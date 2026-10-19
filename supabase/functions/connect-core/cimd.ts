// Client ID Metadata Documents (CIMD) for the authorization server: lets "Use Claude's published identity" work.
// PROTOTYPE on the proof project (CONNECT 2026-10-19); see proposals/CONNECT-PUBLISHED-IDENTITY.md.
//
// The client_id is an https address. The ONLY addresses this server ever fetches are the exact ones on the allowlist (CIMD_ALLOWED here, and the
// same list enforced again in SQL by connect_cimd_client), so an assistant can never make this server request an address of its choosing.
// Nothing from the document is trusted except its redirect list, and even that is checked again in SQL against Ryan's redirect allowlist.

/** Claude's hosted-apps identity document (public, published by Anthropic). Ryan's list; every entry is an exact address. */
export const CIMD_ALLOWED: ReadonlySet<string> = new Set(["https://claude.ai/oauth/mcp-oauth-client-metadata"]);

export const CIMD_MAX_BYTES = 4096;
export const CIMD_TIMEOUT_MS = 4000;

export interface CimdResponse { status: number; contentType: string | null; text: string | null }
export type CimdFetcher = (url: string) => Promise<CimdResponse>;
export interface CimdDeps { fetch: CimdFetcher; allowed: ReadonlySet<string> }

/** Is this client_id an https address (so it must be treated as a metadata-document identity, not a registered rgc_ id)? */
export const looksLikeCimd = (clientId: string) => /^https:\/\//i.test(clientId);

export type CimdResult = { ok: true; redirectUris: string[] } | { ok: false; why: string };

/** The checks on a fetched document. Pure, so it is tested without a network. */
export function validateCimd(url: string, res: CimdResponse | null, requestedRedirect: string): CimdResult {
  if (!res) return { ok: false, why: "could not be fetched" };
  if (res.status !== 200) return { ok: false, why: `answered ${res.status}` };
  if (!/^application\/(json|[a-z.+-]*\+json)\b/i.test(res.contentType ?? "")) return { ok: false, why: "is not JSON" };
  if (res.text === null || res.text.length === 0 || new TextEncoder().encode(res.text).byteLength > CIMD_MAX_BYTES) return { ok: false, why: "is empty or too large" };
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(res.text); } catch { return { ok: false, why: "is not valid JSON" }; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, why: "is not a JSON object" };
  if (doc.client_id !== url) return { ok: false, why: "names a different client_id" };
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || uris.some((u) => typeof u !== "string" || u.length > 300)) return { ok: false, why: "has no usable redirect_uris" };
  if (!uris.includes(requestedRedirect)) return { ok: false, why: "does not list the requested redirect address" };
  const method = doc.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return { ok: false, why: "is not a public client" };
  if ("client_secret" in doc || "jwks" in doc || "jwks_uri" in doc) return { ok: false, why: "carries secrets or keys" };
  return { ok: true, redirectUris: uris as string[] };
}

/** The real fetch: https only, no redirect followed, 4 s, at most 4 KB read. A network failure is null. */
export const defaultCimdFetcher: CimdFetcher = async (url) => {
  if (!/^https:\/\//.test(url)) return { status: 0, contentType: null, text: null };
  try {
    const r = await fetch(url, { redirect: "manual", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(CIMD_TIMEOUT_MS) });
    const ct = r.headers.get("content-type");
    if (r.status !== 200 || !r.body) { await r.body?.cancel(); return { status: r.status, contentType: ct, text: null }; }
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > CIMD_MAX_BYTES) { await reader.cancel(); return { status: 200, contentType: ct, text: "x".repeat(CIMD_MAX_BYTES + 1) }; }     // too large: reported as such, never parsed
      chunks.push(value);
    }
    const buf = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
    return { status: 200, contentType: ct, text: new TextDecoder().decode(buf) };
  } catch {
    return { status: 0, contentType: null, text: null };
  }
};

/** A short-lived in-memory copy per isolate, so a burst of sign-ins fetches once. */
const cache = new Map<string, { uris: string[]; until: number }>();
export const CIMD_CACHE_MS = 10 * 60 * 1000;
export function cachedRedirects(url: string, redirect: string, now = Date.now()): string[] | null {
  const hit = cache.get(url);
  return hit && hit.until > now && hit.uris.includes(redirect) ? hit.uris : null;
}
export function rememberRedirects(url: string, uris: string[], now = Date.now()) { cache.set(url, { uris, until: now + CIMD_CACHE_MS }); }
export function forgetCimdCache() { cache.clear(); }
