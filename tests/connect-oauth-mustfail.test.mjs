// CLOUD-SITE 11-02 round 2: must-fail cases for the token flow at the HTTP face, wired the way supabase/functions/connect/index.ts wires it (the token is hashed, the real
// ConnectDb asks connect_scopes, the router serves MCP and REST), with an in-memory stand-in for the SQL answers. The decisions are made in SQL and proved on a local
// Postgres by supabase/tests/test_connect.py and supabase/tests/test_connect_oauth_mustfail.py; here: an expired, revoked or unknown token never reaches a tool, a token's
// scopes are the database's (not the client's), the raw token never reaches the database, and a token that dies in the middle of a call gets the plain sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { handleRequest } from '../supabase/functions/connect-core/router.ts';
import { sha256hex } from '../supabase/functions/connect-core/oauth.ts';
import { ConnectDb } from '../supabase/functions/connect/db.ts';

const BASE = 'https://ref.supabase.co/functions/v1/connect';
const compile = makeCompile(Ajv2020);
const sqlErr = (message, code) => Object.assign(new Error(message), { code });

/** The SQL as a table of live tokens: hash -> scopes. A token not in it (expired, revoked, unknown) has no scopes, which is what connect_scopes answers. */
async function world(tokens) {
  const live = new Map();
  for (const [raw, scopes] of Object.entries(tokens)) live.set(await sha256hex(raw), scopes);
  const seen = [];
  const db = new ConnectDb(async (sql, params) => {
    seen.push([sql, params]);
    const fn = /public\.(connect_[a-z_]+)\(/.exec(sql)[1];
    const scopes = live.get(params[0]);
    if (fn === 'connect_scopes') return [{ r: scopes ?? null }];
    if (!scopes) throw sqlErr('Sign in to Ryagram to use this connection.', 'PT401');                // what connect_actor raises for a dead token
    if (fn === 'connect_hit') return [{ r: true }];
    if (fn === 'connect_log') return [{ r: null }];
    if (fn === 'connect_whoami') return [{ r: { label: 'alice@example.test', available: 5, held: 0 } }];
    if (fn === 'connect_list_projects') return [{ r: [] }];
    if (fn === 'connect_create_project') return [{ r: { id: '11111111-1111-4111-8111-111111111111', title: 'x', version_id: '22222222-2222-4222-8222-222222222222', number: 1 } }];
    return [{ r: null }];
  }, 'https://uselai.com/app/');
  const deps = { store: db.authStore(), consentUrl: 'https://uselai.com/app/#/connect/consent?request=', publicBase: BASE,
    mcp: { data: null, policy: db.policy(), deps: { compile }, verifyToken: async (t) => db.verify(await sha256hex(t)), dataFor: (_t, p) => db.data(p) } };
  const kill = async (raw) => live.delete(await sha256hex(raw));
  return { seen, deps, kill, db };
}
const mcp = (token, method, params = {}) => new Request(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
const rest = (token, tool, body = {}) => new Request(`${BASE}/v1/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const toolFns = (seen) => seen.map(([sql]) => /public\.(connect_[a-z_]+)\(/.exec(sql)[1]).filter((f) => f !== 'connect_scopes');

test('MUST FAIL: an expired, revoked or unknown token gets 401 with error="invalid_token" on MCP and REST, and no tool function is ever asked', async () => {
  const w = await world({ 'rga_live': ['read'] });
  for (const tok of ['rga_expired', 'rga_revoked', 'not-a-token', 'rga_livex']) {
    for (const req of [mcp(tok, 'tools/call', { name: 'list_projects', arguments: {} }), rest(tok, 'list_projects')]) {
      const r = await handleRequest(req, w.deps);
      assert.equal(r.status, 401, tok); assert.match(r.headers.get('www-authenticate'), /error="invalid_token"/, tok);
      assert.match(r.headers.get('www-authenticate'), /resource_metadata="https:\/\/ref\.supabase\.co\/functions\/v1\/connect\/\.well-known\/oauth-protected-resource"/);
    }
  }
  assert.deepEqual(toolFns(w.seen), [], 'only connect_scopes was asked');
  // no token at all: 401 without invalid_token (the client has not signed in yet), and still nothing asked
  const none = await handleRequest(mcp('', 'tools/list'), w.deps);
  assert.equal(none.status, 401); assert.doesNotMatch(none.headers.get('www-authenticate'), /invalid_token/);
});

test('MUST FAIL: a token revoked between two calls is refused on the next call, at once (nothing is cached)', async () => {
  const w = await world({ 'rga_alice': ['read'] });
  assert.equal((await handleRequest(rest('rga_alice', 'list_projects'), w.deps)).status, 200);
  await w.kill('rga_alice');
  assert.equal((await handleRequest(rest('rga_alice', 'list_projects'), w.deps)).status, 401);
  assert.equal((await handleRequest(mcp('rga_alice', 'tools/list'), w.deps)).status, 401);
});

test('MUST FAIL: the raw token never reaches the database: only its SHA-256, as the first argument of every token function', async () => {
  const w = await world({ 'rga_secret_token_value': ['read'] });
  await handleRequest(rest('rga_secret_token_value', 'whoami_and_credits'), w.deps);
  const h = await sha256hex('rga_secret_token_value');
  assert.ok(w.seen.length >= 3);
  for (const [sql, params] of w.seen) {
    assert.ok(!JSON.stringify(params).includes('rga_secret_token_value'), sql);
    assert.equal(params[0], h, sql);
  }
});

test('MUST FAIL: the scopes are the database\'s: a read-only token is refused a write tool by the gate, the write function is never asked, and a client cannot claim more', async () => {
  const w = await world({ 'rga_reader': ['read'] });
  const r = await (await handleRequest(rest('rga_reader', 'create_project', { title: 'x' }), w.deps)).json();
  assert.equal(r.isError, true); assert.match(r.text, /not allowed to do that \(write\)/);
  assert.ok(!toolFns(w.seen).includes('connect_create_project'));
  // a scope named in the request changes nothing: the arguments are checked against a closed schema
  const r2 = await (await handleRequest(rest('rga_reader', 'create_project', { title: 'x', scope: 'write' }), w.deps)).json();
  assert.equal(r2.isError, true); assert.ok(!toolFns(w.seen).includes('connect_create_project'));
  // an empty scope list from the database is no token at all
  const w2 = await world({ 'rga_empty': [] });
  assert.equal((await handleRequest(rest('rga_empty', 'list_projects'), w2.deps)).status, 401);
  assert.equal(await w2.db.verify(await sha256hex('rga_empty')), null);
  assert.equal(await w2.db.policy().grantFor({ tokenHash: await sha256hex('rga_empty') }), null);
});

test('MUST FAIL: a token that expires in the middle of a call gets the plain sign-in sentence and no data', async () => {
  const w = await world({ 'rga_dying': ['read', 'write'] });
  // the gate passes (scopes and limits answered), then the token dies before the tool's own function runs
  const orig = w.deps.mcp.policy.hit;
  w.deps.mcp.policy.hit = async (...a) => { const ok = await orig(...a); if (a[1] === 'calls_acct') await w.kill('rga_dying'); return ok; };
  const r = await (await handleRequest(rest('rga_dying', 'list_projects'), w.deps)).json();
  assert.equal(r.isError, true); assert.equal(r.text, 'Sign in to Ryagram to use this connection.'); assert.equal(r.data, undefined);
});

test('MUST FAIL: the token endpoint answers invalid_grant for a refused code or refresh, and never echoes what was sent', async () => {
  const w = await world({});
  const st = { ...w.deps.store, exchangeCode: async () => ({ error: 'invalid_grant' }), refresh: async () => ({ error: 'invalid_grant' }) };
  for (const body of ['grant_type=authorization_code&code=SECRETCODE&client_id=rgc_x&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_verifier=' + 'v'.repeat(43),
                      'grant_type=refresh_token&refresh_token=rgr_SECRETREFRESH&client_id=rgc_x']) {
    const r = await handleRequest(new Request(`${BASE}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }), { ...w.deps, store: st });
    assert.equal(r.status, 400); const t = await r.text(); assert.deepEqual(JSON.parse(t), { error: 'invalid_grant' });
    assert.ok(!/SECRET/.test(t));
  }
});
