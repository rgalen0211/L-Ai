// CLOUD-SITE 11-02 round 3: must-fail cases for the redeem-invite function (supabase/functions/redeem-invite/redeem.ts), the sign-up door. The decisions are made in SQL
// (supabase/tests/test_invites.py and test_invite_signup_mustfail.py, on a local Postgres); here: what reaches the database, and what a visitor can learn or forge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, SENT } from '../supabase/functions/redeem-invite/redeem.ts';

function world(reserveResult = { ok: true, redemption: 7 }, over = {}) {
  const calls = [];
  return { calls, deps: {
    allowedOrigins: ['https://uselai.com'], siteUrl: 'https://uselai.com',
    reserve: async (code, email, ipHash) => { calls.push(['reserve', code, email, ipHash]); return typeof reserveResult === 'function' ? reserveResult() : reserveResult; },
    sent: async (id, user) => { calls.push(['sent', id, user]); },
    release: async (id) => { calls.push(['release', id]); },
    invite: async (email, redirectTo) => { calls.push(['invite', email, redirectTo]); return { userId: 'u-1' }; },
    ...over } };
}
const post = (deps, body, headers = {}) => handle(new Request('https://x.supabase.co/functions/v1/redeem-invite', { method: 'POST',
  headers: { origin: 'https://uselai.com', 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), deps);
const hashOf = (w) => w.calls.find((c) => c[0] === 'reserve')[3];

test('MUST FAIL (bug): a forged first X-Forwarded-For hop does not change who the caller is for the guess limit; the hop our proxy appended (the last) does', async () => {
  const seen = new Set();
  for (const forged of ['1.1.1.1', '2.2.2.2', '3.3.3.3', 'anything at all']) {
    const w = world({ ok: false, reason: 'invalid' });
    await post(w.deps, { code: 'RYA-AAAA-BBBB', email: 'a@b.example' }, { 'x-forwarded-for': `${forged}, 198.51.100.7` });
    seen.add(hashOf(w));
  }
  assert.equal(seen.size, 1, 'rotating the forged hop must not give a fresh 10-guesses-an-hour allowance');
  const other = world({ ok: false, reason: 'invalid' });
  await post(other.deps, { code: 'RYA-AAAA-BBBB', email: 'a@b.example' }, { 'x-forwarded-for': '1.1.1.1, 198.51.100.8' });
  assert.ok(!seen.has(hashOf(other)), 'a different real caller is a different caller');
  // cf-connecting-ip, when present, is the platform's own and wins
  const cf1 = world({ ok: false, reason: 'invalid' }), cf2 = world({ ok: false, reason: 'invalid' });
  await post(cf1.deps, { code: 'x', email: 'a@b.example' }, { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '9.9.9.9, 198.51.100.7' });
  await post(cf2.deps, { code: 'x', email: 'a@b.example' }, { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '8.8.8.8, 198.51.100.9' });
  assert.equal(hashOf(cf1), hashOf(cf2));
});

test('MUST FAIL: an address that already has an account gets exactly the same answer as a new one (no way to test which emails are signed up)', async () => {
  const fresh = world(), taken = world(undefined, { invite: async () => { throw Object.assign(new Error('exists'), { code: 'email_exists' }); } });
  const a = await post(fresh.deps, { code: 'RYA-AAAA-BBBB', email: 'new@x.example' }), b = await post(taken.deps, { code: 'RYA-AAAA-BBBB', email: 'old@x.example' });
  assert.equal(a.status, b.status); assert.deepEqual(await a.json(), await b.json()); assert.deepEqual(await (await post(fresh.deps, { code: 'RYA-AAAA-BBBB', email: 'n2@x.example' })).json(), { message: SENT });
  assert.deepEqual(taken.calls.map((c) => c[0]), ['reserve', 'release'], 'the use comes back, and nothing is marked sent (the invite stub here records nothing)');
});

test('MUST FAIL: expired, used-up, made-up and malformed codes all get the same plain sentence, and nothing is invited', async () => {
  const answers = new Set();
  for (const code of ['RYA-EXPI-RED1', 'RYA-USED-UPUP', 'RYA-MADE-UPPP', '!!!', 'x'.repeat(39)]) {
    const w = world({ ok: false, reason: 'invalid' });
    const r = await post(w.deps, { code, email: 'a@b.example' });
    assert.equal(r.status, 400); answers.add((await r.json()).error);
    assert.ok(!w.calls.some((c) => c[0] === 'invite'));
  }
  assert.deepEqual([...answers], ['That code isn’t valid, has expired or has been used up.']);
});

test('MUST FAIL: the email reaches the database trimmed and lower case; an over-long code is cut, never passed whole; nothing else is passed', async () => {
  const w = world();
  await post(w.deps, { code: 'R'.repeat(500), email: '  Maya.Ortiz@Example.COM  ', extra: 'ignored', user_id: 'u-admin', credits: 1000 });
  const [, code, email] = w.calls[0];
  assert.equal(email, 'maya.ortiz@example.com'); assert.equal(code.length, 40);
  assert.deepEqual(w.calls.map((c) => c[0]), ['reserve', 'invite', 'sent']);
  assert.equal(w.calls[1][2], 'https://uselai.com/app/', 'the link goes to our own app, never to an address the visitor sent');
});

test('MUST FAIL: a code or email that is not a string, a JSON array, or no body is refused before the database is asked', async () => {
  for (const body of [{ code: 123, email: 'a@b.example' }, { code: ['RYA'], email: 'a@b.example' }, { code: 'RYA-AAAA-BBBB', email: { a: 1 } }, [], '', 'not json', '{"code":"RYA-AAAA-BBBB"}']) {
    const w = world();
    const r = await post(w.deps, body);
    assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(w.calls.length, 0, JSON.stringify(body));
  }
});

test('MUST FAIL: a database fault says try again, never the fault; a failed release never changes the answer', async () => {
  const boom = world(() => { throw new Error('connection to db.internal:5432 refused, password=hunter2'); });
  const r = await post(boom.deps, { code: 'RYA-AAAA-BBBB', email: 'a@b.example' });
  assert.equal(r.status, 500); const t = await r.text(); assert.ok(!/5432|hunter2|db\.internal/.test(t)); assert.match(t, /Try again in a minute/);
  const w = world(undefined, { invite: async () => { throw Object.assign(new Error('x'), { code: 'email_exists' }); }, release: async () => { throw new Error('release failed'); } });
  const r2 = await post(w.deps, { code: 'RYA-AAAA-BBBB', email: 'a@b.example' });
  assert.equal(r2.status, 200); assert.deepEqual(await r2.json(), { message: SENT });
});

test('MUST FAIL: another site cannot call it (403 before the database), and the answer carries no CORS permission for it', async () => {
  for (const origin of ['https://evil.example', 'https://uselai.com.evil.example', 'null', '']) {
    const w = world();
    const r = await post(w.deps, { code: 'RYA-AAAA-BBBB', email: 'a@b.example' }, { origin });
    assert.equal(r.status, 403, origin); assert.equal(w.calls.length, 0); assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
});
