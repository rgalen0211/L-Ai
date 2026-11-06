// editor-bundle: the signed read link for the live editor inside the AI chat (CONNECT, 2026-11-05; plan 5.3; rules and must-fails in core.ts and tests/connect-read-link.test.mjs). NOT DEPLOYED.
// Deploy after review and after migration 20261105000200_editor_link_check.sql is applied (a Ryan row). The link IS the credential, so the function takes no login and is deployed without the gateway's JWT check:
//   npx.cmd supabase functions deploy editor-bundle --project-ref <ref> --no-verify-jwt
// It refuses any request that carries an Authorization header or a cookie (core.ts), so deploying without the JWT check adds no way in for a site session.
// Secrets: EDITOR_LINK_KEY (at least 32 random characters; the SAME value as on the connector function, which makes the links). Without it every request is the plain 403.
// The drawing bundle's home is not decided yet (asked of WEB and ENGINE, plan section 9): until they say, object() answers "not available yet" and nothing is read from storage.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";
import { handle } from "./core.ts";

const sk = resolveServiceKey();
const serve = guardedServe(sk);
const service = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient, { auth: { persistSession: false } });

serve((req) => handle(req, {
  secret: () => Deno.env.get("EDITOR_LINK_KEY"),
  now: () => Math.floor(Date.now() / 1000),
  async allowed(projectId, ownerHash) {
    const { data, error } = await service.rpc("editor_link_check", { p_project: projectId, p_owner_hash: ownerHash });
    if (error) throw new Error("check failed");
    return data === true;
  },
  async object() { return null; },
  log: (event) => console.log("editor-bundle " + event),
}));
