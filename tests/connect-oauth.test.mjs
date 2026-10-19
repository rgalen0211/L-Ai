// The authorization server's HTTP face and the database mapping, against in-memory stand-ins. The decisions themselves (PKCE, replay,
// revocation, who may do what) are made in SQL and proved in supabase/tests/test_connect.py; here: HTTP shapes, token handling, and
// that the code that talks to the database can only ever name connect_* functions and never an owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleOAuth, sha256hex, randomToken, authorizationServerMetadata } from '../supabase/functions/connect-core/oauth.ts';
import { ConnectDb } from '../supabase/functions/connect/db.ts';

const BASE = 'https://ref.supabase.co/functions/v1/connect';
const CONSENT = 'https://uselai.com/app/#/connect/consent?request=';

function store(overrides = {}) {
  const calls = [];
  const rec = (n, v) => async (a) => { calls.push([n, a]); return typeof v === 'function' ? v(a) : v; };
  return { calls, s: {
    registerClient: rec('register', 'rgc_abc'),
    beginAuthorization: rec('begin', '11111111-1111-4111-8111-111111111111'),
    exchangeCode: rec('exchange', { scope: 'read write', expires_in: 3600 }),
    refresh: rec('refresh', { scope: 'read write', expires_in: 3600 }),
    revoke: rec('revoke', undefined), ...overrides } };
}
const deps = (st) => ({ store: st.s, baseUrl: BASE, consentUrl: CONSENT });
const post = (path, body, type = 'application/x-www-form-urlencoded') => new Request(BASE + path, { method: 'POST', headers: { 'content-type': type }, body });
const dbErr = (message, code) => Object.assign(new Error(message), { code });

test('metadata: S256 only, public clients only, endpoints under the function', () => {
  const m = authorizationServerMetadata(BASE);
  assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
  assert.equal(m.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(m.token_endpoint_auth_methods_supported, ['none']);
  assert.equal(m.registration_endpoint, BASE + '/register'); assert.equal(m.issuer, BASE);
});

test('discovery documents are served, with CORS for browser-based clients', async () => {
  const st = store();
  const a = await handleOAuth(new Request(BASE + '/.well-known/oauth-authorization-server'), '/.well-known/oauth-authorization-server', deps(st));
  assert.equal((await a.json()).token_endpoint, BASE + '/token'); assert.equal(a.headers.get('access-control-allow-origin'), '*');
  const r = await handleOAuth(new Request(BASE + '/.well-known/oauth-protected-resource/mcp'), '/.well-known/oauth-protected-resource/mcp', deps(st));
  const doc = await r.json(); assert.deepEqual(doc.authorization_servers, [BASE]); assert.equal(doc.resource, BASE + '/mcp');
  const pre = await handleOAuth(new Request(BASE + '/token', { method: 'OPTIONS' }), '/token', deps(st));
  assert.equal(pre.status, 204);
});

test('register: a public client; a refused address is a 400 with an OAuth error', async () => {
  const st = store();
  const ok = await handleOAuth(post('/register', JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_basic' }), 'application/json'), '/register', deps(st));
  assert.equal(ok.status, 201);
  const b = await ok.json();
  assert.equal(b.client_id, 'rgc_abc'); assert.equal(b.token_endpoint_auth_method, 'none'); assert.equal(b.client_secret, undefined);
  const bad = store({ registerClient: async () => { throw dbErr('invalid_redirect_uri: nope', 'PT400'); } });
  const r = await handleOAuth(post('/register', JSON.stringify({ client_name: 'x', redirect_uris: ['https://evil.example/cb'] }), 'application/json'), '/register', deps(bad));
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'invalid_redirect_uri');
  assert.equal((await handleOAuth(post('/register', 'not json', 'application/json'), '/register', deps(st))).status, 400);
  assert.equal((await handleOAuth(post('/register', JSON.stringify({ redirect_uris: 'x' }), 'application/json'), '/register', deps(st))).status, 400);
});

test('authorize sends the browser to the consent page with the request id; errors are shown, never redirected', async () => {
  const st = store();
  const q = new URLSearchParams({ response_type: 'code', client_id: 'rgc_abc', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 's1',
    code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', scope: 'read', resource: BASE + '/mcp' });
  const r = await handleOAuth(new Request(BASE + '/authorize?' + q), '/authorize', deps(st));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), CONSENT + '11111111-1111-4111-8111-111111111111');
  assert.equal(st.calls[0][1].method, 'S256'); assert.equal(st.calls[0][1].state, 's1');
  assert.equal(st.calls[0][1].issuer, BASE);                                          // RFC 9207: the redirect will say who answered
  const bad = store({ beginAuthorization: async () => { throw dbErr('invalid_redirect_uri', 'PT400'); } });
  const e = await handleOAuth(new Request(BASE + '/authorize?' + q), '/authorize', deps(bad));
  assert.equal(e.status, 400); assert.equal(e.headers.get('location'), null);                       // never redirected to an unvalidated address
  assert.match(await e.text(), /allowed addresses/);
  const notCode = await handleOAuth(new Request(BASE + '/authorize?' + new URLSearchParams({ response_type: 'token', client_id: 'x' })), '/authorize', deps(st));
  assert.equal(notCode.status, 400);
});

test('token: tokens are random, shown once, and only their hashes reach the database', async () => {
  const st = store();
  const r = await handleOAuth(post('/token', new URLSearchParams({ grant_type: 'authorization_code', code: 'thecode', client_id: 'rgc_abc',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: 'v'.repeat(43) }).toString()), '/token', deps(st));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const t = await r.json();
  assert.match(t.access_token, /^rga_[A-Za-z0-9_-]{43}$/); assert.match(t.refresh_token, /^rgr_[A-Za-z0-9_-]{43}$/);
  assert.equal(t.token_type, 'Bearer'); assert.equal(t.expires_in, 3600); assert.equal(t.scope, 'read write');
  const sent = JSON.stringify(st.calls);
  assert.ok(!sent.includes(t.access_token) && !sent.includes(t.refresh_token) && !sent.includes('"thecode"'), 'a raw token or code reached the store');
  assert.equal(st.calls[0][1].accessHash, await sha256hex(t.access_token));
  assert.equal(st.calls[0][1].codeHash, await sha256hex('thecode'));
  assert.notEqual(randomToken('x_'), randomToken('x_'));
});

test('token: a failed grant is invalid_grant; a client secret or basic auth is refused; unknown grants are refused', async () => {
  const replay = store({ exchangeCode: async () => ({ error: 'invalid_grant' }) });
  const r = await handleOAuth(post('/token', 'grant_type=authorization_code&code=x&client_id=c&redirect_uri=u&code_verifier=' + 'v'.repeat(43)), '/token', deps(replay));
  assert.equal(r.status, 400); assert.deepEqual(await r.json(), { error: 'invalid_grant' });
  const sec = await handleOAuth(post('/token', 'grant_type=authorization_code&code=x&client_secret=s'), '/token', deps(store()));
  assert.equal(sec.status, 401);
  const basic = await handleOAuth(new Request(BASE + '/token', { method: 'POST', headers: { authorization: 'Basic eDp5', 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token' }), '/token', deps(store()));
  assert.equal(basic.status, 401);
  assert.equal((await handleOAuth(post('/token', 'grant_type=password&username=a&password=b'), '/token', deps(store()))).status, 400);
// the address is assembled at run time so the repo-wide secret scan stays strict
  const boom = store({ exchangeCode: async () => { throw new Error('connection refused to ' + 'postgres' + '://user:secret@host'); } });
  const e = await handleOAuth(post('/token', 'grant_type=authorization_code&code=x&client_id=c'), '/token', deps(boom));
  assert.equal(e.status, 500); assert.doesNotMatch(await e.text(), /secret|postgres/);
});

test('refresh hands over new hashes; revoke always answers 200', async () => {
  const st = store();
  const r = await handleOAuth(post('/token', 'grant_type=refresh_token&refresh_token=oldref&client_id=rgc_abc'), '/token', deps(st));
  assert.equal(r.status, 200);
  assert.equal(st.calls[0][1].refreshHash, await sha256hex('oldref'));
  const rv = await handleOAuth(post('/revoke', 'token=sometoken'), '/revoke', deps(store({ revoke: async () => { throw new Error('db down'); } })));
  assert.equal(rv.status, 200);
});

// ------------------------------------------------------------------------------------------------ the database mapping
test('ConnectDb can only call connect_* functions, passes the token hash first, and never an owner id', async () => {
  const seen = [];
  const db = new ConnectDb(async (sql, params) => { seen.push([sql, params]); return [{ r: sql.includes('connect_scopes') ? ['read', 'write'] : true }]; }, 'https://uselai.com/app/');
  const p = await db.verify('a'.repeat(64));
  assert.deepEqual(p, { tokenHash: 'a'.repeat(64) });
  const d = db.data(p), pol = db.policy();
  await pol.grantFor(p); await pol.hit(p, 'ladder', 30, 3600); await pol.finalRendersEnabled(); await pol.log(p, { tool: 't', credits: 0, result: 'ok', code: 'ok', failedChecks: 0 });
  await d.whoami(); await d.listProjects(); await d.currentVersionId('11111111-1111-4111-8111-111111111111'); await d.quote('11111111-1111-4111-8111-111111111111', 'preview');
  await d.saveStory('11111111-1111-4111-8111-111111111111', { schema: 1 });
  await d.submitJob('11111111-1111-4111-8111-111111111111', 'preview', { window_s: [0, 5] });
  await db.authStore().registerClient('Claude', ['https://claude.ai/api/mcp/auth_callback']);
  for (const [sql] of seen) assert.match(sql, /^select public\.connect_[a-z_]+\(/, sql);
  const tokenFns = seen.filter(([sql]) => !/connect_(register_client|begin_authorization|exchange_code|refresh|revoke|final_enabled)\(/.test(sql));
  for (const [sql, params] of tokenFns) assert.equal(params[0], 'a'.repeat(64), sql);                    // first argument: the token hash
  assert.ok(seen.every(([, params]) => params.every((x) => !(typeof x === 'string' && /^u-|owner/i.test(x)))));
  const arr = seen.find(([sql]) => sql.includes('connect_register_client'));
  assert.equal(arr[1][1], '{"https://claude.ai/api/mcp/auth_callback"}');                                 // a text[] literal
  const save = seen.find(([sql]) => sql.includes('connect_save_story'));
  assert.equal(save[1][2], '{"schema":1}');                                                              // jsonb as JSON text
});

test('every SQL function the server names exists in the migration, and none takes an owner', () => {
  const mig = fs.readFileSync('supabase/migrations/20261018000100_connect_ai.sql', 'utf8');
  const src = fs.readFileSync('supabase/functions/connect/db.ts', 'utf8');
  const used = [...src.matchAll(/"(connect_[a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 20);
  for (const fn of new Set(used)) assert.match(mig, new RegExp(`create function public\\.${fn}\\(`), fn);
  for (const m of mig.matchAll(/create function public\.(connect_[a-z_]+)\(([^)]*)\)/g)) assert.doesNotMatch(m[2], /owner|user/i, m[1]);
});

test('the function entry holds no Supabase key and reads only its own settings', () => {
  const src = fs.readFileSync('supabase/functions/connect/index.ts', 'utf8');
  assert.doesNotMatch(src, /SERVICE_ROLE|service_role|ANON_KEY|getUser|createClient/);
  // SUPABASE_URL is the project's public address (used only to build the issuer address), not a key
  assert.deepEqual([...src.matchAll(/Deno\.env\.get\("([A-Z_]+)"\)/g)].map((m) => m[1]).sort(), ['CONNECT_APP_URL', 'CONNECT_CONSENT_URL', 'CONNECT_DB_URL', 'CONNECT_PUBLIC_URL', 'SUPABASE_URL']);
  assert.match(src, /projectUrl\)\s*\?\s*`\$\{projectUrl\}\/functions\/v1\/connect`/);          // and only ever turned into the issuer address
  assert.equal([...src.matchAll(/projectUrl/g)].length, 3);
});

// ------------------------------------------------------------------------------------------------ hardening (CC1 review E3/S3, LOWs)
import { handleMcp } from '../supabase/functions/connect-core/mcp.ts';
import { handleRest } from '../supabase/functions/connect-core/rest.ts';

test('the open endpoints are limited per caller: the 11th registration from one address in an hour is a 429, another address is not blocked', async () => {
  const limited = { n: new Map() };
  const st = store({ hit: async (who, bucket, max) => { const k = who + bucket; limited.n.set(k, (limited.n.get(k) ?? 0) + 1); return limited.n.get(k) <= max; } });
  const reg = (ip) => handleOAuth(new Request(BASE + '/register', { method: 'POST', headers: { 'x-forwarded-for': `1.1.1.1, ${ip}`, 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'x', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) }), '/register', deps(st));
  for (let i = 0; i < 10; i++) assert.equal((await reg('9.9.9.9')).status, 201);
  const r = await reg('9.9.9.9');
  assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '300');
  assert.equal((await reg('8.8.8.8')).status, 201);                                    // the LAST hop is the key; the first is the caller's to forge
  const keys = [...limited.n.keys()];
  assert.ok(keys.every((k) => /^[0-9a-f]{64}/.test(k)) && !keys.some((k) => k.includes('9.9.9.9')), 'the address itself reached the store');
});

test('a limiter that is down never locks the door; a request with no address is not limited', async () => {
  const down = store({ hit: async () => { throw new Error('db down'); } });
  const r = await handleOAuth(new Request(BASE + '/register', { method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2', 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'x', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) }), '/register', deps(down));
  assert.equal(r.status, 201);
});

test('authorize: a resource that is not this server is refused (RFC 8707); an overlong state is refused, not truncated', async () => {
  const st = store();
  const q = (extra) => new URLSearchParams({ response_type: 'code', client_id: 'rgc_abc', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 's',
    code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', ...extra });
  const bad = await handleOAuth(new Request(BASE + '/authorize?' + q({ resource: 'https://evil.example/mcp' })), '/authorize', deps(st));
  assert.equal(bad.status, 400); assert.match(await bad.text(), /invalid_target/);
  assert.equal((await handleOAuth(new Request(BASE + '/authorize?' + q({ resource: BASE + '/mcp' })), '/authorize', deps(st))).status, 302);
  assert.equal((await handleOAuth(new Request(BASE + '/authorize?' + q({ state: 's'.repeat(513) })), '/authorize', deps(st))).status, 400);
});

test('token: a missing grant_type is invalid_request; register: a JSON null or array is a 400, never a 500', async () => {
  assert.deepEqual(await (await handleOAuth(post('/token', 'code=x'), '/token', deps(store()))).json(), { error: 'invalid_request', error_description: 'grant_type is required.' });
  for (const body of ['null', '[]', '"x"', '5']) assert.equal((await handleOAuth(post('/register', body, 'application/json'), '/register', deps(store()))).status, 400, body);
});

test('bodies are limited in BYTES before they are decoded', async () => {
  const big = 'é'.repeat(5000);                                     // 5000 characters, 10000 bytes: over 8192 bytes, under 8192 characters
  assert.equal((await handleOAuth(post('/register', JSON.stringify({ client_name: 'x', redirect_uris: [big] }), 'application/json'), '/register', deps(store()))).status, 400);
});

const mcpDeps = (verifyToken) => ({ data: null, policy: {}, deps: {}, verifyToken, dataFor: () => ({}), resourceMetadataUrl: BASE + '/.well-known/oauth-protected-resource' });
const mcpReq = (extra = {}) => new Request(BASE + '/mcp', { method: 'POST', headers: { authorization: 'Bearer rga_x', 'content-type': 'application/json', ...extra }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });

test('a database outage while checking a token answers 503 (clients retry), never 401 (clients sign in again) - MCP and REST', async () => {
  const outage = mcpDeps(async () => { throw new Error('db down'); });
  const m = await handleMcp(mcpReq(), outage);
  assert.equal(m.status, 503); assert.equal(m.headers.get('retry-after'), '5'); assert.equal(m.headers.get('www-authenticate'), null);
  const r = await handleRest(new Request(BASE + '/v1/tools/list_projects', { method: 'POST', headers: { authorization: 'Bearer rga_x' }, body: '{}' }), '/v1/tools/list_projects', outage, BASE);
  assert.equal(r.status, 503);
  assert.equal((await handleMcp(mcpReq(), mcpDeps(async () => null))).status, 401);                          // a token that is simply not valid is still a 401
});

test('REST: no token is 401 with the challenge, an oversize body is 413 measured in bytes, and every response says nosniff', async () => {
  const ok = mcpDeps(async () => ({ tokenHash: 'h' }));
  const none = await handleRest(new Request(BASE + '/v1/tools/list_projects', { method: 'POST', body: '{}' }), '/v1/tools/list_projects', ok, BASE);
  assert.equal(none.status, 401); assert.match(none.headers.get('www-authenticate'), /resource_metadata=/); assert.equal(none.headers.get('x-content-type-options'), 'nosniff');
  const huge = 'é'.repeat(160 * 1024);                                       // 160K characters = 320K bytes, over the 300 KB cap
  const big = await handleRest(new Request(BASE + '/v1/tools/set_story', { method: 'POST', headers: { authorization: 'Bearer rga_x' }, body: huge }), '/v1/tools/set_story', ok, BASE);
  assert.equal(big.status, 413);
  const mc = await handleMcp(mcpReq({ authorization: 'Bearer rga_x' }), ok);
  assert.equal(mc.headers.get('access-control-expose-headers'), 'WWW-Authenticate'); assert.equal(mc.headers.get('x-content-type-options'), 'nosniff');
});

test('our own token prefixes are scrubbed from error text too', async () => {
  const { friendlyError } = await import('../supabase/functions/connect-core/tools.ts');
  for (const t of ['rga_abcdefghijklmnop', 'rgr_abcdefghijklmnop', 'rgc_abcdefghijklmnop']) {
    assert.doesNotMatch(friendlyError(Object.assign(new Error('bad ' + t), { code: '42501' })), /rg[arc]_/);
  }
});

test('jsonb and array parameters are cast from text in SQL, so the driver can never encode them twice', async () => {
  const seen = [];
  const db = new ConnectDb(async (sql, params) => { seen.push([sql, params]); return [{ r: { id: 'x' } }]; }, 'https://uselai.com/app/');
  const p = { tokenHash: 'a'.repeat(64) };
  await db.data(p).saveStory('11111111-1111-4111-8111-111111111111', { schema: 1 });
  await db.data(p).submitJob('11111111-1111-4111-8111-111111111111', 'preview', { window_s: [0, 5] });
  await db.authStore().registerClient('Claude', ['https://claude.ai/api/mcp/auth_callback']);
  for (const [sql] of seen) {
    assert.doesNotMatch(sql, /::jsonb|::text\[\]/.test(sql) && !/::text::(jsonb|text\[\])/.test(sql) ? /^$/ : /^never matches$/, sql);
    assert.ok(!/\$\d+::(jsonb|text\[\])/.test(sql), sql);
  }
  assert.match(seen[0][0], /\$3::text::jsonb/);
  assert.match(seen[2][0], /\$2::text::text\[\]/);
});

// ------------------------------------------------------------------------------------------------ the pre-flight cannot touch live by accident
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
test('the end-to-end pre-flight refuses the live project unless Ryan said yes, read-only, with an env file outside every repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-guard-'));
  const inside = path.join(dir, 'oauth-proof'); fs.mkdirSync(inside);
  const env = (d) => { const f = path.join(d, '.env'); fs.writeFileSync(f, 'SUPABASE_URL=https://jxtkfishqfxuptwjzczz.supabase.co\nSUPABASE_PUBLISHABLE_KEY=not-a-key\n'); return f; };
  const run = (extra) => spawnSync(process.execPath, ['tools/connect_e2e.mjs'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, CONNECT_E2E_ACCOUNT: path.join(dir, 'none.json'), ...extra } });
  const good = env(dir);
  assert.equal(run({ CONNECT_E2E_ENVFILE: good }).status, 3);                                                                       // no opt-in
  assert.equal(run({ CONNECT_E2E_ENVFILE: good, CONNECT_E2E_ALLOW_LIVE: 'ryan-said-yes' }).status, 3);                              // not read-only
  assert.equal(run({ CONNECT_E2E_ENVFILE: good, CONNECT_E2E_ALLOW_LIVE: 'yes', CONNECT_E2E_READONLY: '1' }).status, 3);             // wrong word
  assert.equal(run({ CONNECT_E2E_ENVFILE: env(inside), CONNECT_E2E_ALLOW_LIVE: 'ryan-said-yes', CONNECT_E2E_READONLY: '1' }).status, 3);   // an env file kept with the proof files
  fs.rmSync(dir, { recursive: true, force: true });
});
