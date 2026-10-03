// Beta sign-up by invite code. Visitors aren't signed in, so the platform JWT check is off:
//   npx supabase functions deploy redeem-invite --project-ref <ref> --no-verify-jwt
// No secrets of its own. It needs an email sender: Supabase Auth sends the invite email, which
// only reaches arbitrary addresses once custom SMTP is set (supabase/README.md, "Beta invites").
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./redeem.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
                             { auth: { persistSession: false } });

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  siteUrl: "https://uselai.com",
  reserve: (code, email, ipHash) => rpc("invite_reserve", { p_code: code, p_email: email, p_ip_hash: ipHash }),
  sent: async (redemption, userId) => { await rpc("invite_sent", { p_redemption: redemption, p_user: userId }); },
  release: async (redemption) => { await rpc("invite_release", { p_redemption: redemption }); },
  async invite(email, redirectTo) {
    const { data, error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) {
      const exists = error.code === "email_exists" || /already (been )?registered/i.test(error.message);
      throw Object.assign(new Error(error.message), { code: exists ? "email_exists" : error.code });
    }
    return { userId: data.user?.id ?? null };
  },
}));
