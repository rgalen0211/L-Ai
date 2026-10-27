// app-download (NEXT-CONNECT 133, re-aimed at Cloudflare R2): an invited person's link to the desktop app, good for 15 minutes. Tested in tests/app-download.test.mjs.
//
// SQL decides WHO may be handed a link and WHICH file (request_app_download: an invited tester or an admin, not a worker, at most 3 links in 24 hours, an active release, one row written, no address kept);
// this function only checks the person's sign-in and signs ONE object of the PRIVATE bucket. It holds three secrets (the R2 account id and an access key that can only READ that one bucket) in function
// secrets; they are never returned, logged or put in an error. A connected AI's OAuth token is refused (the app is for a person).

export const KINDS = ["app", "addon", "notices"] as const;
export type Kind = typeof KINDS[number];

export interface Release {
  link_id: string; kind: string; file_name: string; size_bytes: number; sha256: string; object_key: string; expires_seconds: number;
}

export interface Deps {
  allowedOrigins: string[];
  /** false until the three R2 secrets and the bucket name are set: the function then answers 503 BEFORE anything is written. */
  configured(): boolean;
  verifyUser(jwt: string): Promise<{ id: string; clientId: string | null } | null>;
  /** request_app_download(owner, kind): throws an Error with the database's SQLSTATE in .code (PT401, PT403, PT404, PT429) and a plain sentence in .message. */
  request(owner: string, kind: Kind): Promise<Release>;
  /** A presigned GET for exactly this object, valid for `seconds`, saved with this file name. */
  presign(objectKey: string, seconds: number, fileName: string): Promise<string>;
}

const PLAIN: Record<string, number> = { PT401: 401, PT403: 403, PT404: 404, PT429: 429 };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.verifyUser(jwt).catch(() => null) : null;
  if (!user) return reply(401, { error: "Sign in first." });
  if (user.clientId) return reply(403, { error: "The app is downloaded by a person on the website, not by a connected AI." });
  let kind: Kind = "app";
  try {                                                                                  // the body is optional: {} or {"kind": "app" | "addon" | "notices"}
    const text = await req.text();
    const body = text.trim() ? JSON.parse(text) : {};
    if (body && typeof body === "object" && "kind" in body) {
      if (!(KINDS as readonly unknown[]).includes(body.kind)) return reply(400, { error: "Bad request." });
      kind = body.kind as Kind;
    }
  } catch {
    return reply(400, { error: "Bad request." });
  }
  if (!deps.configured()) return reply(503, { error: "The download is not set up yet." });

  let rel: Release;
  try {
    rel = await deps.request(user.id, kind);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const status = PLAIN[e.code ?? ""];
    if (status) return reply(status, { error: String(e.message ?? "").slice(0, 300) });         // our own sentence from the database
    console.error(`app-download request: ${e.code ?? "error"}`);
    return reply(500, { error: "The link couldn't be made just now. Try again in a minute." });
  }
  try {
    const url = await deps.presign(rel.object_key, rel.expires_seconds, rel.file_name);
    return reply(200, { url, expires_in: rel.expires_seconds, file_name: rel.file_name, size_bytes: rel.size_bytes, sha256: rel.sha256 });
  } catch {
    console.error("app-download sign failed");                                                    // nothing of the secret or the key in the log
    return reply(500, { error: "The link couldn't be made just now. Try again in a minute." });
  }
}
