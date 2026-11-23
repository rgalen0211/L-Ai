// What the join function says when the sign-up email cannot be sent just now (CONNECT 2026-11-23, CC1's audit of the email path, GAMES agreeing). It used to answer 200 "a link is on its way" even when Supabase Auth failed
// to send (SMTP down, or the Auth hourly email allowance run out on launch morning): the stranger read success, no mail came, and every retry spent one of their 3 tries a day.
// Customer step: a stranger who signs up gets the email, or is told plainly it did not go, and an honest retry is never locked out by it.
// Rules: (1) a real send failure answers 503 with plain words (no waitlist, invite or person); (2) email_exists keeps the SAME 200 answer as a sent mail (no probing of which addresses have accounts);
// (3) the failed send gives the try back (release), once, for that address and caller; (4) a failing release changes nothing about the answer; (5) a sent mail gives nothing back.
// Runs the real handler with fake dependencies; talks to nothing. Must-fails: tests/connect_join_sendfail_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle as join, SEND_FAILED_WORDS, SENT, BAD_ADDRESS_WORDS } from '../supabase/functions/join/join.ts';

const ORIGIN = 'https://uselai.com';
const WRONG = /waitlist|wait list|waiting list|invite|invitation|ask Ryan|email us|ryagram@/i;
const post = (email = 'a@example.test') => new Request('https://x.test/fn', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ email, adult_confirmed: true }) });
const make = (invite, over = {}) => {
  const seen = { reserve: [], release: [] };
  const deps = { allowedOrigins: [ORIGIN], siteUrl: ORIGIN, reserve: async (e, h) => { seen.reserve.push([e, h]); return { ok: true }; }, invite, release: async (e, h) => { seen.release.push([e, h]); }, ...over };
  return { deps, seen };
};
const fails = (code, message = 'smtp') => async () => { throw Object.assign(new Error(message), code ? { code } : {}); };

test('a failed send is told plainly: 503, retry-later words, nothing about a waitlist, an invite or a person', async () => {
  for (const code of [undefined, 'over_email_send_rate_limit', 'unexpected_failure']) {
    const { deps } = make(fails(code));
    const r = await join(post(), deps);
    assert.equal(r.status, 503, String(code));
    const said = (await r.json()).error;
    assert.equal(said, SEND_FAILED_WORDS);
    assert.match(said, /couldn.t send the email just now/i);
    assert.match(said, /try again/i);
    assert.ok(!WRONG.test(said), said);
    assert.notEqual(said, SENT, 'never the success words');
  }
});

test('a failed send gives the try back, once, for this address and this caller', async () => {
  const { deps, seen } = make(fails());
  await join(post('Someone@Example.test'), deps);
  assert.equal(seen.reserve.length, 1);
  assert.equal(seen.release.length, 1, 'exactly one release');
  assert.deepEqual(seen.release[0], seen.reserve[0], 'the same (lower-cased) address and the same hashed caller as the try that was counted');
  assert.equal(seen.release[0][0], 'someone@example.test');
  assert.match(seen.release[0][1], /^[0-9a-f]{64}$/);
});

test('an address that already has an account gets the SAME 200 as a sent mail, and its try is not released', async () => {
  const ok = make(async () => {});
  const known = make(fails('email_exists', 'User already registered'));
  const a = await join(post(), ok.deps), b = await join(post(), known.deps);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(known.seen.release.length, 0, 'nothing is given back when the address is known (same behaviour as a sent mail)');
  assert.equal(ok.seen.release.length, 0, 'and nothing after a sent mail');
});

test('a sent mail answers 200 with the sent words', async () => {
  const { deps } = make(async () => {});
  const r = await join(post(), deps);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).message, SENT);
});

test('a release that fails, or no release at all, never changes the answer', async () => {
  const boom = make(fails(), { release: async () => { throw new Error('rpc down'); } });
  const rb = await join(post(), boom.deps);
  assert.equal(rb.status, 503);
  assert.equal((await rb.json()).error, SEND_FAILED_WORDS);
  const none = make(fails(), { release: undefined });
  const rn = await join(post(), none.deps);
  assert.equal(rn.status, 503);
  assert.equal((await rn.json()).error, SEND_FAILED_WORDS);
});

test('an address that Auth itself refuses is told so (400) and its try is NOT given back: a refusal is not a send failure', async () => {
  for (const code of ['validation_failed', 'email_address_invalid']) {
    const { deps, seen } = make(fails(code, 'Unable to validate email address'));
    const r = await join(post('a@b..cc'), deps);
    assert.equal(r.status, 400, code);
    assert.equal((await r.json()).error, BAD_ADDRESS_WORDS);
    assert.equal(seen.release.length, 0, 'nothing is given back: it stays counted, so it cannot be used to get past the limits');
  }
  assert.ok(!WRONG.test(BAD_ADDRESS_WORDS));
});

test('index.ts wires the release to the database function by its real name and argument names, passes Auth\'s status on, and maps email_exists both ways', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/join/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /service\.rpc\("join_release", \{ p_email: email, p_ip_hash: ipHash \}\)/);
  assert.match(src, /async release\(email, ipHash\) \{/);
  assert.match(src, /service\.rpc\("join_reserve", \{ p_email: email, p_ip_hash: ipHash \}\)/);
  assert.match(src, /error\.code === "email_exists" \|\| \/already \(been \)\?registered\/i\.test\(error\.message\)/);
  assert.match(src, /code: exists \? "email_exists" : error\.code, status: error\.status/);
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261121000800_join_open.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.join_release\(p_email text, p_ip_hash text\) returns void/, 'the SQL function has the name and the argument names index.ts sends, and can be applied twice');
});
