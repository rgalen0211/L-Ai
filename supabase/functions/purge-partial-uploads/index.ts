// Deletes partial uploads 24 hours after their job ended without completing.
// Scheduled (e.g. hourly, see supabase/README.md). Runs with the service_role key that Supabase
// gives every Edge Function; it only ever calls partial_uploads_due and mark_uploads_deleted,
// and removes exactly the Storage paths the database lists. It takes no input.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

Deno.serve(async (req) => {
  // Only the scheduler (or Ryan) calls this, with the service_role key as the bearer token.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return new Response("forbidden", { status: 403 });
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: due, error } = await db.rpc("partial_uploads_due", { p_limit: 500 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let removed = 0;
  const byBucket = new Map<string, { ids: string[]; paths: string[] }>();
  for (const row of due ?? []) {
    const group = byBucket.get(row.bucket) ?? { ids: [], paths: [] };
    group.ids.push(row.artifact_id);
    group.paths.push(row.storage_path);
    byBucket.set(row.bucket, group);
  }
  for (const [bucket, { ids, paths }] of byBucket) {
    // Remove the files, then ask the database to mark them deleted. It marks only rows whose
    // Storage object is really gone, so a failed delete is simply retried on the next run.
    await db.storage.from(bucket).remove(paths);
    const { data: count } = await db.rpc("mark_uploads_deleted", { p_artifact_ids: ids });
    removed += count ?? 0;
  }
  return Response.json({ due: due?.length ?? 0, removed });
});
