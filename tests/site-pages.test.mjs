// The signed-in site as one website (WEB 11-20; assets/app-site.js): the Admin page lists exactly the admin pages that are switched on, in groups, in plain words and as text; a film card shows the film's OWN
// thumbnail or contact sheet (never an invented picture), a plain first-letter tile when there is none or the reads fail, at most two picture reads at once, one read per film for the page's life, nothing
// until the card is near the screen. The page's wiring (header link, route, home, logo) is pinned from the library source. Offline, in a tiny stand-in DOM. Must-fails: tests/site_pages_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.isConnected = true; this._cls = new Set(); this.hidden = false; }
  append(...ks) { for (const k of ks.flat(Infinity)) if (k != null && k !== false) this.children.push(k); }
  replaceChildren(...ks) { this.children = []; this.append(...ks); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type) { for (const f of this.listeners[type] || []) f({ target: this }); }
  get text() { return this.children.map(c => (c instanceof El ? c.text : String(c))).join(''); }
  all(pred, out = []) { for (const c of this.children) if (c instanceof El) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  get className() { return this.attrs.class || ''; }
}
const h = (tag, attrs, ...kids) => {
  const e = new El(tag);
  if (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !(attrs instanceof El)) Object.assign(e.attrs, attrs); else if (attrs != null) kids.unshift(attrs);
  e.append(...kids); return e;
};
// a fresh copy of the module per test (its picture cache and queue are module state)
function load({ observer = false } = {}) {
  const win = {}, seen = [], ctx = { window: win, console, Promise, String, Array, Map, Object };
  if (observer) ctx.IntersectionObserver = class { constructor(cb) { this.cb = cb; seen.push(this); } observe() {} unobserve() { this.gone = true; } disconnect() { this.gone = true; } };
  vm.runInNewContext(read('assets/app-site.js'), ctx);
  return { S: win.ryagramSite, seen, win };
}
const project = (id, title) => ({ id, title });
const card = (S, data, p, version) => S.filmCard({ h, project: p, data, version, statusEl: 'Version 1', updated: '· updated today', edit: null });
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

test('ADMIN PAGE: only the pages given, in the three groups, each with its words as text; a group with no page is not drawn; none at all says so', () => {
  const { S } = load();
  const pages = [{ href: '#/admin/ops', label: 'Operations and invites', about: 'People and invite codes.', group: 'People' }, { href: '#/admin/renders', label: 'Render approvals', about: 'Films waiting for your yes.', group: 'Films' }, { href: '#/admin/tester', label: 'Tester computers', about: 'Which computers are signed in.', group: 'Computers' }];
  const view = S.adminHub({ h, pages });
  const root = h('div', {}, ...view);
  assert.equal(root.all(e => e.tag === 'h1')[0].text, 'Admin');
  const heads = root.all(e => e.tag === 'h2').map(e => e.text);
  assert.deepEqual(heads, ['People', 'Films', 'Computers'], 'the three groups, in that order');
  const only = h('div', {}, ...S.adminHub({ h, pages: pages.slice(0, 1) }));
  assert.deepEqual(only.all(e => e.tag === 'h2').map(e => e.text), ['People'], 'a group with no page is not drawn');
  const links = root.all(e => e.tag === 'a' && e.attrs.class === 'site-card-link');
  assert.deepEqual(links.map(a => [a.attrs.href, a.text]), [['#/admin/ops', 'Operations and invites'], ['#/admin/renders', 'Render approvals'], ['#/admin/tester', 'Tester computers']]);
  assert.ok(root.text.includes('People and invite codes.') && root.text.includes('Films waiting for your yes.'), 'each card says in a line what it is for');
  assert.ok(root.all(e => e.tag === 'a').some(a => a.attrs.href === '#/'), 'a way back to Your projects');
  const none = h('div', {}, ...S.adminHub({ h, pages: [] }));
  assert.match(none.text, /No admin pages are switched on/);
  assert.equal(none.all(e => e.tag === 'h2').length, 0);
});

test('ADMIN PAGE: a page label that is hostile markup stays text (the page builds elements, never HTML)', () => {
  const { S } = load();
  const view = S.adminHub({ h, pages: [{ href: '#/admin/ops', label: '<img src=x onerror=alert(1)>', about: '<b>x</b>', group: 'People' }] });
  const root = h('div', {}, ...view);
  assert.equal(root.all(e => e.tag === 'img').length, 0);
  assert.ok(root.text.includes('<img src=x onerror=alert(1)>'));
});

test('FILM CARD: a plain tile with the first letter, the title as text, Open links to the film; the title never becomes HTML', () => {
  const { S } = load();
  const c = card(S, null, project('p1', '<i>America</i> never started'), null);
  assert.equal(c.all(e => e.attrs.class === 'film-thumb-letter')[0].text, '<');
  assert.equal(c.all(e => e.tag === 'i').length, 0, 'no element made from the title');
  assert.equal(c.all(e => e.tag === 'h3')[0].text, '<i>America</i> never started');
  const hrefs = c.all(e => e.tag === 'a').map(a => a.attrs.href);
  assert.ok(hrefs.every(x => x === '#/p/p1'), 'every link goes to the film: ' + hrefs);
  assert.equal(card(S, null, project('p2', ''), null).all(e => e.attrs.class === 'film-thumb-letter')[0].text, '?', 'a film with no title gets a question mark, not nothing');
  assert.equal(card(S, null, project('p3', 'ab'), null).all(e => e.attrs.class === 'film-thumb-letter')[0].text, 'A');
});

test('PICTURE: the film’s own thumbnail first, else its contact sheet, never a preview or a render; its address comes from fileUrl; the tile is replaced by the picture', async () => {
  const { S } = load();
  const asked = [];
  const data = { artifactsFor: async id => ([{ kind: 'final_video', storage_path: 'v' }, { kind: 'contact_sheet', storage_path: 'sheet.png' }, { kind: 'thumbnail', storage_path: 'thumb.png' }, { kind: 'preview', storage_path: 'p.mp4' }]),
    fileUrl: async path => { asked.push(path); return 'https://files.example/' + path; } };
  const c = card(S, data, project('p1', 'Film'), 'v1'); await flush();
  const img = c.all(e => e.tag === 'img')[0];
  assert.equal(img && img.attrs.src, 'https://files.example/thumb.png');
  assert.deepEqual(asked, ['thumb.png']);
  assert.equal(c.all(e => e.attrs.class === 'film-thumb-letter').length, 0, 'the tile is replaced');
  const { S: S2 } = load();
  const onlySheet = { artifactsFor: async () => ([{ kind: 'preview', storage_path: 'p.mp4' }, { kind: 'contact_sheet', storage_path: 's.png' }]), fileUrl: async p => 'https://f/' + p };
  const c2 = card(S2, onlySheet, project('p2', 'Film'), 'v2'); await flush();
  assert.equal(c2.all(e => e.tag === 'img')[0].attrs.src, 'https://f/s.png');
  const { S: S3 } = load(); const asked3 = [];
  const noPic = { artifactsFor: async () => ([{ kind: 'preview', storage_path: 'p.mp4' }, { kind: 'final_video', storage_path: 'f.mp4' }]), fileUrl: async p => { asked3.push(p); return 'https://f/' + p; } };
  const c3 = card(S3, noPic, project('p3', 'Film'), 'v3'); await flush();
  assert.equal(c3.all(e => e.tag === 'img').length, 0, 'a video is never drawn as a picture'); assert.deepEqual(asked3, [], 'and no address is even asked for one');
  assert.equal(c3.all(e => e.attrs.class === 'film-thumb-letter').length, 1);
});

test('PICTURE: a failed read, a missing address, a card no longer on the page or a data layer without the calls leaves the plain tile and breaks nothing', async () => {
  const { S } = load();
  const bad = { artifactsFor: async () => { throw new Error('nope'); }, fileUrl: async () => 'x' };
  const c1 = card(S, bad, project('a', 'A'), 'v-bad'); await flush();
  assert.equal(c1.all(e => e.tag === 'img').length, 0);
  const noUrl = { artifactsFor: async () => ([{ kind: 'thumbnail', storage_path: 't' }]), fileUrl: async () => null };
  const c2 = card(S, noUrl, project('b', 'B'), 'v-nourl'); await flush();
  assert.equal(c2.all(e => e.tag === 'img').length, 0);
  const gone = { artifactsFor: async () => ([{ kind: 'thumbnail', storage_path: 't' }]), fileUrl: async () => 'https://x/t' };
  const c3 = card(S, gone, project('c', 'C'), 'v-gone'); c3.isConnected = false; await flush();
  assert.equal(c3.all(e => e.tag === 'img').length, 0, 'a card that left the page is not touched');
  const c4 = card(S, { listProjects() {} }, project('d', 'D'), 'v-x'); await flush();
  assert.equal(c4.all(e => e.attrs.class === 'film-thumb-letter').length, 1);
  const c5 = card(S, gone, project('e', 'E'), null); await flush();
  assert.equal(c5.all(e => e.tag === 'img').length, 0, 'a film with no version asks for nothing');
});

test('PICTURE READS: at most two at once, however many cards; a film is read once for the page’s life', async () => {
  const { S } = load();
  let live = 0, peak = 0, reads = 0; const gates = [];
  const data = { artifactsFor: async id => { reads++; live++; peak = Math.max(peak, live); await new Promise(r => gates.push(r)); live--; return [{ kind: 'thumbnail', storage_path: id }]; }, fileUrl: async p => 'https://f/' + p };
  const cards = [1, 2, 3, 4, 5, 6].map(i => card(S, data, project('p' + i, 'F' + i), 'v' + i));
  await flush(); assert.equal(live, 2, 'two reads started, the rest wait');
  while (gates.length) { gates.shift()(); await flush(); }
  assert.equal(peak, 2); assert.equal(reads, 6);
  assert.ok(cards.every(c => c.all(e => e.tag === 'img').length === 1), 'every card got its own picture in the end');
  const again = card(S, data, project('p1', 'F1'), 'v1'); await flush();
  assert.equal(reads, 6, 'the same film is not read twice');
  assert.equal(again.all(e => e.tag === 'img').length, 1, 'and its second card still shows the picture');
});

test('PICTURE READS (WEB audit 11-20): with an observer, ONE shared observer for every card; nothing is read until a card is near the screen; a card reached is read once and released; cards never reached cost nothing', async () => {
  const win = {}, made = [];
  const ctx = { window: win, console, Promise, String, Array, Map, Object, WeakMap, Date, IntersectionObserver: class { constructor(cb) { this.cb = cb; this.targets = new Set(); made.push(this); } observe(el) { this.targets.add(el); } unobserve(el) { this.targets.delete(el); } } };
  vm.runInNewContext(read('assets/app-site.js'), ctx);
  const S = win.ryagramSite, reads = [];
  const data = { artifactsFor: async id => { reads.push(id); return [{ kind: 'thumbnail', storage_path: id }]; }, fileUrl: async p => 'https://f/' + p };
  const cards = [1, 2, 3].map(i => card(S, data, project('p' + i, 'F' + i), 'v' + i)); await flush();
  assert.equal(made.length, 1, 'one observer for all three cards');
  assert.equal(made[0].targets.size, 3); assert.equal(reads.length, 0, 'off screen: nothing is read');
  const fire = (el, yes) => made[0].cb([{ target: el, isIntersecting: yes }]);
  const targets = [...made[0].targets];
  fire(targets[1], false); await flush(); assert.equal(reads.length, 0, 'seen but not near: still nothing');
  fire(targets[1], true); await flush();
  assert.deepEqual(reads, ['v2']); assert.equal(made[0].targets.size, 2, 'the reached card is released');
  fire(targets[1], true); await flush(); assert.deepEqual(reads, ['v2'], 'a second sighting reads nothing more');
  assert.equal(cards[1].all(e => e.tag === 'img').length, 1); assert.equal(cards[0].all(e => e.tag === 'img').length, 0, 'the card never reached has no read and no picture');
  fire(targets[0], true); fire(targets[2], true); await flush();
  assert.equal(made[0].targets.size, 0); assert.equal(reads.length, 3);
});

test('PICTURE ADDRESS CACHE (WEB audit 11-20): an address is kept 10 minutes (it lasts 15), a failed read 30 seconds, an expired one is read again, and the cache is bounded', () => {
  const { S } = load(); let t = 0; const c = S.makeCache(600000, 30000, () => t);
  assert.equal(c.get('a'), undefined, 'nothing known is undefined, not null');
  c.set('a', 'https://x/a'); c.set('b', null);
  t = 599999; assert.equal(c.get('a'), 'https://x/a'); t = 600001; assert.equal(c.get('a'), undefined, 'the address expired before the signed link would have');
  t = 0; c.set('b', null); t = 29999; assert.equal(c.get('b'), null, 'a failure is remembered briefly'); t = 30001; assert.equal(c.get('b'), undefined, 'and asked again soon');
  const d = S.makeCache(600000, 30000, () => 0); for (let i = 0; i < 400; i++) d.set('k' + i, 'v');
  assert.ok(d.size() <= 201, 'bounded: ' + d.size()); assert.equal(d.get('k0'), undefined, 'the oldest went first'); assert.equal(d.get('k399'), 'v');
});

test('LIGHT READ: a card reads its picture with ONE call (artifactsFor), never the version page’s reads (getVersion); a failed read is asked again after 30 s, a good address is kept; an address that stops working puts the tile back', async () => {
  const { S } = load();
  let calls = 0, vcalls = 0;
  const data = { artifactsFor: async () => { calls++; return [{ kind: 'thumbnail', storage_path: 't' }]; }, getVersion: async () => { vcalls++; throw new Error('the heavy path must not be used'); }, fileUrl: async () => 'https://f/t?sig=1' };
  const c = card(S, data, project('p', 'P'), 'v1'); await flush();
  assert.equal(calls, 1); assert.equal(vcalls, 0, 'getVersion is never called');
  const img = c.all(e => e.tag === 'img')[0];
  assert.ok(img, 'the picture is drawn');
  img.fire('error');
  assert.equal(c.all(e => e.tag === 'img').length, 0, 'an address that stopped working puts the plain tile back');
  assert.equal(c.all(e => e.attrs.class === 'film-thumb-letter').length, 1);
  const again = card(S, data, project('p', 'P'), 'v1'); await flush();
  assert.equal(calls, 2, 'and the dropped address is asked for again, not served from the cache');
  assert.ok(again.all(e => e.tag === 'img').length === 1);
});

test('LIGHT READ: no picture yet is NOT remembered for long (a contact sheet made then back to home shows up), only for 30 seconds', () => {
  const { S } = load();
  let t = 0; const c = S.makeCache(600000, 30000, () => t);
  c.set('v', null); assert.equal(c.get('v'), null);
  t = 29000; assert.equal(c.get('v'), null, 'within 30 s it is remembered (no storm of reads)');
  t = 31000; assert.equal(c.get('v'), undefined, 'after 30 s it is asked again');
  const src = read('assets/app-site.js');
  assert.match(src, /makeCache\(10 \* 60 \* 1000, 30 \* 1000\)/, 'a good address 10 minutes (it lasts 15), a miss 30 seconds');
});

test('ASK YOUR AI: the button on the Start card is drawn only for an account the connector counts as invited (the page it opens does nothing for anyone else); a failed check draws nothing', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const aiInvited = startOn\(\) \? await connectAllowed\(data\)\.catch\(\(\) => false\) : false;/);
  assert.match(lib, /aiInvited \? h\('a', \{ class: 'button secondary', href: '#\/start' \}, 'Ask your AI'\) : null/);
  assert.doesNotMatch(lib, /startOn\(\) \? h\('a', \{ class: 'button secondary', href: '#\/start' \}/, 'no longer shown on the flag alone');
});

test('WIRING: one Admin link in the header (no menu), the Admin page only for an admin, every admin page listed in groups, the home page built from the card module, the logo goes home and is put back', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /menu = h\('a', \{ class: 'menu-link admin-link', href: '#\/admin', role: 'menuitem' \}, 'Admin'\);/);
  assert.doesNotMatch(lib, /admin-menu-panel|class: 'admin-menu'/);
  assert.match(lib, /hash === '#\/admin' && await data\.isAppAdmin\(\)\) view = window\.ryagramSite\.adminHub\(\{ h, pages: adminPages\(\) \}\)/);
  for (const [href, group] of [['#/admin/ops', 'People'], ['#/admin/waiting', 'People'], ['#/admin/waitlist', 'People'], ['#/admin/visits', 'People'], ['#/admin/funnel', 'People'], ['#/admin/renders', 'Films'], ['#/admin/tester', 'Computers']])
    assert.ok(lib.includes(`['${href}', `) && new RegExp(`\\['${href.replace(/\//g, '\\/')}', '[^']+', '[^']+', '${group}', `).test(lib), href + ' is on the Admin page in ' + group);
  assert.doesNotMatch(lib, /class: 'meta admin-links'/, 'the admin link row is gone from Your projects');
  assert.match(lib, /S\.filmCard\(\{ h, project: p, data, version: p\.latest && p\.latest\.id,/);
  assert.match(lib, /h\('h2', \{ id: 'start-card-h' \}, 'Start a new film'\)/);
  assert.match(lib, /h\('label', \{ for: 'np-title' \}, 'Name your film'\)/);
  assert.match(lib, /brand\.setAttribute\('href', '#\/'\);/);
  assert.match(lib, /if \(brand && brandWas\) brand\.setAttribute\('href', brandWas\);/);
  assert.doesNotMatch(lib, /brand\.setAttribute\('aria-label'/, 'assets/workflow-audit.css aligns the wordmark by .brand[aria-label="Ryagram"]: the label must not change');
  assert.match(read('assets/workflow-audit.css'), /\.brand\[aria-label="Ryagram"\]\{align-items:baseline\}/);
  const html = read('app/index.html');
  assert.ok(html.indexOf('app-site.js') > 0 && html.indexOf('app-site.js') < html.indexOf('app-library.js'), 'the card module loads before the library');
  assert.match(html, /app-site\.css\?v=/);
});

test('FILM CARD META (WEB 11-20): the dot goes only BETWEEN the parts that exist, never a leading or trailing one', () => {
  const { S } = load();
  const meta = parts => h('div', {}, S.filmCard({ h, project: project('m', 'M'), parts, edit: null })).all(e => e.attrs.class === 'meta')[0].text;
  assert.equal(meta(['Version 2', 'Sent', 'updated Nov 3']), 'Version 2 · Sent · updated Nov 3');
  assert.equal(meta(['Version 2', null, 'updated Nov 3']), 'Version 2 · updated Nov 3', 'no state: no doubled dot');
  assert.equal(meta(['No versions yet', null, null]), 'No versions yet', 'no date: no trailing dot');
  assert.equal(meta([null, null, 'updated Nov 3']), 'updated Nov 3', 'only a date: no leading dot');
  assert.equal(meta(['Version 1', '', false, undefined]), 'Version 1');
  assert.equal(meta([]), '');
});
