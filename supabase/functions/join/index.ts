// join: "Create an account" with no invite code (see join.ts). NOT DEPLOYED. Deploy after review and after the migrations 20261104000100 and 20261104000200:
//   npx.cmd supabase functions deploy join --project-ref <ref> --no-verify-jwt
// Visitors aren't signed in, so the platform JWT check is off. It needs an email sender: Supabase Auth sends the invite email (custom SMTP, as for redeem-invite).
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./join.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";
import { resolveSiteOrigins, resolveSiteUrl } from "../_shared/site_origins.ts";

const sk = resolveServiceKey();
const serve = guardedServe(sk);
const service = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient, { auth: { persistSession: false } });

serve((req) => handle(req, {
  allowedOrigins: resolveSiteOrigins(),
  siteUrl: resolveSiteUrl(),
  async reserve(email, ipHash) {
    const { data, error } = await service.rpc("join_reserve", { p_email: email, p_ip_hash: ipHash });
    if (error) throw new Error(error.message);
    return data;
  },
  async release(email, ipHash) {
    const { error } = await service.rpc("join_release", { p_email: email, p_ip_hash: ipHash });
    if (error) throw new Error(error.message);
  },
  async invite(email, redirectTo, data) {
    const { error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo, data });
    if (error) {
      const exists = error.code === "email_exists" || /already (been )?registered/i.test(error.message);
      throw Object.assign(new Error(error.message), { code: exists ? "email_exists" : error.code, status: error.status });
    }
  },
}));
