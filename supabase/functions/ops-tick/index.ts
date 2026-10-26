// Every-5-minutes health pass (see tick.ts). NOT DEPLOYED. Deploy after review:
//   npx supabase functions deploy ops-tick --project-ref <ref> --no-verify-jwt
// Schedule: Dashboard > Integrations > Cron > every MINUTE > Supabase Edge Function ops-tick, with the Authorization header
// from supabase/README.md. The scheduler sends OPS_TICK_SECRET (its own, per-job) as the bearer token; the service-role key is also accepted, for Ryan running it by hand.
// Mail: dry-run (ops_outbox table) until OPS_MAIL_MODE=resend plus RESEND_API_KEY and OPS_MAIL_FROM are set as secrets.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { chooseSender, type Outbox } from "../_shared/ops_mail.ts";
import { handle } from "./tick.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";

const sk = resolveServiceKey();            // FUNCTIONS_KEY_NAME picks a key by name; unset = SUPABASE_SERVICE_ROLE_KEY as before (supabase/functions/_shared/service_key.ts)
const serve = guardedServe(sk);

const serviceKey = sk.key;
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
const outbox: Outbox = {
  async add(kind, mode, to, subject, body) {
    const { data, error } = await db.rpc("ops_outbox_add", { p_kind: kind, p_mode: mode, p_to: to, p_subject: subject, p_body: body });
    if (error) throw new Error(error.message);
    return data === true;
  },
};

serve((req) => handle(req, {
  serviceKey,
  jobSecret: Deno.env.get("OPS_TICK_SECRET"),
  async tick() {
    const { data, error } = await db.rpc("ops_tick");
    if (error) throw new Error(error.message);
    return data;
  },
  async purge() {
    const { data, error } = await db.rpc("retention_purge");
    if (error) throw new Error(error.message);
    return data;
  },
  async orders() {
    const { data, error } = await db.rpc("render_orders_tick");
    if (error) throw new Error(error.message);
    return data;
  },
  async removeArtifacts(paths) {
    const { error } = await db.storage.from("ryagram-artifacts").remove(paths);
    if (error) throw new Error(error.message);
  },
  async markNotified(keys) {
    const { data, error } = await db.rpc("ops_mark_notified", { p_keys: keys });
    if (error) throw new Error(error.message);
    return data ?? 0;
  },
  sender: chooseSender((k) => Deno.env.get(k), outbox, fetch as never),
}));
