// Ryagram AI connections (CONNECT, option B). One Edge Function: the authorization server (OAuth 2.1 + PKCE + DCR) and both faces of
// the tool layer (MCP over Streamable HTTP, and REST/OpenAPI). Deploy (it does its own authentication, so the platform check is off):
//   npx supabase functions deploy connect --project-ref <ref> --no-verify-jwt
//
// Secrets (Dashboard > Edge Functions > Secrets, never in the repo, never logged):
//   CONNECT_DB_URL    pooler (transaction mode) connection string for the role connect_runner. That role can execute connect_* only.
//   CONNECT_CONSENT_URL   e.g. https://uselai.com/app/#/connect/consent?request=   (the request id is appended)
//   CONNECT_APP_URL       e.g. https://uselai.com/app/
// There is NO Supabase key here: not the service role, not the anon key. The function never reads a Supabase JWT.
import postgres from "npm:postgres@3.4.5";
import Ajv2020 from "npm:ajv@8.17.1/dist/2020";
import { makeCompile } from "../connect-core/ajv_adapter.ts";
import { handleMcp, protectedResourceMetadata } from "../connect-core/mcp.ts";
import { handleOAuth, json, sha256hex } from "../connect-core/oauth.ts";
import { handleRest } from "../connect-core/rest.ts";
import { ConnectDb } from "./db.ts";

const dbUrl = Deno.env.get("CONNECT_DB_URL") ?? "";
const consentUrl = Deno.env.get("CONNECT_CONSENT_URL") ?? "";
const appUrl = Deno.env.get("CONNECT_APP_URL") ?? "https://uselai.com/app/";

// prepare:false because the transaction pooler does not support prepared statements; one connection per isolate.
const sql = dbUrl ? postgres(dbUrl, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 }) : null;
const db = new ConnectDb(async (text, params) => {
  if (!sql) throw new Error("not configured");
  // deno-lint-ignore no-explicit-any
  return await sql.unsafe(text, params as any[]) as unknown as Record<string, unknown>[];
}, appUrl);
const compile = makeCompile(Ajv2020);

/** The address this function is reached at, from the request (works behind the Supabase gateway). */
function baseOf(req: Request): { base: string; route: string } {
  const u = new URL(req.url);
  const m = /^(.*?\/connect)(\/.*)?$/.exec(u.pathname);
  const prefix = m ? m[1] : "";
  const route = m ? (m[2] ?? "/") : u.pathname;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  // Supabase serves functions under /functions/v1/<name>; behind the gateway the path we see may omit /functions/v1.
  const pre = prefix.startsWith("/functions/v1") ? prefix : `/functions/v1${prefix}`;
  return { base: `${proto}://${host}${pre}`, route };
}

Deno.serve(async (req) => {
  const { base, route } = baseOf(req);
  try {
    if (!sql || !consentUrl) return json(503, { error: "This connection is not set up yet." });
    const oauth = await handleOAuth(req, route, { store: db.authStore(), baseUrl: base, consentUrl });
    if (oauth) return oauth;

    const deps = {
      data: null as never, policy: db.policy(), deps: { compile },
      async verifyToken(token: string) { return await db.verify(await sha256hex(token)); },
      dataFor: (_t: string, p: { tokenHash: string }) => db.data(p),
      resourceMetadataUrl: `${base}/.well-known/oauth-protected-resource`,
    };
    if (route === "/mcp" || route === "/") return await handleMcp(req, deps);
    if (route === "/.well-known/mcp") return json(200, protectedResourceMetadata(`${base}/mcp`, base));
    return await handleRest(req, route, deps, base, base);
  } catch (e) {
    console.error("connect:", (e as { code?: string }).code ?? "error");        // never the message: it could hold a value
    return json(500, { error: "Something went wrong. Try again in a moment." });
  }
});
