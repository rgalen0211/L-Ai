// The Edge Function door: a token issued to an AI connection (it carries client_id) must be refused by every
// function that signs a person in from a bearer token. delete-account is first on the list on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isOAuthToken, verifyAppUser } from '../supabase/functions/_shared/oauth_guard.ts';
import { handle as deleteAccount } from '../supabase/functions/delete-account/remove.ts';
import { handle as stripeCheckout } from '../supabase/functions/stripe-checkout/checkout.ts';
import { handle as filmPage } from '../supabase/functions/film-page/page.ts';
import { handle as aiEditor } from '../supabase/functions/ai-editor/editor.ts';

const FUNCS = path.resolve('supabase/functions');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(claims)}.sig`;
const OAUTH = jwt({ sub: 'u-1', role: 'authenticated', client_id: 'c-1', scope: 'openid' });
const APP = jwt({ sub: 'u-1', role: 'authenticated', session_id: 's-1' });
const ORIGIN = 'https://uselai.com';

function fakeAuth() {
  const calls = [];
  return { calls, getUser: async (t) => { calls.push(t); return { data: { user: { id: 'u-1', email: 'a@example.test' } }, error: null }; } };
}

test('helper: a token with client_id is refused before Supabase is asked; an app session goes through', async () => {
  const a = fakeAuth();
  assert.equal(await verifyAppUser(a, OAUTH), null);
  assert.equal(a.calls.length, 0);
  assert.deepEqual(await verifyAppUser(a, APP), { id: 'u-1', email: 'a@example.test' });
  assert.equal(a.calls.length, 1);
  assert.equal(isOAuthToken(OAUTH), true); assert.equal(isOAuthToken(APP), false);
  for (const junk of ['', 'abc', 'a.b.c', 'x.y']) assert.equal(isOAuthToken(junk), false);   // junk is Supabase's to reject
});

test('helper: a client_id of null/missing is an app session; any present value is an AI connection', () => {
  assert.equal(isOAuthToken(jwt({ sub: 'x', client_id: null })), false);
  assert.equal(isOAuthToken(jwt({ sub: 'x', client_id: '' })), true);
  assert.equal(isOAuthToken(jwt({ sub: 'x', client_id: 'c' })), true);
});

// Each handler is given a verifyUser built the way its index.ts builds it, and every other dependency throws if touched.
const strict = (extra) => new Proxy({ allowedOrigins: [ORIGIN, 'https://www.uselai.com'], siteUrl: ORIGIN, ...extra }, {
  get(t, k) { if (k in t) return t[k]; throw new Error(`touched ${String(k)} before the person was verified`); },
});
const cases = [
  ['delete-account', deleteAccount, { confirm_email: 'a@example.test' }],
  ['stripe-checkout', stripeCheckout, { price_code: 'x' }],
  ['film-page (publish)', filmPage, { version_id: '11111111-1111-4111-8111-111111111111' }],
  ['ai-editor', aiEditor, { version_id: '11111111-1111-4111-8111-111111111111', message: 'hi' }],
];
for (const [name, handle, body] of cases) {
  test(`${name} answers 401 to an AI token and never reaches its other dependencies`, async () => {
    const a = fakeAuth();
    const deps = strict({ verifyUser: (t) => verifyAppUser(a, t) });
    const res = await handle(new Request('https://x.test/fn', { method: 'POST',
      headers: { origin: ORIGIN, authorization: `Bearer ${OAUTH}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), deps);
    assert.equal(res.status, 401, name);
    assert.equal(a.calls.length, 0, 'Supabase was not even asked');
  });
  test(`${name}: control - an app session IS verified (so the 401 above is the guard, not a broken test)`, async () => {
    const a = fakeAuth();
    const deps = strict({ verifyUser: (t) => verifyAppUser(a, t) });
    await Promise.resolve(handle(new Request('https://x.test/fn', { method: 'POST',
      headers: { origin: ORIGIN, authorization: `Bearer ${APP}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), deps)).catch(() => {});
    assert.equal(a.calls.length, 1, name);
  });
}

// Every function directory has a recorded decision. A new function fails this test until someone classifies it.
const USER_TOKEN = ['ai-editor', 'delete-account', 'film-page', 'stripe-checkout'];      // sign a person in: must use verifyAppUser
const NO_USER_TOKEN = ['cost-sync', 'creator-beta', 'ops-digest', 'ops-tick', 'purge-partial-uploads', 'purge-uploads', 'redeem-invite', 'stripe-webhook'];
const NOT_USER_FUNCTIONS = ['_shared', 'connect', 'connect-core'];                        // connect has its own verifier (requires client_id)

test('every function directory is classified, and the classification is true', () => {
  const dirs = fs.readdirSync(FUNCS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const known = [...USER_TOKEN, ...NO_USER_TOKEN, ...NOT_USER_FUNCTIONS].sort();
  assert.deepEqual(dirs, known, 'a function was added or removed: classify it in tests/connect-oauth-guard.test.mjs');
  const sources = (dir) => fs.readdirSync(path.join(FUNCS, dir)).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(FUNCS, dir, f), 'utf8')).join('\n');
  for (const d of USER_TOKEN) {
    const idx = fs.readFileSync(path.join(FUNCS, d, 'index.ts'), 'utf8');
    assert.match(idx, /verifyAppUser\(service\.auth, jwt\)/, `${d} must verify the person with verifyAppUser`);
  }
  for (const d of dirs.filter((x) => x !== '_shared')) {
    const src = sources(d);
    assert.doesNotMatch(src, /\.auth\.getUser\(/, `${d} must not call auth.getUser directly; use verifyAppUser`);
    assert.doesNotMatch(src, /updateUser\(/, `${d} must not call the user-update auth API with a person's token`);
  }
  for (const d of NO_USER_TOKEN) {
    assert.doesNotMatch(sources(d), /replace\(\/\^Bearer|verifyUser/, `${d} is classified as taking no user token but reads one`);
  }
});
