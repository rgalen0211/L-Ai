// get-delivery-url (PIPE-1, JOB-CONTRACT-v1 3b): owner-only, app-session-only, expiry from the database, 1-hour signing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsOf, handle, SIGNED_SECONDS } from '../supabase/functions/get-delivery-url/deliver.ts';

const ME = '00000000-0000-4000-8000-000000000001';
const DLV = '11111111-2222-4333-8444-555555555555';
function world(over = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      allowedOrigins: ['https://uselai.com'],
      verifyUser: async (jwt) => (jwt === 'good' ? { id: ME, clientId: null } : jwt === 'ai' ? { id: ME, clientId: 'chatgpt' } : null),
      objectFor: async (owner, d) => { calls.push(['objectFor', owner, d]); return `${owner}/p/v/j/final.mp4`; },
      sign: async (path, seconds) => { calls.push(['sign', path, seconds]); return `https://signed.example/${path}?t=${seconds}`; },
      ...over,
    },
  };
}
const call = (deps, body, { jwt = 'good', origin = 'https://uselai.com', method = 'POST' } = {}) =>
  handle(new Request('https://x.supabase.co/functions/v1/get-delivery-url', { method,
    headers: { origin, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined }), deps);

test('the owner gets a 1-hour signed link, labelled AI-assisted', async () => {
  const w = world();
  const res = await call(w.deps, { delivery_id: DLV });
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.expires_in, 3600);
  assert.equal(SIGNED_SECONDS, 3600);
  assert.equal(b.label, 'AI-assisted');
  assert.deepEqual(w.calls, [['objectFor', ME, DLV], ['sign', `${ME}/p/v/j/final.mp4`, 3600]]);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('signed out, other origins and wrong methods are refused before the database', async () => {
  const w = world();
  assert.equal((await call(w.deps, { delivery_id: DLV }, { jwt: 'nope' })).status, 401);
  assert.equal((await call(w.deps, { delivery_id: DLV }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(w.deps, null, { method: 'GET' })).status, 405);
  assert.equal((await call(w.deps, { delivery_id: 'not-a-uuid' })).status, 400);
  assert.deepEqual(w.calls, []);
});

test('a connected AI token (client_id) is refused: CONNECT has its own function', async () => {
  const w = world();
  const res = await call(w.deps, { delivery_id: DLV }, { jwt: 'ai' });
  assert.equal(res.status, 403);
  assert.deepEqual(w.calls, []);
});

test("someone else's or a missing delivery is a plain 404; an expired one says it was deleted (410)", async () => {
  const notMine = world({ objectFor: async () => { throw new Error('Delivery not found.'); } });
  assert.equal((await call(notMine.deps, { delivery_id: DLV })).status, 404);
  const gone = world({ objectFor: async () => { throw new Error('This film was kept for its 30 days and has been deleted.'); } });
  const res = await call(gone.deps, { delivery_id: DLV });
  assert.equal(res.status, 410);
  assert.match((await res.json()).error, /30 days/);
});

test('MUST-FAIL guard: a path outside the owner folder is never signed', async () => {
  const w = world({ objectFor: async () => 'someone-else/p/v/j/final.mp4' });
  const res = await call(w.deps, { delivery_id: DLV });
  assert.equal(res.status, 404);
  assert.ok(!w.calls.some((c) => c[0] === 'sign'));
});

test('claimsOf reads client_id from a (verified) JWT and survives garbage', () => {
  const payload = Buffer.from(JSON.stringify({ sub: ME, client_id: 'claude' })).toString('base64url');
  assert.equal(claimsOf(`h.${payload}.s`).client_id, 'claude');
  assert.deepEqual(claimsOf('garbage'), {});
});
