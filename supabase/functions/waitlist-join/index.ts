// Ryagram waitlist signup, behind a Cloudflare Turnstile check.
// Deploy with JWT verification off (visitors aren't signed in):
//   npx supabase functions deploy waitlist-join --project-ref <ref> --no-verify-jwt
// Needs the secret TURNSTILE_SECRET_KEY (Dashboard -> Edge Functions -> Secrets).
// Writes only through public.waitlist_join, which only service_role may call.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./logic.ts";

const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  allowedHostnames: ["uselai.com", "www.uselai.com"],
  async verify(token, remoteIp) {
    if (!secret) return { success: false };
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (remoteIp) form.append("remoteip", remoteIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    return await res.json();
  },
  async join(email, useCase) {
    const { error } = await db.rpc("waitlist_join", { p_email: email, p_use_case: useCase, p_source: "uselai.com/ryagram" });
    if (error) throw new Error(error.message);
  },
}));
