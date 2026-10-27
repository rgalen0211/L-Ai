// app-download (supabase/functions/app-download/core.ts; NEXT-CONNECT 133, Cloudflare R2) against stand-ins for the database and the signer. Every refusal has a case that FAILS if the check is removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/app-download/core.ts';
import { presignGet } from '../supabase/functions/_shared/r2_presign.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const REL = { kind: 'app', link_id: '11111111-1111-4111-8111-111111111111', file_name: 'app-1.zip', size_bytes: 273939672, sha256: 'a'.repeat(64), object_key: 'releases/app-1.zip', expires_seconds: 900 };
const SECRET = 'TOP-SECRET-ACCESS-KEY-VALUE';
const NOW = new Date('2026-10-26T20:30:00Z');

function setup(over = {}) {
  const calls = { request: [], presign: [], logs: [] };
  const deps = {
    allowedOrigins: ['https://uselai.com'],
    configured: () => true,
    verifyUser: async (jwt) => (jwt === 'good' ? { id: ALICE, clientId: null } : jwt === 'oauth' ? { id: ALICE, clientId: 'claude' } : null),
    request: async (owner, kind) => { calls.request.push(owner); calls.kinds = [...(calls.kinds ?? []), kind]; return { ...REL, kind, link_id: crypto.randomUUID() }; },
    presign: async (key, seconds, fileName) => {
      calls.presign.push([key, seconds, fileName]);
      return presignGet({ host: 'acct.r2.cloudflarestorage.com', path: `/ryagram-app/${key}`, accessKeyId: 'AKID', secretAccessKey: SECRET, expiresSeconds: seconds, now: NOW,
                          query: { 'response-content-disposition': `attachment; filename="${fileName}"` } });
    },
    ...over,
  };
  const call = async (method = 'POST', { bearer = 'good', origin = 'https://uselai.com', body } = {}) => {
    const h = {}; if (bearer) h.authorization = `Bearer ${bearer}`; if (origin) h.origin = origin;
    const res = await handle(new Request('https://x.test/functions/v1/app-download', { method, headers: h, body: body ? JSON.stringify(body) : undefined }), deps);
    let j = null; try { j = await res.clone().json(); } catch { /* none */ }
    return { status: res.status, json: j, text: await res.clone().text(), headers: res.headers };
  };
  return { deps, calls, call };
}

test('a signed-in invited person gets one 15-minute link and only five fields, with the secret nowhere', async () => {
  const { call, calls } = setup();
  const r = await call();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['expires_in', 'file_name', 'sha256', 'size_bytes', 'url']);
  assert.equal(r.json.expires_in, 900);
  const u = new URL(r.json.url);
  assert.equal(u.origin, 'https://acct.r2.cloudflarestorage.com');
  assert.equal(u.pathname, '/ryagram-app/releases/app-1.zip');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(u.searchParams.get('response-content-disposition'), 'attachment; filename="app-1.zip"');
  assert.ok(!r.text.includes(SECRET) && !r.text.includes('object_key') && !r.text.includes('link_id'), 'no secret, no object key, no link id in the reply');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls.request, [ALICE]);
});

test('the signature is the real one for that object (recomputed independently), so a changed key or expiry would not verify', async () => {
  const { call } = setup();
  const r = await call();
  const again = await presignGet({ host: 'acct.r2.cloudflarestorage.com', path: '/ryagram-app/releases/app-1.zip', accessKeyId: 'AKID', secretAccessKey: SECRET, expiresSeconds: 900, now: NOW,
                                   query: { 'response-content-disposition': 'attachment; filename="app-1.zip"' } });
  assert.equal(r.json.url, again);
  const other = await presignGet({ host: 'acct.r2.cloudflarestorage.com', path: '/ryagram-app/releases/other.zip', accessKeyId: 'AKID', secretAccessKey: SECRET, expiresSeconds: 900, now: NOW,
                                   query: { 'response-content-disposition': 'attachment; filename="app-1.zip"' } });
  assert.notEqual(new URL(r.json.url).searchParams.get('X-Amz-Signature'), new URL(other).searchParams.get('X-Amz-Signature'));
});

test('no sign-in, a junk token or a connected AI is refused before the database or the signer is touched', async () => {
  const { call, calls } = setup();
  assert.equal((await call('POST', { bearer: '' })).status, 401);
  assert.equal((await call('POST', { bearer: 'junk' })).status, 401);
  assert.equal((await call('POST', { bearer: 'oauth' })).status, 403);
  assert.deepEqual([calls.request.length, calls.presign.length], [0, 0]);
  assert.equal((await call()).status, 200);                                               // control
});

test('only POST from the site\'s own pages; OPTIONS answers the preflight', async () => {
  const { call, calls } = setup();
  assert.equal((await call('GET')).status, 405);
  assert.equal((await call('POST', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', { origin: '' })).status, 403);
  const pre = await call('OPTIONS');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://uselai.com');
  assert.equal(calls.request.length, 0);
});

test('the database\'s refusals come back as plain sentences with the right status and NO url', async () => {
  for (const [code, status, msg] of [['PT403', 403, 'The Ryagram app is for invited testers for now.'], ['PT404', 404, 'The download is not ready yet.'], ['PT429', 429, 'You have asked for the download three times in the last day.'],
                                     ['PT401', 401, 'Sign in first.']]) {
    const { call, calls } = setup({ request: async () => { throw Object.assign(new Error(msg), { code }); } });
    const r = await call();
    assert.equal(r.status, status, code);
    assert.equal(r.json.error, msg);
    assert.ok(!('url' in r.json));
    assert.equal(calls.presign.length, 0, 'nothing is signed for a refused person');
  }
});

test('an unexpected database error is a generic 500 with nothing of the error in the reply or the log', async () => {
  const { call } = setup({ request: async () => { throw Object.assign(new Error('relation "app_downloads" does not exist ' + SECRET), { code: '42P01' }); } });
  const logs = []; const old = console.error; console.error = (...a) => logs.push(a.join(' '));
  try { const r = await call(); assert.equal(r.status, 500); assert.ok(!r.text.includes('app_downloads') && !r.text.includes(SECRET)); } finally { console.error = old; }
  assert.ok(logs.every((l) => !l.includes(SECRET) && !l.includes('app_downloads')), 'the log has only the code');
});

test('not set up: 503 before anything is written; a signer that fails is a generic 500 that never carries the secret', async () => {
  const a = setup({ configured: () => false });
  const r = await a.call();
  assert.equal(r.status, 503);
  assert.equal(a.calls.request.length, 0, 'MUST-FAIL guard: no database row is written while the function is not configured');
  const b = setup({ presign: async () => { throw new Error('bad key ' + SECRET); } });
  const logs = []; const old = console.error; console.error = (...x) => logs.push(x.join(' '));
  try { const r2 = await b.call(); assert.equal(r2.status, 500); assert.ok(!r2.text.includes(SECRET)); } finally { console.error = old; }
  assert.ok(logs.every((l) => !l.includes(SECRET)));
});

test('the body is optional: {} and nothing mean the app; "addon" and "notices" are the other two; anything else is a 400 before the database', async () => {
  const a = setup();
  assert.equal((await a.call('POST', { body: {} })).status, 200);
  assert.equal((await a.call()).status, 200);
  assert.equal((await a.call('POST', { body: { kind: 'addon' } })).status, 200);
  assert.equal((await a.call('POST', { body: { kind: 'notices' } })).status, 200);
  assert.deepEqual(a.calls.kinds, ['app', 'app', 'addon', 'notices']);
  const before = a.calls.request.length;
  for (const bad of [{ kind: 'zip' }, { kind: 7 }, { kind: null }, { kind: '../x' }]) assert.equal((await a.call('POST', { body: bad })).status, 400, JSON.stringify(bad));
  const r = await (handle(new Request('https://x.test/f', { method: 'POST', headers: { authorization: 'Bearer good', origin: 'https://uselai.com' }, body: '{not json' }), a.deps));
  assert.equal(r.status, 400);
  assert.equal(a.calls.request.length, before, 'a bad body never reaches the database');
});

test('a second request is handled as a new request (the database counts and limits them); the function keeps no state', async () => {
  const { call, calls } = setup();
  const a = await call(), b = await call();
  assert.equal(calls.request.length, 2);
  assert.equal(a.json.url, b.json.url, 'same object and time give the same link here; the database row is what differs per request');
});
