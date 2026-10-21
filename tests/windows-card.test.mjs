// "Ryagram for Windows": the download card on the account page, TESTER ACCOUNTS ONLY (assets/app-device.js windowsAppSection, assets/windows-release.js; NEXT-WEB 118; behind desktopApp, off).
// What it guarantees: hidden for a non-tester, shown for a tester; the button is OFF until a release record carries an https address, a safe file name and a 64-hex SHA-256; the Run-anyway rule (CC1 16:17) and the
// three plain steps are on the card; the personal-use notice has a slot that stays hidden until the lawyer's wording is put in; and the page makes no network call (the download is a plain link).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['app-device.js', 'app-data.js', 'windows-release.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, URL, setTimeout, clearTimeout, setInterval, clearInterval });
const D = win.ryagramDevice;
const SHA = 'a'.repeat(64);
const GOOD = { url: 'https://example.test/files/Ryagram-for-Windows-1.zip', fileName: 'Ryagram-for-Windows-1.zip', sizeMb: 212, sha256: SHA, personalUseNotice: null };

// a tiny element builder: enough to read what the card would show
const h = (tag, attrs, ...kids) => ({ tag, attrs: (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !attrs.tag) ? attrs : {}, kids: ((attrs && attrs.tag) || typeof attrs === 'string' ? [attrs, ...kids] : kids).flat(Infinity).filter(x => x != null && x !== false) });
const text = n => (typeof n === 'string' ? n : n.kids.map(text).join(''));
const all = (n, pred, out = []) => { if (typeof n !== 'string') { if (pred(n)) out.push(n); n.kids.forEach(k => all(k, pred, out)); } return out; };
const card = async (seed, release) => {
  win.ryagramWindowsApp = release;
  const ui = D.create({ h, data: win.ryagramData(createFakeClient(seed)), busy: async () => {}, showError: () => {}, errorLine: () => h('p'), date: x => x, whoami: async () => 'sam@example.test' });
  return ui.windowsAppSection();
};
const TESTER = { account_settings: [{ owner_id: 'u-ryan', upload_retention: 'keep', local_compute: true }] };

test('WHO SEES IT: a non-tester gets no card; a tester does', async () => {
  assert.equal(await card({}, GOOD), null);
  assert.equal(await card({ account_settings: [{ owner_id: 'u-ryan', local_compute: false }] }, GOOD), null);
  const c = await card(TESTER, GOOD);
  assert.ok(c && text(c).includes('Ryagram for Windows'));
});

test('READY ONLY WITH A SAFE RELEASE: an https address, a plain file name and a 64-hex SHA-256; anything else keeps the button off', () => {
  assert.equal(D.windowsReady(GOOD), true);
  for (const bad of [null, {}, { ...GOOD, url: null }, { ...GOOD, url: 'http://example.test/a.zip' }, { ...GOOD, url: 'javascript:alert(1)' }, { ...GOOD, url: 'https://x.test/a b.zip' }, { ...GOOD, fileName: null },
                     { ...GOOD, fileName: '../x.zip' }, { ...GOOD, fileName: 'a/b.zip' }, { ...GOOD, sha256: null }, { ...GOOD, sha256: 'A'.repeat(64) }, { ...GOOD, sha256: 'a'.repeat(63) }]) assert.equal(D.windowsReady(bad), false, JSON.stringify(bad));
});

test('BEFORE RYAN HOSTS THE FILE (the committed record is empty): the button is off and says Not ready yet; there is no link', async () => {
  const empty = win.ryagramWindowsApp = undefined;
  vm.runInNewContext(read('assets/windows-release.js'), { window: win });                          // the committed record
  const rel = win.ryagramWindowsApp;
  assert.deepEqual(JSON.parse(JSON.stringify(rel)), { url: null, fileName: null, sizeMb: null, sha256: null, personalUseNotice: null });
  const c = await card(TESTER, rel);
  assert.equal(all(c, n => n.tag === 'a').length, 0, 'no download link');
  const b = all(c, n => n.tag === 'button')[0];
  assert.equal(text(b), 'Not ready yet');
  assert.equal(b.attrs.disabled, true);
  assert.match(text(c), /Ryan will put the file here when it is ready\./);
  assert.match(text(c), /shown here when the file is ready/);
});

test('A READY CARD: one https link with the file name, the name and SHA-256 on screen, and the size in plain words', async () => {
  const c = await card(TESTER, GOOD);
  const links = all(c, n => n.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].attrs.href, GOOD.url);
  assert.equal(links[0].attrs.download, GOOD.fileName);
  assert.equal(text(links[0]), 'Download Ryagram for Windows');
  const t = text(c);
  assert.ok(t.includes(GOOD.fileName) && t.includes(SHA));
  assert.match(t, /about 212 MB\. The listening model is downloaded separately, the first time you run it\./);
  assert.equal(all(c, n => n.tag === 'button').length, 0, 'no disabled button once it is ready');
});

test('THE THREE PLAIN STEPS AND THE RUN-ANYWAY RULE (CC1 16:17): the steps match CONNECT\'s and FACES\' words (FACES 18:54: check step before Open it, space needed, Chrome and memory for site films, undo line); Run anyway only if the name and SHA-256 match; anyone else asking, say no', async () => {
  const t = text(await card(TESTER, GOOD));
  for (const s of ['unzip it into a folder', 'double-click Open Ryagram', 'Windows protected your PC', 'More info, then Run anyway', 'but only if the file name is exactly', 'and the SHA-256 matches',
                   'If anyone else ever asks you to press Run anyway, say no.', 'Download the listening model', 'Balanced is already chosen for you, about 464 MB', 'Sign in to Ryagram', 'approve the code on this website',
                   'Get-FileHash ' + GOOD.fileName + ' -Algorithm SHA256', 'about 1.1 GB free', 'looks like a small window or gear icon', 'the only file to double-click', 'Check it.', 'must equal the SHA-256 above',
                   'need nothing more', 'Google Chrome installed and about 5 GB of free memory', 'To remove it, delete the folder', 'Remove this computer', 'just below this card']) assert.ok(t.includes(s), s);
  const steps = all(await card(TESTER, GOOD), n => n.tag === 'ol');
  assert.equal(steps[0].kids.length, 4, 'four steps');
});

test('NOT READY: the check line keeps a placeholder, and the check step comes before Open it', async () => {
  const t = text(await card(TESTER, null));
  assert.ok(t.includes('Get-FileHash <the file> -Algorithm SHA256'));
  assert.ok(t.indexOf('Check it.') < t.indexOf('Open it.'));
});

test('THE PERSONAL-USE NOTICE SLOT (wording is the lawyer\'s, never a session\'s): present and hidden until a notice is put in; the card itself writes none', async () => {
  const hidden = all(await card(TESTER, GOOD), n => n.attrs && n.attrs['data-slot'] === 'personal-use-notice')[0];
  assert.ok(hidden, 'the slot exists');
  assert.equal(hidden.attrs.hidden, true);
  assert.equal(text(hidden), '');
  const shown = all(await card(TESTER, { ...GOOD, personalUseNotice: 'LAWYER WORDING GOES HERE' }), n => n.attrs && n.attrs['data-slot'] === 'personal-use-notice')[0];
  assert.equal(shown.attrs.hidden, false);
  assert.equal(text(shown), 'LAWYER WORDING GOES HERE');
  assert.doesNotMatch(read('assets/app-device.js').replace(/\/\/.*$/gm, ''), /personal use only|not for resale|licen[sc]ed to you/i);          // no session wrote notice text
});

test('NO NETWORK, NO HTML: the card makes no call (the download is a link the person follows), and writes only text nodes', () => {
  const src = read('assets/app-device.js');
  const card = src.slice(src.indexOf('async function windowsAppSection'), src.indexOf('// ---- admin: who is a tester'));
  assert.doesNotMatch(card.replace(/\/\/.*$/gm, ''), /fetch\(|XMLHttpRequest|sendBeacon|innerHTML|insertAdjacentHTML|localStorage|navigate\(|location\./);
  assert.doesNotMatch(read('assets/windows-release.js').replace(/\/\/.*$/gm, ''), /fetch\(|XMLHttpRequest|http:/);
});

test('WIRING: the card is added only behind desktopApp (off), before the computers list; the release file loads before the device script', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /if \(desktopOn\(\)\) \{ const windows = await deviceUi\(\)\.windowsAppSection\(\); if \(windows\) sections\.push\(windows\); \}/);
  assert.ok(lib.indexOf('windowsAppSection') < lib.indexOf('computersSection'));
  assert.match(read('assets/ryagram-config.js'), /desktopApp: false,/);
  const html = read('app/index.html');
  assert.ok(html.indexOf('windows-release.js') > 0 && html.indexOf('windows-release.js') < html.indexOf('app-device.js'));
});
