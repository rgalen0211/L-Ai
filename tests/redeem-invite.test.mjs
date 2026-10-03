// redeem-invite: a good code sends one invite; bad, throttled and failed cases answer correctly,
// and nothing tells a visitor whether an email already has an account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, SENT } from '../supabase/functions/redeem-invite/redeem.ts';

function world(reserveResult = { ok: true, redemption: 7 }, over = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      allowedOrigins: ['https://uselai.com'], siteUrl: 'https://uselai.com',
      reserve: async (code, email, ipHash) => { calls.push(['reserve', code, email, ipHash]); return reserveResult; },
      sent: async (id, user) => { calls.push(['sent', id, user]); },
      release: async id => { calls.push(['release', id]); },
      invite: async (email, redirectTo) => { calls.push(['invite', email, redirectTo]); return { userId: 'u-1' }; },
      ...over,
    }
  };
}
const post = (deps, body, { origin = 'https://uselai.com', ip = '203.0.113.9', method = 'POST' } = {}) =>
  handle(new Request('https://x.supabase.co/functions/v1/redeem-invite', { method,
    headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` },
    body: method === 'POST' ? JSON.stringify(body) : undefined }), deps);

test('a good code sends one invite back to /app/ and records it', async () => {
  const w = world();
  const res = await post(w.deps, { code: 'rya-k7m2 9qpx', email: '  New@Example.com ' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, SENT);
  assert.equal(w.calls[0][0], 'reserve');
  assert.deepEqual(w.calls[0].slice(1, 3), ['rya-k7m2 9qpx', 'new@example.com']);
  assert.match(w.calls[0][3], /^[0-9a-f]{64}$/);                       // the address is hashed, never stored
  assert.ok(!w.calls[0][3].includes('203.0.113.9'));
  assert.deepEqual(w.calls.slice(1), [['invite', 'new@example.com', 'https://uselai.com/app/'], ['sent', 7, 'u-1']]);
});

test('an address that already has an account gets the same answer, and the use comes back', async () => {
  const w = world(undefined, { invite: async () => { throw Object.assign(new Error('already registered'), { code: 'email_exists' }); } });
  const res = await post(w.deps, { code: 'RYA-K7M2-9QPX', email: 'old@example.com' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, SENT);
  assert.deepEqual(w.calls.at(-1), ['release', 7]);
});

test('bad codes, bad emails, throttling and email failures say what to do', async () => {
  const cases = [
    [{ ok: false, reason: 'invalid' }, 400, /isn’t valid, has expired or has been used up/],
    [{ ok: false, reason: 'email' }, 400, /valid email/],
    [{ ok: false, reason: 'throttled' }, 429, /Wait an hour/],
  ];
  for (const [r, status, text] of cases) {
    const w = world(r);
    const res = await post(w.deps, { code: 'x', email: 'a@b.co' });
    assert.equal(res.status, status);
    assert.match((await res.json()).error, text);
    assert.ok(!w.calls.some(c => c[0] === 'invite'));
  }
  const quiet = console.error; console.error = () => {};
  const down = world(undefined, { invite: async () => { throw Object.assign(new Error('SMTP not configured'), { code: 'unexpected_failure' }); } });
  const res = await post(down.deps, { code: 'x', email: 'a@b.co' });
  console.error = quiet;
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /code still works/);
  assert.deepEqual(down.calls.at(-1), ['release', 7]);
});

test('only from the site, only POST, both fields required', async () => {
  const w = world();
  assert.equal((await post(w.deps, { code: 'x', email: 'a@b.co' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(w.deps, {}, { method: 'GET' })).status, 405);
  for (const body of [{}, { code: 'x' }, { email: 'a@b.co' }, { code: 5, email: 'a@b.co' }]) {
    assert.equal((await post(w.deps, body)).status, 400);
  }
  assert.equal(w.calls.length, 0);
});
