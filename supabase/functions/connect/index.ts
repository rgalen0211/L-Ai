// Ryagram AI connections (CONNECT, option B). One Edge Function: the authorization server (OAuth 2.1 + PKCE + DCR) and both faces of
// the tool layer (MCP over Streamable HTTP, and REST/OpenAPI). Deploy (it does its own authentication, so the platform check is off):
//   npx supabase functions deploy connect --project-ref <ref> --no-verify-jwt
//
// Settings (Dashboard > Edge Functions > Secrets; none is ever in the repo or in a log):
//   CONNECT_DB_URL        pooler (transaction mode) connection string for the role connect_runner. That role can execute connect_* only.
//   CONNECT_CONSENT_URL   e.g. https://uselai.com/app/#/connect/consent?request=   (the request id is appended)
//   CONNECT_APP_URL       e.g. https://uselai.com/app/
//   CONNECT_PUBLIC_URL    (optional but recommended) https://<ref>.supabase.co/functions/v1/connect  pins the issuer address
// There is NO Supabase key here: not the service role, not the anon key. The function never reads a Supabase JWT.
import postgres from "npm:postgres@3.4.5";
import Ajv2020 from "npm:ajv@8.17.1/dist/2020.js";
import { makeCompile } from "../connect-core/ajv_adapter.ts";
import { sha256hex, json } from "../connect-core/oauth.ts";
import { handleRequest } from "../connect-core/router.ts";
import { ConnectDb } from "./db.ts";

const dbUrl = Deno.env.get("CONNECT_DB_URL") ?? "";
const consentUrl = Deno.env.get("CONNECT_CONSENT_URL") ?? "";
const appUrl = Deno.env.get("CONNECT_APP_URL") ?? "https://uselai.com/app/";
const publicBase = Deno.env.get("CONNECT_PUBLIC_URL") || undefined;

// A malformed connection string must not take the module down, and its error text must never be printed (it can hold the URL).
// prepare:false because the transaction pooler does not support prepared statements; one connection per isolate.
// deno-lint-ignore no-explicit-any
let sql: any = null;
try { sql = dbUrl ? postgres(dbUrl, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 }) : null; } catch { sql = null; }
const db = new ConnectDb(async (text, params) => {
  if (!sql) throw Object.assign(new Error("not configured"), { code: "CONFIG" });
  return await sql.unsafe(text, params as unknown[]) as unknown as Record<string, unknown>[];
}, appUrl);
const compile = makeCompile(Ajv2020);

Deno.serve(async (req) => {
  try {
    if (!sql || !consentUrl) return json(503, { error: "This connection is not set up yet." });
    return await handleRequest(req, {
      store: db.authStore(), consentUrl, publicBase,
      mcp: {
        data: null as never, policy: db.policy(), deps: { compile },
        async verifyToken(token: string) { return await db.verify(await sha256hex(token)); },
        dataFor: (_t: string, p: { tokenHash: string }) => db.data(p),
      },
    });
  } catch (e) {
    console.error("connect:", (e as { code?: string }).code ?? "error");        // never the message: it could hold a value
    return json(500, { error: "Something went wrong. Try again in a moment." });
  }
});
