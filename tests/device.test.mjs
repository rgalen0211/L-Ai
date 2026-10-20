// Signing a computer in (assets/app-device.js): the approval page #/device and Account > Computers signed in. DRAFT against a MOCK (r9 M2): the real device-code functions are
// CONNECT's and WORKER's and do not exist yet. This is what the page guarantees (CC1 13:20 and 13:34): it says to approve only a code on YOUR screen; the computer's name is untrusted
// text; Approve needs a signed-in session and a live code; a code is used once; nothing is approved until a button is pressed; and the page never sees a token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['app-device.js', 'app-data.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, URL, setTimeout, clearTimeout, setInterval, clearInterval });
const D = win.ryagramDevice;
const plain = x => JSON.parse(JSON.stringify(x));
const SIGNED_OUT = { user: null };

test('CODE: eight characters from an alphabet with no look-alikes, any case, spaces or one hyphen allowed; everything else is refused', () => {
  for (const ok of ['ABCD2345', 'abcd-2345', 'ABCD 2345', ' abcd2345 ', 'ab-cd-23-45']) assert.equal(D.normalizeCode(ok), 'ABCD2345', ok);
  for (const bad of ['', null, undefined, 'ABCD234', 'ABCD23456', 'ABCD0345', 'ABCDO345', 'ABCD1345', 'ABCDI345', 'ABCDL345', 'ABCD-23!5', '<b>ABCD2345</b>', 'ABCD\n2345x']) assert.equal(D.normalizeCode(bad), null, String(bad));
  assert.equal(D.showCode('ABCD2345'), 'ABCD-2345');
  assert.ok(!/[01OIL]/.test(D.ALPHABET), 'the alphabet has none of 0, O, 1, I, L');
});

test('ROUTE: #/device and #/device?code=... are this page; a bad code in the link is dropped (the person types it), anything else is not this page', () => {
  assert.deepEqual(plain(D.codeFromHash('#/device')), { page: true, code: null, bad: false });
  assert.deepEqual(plain(D.codeFromHash('#/device?code=ABCD-2345')), { page: true, code: 'ABCD2345', bad: false });
  assert.deepEqual(plain(D.codeFromHash('#/device?code=abcd2345')), { page: true, code: 'ABCD2345', bad: false });
  assert.deepEqual(plain(D.codeFromHash('#/device?code=ABCD0000')), { page: true, code: null, bad: true });                       // a bad code in the link is SAID, not silently dropped
  for (const other of ['#/devices', '#/device/ABCD2345', '#/device?code=ABCD-2345&x=1', '#/device?x=1', '#/account', '', null, undefined, '#/connect/consent?request=x']) assert.equal(D.codeFromHash(other).page, false, String(other));
});

test('EXPIRY: the page says when the code ends, warns at 2 minutes, and gives the recovery once it has ended', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const at = m => new Date(now + m * 60000).toISOString();
  assert.equal(D.expiry(at(9), now).state, 'ok');
  assert.match(D.expiry(at(9), now).text, /^This code ends at /);
  const soon = D.expiry(at(1.5), now);
  assert.equal(soon.state, 'soon');
  assert.match(soon.text, /in 2 minutes\. Decide now, or start again in the app\.$/);
  assert.equal(D.expiry(at(0.5), now).state, 'soon');
  assert.match(D.expiry(at(0.5), now).text, /in 1 minute\./);
  const gone = D.expiry(at(-1), now);
  assert.equal(gone.state, 'expired');
  assert.equal(gone.text, 'This code has ended. Start again in the Ryagram app.');
  assert.equal(D.expiry(undefined, now).state, 'unknown');
  assert.equal(D.expiry('nonsense', now).state, 'unknown');
});

test('DATA: check, decide (once), list and remove go through the four draft functions with exactly these arguments', async () => {
  const client = createFakeClient();
  const data = win.ryagramData(client);
  const c = await data.deviceRequestCheck('ABCD-2345');
  assert.equal(c.state, 'pending');
  assert.equal(c.computer_name, 'DESKTOP-SAM-PC');
  assert.ok(c.requested_at && c.expires_at, 'the facts the rev2 draft SQL returns');
  assert.equal((await data.deviceRequestCheck('ABCD-EFGH')).state, 'expired');                              // the server answers with a state, it does not raise
  assert.equal((await data.deviceRequestCheck('ZZZZ-2222')).state, 'unknown');
  assert.deepEqual(plain(await data.myComputers()), []);
  const r = await data.deviceDecide('ABCD-2345', true);
  assert.equal(r.approved, true);
  assert.equal(r.token_days, 30);
  await assert.rejects(data.deviceDecide('ABCD-2345', true), /not valid any more/);                         // MUST-FAIL: a used code is refused
  await assert.rejects(data.deviceDecide('ABCD-2345', false), /not valid any more/);
  assert.equal((await data.deviceRequestCheck('ABCD-2345')).state, 'used');                                 // and looking at a used code says so, with no facts
  const list = plain(await data.myComputers());
  assert.equal(list.length, 1);
  assert.equal(list[0].computer_name, 'DESKTOP-SAM-PC');
  assert.equal(await data.removeComputer('dev-1'), true);
  assert.deepEqual(plain(await data.myComputers()), [], 'a removed computer is no longer listed');
});

test('MUST-FAIL: Approve without a signed-in session is refused, and so is a check; nothing is recorded', async () => {
  const client = createFakeClient({}, SIGNED_OUT);
  const data = win.ryagramData(client);
  await assert.rejects(data.deviceDecide('ABCD-2345', true), /Sign in first/);
  await assert.rejects(data.deviceRequestCheck('ABCD-2345'), /Sign in first/);
  assert.deepEqual(plain(await data.myComputers()), []);
});

test('MUST-FAIL: a denied code approves nothing and cannot be approved afterwards', async () => {
  const data = win.ryagramData(createFakeClient());
  await data.deviceDecide('ABCD-2345', false);
  assert.deepEqual(plain(await data.myComputers()), []);
  await assert.rejects(data.deviceDecide('ABCD-2345', true), /not valid any more/);
});

test('PAGE SOURCE: says to approve only a code on YOUR screen, shows the code, the computer\'s own name as untrusted text, when it was asked for and where, has Approve and Deny, and decides only inside a button handler', () => {
  const src = read('assets/app-device.js');
  for (const text of ["const WARN = 'Approve only if this code is on YOUR screen right now", "h('strong', {}, 'Check before you approve. ')", "'The name it gave itself (not checked)'", "'Asked at'", "'Roughly where (a guess from its network)'",
                      "'Approve this computer'", "'Deny'", 'If you approve, this computer can make films for you for 30 days. It cannot spend your credits or change your account. You can remove it any time.', 'Approve signs this computer in. Deny signs nothing in.', 'Nothing was signed in. If you did not start this, you can ignore it.']) assert.ok(src.includes(text), text);
  const view = src.slice(src.indexOf('async function deviceView'), src.indexOf('// ---- the account page'));
  assert.equal([...view.matchAll(/data\.deviceDecide\(/g)].length, 1);                                       // one decide call, inside the button handler
  assert.match(view, /const decide = async \(button, yes\) => \{[\s\S]*data\.deviceDecide[\s\S]*\};\s*approve\.addEventListener\('click'/);
  assert.match(view, /if \(prefill\) show\(prefill\);/);                                                      // a link only triggers a CHECK
  assert.doesNotMatch(view.slice(view.indexOf('if (prefill)')), /deviceDecide/);
  assert.match(view, /String\(named\)\.slice\(0, 80\)/);                                             // the name is cut and shown as text
  assert.match(view, /if \(e\.state === 'expired'\) \{ approve\.disabled = true;/);
  assert.match(view, /if \(!code\) \{ showError\(error, new Error\(BAD_CODE\)\); return; \}/);
  assert.equal(D.BAD_CODE, "That code doesn't look right. Codes never use the letters O, I or L or the numbers 0 or 1. Check the app and try again.");
});

test('NO TOKEN, NO HTML: the page never reads, stores or shows a token or secret, and writes nothing but text nodes', () => {
  const code = read('assets/app-device.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|\bstyle:|setAttribute\('style'|localStorage|sessionStorage|document\.cookie|access_token|refresh_token|client_secret|device_secret|Authorization|fetch\(|location\.(assign|href)|navigate\(/);
});

test('WIRING AND FLAG: the route and the account section exist only behind desktopApp (off), the script loads before the library, and Remove confirms and then re-lists', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const desktopOn = \(\) => window\.ryagramConfig\?\.desktopApp === true \|\| !!window\.ryagramMock;/);
  assert.match(lib, /desktopOn\(\) && window\.ryagramDevice\.codeFromHash\(hash\)\.page\) view = await deviceUi\(\)\.deviceView\(window\.ryagramDevice\.codeFromHash\(hash\)\.code, window\.ryagramDevice\.codeFromHash\(hash\)\.bad\)/);
  assert.match(lib, /if \(desktopOn\(\)\) sections\.push\(await deviceUi\(\)\.computersSection\(\)\);/);
  assert.match(read('assets/ryagram-config.js'), /desktopApp: false,/);
  const html = read('app/index.html');
  assert.ok(html.indexOf('app-device.js') > 0 && html.indexOf('app-device.js') < html.indexOf('app-library.js'));
  const src = read('assets/app-device.js');
  assert.match(src, /confirm\(`Remove \$\{r\.computer_name \|\| r\.device_name \|\| r\.name \|\| 'this computer'\}\? It is signed out straight away\.`\)/);
  assert.match(src, /await data\.removeComputer\(r\.id\); await draw\(\);/);
});

test('WHICH ACCOUNT (CC1 13:48): above Approve the page says "You are signed in as <email>" so someone in a second account sees which account the computer will join; the email comes from the app\'s own session, cut to 120 characters, as text', () => {
  const src = read('assets/app-device.js');
  assert.match(src, /'You are signed in as ', h\('strong', \{\}, me\.slice\(0, 120\)\), '\. This computer will join this account\. Not you\? Sign out first\.'/);
  assert.ok(src.indexOf("'device-who'") < src.indexOf("class: 'device-consent' }, 'If you approve"), 'the account line comes before the consent sentence and the buttons');
  assert.match(read('assets/app-library.js'), /whoami: async \(\) => \(window\.ryagramApp\?\.client \? \(await window\.ryagramApp\.client\.auth\.getSession\(\)\)\.data\.session\?\.user\?\.email \|\| '' : ''\)/);
});

test('FACES\' FIXES (13:55, with CC1 13:55): the consent sentence is normal size and plain; the name is labelled "(not checked)"; no second copy of the code; the form goes away once answered; Deny says what it did; the account list says "not used yet" and "stops working on"', () => {
  const src = read('assets/app-device.js');
  assert.match(src, /h\('p', \{ class: 'device-consent' \}, 'If you approve, this computer can make films for you for 30 days\. It cannot spend your credits or change your account\. You can remove it any time\.'\)/);
  assert.doesNotMatch(src.slice(src.indexOf('async function deviceView'), src.indexOf('// ---- the account page')), /'Code'/);   // no second copy of the code
  assert.doesNotMatch(src, /The computer calls itself/);
  assert.match(src, /formBox\.hidden = true;/);
  assert.match(src, /not used yet/);
  assert.match(src, /stops working on \$\{date\(r\.expires_at\)\}/);
  assert.match(src, /\(bad \? h\('p', \{ class: 'app-error', role: 'alert' \}, BAD_CODE\) : null\)/);
});

test('REV2 STATES (WORKER 191fc78): a code that is not pending says why in words and shows no facts; the page reads computer_name, requested_at and rough_location', () => {
  const src = read('assets/app-device.js');
  assert.match(src, /const STATE_WORDS = \{ unknown: 'That code was not found\. Check the code in the app and type it again\.', used: 'That code has already been used\.', expired: 'That code has ended\. Start again in the Ryagram app\.' \};/);
  assert.match(src, /if \(!c \|\| \(c\.state && c\.state !== 'pending'\) \|\| !named\) \{/);
  assert.match(src, /c\.computer_name \|\| c\.device_name/);
  assert.match(src, /c\.rough_location \|\| c\.approx_place/);
  assert.match(src, /r\.computer_name \|\| r\.device_name \|\| r\.name/);
});

test('HYPHEN (found by the local E2E run): the page sends the code as XXXX-XXXX, the form the server stores; the unhyphenated form is not found', async () => {
  const src = read('assets/app-device.js');
  assert.match(src, /data\.deviceRequestCheck\(showCode\(code\)\)/);
  assert.match(src, /data\.deviceDecide\(showCode\(code\), yes\)/);
  const data = win.ryagramData(createFakeClient());
  assert.equal((await data.deviceRequestCheck('ABCD2345')).state, 'unknown', 'the unhyphenated form is not what the server stores');
  assert.equal((await data.deviceRequestCheck(D.showCode('ABCD2345'))).state, 'pending');
  await assert.rejects(data.deviceDecide('ABCD2345', true), /not valid any more/);
});
