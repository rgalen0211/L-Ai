// Option B pages (NEXT-WEB waiting pages; plan proposals/WEB-SIGNIN-WAITING-PLAN-1104.md): a WAITING account sees one page. The page only draws; the server is the gate (CONNECT). These prove the page-side belt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = cfg => { const win = { ryagramConfig: cfg }; vm.runInNewContext(read('assets/app-waiting.js'), { window: win, location: { origin: 'https://uselai.com' } }); return win.ryagramWaiting; };

test('the switch is OFF by default and needs exactly true (mock mode turns it on only on localhost)', () => {
  assert.match(read('assets/ryagram-config.js'), /waitingAccounts:\s*false/);
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

test('sign-up checks: an address, 12 characters, the same twice; each problem in plain words', () => {
  const W = load({ waitingAccounts: true });
  assert.equal(W.signUpProblem('a@b.co', 'a-long-password', 'a-long-password'), null);
  assert.match(W.signUpProblem('nope', 'a-long-password', 'a-long-password'), /email address/);
  assert.match(W.signUpProblem('a@b.co', 'short', 'short'), /at least 12/);
  assert.match(W.signUpProblem('a@b.co', 'a-long-password', 'a-long-passwore'), /do not match/);
});

test('sign-up goes to Auth with the address and password only, and relays Auth\'s refusal; it never sets a status itself', async () => {
  const W = load({ waitingAccounts: true }); const calls = [];
  const good = { auth: { signUp: async a => { calls.push(a); return { error: null }; } } }, bad = { auth: { signUp: async () => ({ error: { message: 'no' } }) } };
  assert.deepEqual(JSON.parse(JSON.stringify(await W.signUp(good, ' a@b.co ', 'a-long-password'))), { ok: true });
  assert.equal(calls[0].email, 'a@b.co'); assert.deepEqual(Object.keys(calls[0]).sort(), ['email', 'options', 'password']);
  assert.deepEqual(JSON.parse(JSON.stringify(await W.signUp(bad, 'a@b.co', 'a-long-password'))), { ok: false, message: 'no' });
  assert.ok(!/status|waiting|active|credit/.test(read('assets/app-waiting.js').match(/async function signUp[\s\S]*?\n  }/)[0].replace(/\/\/.*$/gm, '')), 'sign-up sets no status and grants no credit');
});

test('router belt: the waiting gate runs BEFORE every route test, and the admin list needs isAppAdmin', () => {
  const lib = read('assets/app-library.js');
  const gate = lib.indexOf('if (await waitingGate())'), firstRoute = lib.indexOf('hash.match(new RegExp(`^#/p/'), start = lib.indexOf('async function route()');
  assert.ok(start > 0 && gate > start && gate < firstRoute, 'waitingGate is called before any page is chosen');
  const routeBody = lib.slice(start, lib.indexOf('async function delayedNotice()'));
  const afterGate = routeBody.slice(routeBody.indexOf('if (await waitingGate())'));
  assert.equal((afterGate.match(/\n        if /g) || []).length, 0, 'one chain: no second "if" that could overwrite the waiting page');
  assert.match(lib, /waitingOn\(\) && hash === '#\/admin\/waiting' && await data\.isAppAdmin\(\)/);
  assert.match(lib, /catch \{ \/\* fail closed: the waiting page \*\/ \}/);
});

test('the waiting page offers only: an invite code, change password, delete account, sign out; delete-account stays open to it (the router test of CC1\'s exception)', () => {
  const src = read('assets/app-waiting.js');
  for (const call of ['data.claimInvite', 'data.changePassword', 'data.deleteAccount', 'data.signOut']) assert.ok(src.includes(call), call);
  assert.deepEqual([...src.matchAll(/href: '([^']*)'/g)].map(m => m[1]).filter(x => x !== '#/'), [], 'the only link is the way back to the list');
  assert.match(src, /You are on the list/); assert.match(src, /We will email you when your access opens\./);
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), 'server text goes in as text nodes');
});

test('the sign-up page: its own panel with one h1, email, password twice, the draft notice and a way back; the app script loads before the library', () => {
  const html = read('app/index.html');
  const panel = html.match(/<section id="create-account"[\s\S]*?<\/section>/)[0];
  assert.equal((panel.match(/<h1/g) || []).length, 1);
  for (const id of ['ca-email', 'ca-password', 'ca-again']) assert.ok(panel.includes(`id="${id}"`), id);
  assert.match(panel, /are drafts/); assert.match(panel, /Back to sign in/); assert.match(panel, /autocomplete="new-password"/);
  assert.ok(html.indexOf('app-waiting.js') > 0 && html.indexOf('app-waiting.js') < html.indexOf('app-library.js'));
  assert.match(html, /id="create-row"[^>]*hidden>First time here\? <a href="#\/create-account"/);
});

test('the account-made-by-sign-up path: the mock starts it WAITING and only a code or Ryan\'s approve opens it', async () => {
  const src = read('tests/fake-supabase.js');
  assert.match(src, /my_access\(\)/); assert.match(src, /admin_approve_waiting/); assert.match(src, /name === 'claim-invite'/);
  assert.match(src, /async signUp\(/); assert.match(src, /Admins only\./);
});

test('the waitlist section offers "Create an account" only when the switch is exactly true (hidden in the page, shown by ryagram.js)', () => {
  assert.match(read('ryagram/index.html'), /<p id="wl-create" class="rg-note" hidden>Or create an account now and we hold your place: <a href="\/app\/#\/create-account">/);
  assert.match(read('assets/ryagram.js'), /config\.waitingAccounts === true\) createLine\.hidden = false/);
});
