// The authorization server's HTTP face (OAuth 2.1 for MCP): metadata (RFC 8414, RFC 9728), dynamic client registration (RFC 7591),
// /authorize (authorization code + PKCE S256; the person decides on Ryagram's consent page), /token (authorization_code and
// refresh_token), /revoke (RFC 7009). Public clients only (token_endpoint_auth_method none).
//
// Every decision is made in SQL (connect_* functions, tested in supabase/tests/test_connect.py). This file turns HTTP into those
// calls and generates the opaque tokens. Tokens are random, shown once, and only their SHA-256 hash is ever stored.
import type { AuthStore } from "./authstore.ts";
import { cachedRedirects, type CimdDeps, looksLikeCimd, rememberRedirects, validateCimd } from "./cimd.ts";

/** The address of the caller as a salted daily hash (never stored or logged as an address), or null when the request carries none. */
export async function callerKey(req: Request): Promise<string | null> {
  const cf = (req.headers.get("cf-connecting-ip") ?? "").trim();
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const ip = cf || hops[hops.length - 1] || "";              // the LAST hop: the one the gateway added, never the first (that one is the caller's to forge)
  return ip ? await sha256hex(`${new Date().toISOString().slice(0, 10)}|ryagram-connect|${ip}`) : null;
}

export interface OAuthDeps {
  store: AuthStore;
  /** Public address of this function, no trailing slash, e.g. https://<ref>.supabase.co/functions/v1/connect */
  baseUrl: string;
  /** Where the browser is sent to decide; the request id is appended, e.g. https://uselai.com/app/#/connect/consent?request= */
  consentUrl: string;
  /** Client ID Metadata Documents ("Use Claude's published identity"). Absent = not supported: the metadata does not advertise it and an https client_id is refused. */
  cimd?: CimdDeps;
}

export const SCOPES = ["read", "write", "render_free"];
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
               "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "600" };

export const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...NO_STORE, ...CORS, ...extra } });
const text = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function randomToken(prefix: string): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return prefix + btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const authorizationServerMetadata = (base: string, cimd = false) => ({
  issuer: base,
  authorization_endpoint: `${base}/authorize`,
  token_endpoint: `${base}/token`,
  registration_endpoint: `${base}/register`,
  revocation_endpoint: `${base}/revoke`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  authorization_response_iss_parameter_supported: true,           // RFC 9207: the redirect carries iss = this issuer
  token_endpoint_auth_methods_supported: ["none"],
  revocation_endpoint_auth_methods_supported: ["none"],
  scopes_supported: SCOPES,
  service_documentation: "https://uselai.com/",
  ...(cimd ? { client_id_metadata_document_supported: true } : {}),
});
/** The same server described the OpenID way, because clients that follow the MCP discovery order for an issuer with a path try
 *  `<issuer>/.well-known/openid-configuration` and Supabase routes nothing else to us. Ryagram issues no ID tokens and has no userinfo;
 *  the OpenID-required fields below are present only so those clients accept the document. `openid` is not a scope we grant. */
export const openIdShapedMetadata = (base: string, cimd = false) => ({
  ...authorizationServerMetadata(base, cimd),
  jwks_uri: `${base}/.well-known/jwks.json`,
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
});
export const protectedResourceDoc = (base: string) => ({
  resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"],
  scopes_supported: SCOPES, resource_name: "Ryagram", resource_documentation: "https://uselai.com/",
});

/** The plain words behind an OAuth error code from the database. */
const WHY: Record<string, string> = {
  invalid_client: "This assistant is not registered with Ryagram. Remove the connection and add it again.",
  invalid_redirect_uri: "This assistant's return address is not on Ryagram's list of allowed addresses.",
  invalid_request: "The sign-in request was incomplete or used a method Ryagram does not allow.",
};
const code = (e: unknown) => /^([a-z_]+)/.exec(String((e as Error)?.message ?? ""))?.[1] ?? "";
const status = (e: unknown) => /^PT(\d{3})$/.test((e as { code?: string })?.code ?? "") ? Number((e as { code: string }).code.slice(2)) : 0;

/** The body as text, refusing more than `max` BYTES before decoding. null = too large. */
async function bodyText(req: Request, max = 8192): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > max ? null : new TextDecoder().decode(buf);
}

async function form(req: Request): Promise<URLSearchParams> {
  const raw = await bodyText(req);
  if (raw === null) return new URLSearchParams();
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try { const o = JSON.parse(raw); return new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])); } catch { return new URLSearchParams(); }
  }
  return new URLSearchParams(raw);
}

/** null = the client is now registered (or already was) and the sign-in may go on; otherwise the plain-words reason it may not. */
async function resolveCimdClient(clientId: string, redirectUri: string, d: OAuthDeps): Promise<string | null> {
  const NOT_REGISTERED = WHY.invalid_client;
  if (!d.cimd || !d.store.registerCimdClient || !d.cimd.allowed.has(clientId)) return NOT_REGISTERED;        // not on the list: nothing is fetched
  if (cachedRedirects(clientId, redirectUri)) return null;
  const res = validateCimd(clientId, await d.cimd.fetch(clientId), redirectUri);
  if (!res.ok) return "The assistant's identity document was not accepted. Go back to your assistant and try again, or choose 'Register automatically' when adding it.";
  try { await d.store.registerCimdClient(clientId, res.redirectUris); } catch (e) { return WHY[code(e)] ?? NOT_REGISTERED; }
  rememberRedirects(clientId, res.redirectUris);
  return null;
}

export async function handleOAuth(req: Request, route: string, d: OAuthDeps): Promise<Response | null> {
  const { store } = d;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // Per-caller limits on the endpoints anyone can reach (each insert or lookup costs a database round trip). Over the limit: 429, nothing runs.
  const LIMITS_: Record<string, [string, number, number]> = { "/register": ["register", 10, 3600], "/authorize": ["authorize", 30, 600],
    "/token": ["token", 60, 600], "/revoke": ["revoke", 30, 600] };
  const lim = LIMITS_[route];
  if (lim) {
    const who = await callerKey(req);
    let ok = true;
    try { ok = who ? await store.hit(who, lim[0], lim[1], lim[2]) : true; } catch { ok = true; }       // a limiter that is down never locks the door
    if (!ok) return json(429, { error: "slow_down", error_description: "Too many requests. Wait a few minutes." }, { "Retry-After": "300" });
  }

  if (req.method === "GET" && route.startsWith("/.well-known/oauth-authorization-server")) return json(200, authorizationServerMetadata(d.baseUrl, !!d.cimd));
  if (req.method === "GET" && route.startsWith("/.well-known/openid-configuration")) return json(200, openIdShapedMetadata(d.baseUrl, !!d.cimd));
  if (req.method === "GET" && route === "/.well-known/jwks.json") return json(200, { keys: [] });             // we sign no tokens
  if (req.method === "GET" && route.startsWith("/.well-known/oauth-protected-resource")) return json(200, protectedResourceDoc(d.baseUrl));

  if (route === "/register" && req.method === "POST") {
    let body: Record<string, unknown>;
    const raw = await bodyText(req);
    try { body = JSON.parse(raw ?? ""); } catch { return json(400, { error: "invalid_client_metadata", error_description: "Send JSON." }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "invalid_client_metadata", error_description: "Send a JSON object." });
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.some((u) => typeof u !== "string")) return json(400, { error: "invalid_redirect_uri", error_description: "redirect_uris must be a list of addresses." });
    const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "AI assistant";
    try {
      const id = await store.registerClient(name, uris as string[]);
      return json(201, { client_id: id, client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"], token_endpoint_auth_method: "none", client_id_issued_at: Math.floor(Date.now() / 1000) });
    } catch (e) {
      const c = code(e);
      return json(status(e) === 429 ? 429 : 400, { error: c === "invalid_redirect_uri" ? "invalid_redirect_uri" : "invalid_client_metadata",
        error_description: WHY[c] ?? "Registration was refused." });
    }
  }

  if (route === "/authorize" && (req.method === "GET" || req.method === "POST")) {
    const u = req.method === "GET" ? new URL(req.url).searchParams : await form(req);
    if (u.get("response_type") !== "code") return text(400, "Ryagram can only start a sign-in with response_type=code.");
    const resource = u.get("resource");                                                      // RFC 8707: it must name THIS server
    if (resource && resource !== `${d.baseUrl}/mcp` && resource !== d.baseUrl) return text(400, "Ryagram could not start this sign-in. The assistant asked for a different server (invalid_target).");
    if ((u.get("state") ?? "").length > 512) return text(400, "Ryagram could not start this sign-in. The state value is too long.");
    const wantedClient = u.get("client_id") ?? "";
    if (looksLikeCimd(wantedClient)) {                                                        // an https client_id: only an allowlisted address is ever fetched
      const refused = await resolveCimdClient(wantedClient, u.get("redirect_uri") ?? "", d);
      if (refused) return text(400, `Ryagram could not start this sign-in. ${refused}`);
    }
    try {
      const id = await store.beginAuthorization({
        clientId: u.get("client_id") ?? "", redirectUri: u.get("redirect_uri") ?? "", state: u.get("state"), codeChallenge: u.get("code_challenge") ?? "",
        method: u.get("code_challenge_method"), scope: u.get("scope"), resource: u.get("resource"), issuer: d.baseUrl });
      return new Response(null, { status: 302, headers: { Location: d.consentUrl + encodeURIComponent(id), ...NO_STORE } });
    } catch (e) {
      // Never redirect an error to an address that has not been validated: show it here instead.
      return text(400, `Ryagram could not start this sign-in. ${WHY[code(e)] ?? "Go back to your assistant and try again."}`);
    }
  }

  if (route === "/token" && req.method === "POST") {
    const p = await form(req);
    const grant = p.get("grant_type");
    if (!grant) return json(400, { error: "invalid_request", error_description: "grant_type is required." });
    if (p.get("client_secret") || (req.headers.get("authorization") ?? "").toLowerCase().startsWith("basic ")) {
      return json(401, { error: "invalid_client", error_description: "Ryagram connections are public clients: send client_id only." });
    }
    const access = randomToken("rga_"), refresh = randomToken("rgr_");
    const [aHash, rHash] = await Promise.all([sha256hex(access), sha256hex(refresh)]);
    try {
      let r: Record<string, unknown>;
      if (grant === "authorization_code") {
        r = await store.exchangeCode({ codeHash: await sha256hex(p.get("code") ?? ""), clientId: p.get("client_id") ?? "",
          redirectUri: p.get("redirect_uri") ?? "", verifier: p.get("code_verifier") ?? "", accessHash: aHash, refreshHash: rHash });
      } else if (grant === "refresh_token") {
        r = await store.refresh({ refreshHash: await sha256hex(p.get("refresh_token") ?? ""), clientId: p.get("client_id") ?? "", accessHash: aHash, newRefreshHash: rHash });
      } else {
        return json(400, { error: "unsupported_grant_type" });
      }
      if (r.error) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: access, token_type: "Bearer", expires_in: r.expires_in, refresh_token: refresh, scope: r.scope });
    } catch (e) {
      return status(e) === 400 ? json(400, { error: "invalid_grant" }) : json(500, { error: "server_error" });
    }
  }

  if (route === "/revoke" && req.method === "POST") {
    const p = await form(req);
    const t = p.get("token");
    if (t) { try { await store.revoke(await sha256hex(t)); } catch { /* RFC 7009: always 200 */ } }
    return json(200, {});
  }
  return null;
}
