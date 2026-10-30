// The AI-first front door (assets/app-start.js, #/start): its pure rules, and the guards that keep it OFF until Ryan flips it and keep every other page as it was.
// The page in real Chrome is tools/check-start.py (it needs Chrome, so it is not part of this suite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
vm.runInNewContext(read('assets/app-start.js'), { window: win, setTimeout, clearTimeout, setInterval, clearInterval, document: {} });
const S = win.ryagramStart;
const plain = x => JSON.parse(JSON.stringify(x));
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

test('FLAG: aiFirst is ON in the committed config (Ryan 2026-10-28 10:59, Q303), and it needs connectAi', () => {
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /aiFirst: true,/);
  const w = {};
  vm.runInNewContext(cfg, { window: w });
  assert.equal(w.ryagramConfig.aiFirst, true);
  win.ryagramConfig = { aiFirst: true, connectAi: false }; assert.equal(S.flagOn(), false);
  win.ryagramConfig = { aiFirst: false, connectAi: true }; assert.equal(S.flagOn(), false);
  win.ryagramConfig = { aiFirst: true, connectAi: true }; assert.equal(S.flagOn(), true);
  win.ryagramConfig = {};
});

test('WIRING: #/start and the landing redirect and the strip exist only behind startOn (aiFirst + connectAi), the script loads before app-library, and the stamps moved', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const startOn = \(\) => window\.ryagramConfig\?\.aiFirst === true && connectOn\(\);/);
  assert.match(lib, /startOn\(\) && hash === '#\/start'\) view = await startUi\(\)\.startView\(onStop, libraryView\)/);
  assert.match(lib, /\(hash === '' \|\| hash === '#\/'\) && startOn\(\) && await startUi\(\)\.shouldLandOnDoor\(\)/);
  assert.match(lib, /const startStrip = startOn\(\) \? await startUi\(\)\.strip\(\) : null;/);
  const html = read('app/index.html');
  assert.ok(html.indexOf('app-start.js') > 0 && html.indexOf('app-start.js') < html.indexOf('app-library.js'));
  assert.match(html, /app-start\.js\?v=20261029a/);
});

test('SCREEN: no AI = connect, an AI = start; a failed check, or an account that is not invited, is the library, never a blank door', () => {
  assert.equal(S.screenFor({ allowed: true, rows: [] }), 'connect');
  assert.equal(S.screenFor({ allowed: true, rows: [{ client_name: 'Claude' }] }), 'start');
  assert.equal(S.screenFor({ allowed: false, rows: [] }), 'library');
  assert.equal(S.screenFor({ allowed: true, rows: null }), 'library');              // MUST-FAIL guard: a connected-AI check that errored is not "no AI"
  assert.equal(S.screenFor({ allowed: true, rows: undefined }), 'library');
  assert.equal(S.screenFor({ allowed: undefined, rows: [] }), 'library');
  assert.equal(S.screenFor({}), 'library');
});

test('NOT NOW: it lasts seven days, then the door comes back; a bad or future stamp never hides it', () => {
  assert.equal(S.SNOOZE_MS, 7 * 24 * 3600 * 1000);
  assert.equal(S.snoozed(String(NOW - 1000), NOW), true);
  assert.equal(S.snoozed(String(NOW - 6 * 24 * 3600 * 1000), NOW), true);
  assert.equal(S.snoozed(String(NOW - 7 * 24 * 3600 * 1000), NOW), false);
  assert.equal(S.snoozed(String(NOW - 8 * 24 * 3600 * 1000), NOW), false);
  for (const bad of [null, undefined, '', 'x', '0', '-5', String(NOW + 5000)]) assert.equal(S.snoozed(bad, NOW), false, String(bad));
});

test('LANDING: the plain address goes to the door only with the flag on, an invited account, no AI connected and no Not now in force', () => {
  const base = { flag: true, allowed: true, rows: [], notNowAt: null, now: NOW };
  assert.equal(S.landsOnDoor(base), true);
  assert.equal(S.landsOnDoor({ ...base, flag: false }), false);
  assert.equal(S.landsOnDoor({ ...base, allowed: false }), false);
  assert.equal(S.landsOnDoor({ ...base, rows: [{ client_name: 'Claude' }] }), false);
  assert.equal(S.landsOnDoor({ ...base, rows: null }), false);                          // a failed check shows the library
  assert.equal(S.landsOnDoor({ ...base, notNowAt: String(NOW - 1000) }), false);
  assert.equal(S.landsOnDoor({ ...base, notNowAt: String(NOW - 9 * 24 * 3600 * 1000) }), true);
});

test('LINES: six plain starting lines, no dataset ids, nothing from a person; every line is sent with its tail', () => {
  assert.equal(S.LINES.length, 6);
  assert.equal(S.STRIP, 3);
  assert.deepEqual(plain(S.LINES.map(l => l.id)), ['housing', 'population', 'unemployment', 'rents', 'permits', 'income']);
  // Ryan 2026-10-26 13:16 (Q233): lines 3 and 5 are on topics the catalog runs today, in ONE named list; the other four and the closing line are unchanged.
  assert.deepEqual(plain(S.CATALOG_LINES.map(l => l.id)), ['unemployment', 'permits']);
  assert.equal(S.LINES[2], S.CATALOG_LINES[0]); assert.equal(S.LINES[4], S.CATALOG_LINES[1]);
  assert.equal(S.LINES[0].text, 'Make me a film about housing costs in my county');
  assert.equal(S.LINES[1].text, 'Show how my state’s population changed since 1970');
  assert.equal(S.LINES[3].text, 'What changed most in US rents this decade? Make it a film');
  assert.equal(S.LINES[5].text, 'Compare my county with the state average on income');
  assert.doesNotMatch(S.LINES.map(l => l.text).join(' '), /spreadsheet|paste a link/i);
  for (const l of S.LINES) {
    assert.ok(l.text.length > 10 && l.text.length < 90, l.id);
    assert.doesNotMatch(l.text, /[a-z]+_[a-z_]+|https?:|@|\d{5}/, `${l.id}: no dataset id, link, address or code`);
    assert.ok(S.lineWithTail(l.text).endsWith(S.TAIL), l.id);
  }
  assert.equal(S.TAIL, 'Use the Ryagram connector. Show me a free contact sheet before anything that costs credits.');
});

test('LINKS: a new-chat address with the line and its tail encoded; an unknown app gets none; an over-long line falls back to the plain new-chat address', () => {
  const line = 'Make me a film about housing costs in my county';
  assert.equal(S.chatUrl('claude', line), 'https://claude.ai/new?q=' + encodeURIComponent(`${line} ${S.TAIL}`));
  assert.equal(S.chatUrl('chatgpt', line), 'https://chatgpt.com/?q=' + encodeURIComponent(`${line} ${S.TAIL}`));
  assert.equal(S.chatUrl('gemini', line), '');
  assert.equal(S.chatUrl('claude', 'x'.repeat(3000)), 'https://claude.ai/new');
  for (const l of S.LINES) for (const app of ['claude', 'chatgpt']) {
    const u = S.chatUrl(app, l.text);
    assert.match(u, /^https:\/\/(claude\.ai\/new|chatgpt\.com\/)\?q=[A-Za-z0-9%._~!*'()-]+$/, `${app} ${l.id}`);   // nothing but the encoded line
    assert.ok(u.length < 1800);
  }
});

test('WHICH AI: the connected AI is told from its registered name; an unknown name highlights neither button; the pill text is trimmed and short', () => {
  assert.equal(S.appOf('Claude'), 'claude');
  assert.equal(S.appOf('Claude Desktop'), 'claude');
  assert.equal(S.appOf('ChatGPT'), 'chatgpt');
  assert.equal(S.appOf('OpenAI'), 'chatgpt');
  assert.equal(S.appOf('Something else'), '');
  assert.equal(S.appOf(null), '');
  assert.equal(S.connectedName([{ client_name: '  Claude  ' }]), 'Claude');
  assert.equal(S.connectedName([]), '');
  assert.equal(S.connectedName(null), '');
  assert.equal(S.connectedName([{ client_name: 'y'.repeat(200) }]).length, 60);
});

test('SAFE TEXT: the page puts server text in as text nodes only, builds no HTML, reads no account data into an address, and does not store anything but the Not now time', () => {
  const src = read('assets/app-start.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(src, /sessionStorage|document\.cookie|indexedDB/);
  assert.equal((src.match(/localStorage\.(get|set|remove)Item\(/g) || []).length, 3);
  assert.match(src, /const SNOOZE_KEY = 'ryagram\.start\.notnow';/);
});

test('NOTHING ELSE MOVES: the builder link, the library heading and the connect pages keep their words; the connect guide has anchors for the two buttons', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /'Tutorial: make a film step by step'/);                         // relabelled as the tutorial (NEXT-BUILDER 38)
  assert.match(lib, /h\('h1', \{ tabindex: '-1' \}, 'Your projects'\)/);
  const guide = read('connect-ai/index.html');
  assert.ok(guide.includes('<a id="claude"></a><h2>Claude (claude.ai'));
  assert.ok(guide.includes('<a id="chatgpt"></a><h2>ChatGPT</h2>'));
});

test('CATALOG LINES (Ryan 2026-10-26 13:16, Q233): each of the two catalog lines names a dataset that is usable and on the installed worker\'s list, its years sit inside what the catalog and the connector tell the AI, and a keyword search finds it', async () => {
  const { CATALOG } = await import('../supabase/functions/_shared/catalog_data.ts');
  const { searchCatalog } = await import('../supabase/functions/_shared/film.ts');
  const { DATASETS } = await import('../supabase/functions/_shared/templates.ts');
  const allow = read('supabase/functions/_shared/worker_allowlist.txt').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const plan = {
    unemployment: { dataset: 'bls_state_unemployment', years: [2019, 2022], words: 'unemployment state' },
    permits: { dataset: 'bps_county_permits', years: [1990, new Date().getUTCFullYear()], words: 'building permits county' }
  };
  for (const line of S.CATALOG_LINES) {
    const p = plan[line.id];
    assert.ok(p, line.id);
    const entry = CATALOG.find(e => e.id === p.dataset);
    assert.ok(entry && entry.status === 'usable' && entry.listable === true, `${p.dataset} is usable and listable`);
    assert.ok(allow.includes(p.dataset), `${p.dataset} is on the worker allowlist`);
    const d = DATASETS[p.dataset];                                                              // what get_story_schema tells the connector's AI
    const first = Number(String(d.start).slice(0, 4)), last = Number(String(d.end).slice(0, 4));
    const years = (line.text.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    assert.ok(years.length >= 1, `${line.id} names its years`);
    for (const y of years) assert.ok(y >= first && y <= last, `${line.id}: ${y} is inside ${first} to ${last}`);
    assert.ok(searchCatalog(p.words).some(r => (r.id || r) === p.dataset), `a keyword search finds ${p.dataset}`);
  }
});
