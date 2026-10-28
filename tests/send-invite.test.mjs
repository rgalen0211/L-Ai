// send-invite (NEXT-WEB 155): admin-only, one address, the words of the email, honest about SENT versus SAVED, and a failed send gives its reservation back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, compose, joinLink } from '../supabase/functions/send-invite/send.ts';

const ORIGIN = 'https://uselai.com';
const begun = { to: 'maya@example.com', name: 'Maya Ortiz', credits: 20, expires_at: '2026-11-26T15:00:00Z', sends: 1 };
const req = (body, { auth = 'Bearer app', origin = ORIGIN, method = 'POST' } = {}) => new Request('https://x/functions/v1/send-invite', {
  method, headers: { origin, authorization: auth, 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
function deps(over = {}) {
  const calls = { begin: [], undo: [], send: [] };
  return { calls, d: { allowedOrigins: [ORIGIN], siteUrl: ORIGIN, verifyUser: async jwt => (jwt === 'app' ? { id: 'u1', email: 'ryan@example.com' } : null),
    begin: async (jwt, code, email) => { calls.begin.push([jwt, code, email]); return begun; }, undo: async (jwt, code) => { calls.undo.push([jwt, code]); },
    send: async m => { calls.send.push(m); return { mode: 'live' }; }, now: () => new Date('2026-10-27T20:00:00Z'), ...over } };
}
const good = { code: 'RYA-K7M2-9QPX', email: 'Maya@Example.com' };

test('a good send: one message to the invite address, subject, the code and the pre-filled link; the answer says SENT', async () => {
  const { d, calls } = deps();
  const r = await handle(req(good), d), j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'sent'); assert.equal(j.to, 'maya@example.com'); assert.equal(j.at, '2026-10-27T20:00:00.000Z');
  assert.equal(calls.send.length, 1);
  const m = calls.send[0];
  assert.equal(m.kind, 'invite'); assert.equal(m.to, 'maya@example.com'); assert.equal(m.subject, 'Your Ryagram invite');
  assert.match(m.body, /Hi Maya,/); assert.match(m.body, /RYA-K7M2-9QPX/); assert.match(m.body, /20 beta credits/); assert.match(m.body, /expires on November 26, 2026/);
  assert.ok(m.body.includes('https://uselai.com/app/#/join?code=RYA-K7M2-9QPX&email=maya%40example.com'));
});

test('THE APPROVED WORDS (Ryan 2026-10-28 10:59), in full: the draft body, signed "The Ryagram Team" as the very last line, with nothing after it', () => {
  const body = compose({ ...begun }, 'RYA-K7M2-9QPX', 'https://uselai.com').body;
  assert.equal(body, [
    'Hi Maya,', '',
    "You're in. Your invite code is RYA-K7M2-9QPX.", '',
    'To sign up, open this link. It fills in your email and your code:', 'https://uselai.com/app/#/join?code=RYA-K7M2-9QPX&email=maya%40example.com', '',
    'Or go to https://uselai.com/app/, choose "Have an invite code?", and enter the code with this email address. You will get an email to set your password, and 20 beta credits will be waiting for you.', '',
    'Beta credits are free, in exchange for your feedback. If you talk about or promote Ryagram, or a film you made with it, please say your credits were free.', '',
    'The code works once and expires on November 26, 2026.', '',
    'The Ryagram Team',
  ].join('\n'));
  assert.equal(body.split('\n').at(-1), 'The Ryagram Team');
  assert.equal(body.split('\n').at(-2), '');
  assert.ok(!body.endsWith('\n'));
  // the credits sentence still goes for a 0-credit invite; the signature stays
  const none = compose({ ...begun, credits: 0 }, 'RYA-K7M2-9QPX', 'https://uselai.com').body;
  assert.ok(none.includes('to set your password.') && !none.includes('beta credit')); assert.equal(none.split('\n').at(-1), 'The Ryagram Team');
});

test('the address and code travel in the URL FRAGMENT, never the query string', () => {
  const l = joinLink('https://uselai.com/', 'RYA-K7M2-9QPX', 'a+b@example.com');
  assert.equal(l, 'https://uselai.com/app/#/join?code=RYA-K7M2-9QPX&email=a%2Bb%40example.com');
  assert.ok(!new URL(l).search);
  assert.ok(!/\?[^#]*code=/.test(l.split('#')[0]));
});

test('the recipient is whatever the database bound to the invite, never what the caller typed', async () => {
  const { d, calls } = deps({ begin: async () => ({ ...begun, to: 'bound@example.com' }) });
  await handle(req({ code: 'RYA-K7M2-9QPX', email: 'someone-else@example.com' }), d);
  assert.equal(calls.send[0].to, 'bound@example.com');
});

test('dry-run says SAVED and that nothing was sent', async () => {
  const { d } = deps({ send: async () => ({ mode: 'dry_run' }) });
  const j = await (await handle(req(good), d)).json();
  assert.equal(j.status, 'saved'); assert.match(j.message, /nothing was sent/i); assert.doesNotMatch(j.message, /^Sent/);
});

test('not an admin (the database refuses): 403 and nothing is sent', async () => {
  const { d, calls } = deps({ begin: async () => { throw new Error('Only an admin can send invites.'); } });
  const r = await handle(req(good), d);
  assert.equal(r.status, 403); assert.equal(calls.send.length, 0);
});

test('an AI token, no login, a bad origin, GET and bad bodies are all refused before anything runs', async () => {
  const { d, calls } = deps();
  assert.equal((await handle(req(good, { auth: 'Bearer nope' }), d)).status, 401);
  assert.equal((await handle(req(good, { auth: '' }), d)).status, 401);
  assert.equal((await handle(req(good, { origin: 'https://evil.example' }), d)).status, 403);
  assert.equal((await handle(req(good, { method: 'GET' }), d)).status, 405);
  for (const b of [{}, { code: 'x', email: 'a@b.co' }, { code: 'RYA-K7M2-9QPX' }, { code: 'RYA-K7M2-9QPX', email: 'a'.repeat(400) }, { code: 5, email: 'a@b.co' }]) assert.equal((await handle(req(b), d)).status, 400);
  assert.equal(calls.begin.length, 0); assert.equal(calls.send.length, 0);
});

test('the limits (another address, wait, 3 sends) come back as 409 in the database’s own words, with no markup', async () => {
  const { d, calls } = deps({ begin: async () => { throw new Error('That invite was made for another address.<b>'); } });
  const r = await handle(req(good), d), j = await r.json();
  assert.equal(r.status, 409); assert.match(j.error, /another address/); assert.ok(!/[<>]/.test(j.error)); assert.equal(calls.send.length, 0);
});

test('a failed send says nothing was sent and gives the reservation back', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    const { d, calls } = deps({ send: async () => { throw new Error('mail down'); } });
    const r = await handle(req(good), d), j = await r.json();
    assert.equal(r.status, 502); assert.match(j.error, /Nothing was sent/);
    assert.deepEqual(calls.undo, [['app', 'RYA-K7M2-9QPX']]);
  } finally { console.error = quiet; }
});

test('the words: no credits line when there are none; a one-word name still greets; nothing in the body but plain text', () => {
  const b = compose({ ...begun, credits: 0, name: '' }, 'RYA-K7M2-9QPX', ORIGIN).body;
  assert.match(b, /^Hi there,/); assert.doesNotMatch(b, /credit will|credits will/);
  assert.match(compose({ ...begun, credits: 1 }, 'RYA-K7M2-9QPX', ORIGIN).body, /1 beta credit will be waiting/);
  assert.ok(!/[<>]/.test(compose(begun, 'RYA-K7M2-9QPX', ORIGIN).body));
});
