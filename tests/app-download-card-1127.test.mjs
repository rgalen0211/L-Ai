// The app download card for Compilations accounts (WEB 11-28; CONNECT's installer plan 11-27 section 4 item 2 and section 6; Ryan 23:43 and 23:49: a direct download from our own site, UNSIGNED, with the plain
// "More info, then Run anyway" step). What it guarantees: the card shows for a tester (as before) AND for an account whose Compilations switch is on; the BUTTON is gated on
// APP_DOWNLOAD_COMPILATIONS_DOOR (false: the server still refuses such an account), so a Compilations account that is not a tester sees the honest line and no button; with the door on (the mock's ?appdoor) the
// button, the setup's file name and its SHA-256 show; the setup card carries the six "If Windows warns you" steps (More info, Run anyway, the PowerShell Get-FileHash line) and never the word unzip;
// no screenshot is invented; the Compilations page links to the card (44px) or says the same honest line. Every public word is a DRAFT for Ryan's yes (docs/app-download-card-words-1127.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
for (const f of ['app-device.js', 'app-data.js', 'windows-release.js', 'app-compilations.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, URL, setTimeout, clearTimeout, setInterval, clearInterval });
const D = win.ryagramDevice;
const SHA = 'b'.repeat(64);
const EXE = { url: 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/app-download', fileName: 'Ryagram-Setup-0.1.0.exe', sizeMb: 290, unpackedMb: null, sha256: SHA, personalUseNotice: null };
const ZIP = { url: 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/app-download', fileName: 'app-1030e.zip', sizeMb: 274, unpackedMb: 738, sha256: '6ecb8961e46fa09df81f94e5d59190343b677f5dfa3edca1ab48921a961c7550', personalUseNotice: null };

const h = (tag, attrs, ...kids) => ({ tag, attrs: (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !attrs.tag) ? attrs : {}, kids: ((attrs && attrs.tag) || typeof attrs === 'string' ? [attrs, ...kids] : kids).flat(Infinity).filter(x => x != null && x !== false) });
const text = n => (typeof n === 'string' ? n : n.kids.map(text).join(''));
const all = (n, pred, out = []) => { if (typeof n !== 'string') { if (pred(n)) out.push(n); n.kids.forEach(k => all(k, pred, out)); } return out; };
const TESTER = { account_settings: [{ owner_id: 'u-ryan', upload_retention: 'keep', local_compute: true }] };
const NOT_TESTER = { account_settings: [{ owner_id: 'u-ryan', upload_retention: 'keep', local_compute: false }] };

// one account: its seed, whether the Compilations switch is on, whether the mock door is open, the release record
async function card({ seed = {}, compilations = false, door = false, record = ZIP, working = false } = {}) {
  win.ryagramWindowsApp = record;
  win.ryagramAppDoorMock = door ? true : undefined;
  win.ryagramSwitches = { featureOn: k => (k === 'compilations' ? compilations : false) };
  const client = createFakeClient(seed);
  const data = win.ryagramData(client);
  if (working) data.myDepartments = async () => [{ id: 'compilations', status: 'working' }];
  const ui = D.create({ h, data, busy: async () => {}, showError: () => {}, errorLine: () => h('p'), date: x => x, whoami: async () => 'sam@example.test' });
  return { section: await ui.windowsAppSection(), access: await ui.appAccess(), ui };
}
const buttons = c => all(c, n => n.tag === 'button');
const links = c => all(c, n => n.tag === 'a');

test('SWITCH OFF, NOT A TESTER: no card at all', async () => {
  assert.equal((await card({ seed: NOT_TESTER })).section, null);
  assert.equal((await card({ seed: {} })).section, null);
  const a = (await card({ seed: {} })).access;
  assert.deepEqual([a.tester, a.compilations, a.show, a.button], [false, false, false, false]);
});

test('SWITCH ON, DOOR OFF, NOT A TESTER: the card shows the honest line and NO button, no link, no file name, no steps', async () => {
  assert.equal(D.APP_DOWNLOAD_COMPILATIONS_DOOR, false, 'the door constant is false in the shipped code');
  for (const record of [ZIP, EXE]) {
    const { section } = await card({ seed: NOT_TESTER, compilations: true, door: false, record });
    assert.ok(section, 'the card is there');
    const t = text(section);
    assert.ok(t.includes('Ryagram for Windows'));
    assert.ok(t.includes('The Ryagram app is not ready to download yet.'), 'the honest line');
    assert.equal(D.NOT_OPEN, 'The Ryagram app is not ready to download yet.');
    assert.equal(buttons(section).length, 0, 'no button the server would only refuse');
    assert.equal(links(section).length, 0, 'no link either');
    assert.ok(!t.includes(record.fileName) && !t.includes(record.sha256) && !/unzip|Run anyway/i.test(t), 'no file, no steps');
    const live = all(section, n => n.attrs && n.attrs['aria-live'] === 'polite');
    assert.equal(live.length, 1, 'the line sits in a polite live region');
  }
});

test('SWITCH ON through my_departments (Compilations working) counts the same as the switch', async () => {
  const { section, access } = await card({ seed: NOT_TESTER, compilations: false, working: true });
  assert.equal(access.compilations, true);
  assert.ok(section && text(section).includes('not ready to download yet.'));
  const soon = await card({ seed: NOT_TESTER, compilations: false });         // the mock's my_departments names Compilations as soon: not enough
  assert.equal(soon.section, null);
});

test('DOOR ON (the mock\'s ?appdoor): the button, the setup\'s file name and its SHA-256 are shown', async () => {
  const { section, access } = await card({ seed: NOT_TESTER, compilations: true, door: true, record: EXE });
  assert.equal(access.button, true);
  const b = buttons(section);
  assert.equal(b.length, 1);
  assert.equal(text(b[0]), 'Download Ryagram for Windows');
  assert.ok(!b[0].attrs.disabled);
  const t = text(section);
  assert.ok(t.includes('Ryagram-Setup-0.1.0.exe') && t.includes(SHA), 'file name and SHA-256 next to the button');
  assert.ok(t.includes('about 290 MB.'));
  const status = all(section, n => n.attrs && n.attrs['aria-live'] === 'polite' && /windows-download-status/.test(n.attrs.class || ''));
  assert.equal(status.length, 1, 'the download status is a polite live region');
});

test('A TESTER STILL SEES IT, door off: the button and the file (the server lets testers in today); a zip record keeps its zip steps', async () => {
  const z = await card({ seed: TESTER, compilations: false, door: false, record: ZIP });
  assert.equal(z.access.tester, true);
  assert.equal(buttons(z.section).length, 1);
  assert.ok(text(z.section).includes('app-1030e.zip') && text(z.section).includes('and unzip it into a folder'), 'the zip path is unchanged');
  const e = await card({ seed: TESTER, compilations: false, door: false, record: EXE });
  assert.equal(buttons(e.section).length, 1);
  assert.ok(text(e.section).includes('Ryagram-Setup-0.1.0.exe'));
  const both = await card({ seed: TESTER, compilations: true, door: false, record: EXE });
  assert.equal(buttons(both.section).length, 1, 'a tester with the switch on keeps the button');
});

test('THE SETUP\'S WORDS: the six steps verbatim from CONNECT\'s plan section 6; More info, Run anyway and the PowerShell line; never unzip; no price, credit or free claim', async () => {
  const { section } = await card({ seed: TESTER, record: EXE });
  const t = text(section);
  const steps = all(section, n => n.tag === 'ol')[0];
  assert.equal(steps.kids.length, 6, 'six steps');
  assert.equal(D.WARN_INTRO, 'Windows may warn you before it opens the Ryagram setup, because the file is new and not yet widely downloaded. Check that the file name and size are the ones on this page, then go on.');
  assert.ok(t.includes(D.WARN_INTRO));
  assert.ok(t.includes(D.SHA_NOTE) && t.includes(D.UPDATE_NOTE));
  assert.equal(D.SHA_NOTE, 'The SHA-256 shows that the file was not damaged on its way to you. It cannot show who made the file, because this same site gives you both.');
  assert.equal(D.UPDATE_NOTE, 'Ryagram does not update itself and does not download new program code. To update it, install a newer setup from this page; it upgrades the Ryagram you already have in place.');
  assert.ok(!/signature|signed by|we know of|safe\b|virus|scanned|verified/i.test(t.replace('Publisher: Unknown publisher', '')), 'RENDERER: no signature word, no promise about the file being clean');
  const want = [
    'Download the setup from this page. Its file name and its SHA-256 are shown next to the button. To check them, open PowerShell in the folder you downloaded to and paste: Get-FileHash Ryagram-Setup-0.1.0.exe -Algorithm SHA256. The 64 characters must match the ones on this page. If they do not, delete the file and do not run it.',
    'When you open it, Windows may show a blue window, "Windows protected your PC". Press More info. It then shows the file name and "Publisher: Unknown publisher". If the file name is the one on this page, press Run anyway.',
    'If anyone else, anywhere else, ever asks you to press Run anyway for a different file, say no.',
    'Windows 11 has a feature called Smart App Control. If it is on, Windows may refuse to open the setup at all and show no Run anyway button. We do not ask you to turn a security feature off. If you see that message, write to us at the address on the Help page and we will help you another way.',
    'The setup puts Ryagram in a folder you choose (it suggests a D: drive if you have one), adds one Start-menu entry, and adds an entry to Windows\' list of installed apps. You can remove it from there at any time; the setup asks whether to keep your films.',
    'The first time you open Ryagram it shows a short code. You approve the code on uselai.com while signed in there. No password is typed into the app. It then offers to download the listening model (about 464 MB, once).'
  ];
  steps.kids.forEach((li, i) => assert.equal(text(li), want[i], 'step ' + (i + 1)));
  assert.ok(t.includes('More info') && t.includes('Run anyway'));
  assert.ok(t.includes('Get-FileHash Ryagram-Setup-0.1.0.exe -Algorithm SHA256'));
  assert.ok(all(section, n => n.tag === 'code').some(c => text(c) === 'Get-FileHash Ryagram-Setup-0.1.0.exe -Algorithm SHA256'), 'the line is in a code element');
  assert.ok(!/unzip|extract|\.zip/i.test(t), 'never the word unzip, extract all or a zip name');
  assert.ok(!/Open Ryagram|delete the folder/.test(t), 'none of the zip steps');
  assert.ok(!/\$\d|per month|\bprice|credits?\b|\bfree\b/i.test(t.replace('about 5 GB of free memory', '')), 'no price, credit or free claim');
  // the placeholder form when the record has no file yet is not shown on a setup card; the words module also gives it for a page that has none
  assert.ok(D.warnSteps(null)[0].some(p => p && p.code === 'Get-FileHash Ryagram-Setup-<version>.exe -Algorithm SHA256'));
});

test('NO SCREENSHOT IS INVENTED: the slot is null, no image is drawn, and no screenshot file is in the repo for it', async () => {
  assert.equal(D.WARNING_SHOT, null);
  const { section } = await card({ seed: TESTER, record: EXE });
  assert.equal(all(section, n => n.tag === 'img').length, 0);
  assert.ok(read('assets/app-device.js').includes("...(WARNING_SHOT ? [h('img'"), 'the slot draws an image only when a file address is put in');
  const names = fs.readdirSync(new URL('../assets/', import.meta.url)).filter(n => /windows|warn|smartscreen|protected/i.test(n) && /\.(png|jpe?g|webp|gif)$/i.test(n));
  assert.deepEqual(names, []);
});

test('THE DOOR IS CLOSED IN THE SHIPPED CODE: the constant is false, the mock alone sets the flag (?appdoor), the live page never loads the mock, and the button needs the door', () => {
  const src = read('assets/app-device.js');
  assert.match(src, /const APP_DOWNLOAD_COMPILATIONS_DOOR = false;/);
  assert.ok(!/ryagramAppDoorMock\s*=(?!=)/.test(src.replace(/\/\/.*$/gm, '')), 'the card never sets the mock flag');
  const fake = read('tests/fake-supabase.js');
  assert.match(fake, /\/\[\?&\]appdoor\/\.test\(location\.search/);
  assert.ok(fake.includes('window.ryagramAppDoorMock = true'));
  assert.ok(!/ryagramAppDoorMock/.test(read('assets/app-compilations.js') + read('assets/app-library.js') + read('assets/app-data.js')), 'no other file reads or sets the flag');
});

test('THE SETUP\'S RECORD: Ryagram-Setup-<version>.exe is a setup; a zip is not', () => {
  assert.equal(D.isSetup(EXE), true);
  for (const bad of [null, {}, ZIP, { fileName: 'Setup.exe' }, { fileName: 'Ryagram-Setup-1.exe.zip' }, { fileName: '../Ryagram-Setup-1.exe' }, { fileName: 'Ryagram-Setup-1.exe ' }]) assert.equal(D.isSetup(bad), false, JSON.stringify(bad));
  assert.equal(D.windowsReady(EXE), true);
  assert.equal(D.viaDownloadFunction(EXE), true);
});

// ---- the Compilations page
const pageWith = async appAccess => {
  win.ryagramFlip = { create: ({ sections }) => ({ el: sections.map(s => s.el) }) };
  const rows = [];
  const withReplace = el => { el.replaceChildren = (...k) => { el.kids = k.flat(Infinity).filter(x => x != null && x !== false); }; el.addEventListener = () => {}; return el; };
  const hh = (...a) => withReplace(h(...a));
  const data = { myCompilationRequests: async () => rows, myComputers: async () => [{ id: 'c1' }] };
  const ui = win.ryagramCompilations.create({ h: hh, data, busy: async () => {}, showError: () => {}, errorLine: () => hh('p'), date: x => x, appAccess });
  return ui.pageView();
};
test('THE COMPILATIONS PAGE: a link "Get the Ryagram app" when the account may press the button; the honest line when it may not; nothing when the question has no answer', async () => {
  const yes = await pageWith(async () => ({ show: true, button: true }));
  const link = all({ tag: 'div', attrs: {}, kids: yes.flat(Infinity) }, n => n.tag === 'a' && n.attrs.id === 'comp-getapp');
  assert.equal(link.length, 1);
  assert.equal(text(link[0]), 'Get the Ryagram app');
  assert.equal(link[0].attrs.href, '#/account');
  assert.match(link[0].attrs.class, /\bbutton\b/, 'a .button link: the house 44px target');
  const no = await pageWith(async () => ({ show: true, button: false }));
  const flat = { tag: 'div', attrs: {}, kids: no.flat(Infinity) };
  assert.equal(all(flat, n => n.tag === 'a' && n.attrs.id === 'comp-getapp').length, 0);
  const closed = all(flat, n => /comp-getapp-closed/.test((n.attrs && n.attrs.class) || ''));
  assert.equal(closed.length, 1);
  assert.equal(text(closed[0]), 'The Ryagram app is not ready to download yet.');
  assert.equal(closed[0].attrs['aria-live'], 'polite');
  for (const q of [undefined, async () => { throw new Error('x'); }, async () => null, async () => ({ show: false, button: false })]) {
    const p = { tag: 'div', attrs: {}, kids: (await pageWith(q)).flat(Infinity) };
    assert.equal(all(p, n => /comp-getapp/.test((n.attrs && (n.attrs.class || '') + (n.attrs.id || '')) || '')).length, 0, 'no link and no line');
  }
});

test('WIRING: the Compilations page is handed the card\'s own access question; the stamps changed; the 44px rule is the house .button', () => {
  assert.ok(read('assets/app-library.js').includes('appAccess: () => deviceUi().appAccess()'));
  assert.match(read('app/index.html'), /app-device\.js\?v=20261128b/);
});
