// Hourly sweep of uploaded spreadsheets (see sweep.ts). Deploy:
//   npx supabase functions deploy purge-uploads --project-ref <ref> --no-verify-jwt
// The scheduler sends PURGE_UPLOADS_SECRET (its own per-job secret) as the bearer token; the service_role key is also accepted, for Ryan running it by hand.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./sweep.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";

const sk = resolveServiceKey();            // FUNCTIONS_KEY_NAME picks a key by name; unset = SUPABASE_SERVICE_ROLE_KEY as before (supabase/functions/_shared/service_key.ts)
const serve = guardedServe(sk);

const serviceKey = sk.key;
const db = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient, { auth: { persistSession: false } });

serve((req) => handle(req, {
  serviceKey,
  jobSecret: Deno.env.get("PURGE_UPLOADS_SECRET"),
  async due(limit) {
    const { data, error } = await db.rpc("uploads_due_for_deletion", { p_limit: limit });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
  async remove(paths) {
    const { error } = await db.storage.from("ryagram-uploads").remove(paths);
    if (error) throw new Error(error.message);
  },
  async markRemoved(ids) {
    const { data, error } = await db.rpc("mark_uploads_removed", { p_dataset_ids: ids });
    if (error) throw new Error(error.message);
    return data ?? 0;
  },
}));
