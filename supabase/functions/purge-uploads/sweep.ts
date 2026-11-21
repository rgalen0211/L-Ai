// Removes uploaded spreadsheets that are due to go (the person deleted them, Don't keep and the final film is
// done or 7 days idle, or the file couldn't be read). Tested in tests/purge-uploads.test.mjs.
// Scheduled hourly. Only its OWN per-job secret (PURGE_UPLOADS_SECRET) or the service_role key may call it (the scheduler
// sends the per-job one: pg_net keeps each call where every database login can read it, so the scheduled call must not carry
// the service-role key; see supabase/README.md "Hands-off operations" step 3). It takes no input and removes exactly the Storage
// paths the database lists. The database marks a file removed only when Storage no longer has it, so a failed
// delete is simply retried on the next run.
import { reply, whoCalls } from "../_shared/ops_mail.ts";

export interface Deps {
  serviceKey: string;
  jobSecret?: string;               // PURGE_UPLOADS_SECRET: what the scheduler sends instead of the service-role key
  due(limit: number): Promise<{ dataset_id: string; storage_path: string }[]>;
  remove(paths: string[]): Promise<void>;
  markRemoved(ids: string[]): Promise<number>;
  // WORKER 2026-11-21 (GEO's privacy review M3): the films made FROM a removed upload (the rule is in migration
  // 20261121000200: everything when the person deleted it; the drafts only under Don't keep). Same pattern: list,
  // remove from ryagram-artifacts, then mark only what Storage no longer has.
  dueFilms?(limit: number): Promise<{ artifact_id: string; storage_path: string }[]>;
  removeFilms?(paths: string[]): Promise<void>;
  markFilmsRemoved?(ids: string[]): Promise<number>;
}

const BATCH = 100;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const caller = whoCalls(req, deps.serviceKey, deps.jobSecret);
  if (!caller) return new Response("forbidden", { status: 403 });
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
    // then the films made from removed uploads (after the spreadsheets, so a just-removed upload's films go this run)
    let films: { films_due: number; films_removed: number } | undefined;
    if (deps.dueFilms && deps.removeFilms && deps.markFilmsRemoved) {
      step = "films-list";
      const fdue = (await deps.dueFilms(500)).filter((r) => r && typeof r.storage_path === "string" && r.storage_path.includes("/"));
      let fremoved = 0;
      for (let i = 0; i < fdue.length; i += BATCH) {
        const batch = fdue.slice(i, i + BATCH);
        step = "films-remove";
        try { await deps.removeFilms(batch.map((r) => r.storage_path)); } catch (err) {
          console.error(`purge-uploads films remove: ${(err as Error).message}`);   // marked nothing; retried next run
          continue;
        }
        step = "films-mark";
        fremoved += await deps.markFilmsRemoved(batch.map((r) => r.artifact_id));
      }
      films = { films_due: fdue.length, films_removed: fremoved };
    }
    return reply(caller, 200, { due: due.length, removed, ...(films ?? {}) });
  } catch (err) {
    console.error(`purge-uploads ${step}: ${(err as Error).message}`);
    return reply(caller, 500, { error: "The sweep failed; it will run again." });
  }
}
