// OAuth premise proof, part 2: the doors the first run did not cover (CC1's list): Supabase Auth user endpoints
// (read email, change metadata / password / email, enrol 2FA), GraphQL, and Realtime. THROWAWAY PROJECT ONLY.
//   node tools/oauth_proof/doors.mjs <label>        e.g. "before-fix" or "after-fix"
// Prints only statuses. Never prints a key, token, password or claim value. Writes result-doors-<label>.json.
// Destructive probes (password change) run on a SECOND throwaway user created here, not on the first one.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { decodeJwt } from 'jose';

const DIR = 'D:/Ryagram-scratch/oauth-proof';
const label = process.argv[2] ?? 'run';
const env = {};
for (const line of fs.readFileSync(path.join(DIR, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env.SUPABASE_URL.replace(/\/+$/, ''), PK = env.SUPABASE_PUBLISHABLE_KEY, SK = env.SUPABASE_SECRET_KEY;
try { const live = fs.readFileSync('C:/Users/Ryan/Documents/GitHub/L-Ai/supabase/.temp/project-ref', 'utf8').trim(); if (live && URL_.includes(live)) { console.error('REFUSED: live project.'); process.exit(3); } } catch { /* none */ }

const H = (key, bearer) => ({ apikey: key, Authorization: `Bearer ${bearer ?? key}`, 'Content-Type': 'application/json' });
async function call(method, url, headers, body) {
  const r = await fetch(url, { method, headers, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, headers: r.headers, json, text };
}

// ---- a fresh user per probe set, each with an app session (S) and an OAuth token (T) ---------------------------------
const meta = (await call('GET', `${URL_}/.well-known/oauth-authorization-server/auth/v1`, {})).json;
const REDIRECT = 'http://localhost:8789/cb';
const made = [];
async function freshUser() {
  const u = { email: `door-${crypto.randomBytes(5).toString('hex')}@example.test`, password: crypto.randomBytes(18).toString('base64url') };
  let r = await call('POST', `${URL_}/auth/v1/admin/users`, H(SK), { ...u, email_confirm: true });
  if (r.status >= 300) { console.error('could not create a user:', r.status); process.exit(4); }
  const id = r.json.id; made.push(id);
  r = await call('POST', `${URL_}/auth/v1/token?grant_type=password`, H(PK), u);
  const S = r.json.access_token, S_REFRESH = r.json.refresh_token;
  const reg = await call('POST', meta.registration_endpoint, { 'Content-Type': 'application/json' }, { client_name: 'Doors client', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
  const clientId = reg.json.client_id;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 's', scope: 'openid' });
  const az = await call('GET', `${meta.authorization_endpoint}?${q}`, {});
  const authzId = new URL(az.headers.get('location'), URL_).searchParams.get('authorization_id');
  const sb = createClient(URL_, PK, { auth: { persistSession: false, autoRefreshToken: false } });
  const ss = await sb.auth.setSession({ access_token: S, refresh_token: S_REFRESH });
  if (ss.error) { await cleanup(); console.error('setSession failed:', ss.error.message); process.exit(6); }
  await sb.auth.oauth.getAuthorizationDetails(authzId);
  const ap = await sb.auth.oauth.approveAuthorization(authzId);
  if (ap.error || !ap.data) { await cleanup(); console.error('approve failed:', ap.error?.message ?? 'no data'); process.exit(7); }
  const code = new URL(ap.data.redirect_url).searchParams.get('code');
  const tk = await call('POST', meta.token_endpoint, { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }).toString());
  return { id, S, T: tk.json.access_token, R: tk.json.refresh_token, clientId, tokenEndpoint: meta.token_endpoint };
}
async function cleanup() { for (const id of made) await call('DELETE', `${URL_}/auth/v1/admin/users/${id}`, H(SK)); }
const UA = await freshUser();   // probed with its app session
const UB = await freshUser();   // probed with its OAuth token
const UC = await freshUser();   // the Realtime pair: S inserts, both tokens listen
const claimsT = decodeJwt(UB.T);
console.log('OAuth token has client_id:', !!claimsT.client_id, '| aud claim is', JSON.stringify(claimsT.aud), '| role claim is', JSON.stringify(claimsT.role));

const out = { label, at: new Date().toISOString(), claims: {}, rest: {}, auth_endpoints: {}, graphql: {}, realtime: {} };
// What the two tokens look like, and whether a REFRESHED OAuth token keeps the same shape.
out.claims.oauth_aud = decodeJwt(UB.T).aud; out.claims.oauth_role = decodeJwt(UB.T).role; out.claims.app_aud = decodeJwt(UA.S).aud;
const rf = await call('POST', UB.tokenEndpoint, { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: UB.R, client_id: UB.clientId }).toString());
out.claims.refresh_status = rf.status;
if (rf.status === 200) { const c = decodeJwt(rf.json.access_token); out.claims.refreshed_aud = c.aud; out.claims.refreshed_has_client_id = !!c.client_id; }
// Can the Ryagram connection functions still be called through PostgREST with each token?
out.rest.app_session_connect_probe = (await call('POST', `${URL_}/rest/v1/rpc/connect_probe`, H(PK, UA.S), {})).status;
out.rest.oauth_token_connect_probe = (await call('POST', `${URL_}/rest/v1/rpc/connect_probe`, H(PK, UB.T), {})).status;
out.rest.oauth_token_table_select = (await call('GET', `${URL_}/rest/v1/proof_notes?select=id`, H(PK, UB.T))).status;
const ok = (s) => typeof s === 'number' && s >= 200 && s < 300;

// ---- Supabase Auth user endpoints, with each token ---------------------------------------------------------------------
async function authDoors(who, tok) {
  const o = {};
  o['read user (email)'] = (await call('GET', `${URL_}/auth/v1/user`, H(PK, tok))).status;
  o['write user metadata'] = (await call('PUT', `${URL_}/auth/v1/user`, H(PK, tok), { data: { probe: who } })).status;
  const enrol = await call('POST', `${URL_}/auth/v1/factors`, H(PK, tok), { factor_type: 'totp', friendly_name: `probe-${who}` });
  o['enrol 2FA factor'] = enrol.status;
  if (ok(enrol.status) && enrol.json?.id) await call('DELETE', `${URL_}/auth/v1/factors/${enrol.json.id}`, H(PK, tok));   // tidy up
  o['change email'] = (await call('PUT', `${URL_}/auth/v1/user`, H(PK, tok), { email: `moved-${who}-${crypto.randomBytes(3).toString('hex')}@example.test` })).status;
  o['change password'] = (await call('PUT', `${URL_}/auth/v1/user`, H(PK, tok), { password: crypto.randomBytes(18).toString('base64url') })).status;
  o['list own factors/identities'] = (await call('GET', `${URL_}/auth/v1/user/identities/authorize?provider=github`, H(PK, tok))).status;
  return o;
}
// Run the OAuth token first: if it can change the password, the app session's own password then is stale, and S is
// already in hand, so the app-session run still works with its access token.
out.auth_endpoints.app_session = await authDoors('app', UA.S);
out.auth_endpoints.oauth_token = await authDoors('oauth', UB.T);

// ---- GraphQL --------------------------------------------------------------------------------------------------------------
for (const [who, tok] of [['app_session', UA.S], ['oauth_token', UB.T]]) {
  const t = await call('POST', `${URL_}/graphql/v1`, H(PK, tok), { query: '{ __typename }' });
  const c = await call('POST', `${URL_}/graphql/v1`, H(PK, tok), { query: '{ proof_notesCollection { edges { node { id } } } }' });
  out.graphql[who] = { typename: t.status, table_collection: c.status, table_collection_errors: Array.isArray(c.json?.errors) ? c.json.errors.length : 0 };
}

// ---- Realtime: does a subscriber with each token receive row changes of a table in the realtime publication? -----------------
// Setup needed first (realtime_1_publication.sql). The change is made by the OTHER user's owner row path: user 2 inserts
// into proof_notes (owner policy), so both tokens belong to the SAME person and RLS would show it to both.
async function listen(tok, ms = 6000) {
  const c = createClient(URL_, PK, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 5 } } });
  await c.realtime.setAuth(tok);
  const got = []; let subscribed = false;
  const ch = c.channel(`probe-${crypto.randomBytes(3).toString('hex')}`).on('postgres_changes', { event: '*', schema: 'public', table: 'proof_notes' }, (p) => got.push(p.eventType));
  await new Promise((res) => { ch.subscribe((st) => { if (st === 'SUBSCRIBED') { subscribed = true; res(); } if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(st)) res(); }); setTimeout(res, 5000); });
  await new Promise((res) => setTimeout(res, 500));
  const insertWith = createClient(URL_, PK, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${UC.S}` } } });
  await insertWith.from('proof_notes').insert({ body: 'rt' });
  await new Promise((res) => setTimeout(res, ms - 1000));
  await c.removeAllChannels(); await c.realtime.disconnect();
  return { subscribed, events_received: got.length };
}
try {
  out.realtime.app_session = await listen(UC.S);
  out.realtime.oauth_token = await listen(UC.T);
} catch (e) { out.realtime.error = String(e.message ?? e).slice(0, 100); }

// ---- tidy: remove user 2 ----------------------------------------------------------------------------------------------------
await cleanup();
fs.writeFileSync(path.join(DIR, `result-doors-${label}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
