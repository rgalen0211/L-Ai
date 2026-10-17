// OAuth premise proof for the connect design (CONNECT-DESIGN.md, REVISION 1, R1/R2). THROWAWAY PROJECT ONLY.
//   node tools/oauth_proof/proof.mjs <label>        label: "hook-off" or "hook-on" (which state the project is in)
// Reads D:\Ryagram-scratch\oauth-proof\.env (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY).
// Prints only statuses and claim NAMES. Never prints a key, a token, a password or a claim value.
// Writes D:\Ryagram-scratch\oauth-proof\result-<label>.json (same rule).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';

const DIR = 'D:/Ryagram-scratch/oauth-proof';
const label = process.argv[2];
if (!['hook-on', 'hook-off'].includes(label)) { console.error('usage: proof.mjs hook-on|hook-off'); process.exit(2); }

const env = {};
for (const line of fs.readFileSync(path.join(DIR, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) if (!env[k]) { console.error(`missing ${k} in .env`); process.exit(2); }
const URL_ = env.SUPABASE_URL.replace(/\/+$/, '');

// Safety: never run against the live Ryagram project.
try {
  const live = fs.readFileSync('C:/Users/Ryan/Documents/GitHub/L-Ai/supabase/.temp/project-ref', 'utf8').trim();
  if (live && URL_.includes(live)) { console.error('REFUSED: that is the live Ryagram project.'); process.exit(3); }
} catch { /* no linked project file: nothing to compare */ }
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(URL_)) { console.error('SUPABASE_URL should look like https://<ref>.supabase.co'); process.exit(2); }

const H = (key, bearer) => ({ apikey: key, Authorization: `Bearer ${bearer ?? key}`, 'Content-Type': 'application/json' });
async function call(method, url, headers, body) {
  const r = await fetch(url, { method, headers, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, headers: r.headers, json, text };
}

// ---- 1. the throwaway test user (generated here, kept only in the proof folder) -------------------------------
const userFile = path.join(DIR, 'test-user.json');
let user;
if (fs.existsSync(userFile)) user = JSON.parse(fs.readFileSync(userFile, 'utf8'));
else {
  user = { email: `proof-${crypto.randomBytes(5).toString('hex')}@example.test`, password: crypto.randomBytes(18).toString('base64url') };
  const r = await call('POST', `${URL_}/auth/v1/admin/users`, H(env.SUPABASE_SECRET_KEY), { email: user.email, password: user.password, email_confirm: true });
  if (r.status >= 300) { console.error('could not create the test user: HTTP', r.status, r.json?.msg ?? r.json?.message ?? ''); process.exit(4); }
  fs.writeFileSync(userFile, JSON.stringify(user));
}
const signIn = await call('POST', `${URL_}/auth/v1/token?grant_type=password`, H(env.SUPABASE_PUBLISHABLE_KEY), { email: user.email, password: user.password });
if (signIn.status !== 200) { console.error('test user sign-in failed: HTTP', signIn.status); process.exit(4); }
const S = signIn.json.access_token;

// ---- 2. discovery, DCR, authorize, consent, token --------------------------------------------------------------
const disc = await call('GET', `${URL_}/.well-known/oauth-authorization-server/auth/v1`, {});
if (disc.status !== 200) { console.error('OAuth discovery document not found (HTTP', disc.status, '). Is the OAuth server switched on?'); process.exit(5); }
const meta = disc.json;
const out = { label, at: new Date().toISOString(), discovery: {
  issuer: meta.issuer, has_registration_endpoint: !!meta.registration_endpoint, code_challenge_methods: meta.code_challenge_methods_supported,
  grant_types: meta.grant_types_supported, scopes: meta.scopes_supported, token_auth_methods: meta.token_endpoint_auth_methods_supported,
  client_id_metadata_document_supported: meta.client_id_metadata_document_supported ?? null, response_types: meta.response_types_supported,
}, steps: {}, matrix: {} };

const REDIRECT = 'http://localhost:8789/cb';
const reg = await call('POST', meta.registration_endpoint, { 'Content-Type': 'application/json' }, {
  client_name: 'Proof client', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
});
out.steps.dcr_status = reg.status;
if (reg.status >= 300 || !reg.json?.client_id) { console.error('dynamic client registration failed: HTTP', reg.status, reg.json?.error ?? '', reg.json?.error_description ?? ''); fs.writeFileSync(path.join(DIR, `result-${label}.json`), JSON.stringify(out, null, 1)); process.exit(6); }
const clientId = reg.json.client_id;

const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st', scope: meta.scopes_supported?.includes('email') ? 'openid email' : 'openid' });
const az = await call('GET', `${meta.authorization_endpoint}?${q}`, {});
out.steps.authorize_status = az.status;
const loc = az.headers.get('location') ?? '';
const authzId = new URL(loc, URL_).searchParams.get('authorization_id');
out.steps.consent_redirect_path = (() => { try { return new URL(loc, URL_).pathname; } catch { return null; } })();
if (!authzId) { console.error('authorize did not redirect to the consent path with an authorization_id (HTTP', az.status, ')'); fs.writeFileSync(path.join(DIR, `result-${label}.json`), JSON.stringify(out, null, 1)); process.exit(7); }

const sb = createClient(URL_, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
await sb.auth.setSession({ access_token: S, refresh_token: signIn.json.refresh_token });
const details = await sb.auth.oauth.getAuthorizationDetails(authzId);
out.steps.details_ok = !details.error;
out.steps.details_fields = details.data ? Object.keys(details.data) : null;
const approved = await sb.auth.oauth.approveAuthorization(authzId);
if (approved.error || !approved.data?.redirect_url) { console.error('approve failed:', approved.error?.message ?? 'no redirect_url'); process.exit(8); }
const code = new URL(approved.data.redirect_url).searchParams.get('code');

const tok = await call('POST', meta.token_endpoint, { 'Content-Type': 'application/x-www-form-urlencoded' },
  new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }).toString());
out.steps.token_status = tok.status;
if (tok.status !== 200) { console.error('token exchange failed: HTTP', tok.status, tok.json?.error ?? ''); process.exit(9); }
const T = tok.json.access_token;

// ---- 3. what is in the two tokens ---------------------------------------------------------------------------------
const cs = decodeJwt(S), ct = decodeJwt(T);
out.claims = { app_session_names: Object.keys(cs).sort(), oauth_token_names: Object.keys(ct).sort(),
  premise_oauth_has_client_id: 'client_id' in ct, premise_app_session_lacks_client_id: !('client_id' in cs),
  oauth_client_id_matches_registered: ct.client_id === clientId, oauth_role: ct.role, app_role: cs.role,
  oauth_lifetime_s: ct.exp - ct.iat, app_lifetime_s: cs.exp - cs.iat, oauth_token_response_expires_in: tok.json.expires_in, refresh_token_returned: !!tok.json.refresh_token };
const hdr = decodeProtectedHeader(T);
out.signing = { alg: hdr.alg, has_kid: !!hdr.kid };
try {
  const jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
  const v = await jwtVerify(T, jwks, { issuer: meta.issuer });
  out.signing.jwks_verifies = true; out.signing.aud = v.payload.aud; out.signing.iss_matches = true;
} catch (e) { out.signing.jwks_verifies = false; out.signing.error = String(e.code ?? e.message).slice(0, 80); }

// refresh keeps the claim?
if (tok.json.refresh_token) {
  const rf = await call('POST', meta.token_endpoint, { 'Content-Type': 'application/x-www-form-urlencoded' },
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.json.refresh_token, client_id: clientId }).toString());
  out.steps.refresh_status = rf.status;
  if (rf.status === 200) out.claims.refreshed_token_keeps_client_id = decodeJwt(rf.json.access_token).client_id === clientId;
}

// ---- 4. the matrix: the same calls with the app session (S) and the OAuth token (T) ------------------------------------
const pk = env.SUPABASE_PUBLISHABLE_KEY, uid = cs.sub;
const calls = (tok_) => ({
  'table select':  () => call('GET', `${URL_}/rest/v1/proof_notes?select=id`, H(pk, tok_)),
  'table insert':  () => call('POST', `${URL_}/rest/v1/proof_notes`, { ...H(pk, tok_), Prefer: 'return=minimal' }, { body: 'x' }),
  'table update':  () => call('PATCH', `${URL_}/rest/v1/proof_notes?body=eq.x`, { ...H(pk, tok_), Prefer: 'return=minimal' }, { body: 'y' }),
  'table delete':  () => call('DELETE', `${URL_}/rest/v1/proof_notes?body=eq.y`, { ...H(pk, tok_), Prefer: 'return=minimal' }),
  'rpc definer (stands for submit_job/admin_*)': () => call('POST', `${URL_}/rest/v1/rpc/proof_spend`, H(pk, tok_), {}),
  'rpc claims_probe': () => call('POST', `${URL_}/rest/v1/rpc/claims_probe`, H(pk, tok_), {}),
  'rpc connect_probe (ALLOWED for OAuth)': () => call('POST', `${URL_}/rest/v1/rpc/connect_probe`, H(pk, tok_), {}),
  'storage list': () => call('POST', `${URL_}/storage/v1/object/list/proof`, H(pk, tok_), { prefix: `${uid}/`, limit: 10 }),
  'storage upload': () => call('POST', `${URL_}/storage/v1/object/proof/${uid}/t-${crypto.randomBytes(3).toString('hex')}.txt`, { apikey: pk, Authorization: `Bearer ${tok_}`, 'Content-Type': 'text/plain' }, 'hello'),
  'storage download': () => call('GET', `${URL_}/storage/v1/object/authenticated/proof/${uid}/seed.txt`, { apikey: pk, Authorization: `Bearer ${tok_}` }),
  'auth user (what an Edge Function would call)': () => call('GET', `${URL_}/auth/v1/user`, H(pk, tok_)),
});
// seed one object as S so the download has something to find
await call('POST', `${URL_}/storage/v1/object/proof/${uid}/seed.txt`, { apikey: pk, Authorization: `Bearer ${S}`, 'Content-Type': 'text/plain', 'x-upsert': 'true' }, 'seed');
for (const [who, tk] of [['app_session', S], ['oauth_token', T]]) {
  out.matrix[who] = {};
  for (const [name, fn] of Object.entries(calls(tk))) { const r = await fn(); out.matrix[who][name] = r.status; }
}

// ---- 5. verdict -----------------------------------------------------------------------------------------------------------
const okS = (s) => s >= 200 && s < 300;
const mS = out.matrix.app_session, mT = out.matrix.oauth_token;
const sessionWorks = Object.entries(mS).every(([, s]) => okS(s));
const allowed = 'rpc connect_probe (ALLOWED for OAuth)';
const oauthDeniedEverywhereElse = Object.entries(mT).every(([n, s]) => n === allowed || n.startsWith('auth user') || !okS(s));
const oauthConnectWorks = okS(mT[allowed]);
out.verdict = {
  premise_claim: out.claims.premise_oauth_has_client_id && out.claims.premise_app_session_lacks_client_id,
  app_session_unchanged: sessionWorks, oauth_denied_on_every_other_door: oauthDeniedEverywhereElse, oauth_can_call_connect_functions: oauthConnectWorks,
  edge_door_open_so_helper_needed: okS(mT['auth user (what an Edge Function would call)']),
};
fs.writeFileSync(path.join(DIR, `result-${label}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ label, discovery: out.discovery, steps: out.steps, claims: out.claims, signing: out.signing, matrix: out.matrix, verdict: out.verdict }, null, 1));
