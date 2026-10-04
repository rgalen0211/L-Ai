// Deleting an account, for the person themselves. Tested in tests/delete-account.test.mjs.
//
// Order matters: files first (the Storage API; database rows can't remove stored files), then the
// login, whose deletion cascades to every row the person owns. A retry after a failure part-way
// is safe: both steps can be repeated.
//
// Refused while a render is in flight (the worker would upload into a deleted account). An account
// with credit history is not hard-deleted: the ledger is an append-only financial record, so the
// request is recorded and Ryan closes the account by hand (QUESTIONS.md, Q6).

export interface Deps {
  allowedOrigins: string[];
  verifyUser(jwt: string): Promise<{ id: string; email: string } | null>;
  check(owner: string): Promise<{ active_jobs: number; has_credit_history: boolean; storage_paths: string[]; upload_paths?: string[] }>;
  removeFiles(paths: string[], bucket?: "uploads"): Promise<void>;
  requestDeletion(owner: string, email: string, reason: string): Promise<void>;
  deleteUser(owner: string): Promise<void>;
}

const BATCH = 100;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.verifyUser(jwt).catch(() => null) : null;
  if (!user) return reply(401, { error: "Sign in first." });

  let body: { confirm_email?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const typed = typeof body.confirm_email === "string" ? body.confirm_email.trim().toLowerCase() : "";
  if (!typed || typed !== (user.email ?? "").trim().toLowerCase()) {
    return reply(400, { error: "Type your account's email address exactly to confirm." });
  }

  let step = "check";
  try {
    const c = await deps.check(user.id);
    if (c.active_jobs > 0) {
      return reply(409, { error: "A render is still running. Cancel it or let it finish, then try again." });
    }
    if (c.has_credit_history) {
      step = "request";
      await deps.requestDeletion(user.id, user.email, "credit history");
      return reply(202, { status: "requested",
        message: "Your account has credit history, which is kept as a financial record. Your request is recorded, and your account and files will be deleted by hand within 30 days." });
    }
    step = "files";
    const paths = (c.storage_paths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${user.id}/`));
    for (let i = 0; i < paths.length; i += BATCH) await deps.removeFiles(paths.slice(i, i + BATCH));
    // Spreadsheets the person uploaded live in their own private bucket.
    const uploads = (c.upload_paths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${user.id}/`));
    for (let i = 0; i < uploads.length; i += BATCH) await deps.removeFiles(uploads.slice(i, i + BATCH), "uploads");
    step = "login";
    await deps.deleteUser(user.id);
    return reply(200, { status: "deleted", files_removed: paths.length + uploads.length });
  } catch (err) {
    console.error(`delete-account ${step}: ${(err as Error).message}`);
    return reply(500, { error: step === "login"
      ? "Your files were removed, but the account couldn't be deleted just now. Try again in a minute."
      : "Nothing was deleted. Try again in a minute." });
  }
}
