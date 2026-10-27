// The Windows card's invite-only download button (CONNECT's app-download function, Cloudflare R2; Ryan 2026-10-26 20:26, CONNECT 20:35 and 20:37): a record pointing at the function's own address
// makes the card's link a BUTTON that asks the function for a short-lived link when pressed; the page follows ONLY an https link on R2's own address; every refusal has a plain sentence; nothing is asked
// before the button is pressed. A record pointing straight at a file still gives the plain link (tests/windows-card.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
for (const f of ['app-device.js', 'app-data.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout, URL });
const D = win.ryagramDevice;

const SHA = 'a'.repeat(64);
const FN = 'https://abcdefghij.supabase.co/functions/v1/app-download';
const REC = { url: FN, fileName: 'Ryagram-for-Windows.zip', sizeMb: 274, unpackedMb: 736, sha256: SHA, personalUseNotice: null };
const LINK = 'https://0123456789abcdef.r2.cloudflarestorage.com/ryagram-app/Ryagram-for-Windows.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-Signature=abc123';
const TESTER = { account_settings: [{ owner_id: 'u-ryan', upload_retention: 'keep', local_compute: true }] };

// a tiny element builder: enough to read what the card shows and to press its button
const h = (...args) => { const e = h0(...args); e.replaceChildren = (...k) => { e.kids = k.flat(Infinity).filter(x => x != null && x !== false); }; return e; };      // (the card replaces the status line's children)
const h0 = (tag, attrs, ...kids) => ({ tag, attrs: (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !attrs.tag) ? attrs : {}, kids: ((attrs && attrs.tag) || typeof attrs === 'string' ? [attrs, ...kids] : kids).flat(Infinity).filter(x => x != null && x !== false) });
const text = n => (typeof n === 'string' ? n : n.kids.map(text).join(''));
const all = (n, pred, out = []) => { if (typeof n !== 'string') { if (pred(n)) out.push(n); n.kids.forEach(k => all(k, pred, out)); } return out; };

async function world(release, answer) {
  win.ryagramWindowsApp = release;
  const calls = [], went = [];
  const base = win.ryagramData(createFakeClient(TESTER));
  const data = { ...base, requestAppDownload: async () => { calls.push('asked'); if (answer instanceof Error) throw answer; return answer; } };
  const ui = D.create({ h, data, busy: async (b, label, fn) => fn(), showError: () => {}, errorLine: () => h('p'), date: x => x, whoami: async () => 'sam@example.test', navigate: url => went.push(url) });
  const card = await ui.windowsAppSection();
  return { card, calls, went };
}
const press = async card => { const b = all(card, n => n.tag === 'button' && n.attrs.id === 'windows-download')[0]; await b.attrs.onclick({ currentTarget: {} }); return card; };
const status = card => text(all(card, n => n.tag === 'p' && /windows-download-status/.test(n.attrs.class || ''))[0]);

test('MODE: a record at the app-download function gives a BUTTON (no direct link); a record at a file still gives the plain link', async () => {
  assert.equal(D.viaDownloadFunction(REC), true);
  for (const bad of [{ ...REC, url: 'https://example.test/files/a.zip' }, { ...REC, url: 'http://abcdefghij.supabase.co/functions/v1/app-download' }, { ...REC, url: FN + '/extra' },
                     { ...REC, url: 'https://evil.test/functions/v1/app-download' }, { ...REC, url: 'https://abcdefghij.supabase.co/functions/v1/other' }, { ...REC, url: null }, null]) assert.equal(!!D.viaDownloadFunction(bad), false, JSON.stringify(bad));
  const { card } = await world(REC, { url: LINK });
  assert.equal(all(card, n => n.tag === 'a').length, 0, 'no direct link before the button is pressed');
  const b = all(card, n => n.tag === 'button');
  assert.equal(b.length, 1);
  assert.equal(text(b[0]), 'Download Ryagram for Windows');
  const plain = await world({ ...REC, url: 'https://example.test/files/a.zip' }, null);
  assert.equal(all(plain.card, n => n.tag === 'a' && n.attrs.href === 'https://example.test/files/a.zip').length, 1);
});

test('NOTHING IS ASKED UNTIL THE BUTTON IS PRESSED: drawing the card makes no request; pressing makes exactly one', async () => {
  const w = await world(REC, { url: LINK, expires_in: 900 });
  assert.deepEqual(w.calls, []);
  await press(w.card);
  assert.deepEqual(w.calls, ['asked']);
});

test('SUCCESS: the browser is sent to the R2 link, and the card keeps a link to it with how long it works', async () => {
  const w = await world(REC, { url: LINK, expires_in: 900, file_name: 'Ryagram-for-Windows.zip', size_bytes: 1, sha256: SHA });
  await press(w.card);
  assert.deepEqual(w.went, [LINK]);
  const s = status(w.card);
  assert.match(s, /Your download is starting\. If it does not, use this link \(it works for 15 minutes\): Download Ryagram for Windows\./);
  const links = all(w.card, n => n.tag === 'a' && n.attrs.id === 'windows-download-link');
  assert.equal(links.length, 1);
  assert.equal(links[0].attrs.href, LINK);
  assert.equal(links[0].attrs.rel, 'noopener');
});

test('THE LINK RULE (CONNECT 20:37): https, no user name or password, no port, a host that is exactly <account>.r2.cloudflarestorage.com; anything else is refused and nothing is followed', async () => {
  const good = D.parseDownloadAnswer({ url: LINK, expires_in: 900 });
  assert.equal(good.url, LINK);
  assert.equal(good.minutes, 15);
  assert.equal(D.parseDownloadAnswer({ url: LINK }).minutes, null);
  assert.equal(D.parseDownloadAnswer({ url: LINK, expires_in: 10 }).minutes, null);                  // not a believable lifetime: not shown
  const hostile = ['http://0123456789abcdef.r2.cloudflarestorage.com/a.zip', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pw@0123456789abcdef.r2.cloudflarestorage.com/a.zip',
    'https://0123456789abcdef.r2.cloudflarestorage.com:8443/a.zip', 'https://r2.cloudflarestorage.com.evil.test/a.zip', 'https://evil.test/0123456789abcdef.r2.cloudflarestorage.com/a.zip',
    'https://evil-r2.cloudflarestorage.com.evil.test/a', 'https://sub.0123456789abcdef.r2.cloudflarestorage.com/a.zip', 'https://github.com/rgalen0211/L-Ai/releases/download/x/a.zip',
    'https://0123456789abcdef.r2.cloudflarestorage.com/a b.zip', 'https://0123456789abcdef.r2.cloudflarestorage.com/' + 'x'.repeat(2100), '', 'not a url'];
  for (const url of hostile) assert.throws(() => D.parseDownloadAnswer({ url }), /Couldn’t get the download link\./, url.slice(0, 60));
  for (const a of [null, undefined, 'x', 5, {}, { url: 5 }, { url: null }, []]) assert.throws(() => D.parseDownloadAnswer(a), /Couldn’t get the download link\./, JSON.stringify(a));
  // pressing with a hostile answer follows nothing and says the generic sentence
  for (const url of hostile.slice(0, 5)) {
    const w = await world(REC, { url });
    await press(w.card);
    assert.deepEqual(w.went, [], url.slice(0, 40));
    assert.match(status(w.card), /Couldn’t get the download link just now\. Try again in a minute\./);
  }
});

test('REFUSALS: the function\'s own plain sentence is shown as text; with none, one plain sentence per status; nothing is followed', async () => {
  const words = { 401: 'Sign in again, then press the button.', 403: 'This download is for invited tester accounts.', 404: 'The download is not ready yet.', 503: 'The download is not switched on yet. Try again later.' };
  for (const [status_, sentence] of Object.entries(words)) assert.equal(D.downloadErrorWords(status_), sentence);
  assert.match(D.downloadErrorWords(429), /several times today\. Try again tomorrow/);
  assert.equal(D.downloadErrorWords(500), 'Couldn’t get the download link just now. Try again in a minute.');
  assert.equal(D.downloadErrorWords(undefined), 'Couldn’t get the download link just now. Try again in a minute.');
  const refusal = (statusCode, serverWords) => Object.assign(new Error('x'), { status: statusCode, serverWords });
  for (const code of [401, 403, 404, 429, 503, 500, 0]) {
    const w = await world(REC, refusal(code, undefined));
    await press(w.card);
    assert.equal(status(w.card), D.downloadErrorWords(code), String(code));
    assert.deepEqual(w.went, []);
  }
  const w = await world(REC, refusal(429, 'You have asked for the download three times in the last day. Try again tomorrow.'));
  await press(w.card);
  assert.equal(status(w.card), 'You have asked for the download three times in the last day. Try again tomorrow.');          // the server's sentence, as sent
  assert.deepEqual(w.went, []);
});

test('THE DATA LAYER: the button calls the function BY NAME through supabase-js (session and apikey are sent by the client), reads the status and the server\'s plain sentence, and nothing else', async () => {
  const calls = [];
  const mk = result => win.ryagramData({ functions: { invoke: async (name, opts) => { calls.push([name, JSON.stringify(opts)]); return result; } } });
  const ok = await mk({ data: { url: LINK, expires_in: 900 }, error: null }).requestAppDownload();
  assert.equal(ok.url, LINK);
  assert.deepEqual(calls, [['app-download', '{"body":{}}']]);
  const err = await mk({ data: null, error: { context: { status: 429, json: async () => ({ error: 'You have asked for the download three times in the last day. Try again tomorrow.' }) } } }).requestAppDownload().catch(e => e);
  assert.equal(err.status, 429);
  assert.equal(err.serverWords, 'You have asked for the download three times in the last day. Try again tomorrow.');
  const err2 = await mk({ data: null, error: { context: { status: 503, json: async () => { throw new Error('not json'); } } } }).requestAppDownload().catch(e => e);
  assert.equal(err2.status, 503);
  assert.equal(err2.serverWords, undefined);
  const err3 = await mk({ data: null, error: { message: 'FunctionsFetchError' } }).requestAppDownload().catch(e => e);
  assert.equal(err3.status, 0);
  // control characters in the server's sentence are not passed through, and it is capped
  const err4 = await mk({ data: null, error: { context: { status: 403, json: async () => ({ error: 'A\u0000B\u001bC' + 'x'.repeat(400) }) } } }).requestAppDownload().catch(e => e);
  assert.ok(!/[\u0000-\u001f]/.test(err4.serverWords) && err4.serverWords.length <= 300);
});

test('SOURCE: the page posts to no address it was handed (a fixed function name), builds no HTML from the answer, and follows the link only through the parsed, checked value', () => {
  const dev = read('assets/app-device.js').replace(/^\s*\/\/.*$/gm, '');
  const dat = read('assets/app-data.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(dev, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(dat, /client\.functions\.invoke\('app-download', \{ body: \{\} \}\)/);
  assert.equal((dev.match(/navigate\(/g) || []).length, 1);
  assert.match(dev, /const got = parseDownloadAnswer\(await data\.requestAppDownload\(\)\);[\s\S]*navigate\(got\.url\);/);
  assert.doesNotMatch(dev, /fetch\(|XMLHttpRequest/);
});

test('WIRING: the stamps moved so a returning visitor gets the button', () => {
  const html = read('app/index.html');
  assert.match(html, /app-device\.js\?v=20261026g/);
  assert.match(html, /app-data\.js\?v=20261027a/);
});
