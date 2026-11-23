// Option B pages (NEXT-WEB waiting pages; plan proposals/WEB-SIGNIN-WAITING-PLAN-1104.md): a WAITING account sees one page. The page only draws; the server is the gate (CONNECT). These prove the page-side belt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = cfg => { const win = { ryagramConfig: cfg }; vm.runInNewContext(read('assets/app-waiting.js'), { window: win, location: { origin: 'https://uselai.com' } }); return win.ryagramWaiting; };

test('the switch needs exactly true (mock mode turns it on only on localhost); on branch web-signup-open-1122 the committed value is TRUE (Ryan 11-21: sign-up OPEN at launch), and the README says how to undo it', () => {
  assert.match(read('assets/ryagram-config.js'), /\n  waitingAccounts: true,\n/);
  assert.match(read('README.md'), /## Open sign-up switch[\s\S]*waitingAccounts: true[\s\S]*join_open/);
  assert.equal(load({ waitingAccounts: false }).on(), false);
  assert.equal(load({ waitingAccounts: 'true' }).on(), false);
  assert.equal(load({ waitingAccounts: true }).on(), true);
  assert.equal(load({}).on(), false);
});

test('fail closed: only the word active opens the app; anything else, an error shape or nothing draws the waiting page', () => {
  const W = load({ waitingAccounts: true });
  assert.equal(W.accessOf('active'), 'active'); assert.equal(W.accessOf({ status: 'active' }), 'active');
  for (const x of ['waiting', 'ACTIVE', ' active', '', null, undefined, true, 1, {}, { status: 'waiting' }, { status: 'Active' }, ['active']]) assert.equal(W.accessOf(x), 'waiting', String(JSON.stringify(x)));
  assert.equal(W.pageFor('active', '#/'), 'normal');
  for (const h of ['#/', '', '#/credits', '#/account', '#/p/x', '#/admin/waiting', '#/waiting', '#/new', '#/build']) assert.equal(W.pageFor('waiting', h), 'waiting', h);
});

test('sign-up checks (Q378 A): an email address only, the problem in plain words; no password is asked for on the page', () => {
  const W = load({ waitingAccounts: true });
  assert.equal(W.signUpProblem('a@b.co'), null);
  assert.equal(W.signUpProblem(' a@b.co '), null);
  for (const bad of ['nope', '', null, undefined, 'a@b', `${'x'.repeat(250)}@b.co`]) assert.match(W.signUpProblem(bad), /email address/, String(bad));
  assert.ok(!/password/i.test(read('assets/app-waiting.js').match(/function signUpProblem[\s\S]*?\n  }/)[0]), 'no password rule left in the sign-up check');
});

test('sign-up (Q378 A) goes ONLY through the join function with the trimmed address, relays its answers, and never sets a status or touches Auth itself', async () => {
  const W = load({ waitingAccounts: true }); const calls = [];
  const data = answer => ({ joinWaiting: async (e, over18) => { calls.push(e); assert.equal(over18, true); return answer; } });
  assert.deepEqual(await W.signUp(data({ ok: true, off: false, message: 'sent' }), ' a@b.co ', true), { ok: true, off: false, message: 'sent' });
  assert.equal(calls[0], 'a@b.co');
  assert.deepEqual(await W.signUp(data({ ok: false, off: true, message: 'not open yet' }), 'a@b.co', true), { ok: false, off: true, message: 'not open yet' });
  const body = read('assets/app-waiting.js').match(/async function signUp[\s\S]*?\n  }/)[0].replace(/\/\/.*$/gm, '');
  assert.ok(!/status|waiting|active|credit|auth\.|signUp\(\{/.test(body.replace('async function signUp', '')), 'sign-up sets no status, grants no credit and never calls Auth sign-up');
  assert.ok(!/auth\.signUp/.test(read('assets/app-auth.js')), 'the page no longer calls Supabase sign-up (Auth sign-up stays OFF)');
});

test('the data layer: join and approve-waiting go through CONNECT\'s functions with exactly their body fields; a 409 from join reads as "not open yet"', async () => {
  const src = read('assets/app-data.js');
  assert.match(src, /functions\.invoke\('join', \{ body: \{ email: String\(email \|\| ''\)\.trim\(\), adult_confirmed: true \} \}\)/);
  assert.match(src, /functions\.invoke\('approve-waiting', \{ body: \{ user_id: userId, reason \} \}\)/);
  assert.match(src, /off: status === 409/);
  assert.ok(!/rpc\('admin_approve_waiting'/.test(src), 'approving never calls the database directly (the function sends the email and pays once)');
});

test('the waiting list: only a confirmed address gets an Approve button; the ops page line counts both', () => {
  const W = load({ waitingAccounts: true });
  assert.equal(W.waitingSummary([]), 'Nobody is waiting.');
  assert.equal(W.waitingSummary([{ confirmed: true }]), '1 account is waiting; 1 has confirmed the address and can be approved.');
  assert.equal(W.waitingSummary([{ confirmed: true }, { confirmed: false }, { confirmed: 'true' }]), '3 accounts are waiting; 1 has confirmed the address and can be approved.');
  assert.equal(W.waitingSummary(null), 'Nobody is waiting.');
  const src = read('assets/app-waiting.js');
  assert.match(src, /if \(r\.confirmed !== true\) \{/); assert.match(src, /address not confirmed yet/); assert.match(src, /fmt\(r\.joined_at\)/);
  assert.ok(!/created_at/.test(src), 'the list reads joined_at, the name CONNECT returns');
  const lib = read('assets/app-library.js');
  assert.match(lib, /if \(waitingOn\(\)\) \{ try \{ waitList = await data\.adminWaitingList\(\); \} catch \{ waitList = null; \} \}/);
  assert.match(lib, /'Open the waiting list to approve'/);
});

test('router belt: the waiting gate runs BEFORE every route test, and the admin list needs isAppAdmin', () => {
  const lib = read('assets/app-library.js');
  const gate = lib.indexOf('if (await waitingGate(gate))'), firstRoute = lib.indexOf('hash.match(new RegExp(`^#/p/'), start = lib.indexOf('async function route()');
  assert.ok(start > 0 && gate > start && gate < firstRoute, 'waitingGate is called before any page is chosen');
  const routeBody = lib.slice(start, lib.indexOf('async function delayedNotice()'));
  const afterGate = routeBody.slice(routeBody.indexOf('if (await waitingGate(gate))'));
  assert.equal((afterGate.match(/\n        if /g) || []).length, 0, 'one chain: no second "if" that could overwrite the waiting page');
  assert.match(lib, /waitingOn\(\) && hash === '#\/admin\/waiting' && await data\.isAppAdmin\(\)/);
  assert.match(lib, /checkAccess\(\(\) => data\.myAccess\(\)\)/);          // fail closed: a failed check never opens the app (wed-v3-1123 tests the words)
});

test('the waiting page offers only: an invite code, change password, delete account, sign out; delete-account stays open to it (the router test of CC1\'s exception)', () => {
  const src = read('assets/app-waiting.js');
  for (const call of ['data.claimInvite', 'data.changePassword', 'data.deleteAccount', 'data.signOut']) assert.ok(src.includes(call), call);
  assert.deepEqual([...src.matchAll(/href: '([^']*)'/g)].map(m => m[1]).filter(x => x !== '#/'), [], 'the only link is the way back to the list');
  assert.match(src, /You are on the list/); assert.match(src, /We will email you when your access opens\./);
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), 'server text goes in as text nodes');
});

test('the sign-up page (Q378 A): its own panel with one h1, the email box and NO password box, the draft notice and a way back; the app script loads before the library', () => {
  const html = read('app/index.html');
  const panel = html.match(/<section id="create-account"[\s\S]*?<\/section>/)[0];
  assert.equal((panel.match(/<h1/g) || []).length, 1);
  assert.ok(panel.includes('id="ca-email"'));
  assert.ok(!/type="password"|ca-password|ca-again/.test(panel), 'no password on the sign-up page: it is chosen from the emailed link');
  assert.doesNotMatch(panel, /are drafts|only puts you on the list|joins the list|access opens|waitlist|invite/i, 'open sign-up (11-22): no list, no wait, no invite words on the sign-up page');
  assert.match(panel, /<p class="form-intro">Make a free account to try Ryagram\.<\/p>/);
  assert.match(panel, /Ryagram is for people 18 and older\. Read the <a href="\/terms\/">Terms of Use<\/a> and the <a href="\/privacy-policy\.html">Privacy Policy<\/a>\./);
  assert.match(panel, /Back to sign in/); assert.match(panel, /choose your password/);
  assert.ok(html.indexOf('app-waiting.js') > 0 && html.indexOf('app-waiting.js') < html.indexOf('app-library.js'));
  assert.match(html, /id="create-row"[^>]*hidden>First time here\? <a href="#\/create-account"/);
});

test('the account-made-by-sign-up path: the mock starts it WAITING and only a code or Ryan\'s approve opens it', async () => {
  const src = read('tests/fake-supabase.js');
  assert.match(src, /my_access\(\)/); assert.match(src, /name === 'claim-invite'/); assert.match(src, /name === 'join'/); assert.match(src, /name === 'approve-waiting'/);
  assert.match(src, /not confirmed yet, so it cannot be approved/); assert.match(src, /Admins only\./);
});

test('the waitlist section offers "Create an account" only when the switch is exactly true (hidden in the page, shown by ryagram.js)', () => {
  assert.match(read('ryagram/index.html'), /<p id="wl-create" class="rg-note" hidden>Or start now: <a href="\/app\/#\/create-account">Create an account<\/a>\. We email you a link to confirm your address and choose a password, and then you can start\.<\/p>/);
  assert.doesNotMatch(read('ryagram/index.html'), /hold your place|when your access opens/);
  assert.match(read('assets/ryagram.js'), /config\.waitingAccounts === true\) createLine\.hidden = false/);
});

// The data layer for real (not a regex): a fake supabase-js client whose functions.invoke answers like the real one (an error carries the Response as .context)
const dataWith = invoke => { const win = {}; vm.runInNewContext(read('assets/app-data.js'), { window: win, console }); return win.ryagramData({ functions: { invoke } }); };
const httpError = (status, body) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => body } } });

test('joinWaiting and the 18+ box (CONNECT 94ab6162 refuses without adult_confirmed: true): ticked sends the field, anything else sends nothing', async () => {
  const calls = [];
  const D = dataWith(async (name, opts) => { calls.push([name, opts]); return { data: { message: 'ok' }, error: null }; });
  for (const x of [false, undefined, null, 'true', 1]) { const r = JSON.parse(JSON.stringify(await D.joinWaiting('a@b.co', x))); assert.equal(r.ok, false); assert.match(r.message, /18 or older/); }
  assert.equal(calls.length, 0, 'unticked: no request');
  assert.equal((await D.joinWaiting('a@b.co', true)).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['join', { body: { email: 'a@b.co', adult_confirmed: true } }]]);
});

test('joinWaiting for real: the trimmed address goes in {email}; 200 is ok with the server words; 409 is "off" (not open yet); other errors carry the server words; a broken reply falls back to plain words', async () => {
  const calls = [];
  let D = dataWith(async (name, opts) => { calls.push([name, opts]); return { data: { message: 'If that email can join, a link is on its way.' }, error: null }; });
  assert.deepEqual(JSON.parse(JSON.stringify(await D.joinWaiting('  a@b.co ', true))), { ok: true, off: false, message: 'If that email can join, a link is on its way.' });
  assert.equal(calls[0][0], 'join'); assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { body: { email: 'a@b.co', adult_confirmed: true } });
  D = dataWith(async () => httpError(409, { error: 'Making an account is not open yet.' }));
  assert.deepEqual(JSON.parse(JSON.stringify(await D.joinWaiting('a@b.co', true))), { ok: false, off: true, message: 'Making an account is not open yet. Please try again later.' });
  D = dataWith(async () => httpError(409, { error: 'Making an account is not open yet. Please try again later.' }));
  const wl = JSON.parse(JSON.stringify(await D.joinWaiting('a@b.co', true))); assert.equal(wl.off, true); assert.equal(wl.message, 'Making an account is not open yet. Please try again later.'); assert.doesNotMatch(wl.message, /waitlist/i);
  D = dataWith(async () => httpError(503, { error: 'We cannot send the email. Try later.' }));
  const sf = JSON.parse(JSON.stringify(await D.joinWaiting('a@b.co', true))); assert.deepEqual(sf, { ok: false, off: false, message: 'We could not send the email just now. Please try again in a few minutes.' });
  D = dataWith(async () => httpError(429, { error: 'Too many tries. Wait a while, then try again.' }));
  const t = JSON.parse(JSON.stringify(await D.joinWaiting('a@b.co', true))); assert.equal(t.off, false); assert.equal(t.message, 'Too many tries. Wait a while, then try again.');
  D = dataWith(async () => ({ data: null, error: { message: 'network', context: { status: 0, json: async () => { throw new Error('not json'); } } } }));
  const n = JSON.parse(JSON.stringify(await D.joinWaiting('a@b.co', true))); assert.equal(n.ok, false); assert.equal(n.off, false); assert.match(n.message, /Try again in a minute/);
});

test('adminApproveWaiting for real: {user_id, reason} to approve-waiting; the server answer comes back; a refusal throws with the server words', async () => {
  const calls = [];
  let D = dataWith(async (name, opts) => { calls.push([name, opts]); return { data: { status: 'sent', message: 'a@b.co is approved.' }, error: null }; });
  assert.equal((await D.adminApproveWaiting('00000000-0000-4000-8000-000000000001', 'approved in the admin page')).message, 'a@b.co is approved.');
  assert.equal(calls[0][0], 'approve-waiting'); assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { body: { user_id: '00000000-0000-4000-8000-000000000001', reason: 'approved in the admin page' } });
  D = dataWith(async () => httpError(400, { error: 'That address has not been confirmed yet, so it cannot be approved.' }));
  await assert.rejects(() => D.adminApproveWaiting('00000000-0000-4000-8000-000000000001', 'approved in the admin page'), /not been confirmed yet/);
});

test('the list contract: the real gate returns confirmed (CONNECT c4b31e5), and the page needs it', () => {
  const mig = read('supabase/migrations/20261104000100_waiting_accounts.sql');
  assert.match(mig, /create function public\.admin_waiting_list\(\) returns table \(user_id uuid, email text, joined_at timestamptz, confirmed boolean\)/);
  assert.match(mig, /That address has not been confirmed yet, so it cannot be approved\./);
});
