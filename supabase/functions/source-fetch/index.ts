// source-fetch: a signed-in person's request to bring one data file from an ALLOWLISTED OFFICIAL host into their uploads (NEXT-CONNECT 137, find-data S2). Deploy (a Ryan row; the JWT is checked inside):
//   npx.cmd supabase functions deploy source-fetch --project-ref <ref> --no-verify-jwt
// Needs migration 20261027000300_find_data_fetch.sql applied first (and the trust-label ones before it). No secret of its own: it uses the project's service key (by name, through _shared/service_key.ts) to call the
// service-role-only fetch_* functions and to put the bytes into the person's slot of the private bucket 'ryagram-uploads'. Nothing here is on until that deploy.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { verifyAppUser } from "../_shared/oauth_guard.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";
import { handle, type Registered } from "./core.ts";

const sk = resolveServiceKey();
const serve = guardedServe(sk);
const service = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient, { auth: { persistSession: false } });

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  async verifyUser(jwt) {
    const u = await verifyAppUser(service.auth, jwt);
    return u ? { id: u.id, clientId: null } : null;
  },
  async hostListed(host) {
    const rows = await rpc("fetch_host_for", { p_host: host });
    return Array.isArray(rows) && rows.length > 0;
  },
  async reserve(owner, host) {
    return String(await rpc("fetch_reserve", { p_owner: owner, p_host: host }));
  },
  async fail(attempt, reason) {
    await rpc("fetch_fail", { p_attempt: attempt, p_reason: reason });
  },
  async register(a) {
    const rows = await rpc("fetch_register", {
      p_attempt: a.attempt, p_owner: a.owner, p_final_url: a.finalUrl, p_ext: a.ext, p_bytes: a.bytes, p_sha256: a.sha256, p_name: a.name,
      p_licence_text: "", p_why: a.why, p_code_version: a.codeVersion,
    });
    return (Array.isArray(rows) ? rows[0] : rows) as Registered;
  },
  async storagePut(path, bytes, contentType) {
    const { error } = await service.storage.from("ryagram-uploads").upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error(error.message);
  },
  async finish(datasetId) {
    await rpc("fetch_finish", { p_dataset: datasetId });
  },
  async abort(datasetId) {
    await rpc("fetch_abort", { p_dataset: datasetId });
  },
  fetch: (url, init) => fetch(url, init),
}));
