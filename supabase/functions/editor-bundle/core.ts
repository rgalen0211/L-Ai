// editor-bundle: the SIGNED READ LINK for the live editor inside the AI chat (CONNECT, 2026-11-05; plan proposals/CONNECT-MCP-APP-PLAN-1105.md section 5.3). NOT DEPLOYED.
// The chat panel (an iframe in somebody else's page) has no site session and must not get one. To draw a data film it needs the film's drawing bundle, so open_editor hands it ONE link that can do ONE thing:
// GET the bundle of ONE project, for at most 10 minutes. The link is not the session and cannot become it: this function accepts no cookie, no Authorization header and no site token, and no other
// function accepts the link.
//   https://<ref>.functions.supabase.co/editor-bundle/<token>        token = base64url(payload) "." base64url(HMAC-SHA256(payload text, EDITOR_LINK_KEY))
//   payload = { v: 1, project_id, owner_hash, scope: "bundle.read", iat, exp, jti }          (seconds; exp - iat <= 600)
// Every refusal is the SAME plain 403 (same status, same bytes, same headers), whatever was wrong, so a caller learns nothing about which check failed. Failing closed is the rule: a missing or short key,
// an unreadable clock, a database that cannot answer, all refuse. The project, its owner and the owner's connector grant are asked about on EVERY read (deps.allowed): nothing is cached across reads,
// so a deleted project, a revoked grant or the connector switched off ends the link at once. The object served is picked by the SERVER from the project id in the token (deps.object), never from the request.
// The token is never logged, never put in an error and never echoed; the only log words are the fixed ones in REASONS.
// Tested offline in tests/connect-read-link.test.mjs; must-fails in tests/connect_read_link_mutants.mjs.

export const LINK_VERSION = 1;
export const LINK_SCOPE = "bundle.read";
export const LINK_MAX_SECONDS = 600;
export const MIN_KEY_CHARS = 32;
const MAX_TOKEN_CHARS = 700;
const CLOCK_SKEW_SECONDS = 60;

export interface LinkClaims { v: number; project_id: string; owner_hash: string; scope: string; iat: number; exp: number; jti: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER_HASH = /^[0-9a-f]{32}$/;
const JTI = /^[0-9a-zA-Z_-]{8,64}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/[+]/g, "-").replace(/[/]/g, "_").replace(/=+$/, "");
}
function fromB64u(text: string): Uint8Array | null {
  if (!B64U.test(text) || text.length % 4 === 1) return null;
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  try {
    const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch { return null; }
}
const hmacKey = (secret: string, usage: "sign" | "verify") => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

/** The owner as the link names them: a SHA-256 of the owner id with a fixed prefix, 32 hex characters, so the token never carries the account id itself. The database function editor_link_check computes the same. */
export async function ownerHash(ownerId: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("ryagram-editor-link:" + ownerId)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** The owner is named by the hash the DATABASE gives the connector for the signed-in person (connect_editor_link_owner), never by an account id: the connector does not hold one. */
export interface MintInput { project_id: string; owner_hash: string; now: number; jti: string; ttl_seconds?: number }

/** Mints a link. The lifetime is capped at LINK_MAX_SECONDS here, whatever the caller asks for. Throws on anything unusable (the caller then returns no link). */
export async function mintLink(secret: string | undefined, p: MintInput): Promise<{ token: string; expires_at: number }> {
  if (typeof secret !== "string" || secret.length < MIN_KEY_CHARS) throw new Error("no link key");
  if (!Number.isFinite(p.now) || !UUID.test(p.project_id) || !JTI.test(p.jti) || typeof p.owner_hash !== "string" || !OWNER_HASH.test(p.owner_hash)) throw new Error("bad link input");
  const asked = p.ttl_seconds === undefined ? LINK_MAX_SECONDS : Math.floor(p.ttl_seconds);
  const ttl = Math.min(LINK_MAX_SECONDS, Math.max(1, Number.isFinite(asked) ? asked : LINK_MAX_SECONDS));
  const iat = Math.floor(p.now);
  const claims: LinkClaims = { v: LINK_VERSION, project_id: p.project_id, owner_hash: p.owner_hash, scope: LINK_SCOPE, iat, exp: iat + ttl, jti: p.jti };
  const payload = toB64u(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(payload)));
  return { token: payload + "." + toB64u(sig), expires_at: claims.exp };
}

/** The claims of a good, unexpired link, or null for anything else (no reason is given). */
export async function verifyLink(secret: string | undefined, token: unknown, now: number): Promise<LinkClaims | null> {
  try {
    if (typeof secret !== "string" || secret.length < MIN_KEY_CHARS) return null;
    if (!Number.isFinite(now)) return null;
    if (typeof token !== "string" || token.length < 10 || token.length > MAX_TOKEN_CHARS) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, sigText] = parts;
    const sig = fromB64u(sigText);
    if (!sig || sig.length !== 32) return null;
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, enc.encode(payload)))) return null;
    const raw = fromB64u(payload);
    if (!raw) return null;
    const c = JSON.parse(dec.decode(raw));
    if (!c || typeof c !== "object" || Array.isArray(c)) return null;
    const keys = Object.keys(c).sort().join(",");
    if (keys !== "exp,iat,jti,owner_hash,project_id,scope,v") return null;
    if (c.v !== LINK_VERSION || c.scope !== LINK_SCOPE) return null;
    if (typeof c.project_id !== "string" || !UUID.test(c.project_id) || typeof c.owner_hash !== "string" || !OWNER_HASH.test(c.owner_hash) || typeof c.jti !== "string" || !JTI.test(c.jti)) return null;
    if (!Number.isInteger(c.iat) || !Number.isInteger(c.exp)) return null;
    if (c.exp <= c.iat || c.exp - c.iat > LINK_MAX_SECONDS) return null;
    if (now >= c.exp || now < c.iat - CLOCK_SKEW_SECONDS) return null;
    return c as LinkClaims;
  } catch { return null; }
}

export interface BundleObject { body: Uint8Array | ReadableStream<Uint8Array>; contentType: string; bytes?: number }

export interface Deps {
  /** the function secret EDITOR_LINK_KEY; undefined or shorter than MIN_KEY_CHARS refuses everything */
  secret(): string | undefined;
  /** seconds since the epoch; anything that is not a finite number refuses everything */
  now(): number;
  /** asked on EVERY read: the connector switch is on, the project exists, its owner hashes to ownerHash, and that owner's connector grant is live. Throwing counts as "no". */
  allowed(projectId: string, ownerHash: string): Promise<boolean>;
  /** the one object of this project, chosen by the server; null when there is none (or the source is not wired yet) */
  object(projectId: string): Promise<BundleObject | null>;
  /** fixed words only (REASONS): never the token, the project or the account */
  log(event: string): void;
}

export const REASONS = ["ok", "method", "credentials", "path", "query", "header", "key", "clock", "token", "denied", "no_object", "source_error"] as const;
export type Reason = (typeof REASONS)[number];

const TYPES = new Set(["application/zip", "application/octet-stream", "application/json"]);
const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
};
const FORBIDDEN_BODY = "Forbidden";
const forbidden = () => new Response(FORBIDDEN_BODY, { status: 403, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

/** Request headers that must never reach this function: a site session, any bearer, and a project named outside the token. */
const REFUSED_HEADERS = ["cookie", "authorization", "x-project-id", "x-project", "x-editor-project"];

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const refuse = (why: Reason) => { try { deps.log(why); } catch { /* logging must never change the answer */ } return forbidden(); };
  try {
    if (req.method !== "GET") {
      deps.log("method");
      return new Response("Use GET.", { status: 405, headers: { ...BASE_HEADERS, Allow: "GET", "Content-Type": "text/plain; charset=utf-8" } });
    }
    for (const h of REFUSED_HEADERS) if (req.headers.has(h)) return refuse(h.startsWith("x-") ? "header" : "credentials");

    const url = new URL(req.url);
    const raw = url.pathname;
    const m = /^[/]editor-bundle[/]([A-Za-z0-9_.-]+)$/.exec(raw);
    if (!m || raw.includes("..") || raw.includes("//") || raw.includes("%")) return refuse("path");
    if (url.search !== "" || url.hash !== "") return refuse("query");

    const secret = deps.secret();
    if (typeof secret !== "string" || secret.length < MIN_KEY_CHARS) return refuse("key");
    const now = deps.now();
    if (typeof now !== "number" || !Number.isFinite(now)) return refuse("clock");

    const claims = await verifyLink(secret, m[1], now);
    if (!claims) return refuse("token");

    let ok = false;
    try { ok = (await deps.allowed(claims.project_id, claims.owner_hash)) === true; } catch { ok = false; }
    if (!ok) return refuse("denied");

    let obj: BundleObject | null;
    try { obj = await deps.object(claims.project_id); } catch { deps.log("source_error"); return new Response("Not available just now.", { status: 503, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } }); }
    if (!obj) { deps.log("no_object"); return new Response("Not available yet.", { status: 404, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } }); }

    const headers: Record<string, string> = { ...BASE_HEADERS, "Content-Type": TYPES.has(obj.contentType) ? obj.contentType : "application/octet-stream" };
    if (typeof obj.bytes === "number" && Number.isInteger(obj.bytes) && obj.bytes >= 0) headers["Content-Length"] = String(obj.bytes);
    deps.log("ok");
    return new Response(obj.body, { status: 200, headers });
  } catch {
    return refuse("token");
  }
}
