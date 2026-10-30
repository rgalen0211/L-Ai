// app-link (supabase/functions/app-link/core.ts; NEXT-CONNECT 162): the invite email's link to the desktop app, good ONCE, against stand-ins for the database and the signer. Every refusal has a case that FAILS if the
// check is removed (tests/invite_app_link_mutants.mjs). The SQL half (one-time use, expiry, disabled invite, hash only) is supabase/tests/test_invite_app_links.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/app-link/core.ts';
import { presignGet } from '../supabase/functions/_shared/r2_presign.ts';

const TOKEN = 'ab'.repeat(32);
const REL = { kind: 'app', file_name: 'app-1.zip', size_bytes: 274327789, sha256: 'c'.repeat(64), object_key: 'releases/app-1.zip', expires_seconds: 900 };
const SECRET = 'TOP-SECRET-ACCESS-KEY-VALUE';
const NOW = new Date('2026-10-30T20:30:00Z');
const sha = async (t) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))).toString('hex');

function setup(over = {}) {
  const calls = { peek: [], redeem: [], presign: [] };
  const used = new Set();
  const deps = {
    allowedOrigins: ['https://uselai.com'], enabled: () => true, configured: () => true, sha256Hex: sha,
    peek: async (h) => { calls.peek.push(h); return used.has(h) || h !== await sha(TOKEN) ? { ok: false } : { ok: true, file_name: REL.file_name, size_bytes: REL.size_bytes }; },
    redeem: async (h) => { calls.redeem.push(h); if (used.has(h) || h !== await sha(TOKEN)) throw Object.assign(new Error('That link has been used'), { code: 'PT404' }); used.add(h); return { ...REL }; },
    presign: async (key, seconds, fileName) => { calls.presign.push([key, seconds, fileName]);
      return presignGet({ host: 'acct.r2.cloudflarestorage.com', path: `/ryagram-app/${key}`, accessKeyId: 'AKID', secretAccessKey: SECRET, expiresSeconds: seconds, now: NOW, query: { 'response-content-disposition': `attachment; filename="${fileName}"` } }); },
    ...over,
  };
  const call = async (body, { method = 'POST', origin = 'https://uselai.com', raw } = {}) => {
    const h = { 'content-type': 'application/json' }; if (origin) h.origin = origin;
    const res = await handle(new Request('https://x.test/functions/v1/app-link', { method, headers: h, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined }), deps);
    let j = null; try { j = await res.clone().json(); } catch { /* none */ }
    return { status: res.status, json: j, text: await res.clone().text(), headers: res.headers };
  };
  return { deps, calls, call, used };
}
const NOT_GOOD = /used, has expired, or is no longer good/;

test('peek: a good link says what it would download and CHANGES NOTHING (so a mail link-checker opening the page cannot use it up)', async () => {
  const { call, calls } = setup();
  for (let i = 0; i < 3; i++) {
    const r = await call({ t: TOKEN, action: 'peek' });
    assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true, file_name: 'app-1.zip', size_bytes: 274327789 });
  }
  assert.equal(calls.redeem.length, 0); assert.equal(calls.presign.length, 0);
  const again = await call({ t: TOKEN, action: 'redeem' });
  assert.equal(again.status, 200, 'still good after three peeks');
});

test('redeem: one 15-minute signed link, five fields, the secret and the key nowhere; the database is asked with the HASH, never the token', async () => {
  const { call, calls } = setup();
  const r = await call({ t: TOKEN, action: 'redeem' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['expires_in', 'file_name', 'sha256', 'size_bytes', 'url']);
  const u = new URL(r.json.url);
  assert.equal(u.origin, 'https://acct.r2.cloudflarestorage.com'); assert.equal(u.pathname, '/ryagram-app/releases/app-1.zip'); assert.equal(u.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(u.searchParams.get('response-content-disposition'), 'attachment; filename="app-1.zip"');
  assert.ok(!r.text.includes(SECRET) && !r.text.includes('object_key') && !r.text.includes(TOKEN), 'no secret, no object key, no token in the reply');
  assert.deepEqual(calls.redeem, [await sha(TOKEN)]); assert.notEqual(calls.redeem[0], TOKEN);
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});

test('MUST-FAIL: the link works ONCE: the second redeem, and a peek after it, say the same plain thing', async () => {
  const { call, calls } = setup();
  assert.equal((await call({ t: TOKEN, action: 'redeem' })).status, 200);
  const second = await call({ t: TOKEN, action: 'redeem' });
  assert.equal(second.status, 404); assert.match(second.json.error, NOT_GOOD);
  const peek = await call({ t: TOKEN, action: 'peek' });
  assert.equal(peek.status, 404); assert.match(peek.json.error, NOT_GOOD);
  assert.equal(calls.presign.length, 1, 'only one download link was ever signed');
});

test('MUST-FAIL: a made-up, malformed or wrong-length token is the same plain answer and never reaches the database', async () => {
  const { call, calls } = setup();
  for (const bad of ['nope', '', 'AB'.repeat(32), 'ab'.repeat(31), 'ab'.repeat(33), 'g'.repeat(64), ' ' + TOKEN.slice(0, 63), 5, null, { x: 1 }]) {
    for (const action of ['peek', 'redeem']) {
      const r = await call({ t: bad, action });
      assert.equal(r.status, 404, `${JSON.stringify(bad)} ${action}`); assert.match(r.json.error, NOT_GOOD);
    }
  }
  const wellFormedButUnknown = await call({ t: 'cd'.repeat(32), action: 'redeem' });
  assert.equal(wellFormedButUnknown.status, 404);
  assert.deepEqual(calls.redeem, [await sha('cd'.repeat(32))], 'only the well-formed unknown token reached the database, as a hash');
});

test('MUST-FAIL: the bad requests are refused before anything runs: GET, a foreign page, a missing or odd action, a huge or broken body', async () => {
  const { call, calls } = setup();
  assert.equal((await call(null, { method: 'GET' })).status, 405);
  assert.equal((await call({ t: TOKEN, action: 'redeem' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call({ t: TOKEN, action: 'redeem' }, { origin: null })).status, 403);
  for (const body of [{ t: TOKEN }, { t: TOKEN, action: 'delete' }, { t: TOKEN, action: 5 }, [], null]) assert.equal((await call(body)).status, 400, JSON.stringify(body));
  assert.equal((await call(null, { raw: '{not json' })).status, 400);
  assert.equal((await call(null, { raw: JSON.stringify({ t: TOKEN, action: 'peek', pad: 'x'.repeat(600) }) })).status, 400);
  assert.equal(calls.peek.length + calls.redeem.length, 0);
});

test('the browser\'s pre-check from the site is answered; from another page it carries no allowance', async () => {
  const { deps } = setup();
  const ok = await handle(new Request('https://x.test/f', { method: 'OPTIONS', headers: { origin: 'https://uselai.com' } }), deps);
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://uselai.com'); assert.match(ok.headers.get('access-control-allow-methods'), /POST/);
  const bad = await handle(new Request('https://x.test/f', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), deps);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('MUST-FAIL: switched off, everything is "Not found" and the database is never asked', async () => {
  const { call, calls } = setup({ enabled: () => false });
  for (const action of ['peek', 'redeem']) {
    const r = await call({ t: TOKEN, action });
    assert.equal(r.status, 404); assert.equal(r.json.error, 'Not found.');
  }
  assert.equal(calls.peek.length + calls.redeem.length, 0);
});

test('MUST-FAIL: not set up (no storage secrets): the button answers 503 BEFORE the link is used up; a peek still works', async () => {
  const { call, calls, used } = setup({ configured: () => false });
  assert.equal((await call({ t: TOKEN, action: 'peek' })).status, 200);
  const r = await call({ t: TOKEN, action: 'redeem' });
  assert.equal(r.status, 503); assert.equal(calls.redeem.length, 0); assert.equal(used.size, 0);
});

test('the database failing, or the signer failing, is a plain sentence: no code, no hash, no token, no secret in the reply or the log', async () => {
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    const dbDown = setup({ redeem: async () => { throw Object.assign(new Error('connection to server at 10.1.2.3 failed ' + TOKEN), { code: 'XX000' }); } });
    const r1 = await dbDown.call({ t: TOKEN, action: 'redeem' });
    assert.equal(r1.status, 500); assert.ok(!/10\.1\.2\.3|XX000/.test(r1.text) && !r1.text.includes(TOKEN));
    const peekDown = setup({ peek: async () => { throw new Error('boom ' + TOKEN); } });
    const r2 = await peekDown.call({ t: TOKEN, action: 'peek' });
    assert.equal(r2.status, 500); assert.ok(!r2.text.includes(TOKEN));
    const signDown = setup({ presign: async () => { throw new Error(SECRET + ' ' + TOKEN); } });
    const r3 = await signDown.call({ t: TOKEN, action: 'redeem' });
    assert.equal(r3.status, 500); assert.ok(!r3.text.includes(SECRET) && !r3.text.includes(TOKEN));
    assert.match(r3.json.error, /Download card/);
  } finally { console.error = orig; }
  assert.ok(logs.every((l) => !l.includes(TOKEN) && !l.includes(SECRET) && !l.includes('10.1.2.3')), 'the log holds no token, secret or address: ' + logs.join(' | '));
});
