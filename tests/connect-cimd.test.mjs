// "Use Claude's published identity" (client ID metadata documents), PROTOTYPE on the proof project. The decisions that matter:
//   * an https client_id that is not on the allowlist is refused and NOTHING IS FETCHED (no assistant can make us request an address),
//   * an allowlisted one is fetched with strict checks on the document, registered, and the sign-in goes on,
//   * the metadata advertises support only when it is switched on,
//   * the database layer names only connect_* functions.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleRequest } from '../supabase/functions/connect-core/router.ts';
import { handleOAuth, authorizationServerMetadata, openIdShapedMetadata } from '../supabase/functions/connect-core/oauth.ts';
import { validateCimd, forgetCimdCache, CIMD_MAX_BYTES, CIMD_ALLOWED } from '../supabase/functions/connect-core/cimd.ts';
import { ConnectDb } from '../supabase/functions/connect/db.ts';

const BASE = 'https://ref.supabase.co/functions/v1/connect';
const CONSENT = 'https://uselai.com/app/#/connect/consent?request=';
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CB = 'https://claude.ai/api/mcp/auth_callback';
const goodDoc = (over = {}) => JSON.stringify({ client_id: CLAUDE, client_name: 'Claude', redirect_uris: [CB], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', ...over });
const ok = (text, ct = 'application/json') => ({ status: 200, contentType: ct, text });

beforeEach(() => forgetCimdCache());

function world({ fetchResult = ok(goodDoc()), registerError = null } = {}) {
  const w = { fetched: [], registered: [], begun: [] };
  const store = {
    registerClient: async () => 'rgc_abc',
    registerCimdClient: async (id, uris) => { if (registerError) throw registerError; w.registered.push([id, uris]); },
    beginAuthorization: async (a) => {                                                    // like the database: an unknown client is refused
      if (a.clientId !== 'rgc_abc' && !w.registered.some(([id]) => id === a.clientId)) throw Object.assign(new Error('invalid_client'), { code: 'PT400' });
      w.begun.push(a); return '11111111-1111-4111-8111-111111111111';
    },
    exchangeCode: async () => ({}), refresh: async () => ({}), revoke: async () => {}, hit: async () => true,
  };
  const cimd = { fetch: async (url) => { w.fetched.push(url); return typeof fetchResult === 'function' ? fetchResult(url) : fetchResult; }, allowed: CIMD_ALLOWED };
  w.deps = (withCimd = true) => ({ store, baseUrl: BASE, consentUrl: CONSENT, ...(withCimd ? { cimd } : {}) });
  return w;
}
const authorize = (clientId, extra = {}) => {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CB, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 's', resource: BASE + '/mcp', ...extra });
  return new Request(BASE + '/authorize?' + q);
};

// ---- the document checks
test('validateCimd: a good document passes and returns its redirect list', () => {
  const r = validateCimd(CLAUDE, ok(goodDoc()), CB);
  assert.equal(r.ok, true); assert.deepEqual(r.redirectUris, [CB]);
});

test('validateCimd: every way a document can be wrong is refused', () => {
  const bad = {
    'no response': null,
    'status 404': { status: 404, contentType: 'application/json', text: '{}' },
    'a redirect status': { status: 302, contentType: 'application/json', text: '' },
    'not JSON by type': ok(goodDoc(), 'text/html'),
    'not valid JSON': ok('{nope'),
    'a JSON array': ok('[]'),
    'empty': ok(''),
    'too large': ok(goodDoc({ pad: 'x'.repeat(CIMD_MAX_BYTES) })),
    'a different client_id': ok(goodDoc({ client_id: 'https://evil.example/doc' })),
    'no client_id': ok(JSON.stringify({ redirect_uris: [CB] })),
    'redirect not listed': ok(goodDoc({ redirect_uris: ['https://claude.ai/other'] })),
    'no redirect list': ok(goodDoc({ redirect_uris: [] })),
    'six redirects': ok(goodDoc({ redirect_uris: [CB, CB + '1', CB + '2', CB + '3', CB + '4', CB + '5'] })),
    'a redirect that is not text': ok(goodDoc({ redirect_uris: [CB, 5] })),
    'a confidential client': ok(goodDoc({ token_endpoint_auth_method: 'client_secret_basic' })),
    'a secret inside': ok(goodDoc({ client_secret: 'abc' })),
    'keys inside': ok(goodDoc({ jwks_uri: 'https://x.example/k' })),
  };
  for (const [name, res] of Object.entries(bad)) assert.equal(validateCimd(CLAUDE, res, CB).ok, false, name);
  assert.equal(validateCimd(CLAUDE, ok(goodDoc()), 'https://claude.ai/other').ok, false, 'a requested redirect the document does not list');
  assert.equal(validateCimd(CLAUDE, ok(goodDoc({ token_endpoint_auth_method: undefined })), CB).ok, true, 'method absent is fine (public by default)');
});

// ---- the metadata
test('metadata advertises client_id_metadata_document_supported only when switched on', async () => {
  assert.equal(authorizationServerMetadata(BASE).client_id_metadata_document_supported, undefined);
  assert.equal(authorizationServerMetadata(BASE, true).client_id_metadata_document_supported, true);
  assert.deepEqual(authorizationServerMetadata(BASE, true).token_endpoint_auth_methods_supported, ['none']);      // Claude needs 'none' too
  assert.deepEqual(authorizationServerMetadata(BASE, true).code_challenge_methods_supported, ['S256']);
  assert.equal(openIdShapedMetadata(BASE, true).client_id_metadata_document_supported, true);
  const w = world();
  for (const [route, on] of [['/.well-known/oauth-authorization-server', true], ['/.well-known/openid-configuration', true], ['/.well-known/oauth-authorization-server', false]]) {
    const r = await handleOAuth(new Request(BASE + route), route, w.deps(on));
    assert.equal((await r.json()).client_id_metadata_document_supported, on ? true : undefined, route + ' ' + on);
  }
});

// ---- /authorize
test('an https client_id that is NOT on the allowlist is refused and nothing is fetched', async () => {
  const w = world();
  for (const id of ['https://evil.example/doc', 'https://claude.ai/oauth/other', 'https://claude.ai/oauth/mcp-oauth-client-metadata/', 'https://claude.ai/oauth/mcp-oauth-client-metadata?x=1',
                    'https://169.254.169.254/latest/meta-data', 'https://localhost/doc', 'http://claude.ai/oauth/mcp-oauth-client-metadata']) {
    const r = await handleOAuth(authorize(id), '/authorize', w.deps());
    assert.equal(r.status, 400, id);
  }
  assert.deepEqual(w.fetched, [], 'not one address was requested');
  assert.deepEqual(w.registered, []); assert.deepEqual(w.begun, []);
});

test('without CIMD switched on, even the Claude address is refused as before and nothing is fetched', async () => {
  const w = world();
  const r = await handleOAuth(authorize(CLAUDE), '/authorize', w.deps(false));
  assert.equal(r.status, 400); assert.match(await r.text(), /not registered/);
  assert.deepEqual(w.fetched, []); assert.deepEqual(w.registered, []);
});

test('the allowlisted Claude address: fetched once, registered with the document\'s redirect list, sign-in goes on; a second sign-in uses the cache', async () => {
  const w = world();
  const r = await handleOAuth(authorize(CLAUDE), '/authorize', w.deps());
  assert.equal(r.status, 302); assert.ok(r.headers.get('location').startsWith(CONSENT));
  assert.deepEqual(w.fetched, [CLAUDE]); assert.deepEqual(w.registered, [[CLAUDE, [CB]]]);
  assert.equal(w.begun[0].clientId, CLAUDE); assert.equal(w.begun[0].redirectUri, CB);
  const r2 = await handleOAuth(authorize(CLAUDE, { state: 't' }), '/authorize', w.deps());
  assert.equal(r2.status, 302); assert.equal(w.fetched.length, 1, 'no second fetch'); assert.equal(w.registered.length, 1);
});

test('a bad document, a failed fetch, or a database refusal stops the sign-in in plain words and starts nothing', async () => {
  for (const [name, w] of [
    ['mismatched client_id', world({ fetchResult: ok(goodDoc({ client_id: 'https://evil.example/x' })) })],
    ['redirect not in the document', world({ fetchResult: ok(goodDoc({ redirect_uris: ['https://claude.ai/other'] })) })],
    ['network failure', world({ fetchResult: null })],
    ['404', world({ fetchResult: { status: 404, contentType: 'application/json', text: null } })],
    ['database says the redirect is not allowed', world({ registerError: Object.assign(new Error('invalid_redirect_uri: nope'), { code: 'PT400' }) })],
    ['database says switched off', world({ registerError: Object.assign(new Error('unavailable: switched off'), { code: 'PT400' }) })],
  ]) {
    const r = await handleOAuth(authorize(CLAUDE), '/authorize', w.deps());
    assert.equal(r.status, 400, name);
    assert.deepEqual(w.begun, [], name + ': no sign-in was started');
    assert.doesNotMatch(await r.text(), /ref\.supabase|rgc_|postgres|stack/i, name);
  }
});

test('a refused fetch is not cached: the next sign-in tries again', async () => {
  let n = 0;
  const w = world({ fetchResult: () => (++n === 1 ? null : ok(goodDoc())) });
  assert.equal((await handleOAuth(authorize(CLAUDE), '/authorize', w.deps())).status, 400);
  assert.equal((await handleOAuth(authorize(CLAUDE), '/authorize', w.deps())).status, 302);
  assert.equal(w.fetched.length, 2);
});

test('registered clients (rgc_ ids) still work exactly as before and never touch the fetcher', async () => {
  const w = world();
  const r = await handleOAuth(authorize('rgc_abc'), '/authorize', w.deps());
  assert.equal(r.status, 302); assert.deepEqual(w.fetched, []); assert.deepEqual(w.registered, []);
});

// ---- the database layer
test('the database mapping names only connect_cimd_client for this path, with the address and the list as parameters', async () => {
  const calls = [];
  const db = new ConnectDb(async (sql, params) => { calls.push([sql, params]); return [{ r: null }]; }, 'https://uselai.com/app/');
  await db.authStore().registerCimdClient(CLAUDE, [CB]);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /^select public\.connect_cimd_client\(\$1::text, \$2::text::text\[\]\) as r$/);
  assert.equal(calls[0][1][0], CLAUDE);
  assert.doesNotMatch(calls[0][0], /owner|user_id/i);
});

// ---- the setting: OFF unless it says exactly "on" (CC1 02:04 MED-1)
test('the function turns CIMD on only when CONNECT_CIMD is exactly "on"; the default is off', () => {
  const src = fs.readFileSync('supabase/functions/connect/index.ts', 'utf8');
  assert.match(src, /const cimdOn = \(Deno\.env\.get\("CONNECT_CIMD"\) \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "on";/);
  assert.match(src, /cimd: cimdOn \? \{ fetch: defaultCimdFetcher, allowed: CIMD_ALLOWED \} : undefined,/);
  assert.doesNotMatch(src, /cimd: \{ fetch: defaultCimdFetcher/);                               // never passed unconditionally
});

test('the whole router with CIMD off (the default): no flag in either metadata document, and an https client_id is refused with nothing fetched', async () => {
  const w = world();
  const deps = { store: w.deps(false).store, consentUrl: CONSENT, publicBase: BASE, mcp: { data: null, policy: null, deps: {}, verifyToken: async () => null, dataFor: () => null } };
  for (const route of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    const r = await handleRequest(new Request(BASE + route), deps);
    const md = await r.json();
    assert.equal(md.client_id_metadata_document_supported, undefined, route);
    assert.ok(md.registration_endpoint, 'registration is still offered');
  }
  const r = await handleRequest(authorize(CLAUDE), deps);
  assert.equal(r.status, 400); assert.deepEqual(w.fetched, []); assert.deepEqual(w.registered, []);
  // and with it on, the same router advertises and accepts
  const on = { ...deps, cimd: w.deps(true).cimd };
  assert.equal((await (await handleRequest(new Request(BASE + '/.well-known/oauth-authorization-server'), on)).json()).client_id_metadata_document_supported, true);
  assert.equal((await handleRequest(authorize(CLAUDE), on)).status, 302);
});
