// Daily digest (see digest.ts). NOT DEPLOYED. Deploy after review:
//   npx supabase functions deploy ops-digest --project-ref <ref> --no-verify-jwt
// Schedule: Dashboard > Integrations > Cron > daily at 13:00 UTC (08:00 New York in winter, 09:00 in summer) > Edge Function
// ops-digest. Silent when nothing needs action. Dry-run (ops_outbox) until OPS_MAIL_MODE=resend is configured, as ops-tick.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { chooseSender, type Outbox } from "../_shared/ops_mail.ts";
import { handle } from "./digest.ts";

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
const outbox: Outbox = {
  async add(kind, mode, to, subject, body) {
    const { data, error } = await db.rpc("ops_outbox_add", { p_kind: kind, p_mode: mode, p_to: to, p_subject: subject, p_body: body });
    if (error) throw new Error(error.message);
    return data === true;
  },
};

Deno.serve((req) => handle(req, {
  serviceKey,
  jobSecret: Deno.env.get("OPS_DIGEST_SECRET"),
  async data() {
    const { data, error } = await db.rpc("ops_digest_data");
    if (error) throw new Error(error.message);
    return data;
  },
  sender: chooseSender((k) => Deno.env.get(k), outbox, fetch as never),
}));
