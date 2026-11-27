// Perfect City page walk fixes (GEO gallery 11-27 and RENDERER's 09:19 walk): the REAL page script (assets/app-perfect-city.js) runs against
// a small fake DOM, the real Census page data and an invented places answer (never OpenStreetMap data). Each check also runs on a planted
// copy of the page with one fix taken back (the old line), and must FAIL there, so a green check cannot pass on a sliver.
//   PC_PAGE_SRC=<path> node --test tests/perfect-city-walk.test.mjs    runs the checks on another copy of the page (for example the old one)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PAGE = process.env.PC_PAGE_SRC ? fs.readFileSync(process.env.PC_PAGE_SRC, 'utf8').replace(/\r\n/g, '\n') : read('assets/app-perfect-city.js');
const CORE = read('assets/perfect-city-core.js');
const CENSUS = ['montgomery_oh', 'greene_oh'].map((c) => read(`assets/perfect-city/${c}.census.js`));
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// ---- a fake DOM: just what the page uses ----
class Text { constructor(t) { this.t = t; } get textContent() { return this.t; } }
function makeDoc() {
  const doc = { activeElement: null, roots: [], head: { append() {} } };
  class El {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.value = ''; }
    get id() { return this.attrs.id || ''; }
    append(...kids) { for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== '') this.children.push(typeof k === 'object' ? k : new Text(String(k))); }
    replaceChildren(...kids) { this.children = []; this.append(...kids); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    fire(t, e = {}) { for (const f of this.listeners[t] || []) f({ preventDefault() {}, target: this, ...e }); }
    get textContent() { return this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = [new Text(String(v))]; }
    *walk() { yield this; for (const c of this.children) if (c instanceof El) yield* c.walk(); }
    querySelectorAll(sel) { const cls = sel.replace(/^\./, ''); return [...this.walk()].filter((e) => e !== this && (e.attrs.class || '').split(' ').includes(cls)); }
    focus() { doc.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
  }
  const all = () => doc.roots.flatMap((r) => (r instanceof El ? [...r.walk()] : []));
  Object.assign(doc, {
    El, all,
    createElementNS: (ns, tag) => new El(tag),
    createElement: (tag) => new El(tag),
    getElementById: (id) => all().find((e) => e.id === id) || null,
    text: () => doc.roots.map((r) => r.textContent).join('\n')
  });
  const h = (tag, attrs = {}, ...kids) => {
    const el = new El(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (/^on/.test(k)) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v != null) el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
  };
  return { doc, h };
}

// the places answer: 14 invented points around the asked spot, or a failure while `fail` is set
function fakeData() {
  const d = { calls: 0, fail: false };
  d.perfectCityPlaces = async (county, kind, lat, lon) => {
    d.calls++;
    if (d.fail) throw new Error('Couldn’t load the business points.');
    const places = Array.from({ length: 14 }, (_, i) => ({ name: `Test Place ${i + 1}`, lat: lat + Math.sin(i * 2.4) * 0.01 * (1 + i % 4), lon: lon + Math.cos(i * 2.4) * 0.013 * (1 + i % 4) }));
    return { loaded: 14, places, credit: 'Map data (c) OpenStreetMap contributors (ODbL)' };
  };
  return d;
}

async function open(src, { fail = false } = {}) {
  const { doc, h } = makeDoc();
  const win = {};
  const ctx = vm.createContext({ window: win, document: doc, setTimeout, clearTimeout });
  vm.runInContext(CORE, ctx);
  for (const c of CENSUS) vm.runInContext(c, ctx);
  vm.runInContext(src, ctx);
  const data = fakeData();
  data.fail = fail;
  doc.roots = await win.ryagramPerfectCityPage.view({ h, data });
  await tick();
  const pc = win.ryagramPerfectCity, $ = (id) => doc.getElementById(id);
  const form = () => doc.all().find((e) => e.tag === 'form');
  const type = async (lat, lon) => { $('pc-lat').value = lat; $('pc-lon').value = lon; form().fire('submit'); await tick(); };
  const pick = async (id, v) => { const s = $(id); s.value = v; s.fire('change'); await tick(30); };
  const clickMap = async (fx, fy) => { doc.all().find((e) => e.tag === 'svg' && (e.attrs.class || '') === 'pc-svg').fire('click', { clientX: 640 * fx, clientY: 480 * fy }); await tick(); };
  const click = async (id) => { $(id).fire('click'); await tick(30); };
  return { doc, data, pc, win, $, type, pick, clickMap, click, words: win.ryagramPerfectCityPage.WORDS };
}
const count = (hay, needle) => hay.split(needle).length - 1;

// ---- the checks: each returns the problems it saw (an empty list is a pass) ----
const CHECKS = {
  // gallery 11: after a county change the typed boxes held the old county's spot, and spot B stayed
  async countyClears(src) {
    const bad = [], p = await open(src);
    await p.type('39.7589', '-84.1916');
    if (!p.$('pc-spot')) bad.push('setup: the typed Montgomery spot was not drawn');
    await p.click('pc-compare-add');
    await p.type('39.7400', '-84.2600');
    if (!p.$('pc-spot-b')) bad.push('setup: spot B was not drawn');
    await p.pick('pc-county', 'greene_oh');
    if (p.$('pc-lat').value !== '' || p.$('pc-lon').value !== '') bad.push(`after the county change the typed boxes still hold ${p.$('pc-lat').value}, ${p.$('pc-lon').value}`);
    if (p.$('pc-spot') || p.$('pc-spot-b') || p.$('pc-compare') || p.$('pc-target')) bad.push('after the county change a spot, spot B or the compare table is still there');
    const before = p.data.calls;
    p.$('pc-go') && (await p.type('', ''));
    if (p.data.calls !== before || p.$('pc-spot')) bad.push('pressing Put the spot here with the cleared boxes asked about a spot');
    return bad;
  },
  // gallery 21/22: a spot outside the county said the sentence twice, offered Compare, and a corner click drew a dot and rings
  async outsideOnce(src) {
    const bad = [], p = await open(src);
    await p.type('39.7589', '-84.1916');
    if (!p.$('pc-spot') || !p.$('pc-compare-add')) bad.push('setup: an inside spot should be drawn with Compare offered');
    await p.type('40.5', '-82.5');
    const t = p.doc.text();
    if (count(t, p.words.outside) !== 1) bad.push(`typed outside: the outside sentence shows ${count(t, p.words.outside)} times`);
    if (p.$('pc-compare-add')) bad.push('typed outside: Compare with a second spot is still offered');
    // the map's top-left corner is outside Montgomery's block groups (the check proves it with the page's own arithmetic)
    await p.type('39.7589', '-84.1916');
    await p.clickMap(0.02, 0.02);
    const spot = [Number(p.$('pc-lon').value), Number(p.$('pc-lat').value)];
    const census = p.win.ryagramPerfectCityData.montgomery_oh;
    if (p.pc.unitAt(spot, census.units)) bad.push('setup: the corner click landed inside the county');
    const rings = p.doc.all().filter((e) => (e.attrs.class || '').split(' ').includes('pc-ring')).length;
    if (p.$('pc-spot') || rings) bad.push(`clicked outside: a dot (${!!p.$('pc-spot')}) or ${rings} rings are drawn outside the county`);
    if (count(p.doc.text(), p.words.outside) !== 1) bad.push(`clicked outside: the outside sentence shows ${count(p.doc.text(), p.words.outside)} times`);
    if (p.$('pc-compare-add')) bad.push('clicked outside: Compare with a second spot is still offered');
    return bad;
  },
  // gallery 32: ?placeserr had no Try again; the button must ask the server again, and go when the answer comes
  async retryButton(src) {
    const bad = [], p = await open(src, { fail: true });
    const b = p.$('pc-retry');
    if (!b) return ['no Try again button when the business points fail (before a spot)'];
    if (b.tag !== 'button' || b.attrs.type !== 'button' || b.textContent !== 'Try again') bad.push(`the Try again control is not a plain button (${b.tag} ${b.attrs.type} ${b.textContent})`);
    let n = p.data.calls;
    await p.click('pc-retry');
    if (p.data.calls !== n + 1) bad.push(`Try again (no spot) asked the server ${p.data.calls - n} times, not once`);
    if (!p.$('pc-retry') || p.$('pc-status').textContent !== p.words.placesError) bad.push('still failing: the button and the failure line should stay');
    await p.type('39.7589', '-84.1916');
    if (!p.$('pc-retry')) bad.push('no Try again button when the business points fail (after a spot)');
    p.data.fail = false;
    n = p.data.calls;
    await p.click('pc-retry');
    if (p.data.calls !== n + 1) bad.push(`Try again (with a spot) asked the server ${p.data.calls - n} times, not once`);
    if (p.$('pc-retry') || !p.$('pc-nearest')) bad.push('after a good answer the button should go and the nearest places show');
    return bad;
  },
  // RENDERER 09:19 (4) and (3): +39.7589, .5 and 39. are numbers; a comma is refused and the message says so, and says which spot is still shown
  async typedNumbers(src) {
    const bad = [], p = await open(src);
    // accepted = not refused in words (39. and .5 lie outside the county, so they are said to be outside, not drawn)
    for (const [lat, lon] of [['39.', '-84.19'], ['.5', '-84.2'], ['+39.7589', '-84.1916']]) {
      await p.type(lat, lon);
      if (/as numbers/.test(p.$('pc-status').textContent)) bad.push(`${lat}, ${lon} was refused`);
    }
    if (!p.$('pc-rings')) bad.push('+39.7589, -84.1916 was not put down');
    const pcv = p.$('pc-lat').value;
    await p.type('39,7589', '-84.1916');
    const st = p.$('pc-status').textContent;
    if (!/as numbers/.test(st) || !/comma is not accepted/.test(st)) bad.push(`a comma decimal: the message does not say a comma is not accepted (${st})`);
    if (!st.includes(`still for the spot at ${pcv}`)) bad.push(`a refused spot: the message does not say which spot the results are for (${st})`);
    await p.type('95', '-84.19');
    if (!/as numbers/.test(p.$('pc-status').textContent)) bad.push('a latitude of 95 was accepted');
    return bad;
  },
  // gallery 11/24: the kind-not-in-this-county note in plain words for every kind
  async kindNote(src) {
    const bad = [], p = await open(src);
    await p.pick('pc-kind', 'grocery');
    await p.pick('pc-county', 'greene_oh');
    const st = p.$('pc-status').textContent;
    if (!st.includes('Supermarkets: no places of this kind are loaded for Greene County, Ohio (Beavercreek, Xenia) yet, so the page shows fast food instead.')) bad.push(`kind note: ${st}`);
    if (/supermarkets data/.test(st)) bad.push('kind note still says "supermarkets data"');
    return bad;
  }
};

// one planted copy per check: the old line put back. The pattern must be in the page, or the planted copy proves nothing.
const PLANTS = {
  countyClears: [["state.b = noB(); latIn.value = ''; lonIn.value = ''; state.kindNote", 'state.b = noB(); state.kindNote']],
  outsideOnce: [
    ["if (inA) drawSpot(state.spot, state.compare ? 'A' : '');", "if (state.spot) drawSpot(state.spot, state.compare ? 'A' : '');"],
    ["results.replaceChildren(h('p', { class: 'form-intro' }, WORDS.pickSpot)); return; }      // the status line", "results.replaceChildren(h('p', { class: 'form-note' }, WORDS.outside)); return; }      // the status line"],
    ['if (!state.spot || (!state.compare && !pc.unitAt(state.spot, state.census.units))) {', 'if (!state.spot) {']
  ],
  retryButton: [
    ["...(failed() ? [h('button'", "...(false ? [h('button'"],
    ['} else await checkLoaded();', '}']
  ],
  typedNumbers: [
    ['/^\\s*[+-]?(\\d+\\.?\\d*|\\.\\d+)\\s*$/', '/^\\s*-?\\d+(\\.\\d+)?\\s*$/'],
    ["(a comma is not accepted)", ''],
    ['status.textContent = WORDS.badTyped + (!shown', 'status.textContent = WORDS.badTyped || (!shown']
  ],
  kindNote: [['`${KINDS[state.kind]}: no places of this kind are loaded for ${c.label} yet', '`There is no ${KINDS[state.kind].toLowerCase()} data for ${c.label} yet']]
};

for (const [name, check] of Object.entries(CHECKS)) {
  test(`${name}: the page passes`, async () => assert.deepEqual(await check(PAGE), []));
  if (process.env.PC_PAGE_SRC) continue;
  for (const [i, [from, to]] of PLANTS[name].entries()) {
    test(`${name}: MUST-FAIL ${i + 1} (the old line put back) is caught`, async () => {
      assert.equal(count(PAGE, from), 1, `planted fault ${name} ${i + 1}: pattern not in the page exactly once: ${from}`);
      const bad = await check(PAGE.replace(from, to));
      assert.ok(bad.length > 0, `planted fault ${name} ${i + 1} was NOT caught`);
    });
  }
}

test('the styles: a 44 px Try again, the credits link kept inline with its brackets, the phone controls and compare table, spot B stronger', () => {
  const css = read('assets/perfect-city.css'), site = read('assets/app-site.css');
  assert.match(css, /\.pc-retry \{ min-height: 44px; min-width: 44px; \}/);
  assert.match(css, /\.pc-credit-link \{ white-space: nowrap; \}/);
  assert.match(css, /@media \(max-width: 520px\) \{[^}]*\.pc-controls > span/);
  assert.match(css, /body \.pc-controls \.pc-control select \{ margin-left: 0; width: 100%;/);
  assert.match(css, /\.pc-compare th\[scope="row"\] \{ min-width: 9em; \}/);
  assert.match(site, /\.soon-tag\.soon-tag-big\{margin:0 16px 8px 0;/);
  assert.match(PAGE, /h\('span', \{ class: 'pc-credit-link' \}, '\(', h\('a'/);
  assert.match(PAGE, /width: 18, height: 18, fill: colour, stroke: '#14141a', 'stroke-width': '3', id: 'pc-spot-b'/);
  assert.ok(!/style=|\.style\b|innerHTML|eval\(/.test(PAGE), 'no inline style, innerHTML or eval');
});
