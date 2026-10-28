// Send an invite email from Ryagram (see send.ts). NOT DEPLOYED. Deploy after review and after the migration 20261027000800_invite_email.sql is applied:
//   npx supabase functions deploy send-invite --project-ref <ref> --no-verify-jwt
// The JWT is checked inside (verifyAppUser, which refuses an AI's token) and the database checks the caller is an admin. It sends through the ops mail path:
// until OPS_MAIL_MODE=resend (with RESEND_API_KEY and OPS_MAIL_FROM) is set, a send is only SAVED to ops_outbox and the page says so.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { verifyAppUser } from "../_shared/oauth_guard.ts";
import { chooseSender, type Outbox } from "../_shared/ops_mail.ts";
import { handle } from "./send.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";

const sk = resolveServiceKey();            // FUNCTIONS_KEY_NAME picks a key by name; unset = SUPABASE_SERVICE_ROLE_KEY as before (supabase/functions/_shared/service_key.ts)
const serve = guardedServe(sk);

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, sk.forClient, { auth: { persistSession: false } });
const outbox: Outbox = {
  async add(kind, mode, to, subject, body) {
    const { data, error } = await service.rpc("ops_outbox_add", { p_kind: kind, p_mode: mode, p_to: to, p_subject: subject, p_body: body });
    if (error) throw new Error(error.message);
    return data === true;
  },
};
const sender = chooseSender((k) => Deno.env.get(k), outbox, fetch as never);

// A client that acts AS THE CALLER, so the database's own is_app_admin() check decides (the service key would bypass it).
const asCaller = (jwt: string) => createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });

serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  siteUrl: "https://uselai.com",
  verifyUser: (jwt) => verifyAppUser(service.auth, jwt),
  async begin(jwt, code, email) {
    const { data, error } = await asCaller(jwt).rpc("admin_invite_send_begin", { p_code: code, p_email: email });
    if (error) throw new Error(error.message);
    return data;
  },
  async undo(jwt, code) {
    const { error } = await asCaller(jwt).rpc("admin_invite_send_undo", { p_code: code });
    if (error) throw new Error(error.message);
  },
  async send(m) { await sender.send(m); return { mode: sender.mode }; },
}));
