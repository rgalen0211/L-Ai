// approve-waiting: Ryan approves a WAITING account and the person is emailed (see approve.ts). NOT DEPLOYED. Deploy after review and after the migration 20261104000100_waiting_accounts.sql:
//   npx.cmd supabase functions deploy approve-waiting --project-ref <ref> --no-verify-jwt
// The JWT is checked inside (verifyActiveUser: an AI's token and a WAITING person are refused) and the database checks the caller is an admin. It sends through the ops mail path:
// until OPS_MAIL_MODE=resend (with RESEND_API_KEY and OPS_MAIL_FROM) is set, a send is only SAVED to ops_outbox and the page says so.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { activeGate, verifyActiveUser } from "../_shared/oauth_guard.ts";
import { chooseSender, type Outbox } from "../_shared/ops_mail.ts";
import { handle } from "./approve.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";

const sk = resolveServiceKey();
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
  verifyUser: (jwt) => verifyActiveUser(service.auth, jwt, activeGate(service)),
  async approve(jwt, userId, reason) {
    const { data, error } = await asCaller(jwt).rpc("admin_approve_waiting", { p_user: userId, p_reason: reason });
    if (error) throw new Error(error.message);
    return data;
  },
  async send(m) { await sender.send(m); return { mode: sender.mode }; },
}));
