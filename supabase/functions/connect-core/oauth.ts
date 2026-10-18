// The authorization server's HTTP face (OAuth 2.1 for MCP): metadata (RFC 8414, RFC 9728), dynamic client registration (RFC 7591),
// /authorize (authorization code + PKCE S256; the person decides on Ryagram's consent page), /token (authorization_code and
// refresh_token), /revoke (RFC 7009). Public clients only (token_endpoint_auth_method none).
//
// Every decision is made in SQL (connect_* functions, tested in supabase/tests/test_connect.py). This file turns HTTP into those
// calls and generates the opaque tokens. Tokens are random, shown once, and only their SHA-256 hash is ever stored.
import type { AuthStore } from "./authstore.ts";

export interface OAuthDeps {
  store: AuthStore;
  /** Public address of this function, no trailing slash, e.g. https://<ref>.supabase.co/functions/v1/connect */
  baseUrl: string;
  /** Where the browser is sent to decide; the request id is appended, e.g. https://uselai.com/app/#/connect/consent?request= */
  consentUrl: string;
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

export const authorizationServerMetadata = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/authorize`,
  token_endpoint: `${base}/token`,
  registration_endpoint: `${base}/register`,
  revocation_endpoint: `${base}/revoke`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  revocation_endpoint_auth_methods_supported: ["none"],
  scopes_supported: SCOPES,
  service_documentation: "https://uselai.com/",
});
/** The same server described the OpenID way, because clients that follow the MCP discovery order for an issuer with a path try
 *  `<issuer>/.well-known/openid-configuration` and Supabase routes nothing else to us. Ryagram issues no ID tokens and has no userinfo;
 *  the OpenID-required fields below are present only so those clients accept the document. `openid` is not a scope we grant. */
export const openIdShapedMetadata = (base: string) => ({
  ...authorizationServerMetadata(base),
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

async function form(req: Request): Promise<URLSearchParams> {
  const raw = await req.text();
  if (raw.length > 8192) return new URLSearchParams();
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try { const o = JSON.parse(raw); return new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])); } catch { return new URLSearchParams(); }
  }
  return new URLSearchParams(raw);
}

export async function handleOAuth(req: Request, route: string, d: OAuthDeps): Promise<Response | null> {
  const { store } = d;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method === "GET" && route.startsWith("/.well-known/oauth-authorization-server")) return json(200, authorizationServerMetadata(d.baseUrl));
  if (req.method === "GET" && route.startsWith("/.well-known/openid-configuration")) return json(200, openIdShapedMetadata(d.baseUrl));
  if (req.method === "GET" && route === "/.well-known/jwks.json") return json(200, { keys: [] });             // we sign no tokens
  if (req.method === "GET" && route.startsWith("/.well-known/oauth-protected-resource")) return json(200, protectedResourceDoc(d.baseUrl));

  if (route === "/register" && req.method === "POST") {
    let body: Record<string, unknown>;
    try { body = JSON.parse((await req.text()).slice(0, 8192)); } catch { return json(400, { error: "invalid_client_metadata", error_description: "Send JSON." }); }
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
    try {
      const id = await store.beginAuthorization({
        clientId: u.get("client_id") ?? "", redirectUri: u.get("redirect_uri") ?? "", state: u.get("state"), codeChallenge: u.get("code_challenge") ?? "",
        method: u.get("code_challenge_method"), scope: u.get("scope"), resource: u.get("resource") });
      return new Response(null, { status: 302, headers: { Location: d.consentUrl + encodeURIComponent(id), ...NO_STORE } });
    } catch (e) {
      // Never redirect an error to an address that has not been validated: show it here instead.
      return text(400, `Ryagram could not start this sign-in. ${WHY[code(e)] ?? "Go back to your assistant and try again."}`);
    }
  }

  if (route === "/token" && req.method === "POST") {
    const p = await form(req);
    const grant = p.get("grant_type");
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
