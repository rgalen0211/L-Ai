// The desktop app's door (NEXT-CONNECT 100). One Edge Function, the connector's twin. Deploy (it does its own authentication, so the platform check is off):
//   npx supabase functions deploy node --project-ref <ref> --no-verify-jwt
//
// Settings (Dashboard > Edge Functions > Secrets; none is ever in the repo or in a log):
//   NODE_DB_URL         pooler (transaction mode) connection string for the role node_runner. That role can execute node_* only.
//   NODE_APPROVAL_URL   where the person approves a code, e.g. https://uselai.com/app   (no trailing slash)
//   NODE_SALT           a random string; salts the hash used to rate-limit callers (never the address itself)
//   NODE_UPLOAD_KEY     the ONE key this function holds, used only to sign an upload URL for a path the DATABASE returned. DECISION FOR RYAN AND CC1: on the
//                       Free plan this is the service-role key; it is never read from a request and never sent to the app. See docs/node-function-contract.md.
//   NODE_MAX_FILE_BYTES (optional) the largest single file a node may upload; default 200000000
import postgres from "npm:postgres@3.4.5";
import { handleNode } from "../node-core/router.ts";
import { NodeSql } from "./db.ts";
import { makeStorage } from "./storage.ts";

const dbUrl = Deno.env.get("NODE_DB_URL") ?? "";
const approvalBase = Deno.env.get("NODE_APPROVAL_URL") ?? "";
const salt = Deno.env.get("NODE_SALT") ?? "";
const projectUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const uploadKey = Deno.env.get("NODE_UPLOAD_KEY") ?? "";
const maxFileBytes = Number(Deno.env.get("NODE_MAX_FILE_BYTES") ?? "") || 200_000_000;
const BUCKET = "ryagram-artifacts";

// A malformed connection string must not take the module down, and its error text must never be printed (it can hold the URL).
// deno-lint-ignore no-explicit-any
let sql: any = null;
try { sql = dbUrl ? postgres(dbUrl, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 }) : null; } catch { sql = null; }
const db = new NodeSql(async (text, params) => {
  if (!sql) throw Object.assign(new Error("not configured"), { code: "CONFIG" });
  return await sql.unsafe(text, params as unknown[]) as unknown as Record<string, unknown>[];
});

const storage = makeStorage(projectUrl, uploadKey, BUCKET);

Deno.serve(async (req) => {
  try {
    if (!sql || !approvalBase || !salt || !projectUrl) return new Response(JSON.stringify({ error: "not_ready", message: "This is not set up yet." }), { status: 503, headers: { "Content-Type": "application/json" } });
    const m = /^.*?\/node(\/.*)?$/.exec(new URL(req.url).pathname);
    return await handleNode(req, m ? (m[1] ?? "/") : "/", { db, storage, approvalBase, salt, maxFileBytes });
  } catch {
    // never the message: it could hold a value
    return new Response(JSON.stringify({ error: "server_error", message: "Something went wrong. Try again in a moment." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
