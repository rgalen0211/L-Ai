// Hourly sweep of uploaded spreadsheets (see sweep.ts). Deploy:
//   npx supabase functions deploy purge-uploads --project-ref <ref> --no-verify-jwt
// The service_role key is checked inside as the bearer token, so only the scheduler (or Ryan) can call it.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./sweep.ts";

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });

Deno.serve((req) => handle(req, {
  serviceKey,
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
