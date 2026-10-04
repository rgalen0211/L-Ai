// Removes uploaded spreadsheets that are due to go (the person deleted them, Don't keep and the final film is
// done or 7 days idle, or the file couldn't be read). Tested in tests/purge-uploads.test.mjs.
// Scheduled hourly. Only the service_role key may call it; it takes no input and removes exactly the Storage
// paths the database lists. The database marks a file removed only when Storage no longer has it, so a failed
// delete is simply retried on the next run.

export interface Deps {
  serviceKey: string;
  due(limit: number): Promise<{ dataset_id: string; storage_path: string }[]>;
  remove(paths: string[]): Promise<void>;
  markRemoved(ids: string[]): Promise<number>;
}

const BATCH = 100;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (!deps.serviceKey || req.headers.get("Authorization") !== `Bearer ${deps.serviceKey}`) {
    return new Response("forbidden", { status: 403 });
  }
  let step = "list";
  try {
    const due = (await deps.due(500)).filter((r) => r && typeof r.storage_path === "string" && r.storage_path.includes("/"));
    let removed = 0;
    for (let i = 0; i < due.length; i += BATCH) {
      const batch = due.slice(i, i + BATCH);
      step = "remove";
      try { await deps.remove(batch.map((r) => r.storage_path)); } catch (err) {
        console.error(`purge-uploads remove: ${(err as Error).message}`);   // marked nothing; retried next run
        continue;
      }
      step = "mark";
      removed += await deps.markRemoved(batch.map((r) => r.dataset_id));
    }
    return Response.json({ due: due.length, removed });
  } catch (err) {
    console.error(`purge-uploads ${step}: ${(err as Error).message}`);
    return Response.json({ error: "The sweep failed; it will run again." }, { status: 500 });
  }
}
