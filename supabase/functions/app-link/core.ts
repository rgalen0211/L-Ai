// app-link (NEXT-CONNECT 162): the link in an invite email turns into a 15-minute signed link to the desktop app, ONCE. Tested in tests/app-link.test.mjs.
//
// The email carries a random token in the FRAGMENT of a page on uselai.com (never in a query string, so no server or log sees it). That page asks this function two things, both by POST:
//   {t, action: "peek"}    is the link good, and what would it download (file name and size)? Changes nothing: so a mail program that merely opens the page cannot use the link up.
//   {t, action: "redeem"}  the button: the database marks the link used in ONE step (redeem_invite_app_link) and this function signs the one object of the PRIVATE bucket for 15 minutes.
// The token is never logged, stored or put in an error; the database keeps only its SHA-256. Off until the function secret APP_LINK_ON=1 (and until the R2 secrets are set, for the button).
// An unknown, used, expired or disabled link all get the same plain answer.

export interface Release { kind: string; file_name: string; size_bytes: number; sha256: string; object_key: string; expires_seconds: number }

export interface Deps {
  allowedOrigins: string[];
  /** false unless the function secret APP_LINK_ON is 1: the function then answers 404 to everything but the browser's pre-check. */
  enabled(): boolean;
  /** false until the three R2 secrets and the bucket name are set: the button then answers 503 BEFORE the link is used. */
  configured(): boolean;
  sha256Hex(text: string): Promise<string>;
  peek(tokenHash: string): Promise<{ ok: boolean; file_name?: string; size_bytes?: number }>;
  /** redeem_invite_app_link: throws an Error with SQLSTATE PT404 in .code and a plain sentence for a link that is not good. */
  redeem(tokenHash: string): Promise<Release>;
  presign(objectKey: string, seconds: number, fileName: string): Promise<string>;
}

const TOKEN = /^[0-9a-f]{64}$/;
const NOT_GOOD = "That link has been used, has expired, or is no longer good. If you have a Ryagram account, sign in at uselai.com and use the Download card.";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin", "Access-Control-Allow-Headers": "content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });
  if (!deps.enabled()) return reply(404, { error: "Not found." });

  let body: { t?: unknown; action?: unknown };
  try {
    const text = await req.text();
    if (text.length > 512) return reply(400, { error: "Bad request." });
    body = JSON.parse(text);
  } catch { return reply(400, { error: "Bad request." }); }
  if (!body || typeof body !== "object") return reply(400, { error: "Bad request." });
  if (body.action !== "peek" && body.action !== "redeem") return reply(400, { error: "Bad request." });
  const token = typeof body.t === "string" ? body.t.trim() : "";
  if (!TOKEN.test(token)) return reply(404, { error: NOT_GOOD });                              // the same plain answer as any link that is not good

  const hash = await deps.sha256Hex(token);
  if (body.action === "peek") {
    try {
      const p = await deps.peek(hash);
      if (!p.ok) return reply(404, { error: NOT_GOOD });
      return reply(200, { ok: true, file_name: String(p.file_name ?? ""), size_bytes: Number(p.size_bytes ?? 0) });
    } catch {
      console.error("app-link peek failed");
      return reply(500, { error: "The link couldn't be checked just now. Try again in a minute." });
    }
  }
  if (!deps.configured()) return reply(503, { error: "The download is not set up yet." });
  let rel: Release;
  try {
    rel = await deps.redeem(hash);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "PT404") return reply(404, { error: NOT_GOOD });
    console.error(`app-link redeem: ${e.code ?? "error"}`);                                       // the code only: never the token, the hash or the message
    return reply(500, { error: "The link couldn't be used just now. Try again in a minute." });
  }
  try {
    const url = await deps.presign(rel.object_key, rel.expires_seconds, rel.file_name);
    return reply(200, { url, expires_in: rel.expires_seconds, file_name: rel.file_name, size_bytes: rel.size_bytes, sha256: rel.sha256 });
  } catch {
    console.error("app-link sign failed");                                                        // nothing of the secret or the key in the log
    return reply(500, { error: "The link couldn't be made just now. Sign in at uselai.com and use the Download card." });
  }
}
