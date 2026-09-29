// The waitlist-join Edge Function's rules (supabase/functions/waitlist-join/logic.ts).
// Node 22.6+ runs the .ts file directly (type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/waitlist-join/logic.ts';

const ORIGIN = 'https://uselai.com';
function deps(overrides = {}) {
  const calls = { verify: [], join: [] };
  return {
    calls,
    allowedOrigins: [ORIGIN],
    allowedHostnames: ['uselai.com'],
    async verify(token, ip) { calls.verify.push({ token, ip }); return { success: true, hostname: 'uselai.com', action: 'waitlist' }; },
    async join(email, useCase) { calls.join.push({ email, useCase }); },
    ...overrides
  };
}
const post = (body, headers = {}) => new Request('https://x.supabase.co/functions/v1/waitlist-join', {
  method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

test('a person who passed the check is added, and told the same thing either way', async () => {
  const d = deps();
  const res = await handle(post({ email: ' a@b.co ', use_case: ' maps ', token: 't1' }, { 'cf-connecting-ip': '1.2.3.4' }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepEqual(d.calls.verify, [{ token: 't1', ip: '1.2.3.4' }]);
  assert.deepEqual(d.calls.join, [{ email: 'a@b.co', useCase: 'maps' }]);
});

test('no signup without a valid check from our page, for this form', async () => {
  for (const result of [{ success: false }, { success: true, hostname: 'evil.example', action: 'waitlist' },
                        { success: true, hostname: 'uselai.com', action: 'other' }, { success: true, action: 'waitlist' }]) {
    const d = deps({ async verify() { return result; } });
    const res = await handle(post({ email: 'a@b.co', token: 't' }), d);
    assert.equal(res.status, 400, JSON.stringify(result));
    assert.equal((await res.json()).error, 'check');
    assert.equal(d.calls.join.length, 0);
  }
  const d = deps();
  assert.equal((await handle(post({ email: 'a@b.co' }), d)).status, 400);          // no token
  assert.equal(d.calls.verify.length, 0);
});

test('bad input is refused before Cloudflare is asked', async () => {
  for (const body of ['{not json', { email: 'nope', token: 't' }, { email: `${'a'.repeat(250)}@b.co`, token: 't' },
                      { email: 'a@b.co', use_case: 'x'.repeat(2001), token: 't' }, { email: 'a@b.co', token: 'x'.repeat(2049) }]) {
    const d = deps();
    assert.equal((await handle(post(body), d)).status, 400);
    assert.equal(d.calls.verify.length, 0);
  }
});

test('only our pages may call it, and only with POST', async () => {
  const d = deps();
  const foreign = await handle(post({ email: 'a@b.co', token: 't' }, { origin: 'https://evil.example' }), d);
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  const noOrigin = new Request('https://x/f', { method: 'POST', body: '{}' });
  assert.equal((await handle(noOrigin, d)).status, 403);
  const preflight = await handle(new Request('https://x/f', { method: 'OPTIONS', headers: { origin: ORIGIN } }), d);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await handle(new Request('https://x/f', { method: 'GET', headers: { origin: ORIGIN } }), d)).status, 405);
  assert.equal(d.calls.verify.length + d.calls.join.length, 0);
});

test('Cloudflare or the database failing is reported, never a false "you are on the list"', async () => {
  const down = await handle(post({ email: 'a@b.co', token: 't' }), deps({ async verify() { throw new Error('net'); } }));
  assert.equal(down.status, 502);
  const broken = await handle(post({ email: 'a@b.co', token: 't' }), deps({ async join() { throw new Error('db'); } }));
  assert.equal(broken.status, 500);
});
