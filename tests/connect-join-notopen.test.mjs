// What the join function says when sign-up is not open (CONNECT 2026-11-23). It used to say "Join the waitlist instead", but the page that ships with open sign-up has no waitlist, and that page shows the function's own sentence, so a
// stranger who hit the closed moment (overnight before the flip, or after the undo, live-step 48) was sent to a list that does not exist. Customer step: a stranger who cannot make an account yet is told so plainly and to try again later,
// never to a waitlist, an invite or a person. Runs the real handler with fake dependencies; talks to nothing. Must-fails: tests/connect_join_notopen_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle as join, NOT_OPEN_WORDS, SENT, ADULT_WORDS } from '../supabase/functions/join/join.ts';

const ORIGIN = 'https://uselai.com';
const deps = (reason) => ({ allowedOrigins: [ORIGIN], siteUrl: ORIGIN, reserve: async () => ({ ok: false, reason }), invite: async () => {} });
const post = () => new Request('https://x.test/fn', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@example.test', adult_confirmed: true }) });
const WRONG = /waitlist|wait list|waiting list|invite|invitation|ask Ryan|email us/i;

test('when sign-up is not open the answer is 409 with the plain words, and never points to a waitlist, an invite or a person', async () => {
  const r = await join(post(), deps('off'));
  assert.equal(r.status, 409, 'the page reads 409 as "not open yet"');
  const said = (await r.json()).error;
  assert.equal(said, NOT_OPEN_WORDS);
  assert.match(said, /not open yet/);
  assert.match(said, /try again later/i);
  assert.ok(!WRONG.test(said), said);
});

test('none of the other refusals of the join function points to a waitlist, an invite or a person either', async () => {
  for (const reason of ['throttled', 'email', 'boom']) {
    const r = await join(post(), deps(reason));
    const said = (await r.json()).error;
    assert.ok(said && !WRONG.test(said), reason + ': ' + said);
  }
  assert.ok(!WRONG.test(ADULT_WORDS), 'the 18+ words are clean too');
  assert.ok(!WRONG.test(SENT.replace('Already have an account? Sign in instead.', '')), 'and so are the sent words');
});
