// One router for the whole `connect` function, kept out of index.ts so tests can run it (with the real MCP SDK client) without Deno.
//
// Discovery on Supabase: the function lives at https://<ref>.supabase.co/functions/v1/connect, a URL WITH a path. MCP clients follow the
// spec's order for such an issuer (RFC 8414 with the path inserted, OpenID with the path inserted, OpenID with the path appended). Supabase
// routes only /functions/v1/connect/* to us, never /.well-known/* at the host root, so the only discovery URLs that can reach this
// function are the ones under its own address. We serve the OAuth document AND an OpenID-shaped document there. A client that is
// told where the resource metadata is (the WWW-Authenticate header on the 401, RFC 9728) goes straight to it.
import type { AuthStore } from "./authstore.ts";
import { handleMcp, type McpDeps } from "./mcp.ts";
import { handleOAuth, json } from "./oauth.ts";
import { handleRest } from "./rest.ts";

export interface RouterDeps {
  store: AuthStore;
  consentUrl: string;
  /** Pin the public address (CONNECT_PUBLIC_URL). Without it the address is derived from the request, which is only as trustworthy as the gateway. */
  publicBase?: string;
  mcp: Omit<McpDeps, "resourceMetadataUrl">;
}

/** The public address of the function and the route inside it. */
export function baseAndRoute(req: Request, publicBase?: string): { base: string; route: string } {
  const u = new URL(req.url);
  const m = /^(.*?\/connect)(\/.*)?$/.exec(u.pathname);
  const prefix = m ? m[1] : "";
  const route = m ? (m[2] ?? "/") : u.pathname;
  if (publicBase) return { base: publicBase.replace(/\/+$/, ""), route };
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  // Supabase serves functions under /functions/v1/<name>; behind the gateway the path we see may omit /functions/v1.
  const pre = prefix.startsWith("/functions/v1") ? prefix : `/functions/v1${prefix}`;
  return { base: `${proto}://${host}${pre}`, route };
}

export async function handleRequest(req: Request, d: RouterDeps): Promise<Response> {
  const { base, route } = baseAndRoute(req, d.publicBase);
  const oauth = await handleOAuth(req, route, { store: d.store, baseUrl: base, consentUrl: d.consentUrl });
  if (oauth) return oauth;
  const deps: McpDeps = { ...d.mcp, resourceMetadataUrl: `${base}/.well-known/oauth-protected-resource` };
  if (route === "/mcp" || route === "/") return await handleMcp(req, deps);
  return await handleRest(req, route, deps, base);
}

export { json };
