// The invite-code path when the email WENT OUT but recording it failed (CONNECT 2026-11-23, a subagent's audit of the stranger path): redeem-invite used to release the code and answer 503 "We couldn't send the email just now"
// although the mail was on its way (and the welcome credits that the recording grants were never given). Now: the recording is tried twice; if it still fails it is logged and the person is told the truth (200, the sent words);
// the code is NOT released. A real send failure still releases the code and answers 503; email_exists still answers the same 200 and releases.
// Runs the real handler with fake dependencies; talks to nothing. Must-fails: tests/connect_redeem_sentfail_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle as redeem, SENT } from '../supabase/functions/redeem-invite/redeem.ts';

const ORIGIN = 'https://uselai.com';
const world = (over = {}) => {
  const calls = [];
  const deps = {
    allowedOrigins: [ORIGIN], siteUrl: ORIGIN,
    reserve: async (...a) => { calls.push(['reserve', ...a]); return { ok: true, redemption: 7 }; },
    sent: async (...a) => { calls.push(['sent', ...a]); },
    release: async (...a) => { calls.push(['release', ...a]); },
    invite: async (...a) => { calls.push(['invite', ...a]); return { userId: 'u-1' }; },
    ...over,
  };
  return { deps, calls };
};
const post = (deps) => redeem(new Request('https://x.test/fn', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'CODE', email: 'a@example.test', adult_confirmed: true }) }), deps);
const names = (calls) => calls.map((c) => c[0]);

test('the mail went out but recording it fails once: it is tried again, the answer is the sent words, the code is not released', async () => {
  let n = 0;
  const w = world({ sent: async (...a) => { w.calls.push(['sent', ...a]); if (++n === 1) throw new Error('db blip'); } });
  const r = await post(w.deps);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).message, SENT);
  assert.deepEqual(names(w.calls), ['reserve', 'invite', 'sent', 'sent']);
});

test('the mail went out but recording it keeps failing: still the sent words, no release, no "could not send"', async () => {
  const w = world({ sent: async (...a) => { w.calls.push(['sent', ...a]); throw new Error('db down'); } });
  const r = await post(w.deps);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.message, SENT);
  assert.ok(!('error' in body));
  assert.ok(!names(w.calls).includes('release'), 'the code is not given back: the email was sent');
  assert.equal(names(w.calls).filter((x) => x === 'sent').length, 2, 'tried twice, no more');
});

test('a real send failure still releases the code and answers 503; a known address still answers the same 200 and releases; nothing is recorded in either case', async () => {
  const down = world({ invite: async () => { throw Object.assign(new Error('smtp'), { code: 'unexpected_failure' }); } });
  const rd = await post(down.deps);
  assert.equal(rd.status, 503);
  assert.match((await rd.json()).error, /couldn.t send the email just now/i);
  assert.deepEqual(names(down.calls), ['reserve', 'release']);
  const known = world({ invite: async () => { throw Object.assign(new Error('registered'), { code: 'email_exists' }); } });
  const rk = await post(known.deps);
  assert.equal(rk.status, 200);
  assert.equal((await rk.json()).message, SENT);
  assert.deepEqual(names(known.calls), ['reserve', 'release']);
});

test('a normal redemption records the mail once with the new account\'s id and answers the sent words', async () => {
  const w = world();
  const r = await post(w.deps);
  assert.equal(r.status, 200);
  assert.deepEqual(w.calls.at(-1), ['sent', 7, 'u-1']);
  assert.equal(names(w.calls).filter((x) => x === 'sent').length, 1);
});
