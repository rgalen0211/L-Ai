// The app link in the invite email (NEXT-CONNECT 162): supabase/functions/send-invite/send.ts with `appLink`. OFF by default: with the switch off, or when the admin did not ask, the email is EXACTLY the approved one.
// The added words are a DRAFT for Ryan's approval (the email's words are Ryan's). tests/invite_app_link_mutants.mjs proves each must-fail by breaking the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, compose, appLinkUrl } from '../supabase/functions/send-invite/send.ts';

const ORIGIN = 'https://uselai.com';
const begun = { to: 'maya@example.com', name: 'Maya Ortiz', credits: 20, expires_at: '2026-11-26T15:00:00Z', sends: 1 };
const TOKEN = 'ab'.repeat(32);
const req = (body, { auth = 'Bearer app', origin = ORIGIN } = {}) => new Request('https://x/functions/v1/send-invite', { method: 'POST', headers: { origin, authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
function deps({ on = true, fail = false, noAppLink = false } = {}) {
  const calls = { begin: [], undo: [], send: [], make: [] };
  const d = { allowedOrigins: [ORIGIN], siteUrl: ORIGIN, verifyUser: async (jwt) => (jwt === 'app' ? { id: 'u1', email: 'ryan@example.com' } : null),
    begin: async (jwt, code, email) => { calls.begin.push([jwt, code, email]); return begun; }, undo: async (jwt, code) => { calls.undo.push([jwt, code]); },
    send: async (m) => { calls.send.push(m); return { mode: 'live' }; }, now: () => new Date('2026-10-30T20:00:00Z') };
  if (!noAppLink) d.appLink = { enabled: () => on, make: async (jwt, code) => { calls.make.push([jwt, code]); if (fail) throw new Error('boom ' + TOKEN); return { token: TOKEN, expires_at: '2026-11-06T20:00:00Z' }; } };
  return { calls, d };
}
const good = { code: 'RYA-K7M2-9QPX', email: 'maya@example.com' };
const WORDS_WITHOUT = compose(begun, 'RYA-K7M2-9QPX', ORIGIN).body;

test('the link goes in the fragment of a page on the site, never in a query string', () => {
  const u = appLinkUrl(ORIGIN, TOKEN);
  assert.equal(u, `https://uselai.com/get-app/#t=${TOKEN}`);
  assert.ok(!u.split('#')[0].includes(TOKEN) && !u.includes('?'));
  assert.equal(appLinkUrl('https://uselai.com/', TOKEN), u);
});

test('compose without a link is the approved email, byte for byte; with a link it adds ONE paragraph and the approved words are all still there, the signature last', () => {
  assert.ok(!/get-app|Windows/.test(WORDS_WITHOUT));
  assert.ok(WORDS_WITHOUT.endsWith('The Ryagram Team'));
  const w = compose(begun, 'RYA-K7M2-9QPX', ORIGIN, { url: appLinkUrl(ORIGIN, TOKEN), expires_at: '2026-11-06T20:00:00Z' }).body;
  assert.ok(w.endsWith('The Ryagram Team'));
  assert.ok(w.includes(`https://uselai.com/get-app/#t=${TOKEN}`));
  assert.match(w, /works once, and it expires on November 6, 2026/);
  assert.match(w, /sign in at https:\/\/uselai\.com\/app\/ and use the Download card/);
  const lines = w.split('\n');
  const approved = WORDS_WITHOUT.split('\n');
  assert.ok(approved.every((l) => lines.includes(l)), 'every approved line is still in the email');
  assert.equal(lines.length - approved.length, 5, 'exactly one added paragraph (the link line, its sentence, the fallback sentence and two blank lines)');
  assert.ok(!/[<>]/.test(w));
});

test('MUST-FAIL: not asked for: no link is made and the email is exactly the approved one', async () => {
  const { d, calls } = deps();
  const r = await handle(req(good), d), j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.app_link, 'not_asked');
  assert.equal(calls.make.length, 0); assert.equal(calls.send[0].body, WORDS_WITHOUT);
  for (const odd of ['yes', 1, 'true', null, [], {}]) {
    const x = deps(); const rr = await handle(req({ ...good, include_app_link: odd }), x.d);
    assert.equal(x.calls.make.length, 0, JSON.stringify(odd)); assert.equal(x.calls.send[0].body, WORDS_WITHOUT, JSON.stringify(odd)); assert.equal((await rr.json()).app_link, 'not_asked');
  }
});

test('MUST-FAIL: asked for but the switch is OFF (or the function has no app link at all): no link is made, the email is the approved one, and the answer says so', async () => {
  for (const cfg of [{ on: false }, { noAppLink: true }]) {
    const { d, calls } = deps(cfg);
    const r = await handle(req({ ...good, include_app_link: true }), d), j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.app_link, 'off'); assert.match(j.message, /app link is not switched on/);
    assert.equal(calls.make.length, 0); assert.equal(calls.send[0].body, WORDS_WITHOUT);
  }
});

test('asked for and on: the link is made for THIS invite as the caller, put in the email, and the answer says so', async () => {
  const { d, calls } = deps();
  const r = await handle(req({ ...good, include_app_link: true }), d), j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.app_link, 'included'); assert.match(j.message, /one-time app download link/);
  assert.deepEqual(calls.make, [['app', 'RYA-K7M2-9QPX']]);
  assert.ok(calls.send[0].body.includes(`https://uselai.com/get-app/#t=${TOKEN}`));
  assert.ok(!JSON.stringify(j).includes(TOKEN), 'the token is only in the email, not in the answer to the admin page');
});

test('MUST-FAIL: if the link cannot be made the invite still goes, WITHOUT it, and the answer says so; the token and the error text are not logged', async () => {
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    const { d, calls } = deps({ fail: true });
    const r = await handle(req({ ...good, include_app_link: true }), d), j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.app_link, 'failed'); assert.match(j.message, /could not be made/);
    assert.equal(calls.send.length, 1); assert.equal(calls.send[0].body, WORDS_WITHOUT);
  } finally { console.error = orig; }
  assert.ok(logs.every((l) => !l.includes(TOKEN)), 'no token in the log: ' + logs.join(' | '));
});

test('MUST-FAIL: the link is made only AFTER the database has accepted the send (a refused send makes no link), and a failed mail send does not leave the admin with a sent-looking answer', async () => {
  const x = deps({}); x.d.begin = async () => { throw new Error('That invite was made for another address'); };
  const r = await handle(req({ ...good, include_app_link: true }), x.d);
  assert.equal(r.status, 409); assert.equal(x.calls.make.length, 0, 'no link for a send the database refused');
  const y = deps({}); y.d.send = async () => { throw new Error('mail down'); };
  const e = console.error; console.error = () => {};
  try { const r2 = await handle(req({ ...good, include_app_link: true }), y.d); assert.equal(r2.status, 502); assert.equal(y.calls.undo.length, 1); } finally { console.error = e; }
});
