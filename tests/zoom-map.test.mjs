// Zoom map prototype (GEO 11-27): the data files, the switch gate and the stamps.
//   data: 49 areas (the contiguous states and DC); every area has five integer years (July 1 of 2020 to 2024, POPESTIMATE2020..2024,
//         spot-checked against the cached CSV when it is present); one county file per state, loaded lazily, whose county count equals the
//         2024 boundary file's (read from the .dbf on this machine when the cache is present; always against the index's own counts);
//   gate: #/labs/map is routed only when featureOn('zoomMap') is true; the switch is 'account'; nothing links to the page;
//   stamps: every data file is loaded with the one ?v= the data says it is; the CSS and script carry a ?v= on app/index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const DIR = 'assets/zoom-map';
const win = {};
vm.runInNewContext(read(`${DIR}/states.js`), { window: win });
const us = win.ryagramZoomMapData.us;
const countyFiles = fs.readdirSync(path.join(root, DIR)).filter((f) => /^st-\d{2}\.js$/.test(f));
for (const f of countyFiles) vm.runInNewContext(read(`${DIR}/${f}`), { window: win });

// Record counts per STATEFP from a dBASE file (the shapefile's attribute table): header, field list, fixed-width records.
function dbfCountsByState(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(4), headLen = b.readUInt16LE(8), recLen = b.readUInt16LE(10);
  let off = 1, at = -1;
  for (let p = 32; b[p] !== 0x0d; p += 32) {
    const name = b.toString('latin1', p, p + 11).replace(/\0.*$/, '');
    if (name === 'STATEFP') at = off;
    off += b[p + 16];
  }
  const out = {};
  for (let i = 0; i < n; i++) {
    const r = headLen + i * recLen;
    if (b[r] === 0x2a) continue;                         // a deleted record
    const fp = b.toString('latin1', r + at, r + at + 2);
    out[fp] = (out[fp] || 0) + 1;
  }
  return out;
}

test('the states file: 49 areas (48 contiguous states and DC), no Alaska, Hawaii or Puerto Rico, every one with a shape and a value, under 150 KB', () => {
  assert.equal(us.states.length, 49);
  assert.deepEqual([...us.leftOut], ['02', '15', '72']);
  for (const s of us.states) {
    assert.ok(!us.leftOut.includes(s.id), s.id);
    assert.match(s.d, /^M[\d.,LMZ-]+Z$/, s.name);
    assert.ok(Array.isArray(s.pop) && s.pop.length === 5 && s.pop.every((x) => Number.isInteger(x) && x > 0), `${s.name}: five integer years`);
    assert.ok(s.bbox[0] >= 0 && s.bbox[1] >= 0 && s.bbox[2] <= us.width && s.bbox[3] <= us.height, s.name);
  }
  assert.ok(fs.statSync(path.join(root, DIR, 'states.js')).size < 150 * 1024);
  assert.equal(us.value.kind, 'estimated');
  assert.deepEqual([...us.value.years], [2020, 2021, 2022, 2023, 2024]);
  assert.match(us.value.note, /July 1, 2020 estimate/);
  assert.match(us.sources.values, /July 1 of each year 2020 to 2024/);
  assert.match(us.sources.values, /Census Bureau.*public domain/);
});

test('one county file per state, and each holds exactly the counties the index counts', () => {
  assert.deepEqual(countyFiles.map((f) => f.slice(3, 5)).sort(), [...us.states.map((s) => s.id)].sort());
  let total = 0;
  for (const s of us.states) {
    const c = win.ryagramZoomMapCounties[s.id];
    assert.equal(c.id, s.id);
    assert.equal(c.counties.length, s.counties, s.name);
    assert.equal(new Set(c.counties.map((x) => x.id)).size, c.counties.length, `${s.name}: duplicate county`);
    for (const x of c.counties) { assert.ok(x.id.startsWith(s.id) && x.d.startsWith('M'), x.id); assert.ok(Array.isArray(x.pop) && x.pop.length === 5 && x.pop.every(Number.isInteger), `${x.id}: not five integer years`); }
    total += c.counties.length;
  }
  assert.equal(total, 3109);
});

test('each state\'s county count equals the 2024 boundary file\'s (read from the cache on this machine)', (t) => {
  const dbf = 'C:/Users/Ryan/Ryagram-cache/geo/cb_2024_us_county_20m/cb_2024_us_county_20m.dbf';
  if (!fs.existsSync(dbf)) { t.skip('the boundary file is not on this machine'); return; }
  const want = dbfCountsByState(dbf);
  for (const s of us.states) assert.equal(win.ryagramZoomMapCounties[s.id].counties.length, want[s.id], s.name);
});

test('the page is gated by the per-account switch zoomMap and nothing links to it', () => {
  assert.match(read('assets/ryagram-config.js'), /^\s*zoomMap: 'account',/m);
  const lib = read('assets/app-library.js');
  assert.match(lib, /const zoomMapOn = \(\) => window\.ryagramSwitches\?\.featureOn\('zoomMap'\) === true && !!window\.ryagramZoomMap;/);
  assert.match(lib, /else if \(zoomMapOn\(\) && hash === '#\/labs\/map'\) view = await window\.ryagramZoomMap\.view\(\{ h \}\);/);
  assert.match(lib, /else if \(!zoomMapOn\(\) && hash === '#\/labs\/map'\) view = zoomMapOffView\(\);/);     // without the switch: one plain line, never the library
  assert.equal((lib.match(/#\/labs\/map/g) || []).length, 3);         // the comment, the route and the off route, never a link
  for (const f of fs.readdirSync(path.join(root, 'assets')).filter((x) => x.endsWith('.js') && !['app-library.js', 'app-zoom-map.js', 'ryagram-config.js'].includes(x))) {     // the config names it in a comment only
    assert.ok(!read(`assets/${f}`).includes('#/labs/map'), `${f} links to the zoom map`);
  }
  assert.ok(!read('app/index.html').includes('#/labs/map'));
  // featureOn itself: 'account' is off until the person's own list names zoomMap
  const w = {};
  vm.runInNewContext(read('assets/app-switches.js'), { window: w });
  const cfg = { zoomMap: 'account' };
  assert.equal(w.ryagramSwitches.featureOn('zoomMap', cfg), false);
  return w.ryagramSwitches.load({ mySwitches: async () => ['zoomMap'] }, cfg).then(() => assert.equal(w.ryagramSwitches.featureOn('zoomMap', cfg), true));
});

test('stamps: the data files load with the data\'s own version; the page loads the script before app-library.js and the CSS, each with a ?v=', () => {
  const page = read('assets/app-zoom-map.js');
  const v = page.match(/const VERSION = '([0-9a-z]+)'/)[1];
  assert.equal(us.version, v);
  assert.match(page, /\/assets\/zoom-map\/states\.js\?v=\$\{VERSION\}/);
  assert.match(page, /\/assets\/zoom-map\/st-\$\{fp\}\.js\?v=\$\{VERSION\}/);
  assert.match(read('tools/zoom-map/export_zoom_map.py'), new RegExp(`VERSION = '${v}'`));
  const html = read('app/index.html');
  const at = (s) => html.indexOf(s);
  assert.ok(at('/assets/app-zoom-map.js?v=') > 0 && at('/assets/app-zoom-map.js?v=') < at('/assets/app-library.js?v='));
  assert.ok(at('/assets/zoom-map.css?v=') > 0);
  assert.ok(!/style=/.test(page) && !/innerHTML/.test(page), 'no inline style, no innerHTML');
  assert.ok(!/['"]?\bstyle['"]?\s*:/.test(page), 'no style: in an h() or svg() props object');
  assert.ok(!/setAttribute(NS)?\(\s*(null\s*,\s*)?['"`]style['"`]/.test(page), 'no setAttribute(\'style\', ...)');
  assert.ok(!/\.style\s*[.=[]/.test(page) && !/cssText/.test(page), 'no element.style or cssText');
  // the inline-style checks catch each form (must-fail: each planted form trips one of them)
  for (const bad of ["h('p', { style: 'color: red' })", "h('p', { 'style': 'x' })", "el.setAttribute('style', 'x')", 'el.setAttribute("style", "x")', 'el.style.color = 1']) {
    const caught = /style=/.test(bad) || /['"]?\bstyle['"]?\s*:/.test(bad) || /setAttribute(NS)?\(\s*(null\s*,\s*)?['"`]style['"`]/.test(bad) || /\.style\s*[.=[]/.test(bad);
    assert.ok(caught, `the check misses ${bad}`);
  }
});

// The data manifest (tests/zoom-map-data.json, written by tools/zoom-map/hash_zoom_map.py and the exporter): VERSION plus the sha256 of the LF-normalised
// text of every data file. A data file changed under the same VERSION fails here, so a returning visitor never keeps an old cached file.
const manifest = JSON.parse(read('tests/zoom-map-data.json'));
const sha = (text) => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
function manifestProblems(m, readData, names) {
  const bad = [];
  const v = read('assets/app-zoom-map.js').match(/const VERSION = '([0-9a-z]+)'/)[1];
  if (m.version !== v) bad.push(`the manifest says ${m.version}, the page loads ?v=${v}`);
  const want = Object.keys(m.files).sort(), have = [...names].sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) bad.push(`files differ: manifest ${want.length}, folder ${have.length}`);
  for (const f of have) if (m.files[f] && m.files[f] !== sha(readData(f))) bad.push(`${f} changed under ?v=${m.version}: bump VERSION and rerun tools/zoom-map/hash_zoom_map.py`);
  return bad;
}
const dataNames = ['states.js', ...countyFiles];
const readData = (f) => read(`${DIR}/${f}`);

test('the data manifest: VERSION and the content hash of states.js and every st-NN.js match the files as they are now', () => {
  assert.equal(manifest.version, us.version);
  assert.equal(Object.keys(manifest.files).length, 50);
  assert.deepEqual(manifestProblems(manifest, readData, dataNames), []);
  assert.match(read('tools/zoom-map/export_zoom_map.py'), /hz\.write_manifest\(\)/, 'the exporter writes the manifest after every export');
});

test('the data manifest check fails on a changed file, a new or missing file and a version that disagrees (must-fail)', () => {
  const changed = (f) => (f === 'st-44.js' ? readData(f).replace(/\d/, (d) => String((Number(d) + 1) % 10)) : readData(f));
  assert.match(manifestProblems(manifest, changed, dataNames).join('|'), /st-44\.js changed under/);
  const crlfOnly = (f) => readData(f).replace(/\n/g, '\r\n');             // line endings alone are not a change
  assert.deepEqual(manifestProblems(manifest, crlfOnly, dataNames), []);
  assert.match(manifestProblems(manifest, readData, [...dataNames, 'st-99.js']).join('|'), /files differ/);
  assert.match(manifestProblems(manifest, readData, dataNames.filter((f) => f !== 'st-11.js')).join('|'), /files differ/);
  assert.match(manifestProblems({ ...manifest, version: 'old' }, readData, dataNames).join('|'), /manifest says old/);
});

test('zoom-map.css: its ?v= on app/index.html has a recorded hash in tests/asset-versions.json equal to the file as it is now', () => {
  const v = read('app/index.html').match(/\/assets\/zoom-map\.css\?v=([0-9a-z]+)/)[1];
  const rec = JSON.parse(read('tests/asset-versions.json'))['zoom-map.css'];
  assert.ok(rec && rec[v], `add "${v}": "${sha(read('assets/zoom-map.css'))}" under "zoom-map.css" in tests/asset-versions.json`);
  assert.equal(rec[v], sha(read('assets/zoom-map.css')), 'zoom-map.css changed: bump its ?v= and add the pair');
  assert.ok(!/:hover/.test(read('assets/zoom-map.css').replace(/\/\*[\s\S]*?\*\//g, '')),'the hover outline is a class set by a mouse pointer, never :hover (it sticks after a tap)');
});

test('the colour bands and the zoom box', () => {
  const w = {};
  vm.runInNewContext(read('assets/app-zoom-map.js'), { window: w, document: {} });
  const { breaks, band, fitBox } = w.ryagramZoomMap;
  const br = breaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([...br], [3, 5, 7, 9]);
  assert.deepEqual([1, 3, 6, 10, null].map((x) => band(x, br)), [0, 1, 2, 4, -1]);
  assert.deepEqual([...breaks([5, 5, 5])], []);
  assert.deepEqual([...breaks([])], [], 'an empty input: no cut points');
  assert.deepEqual([...breaks([null, NaN, undefined])], [], 'no finite figure: no cut points');
  assert.equal(band(7, []), 0, 'no cut points: everything in the first band');
  const [x, y, bw, bh] = fitBox([100, 100, 200, 150], 960, 600, 0);
  assert.ok(Math.abs(bw / bh - 1.6) < 1e-6 && x <= 100 && y <= 100 && x + bw >= 200 && y + bh >= 150);
});

test('the five years match the Census CSV (POPESTIMATE2020 and 2024, not ESTIMATESBASE2020) for three counties and two states', (t) => {
  const csv = 'C:/Users/Ryan/Ryagram-cache/co-est2024-alldata.csv';
  if (!fs.existsSync(csv)) { t.skip('the estimates file is not on this machine'); return; }
  const lines = fs.readFileSync(csv, 'latin1').split(/\r?\n/);
  const head = lines[0].split(',');
  const col = (n) => head.indexOf(n);
  const rows = new Map(lines.slice(1).filter(Boolean).map((l) => l.split(',')).map((r) => [r[col('SUMLEV')] === '040' ? r[col('STATE')] : r[col('STATE')] + r[col('COUNTY')], r]));
  const county = (id) => win.ryagramZoomMapCounties[id.slice(0, 2)].counties.find((c) => c.id === id);
  for (const [id, place] of [['39049', county('39049')], ['48201', county('48201')], ['06037', county('06037')], ['39', us.states.find((s) => s.id === '39')], ['48', us.states.find((s) => s.id === '48')]]) {
    const r = rows.get(id);
    assert.deepEqual([...place.pop], [2020, 2021, 2022, 2023, 2024].map((y) => Number(r[col(`POPESTIMATE${y}`)])), id);
    assert.notEqual(place.pop[0], Number(r[col('ESTIMATESBASE2020')]), `${id}: 2020 is the July 1 estimate, not the estimates base`);
  }
  assert.deepEqual([county('39049').pop[0], county('39049').pop[4]], [1324505, 1356303]);     // Franklin County, Ohio, read from the CSV by hand
});

test('the colour bands are computed once over all five years of a level, and the change line has its sign', () => {
  const w = {};
  vm.runInNewContext(read('assets/app-zoom-map.js'), { window: w, document: {} });
  const { breaks, levelBreaks, change } = w.ryagramZoomMap;
  const all = us.states.flatMap((s) => s.pop);
  assert.equal(all.length, 49 * 5);
  assert.deepEqual([...levelBreaks(us.states)], [...breaks(all)]);
  assert.notDeepEqual([...levelBreaks(us.states)], [...breaks(us.states.map((s) => s.pop[4]))], 'pooled bands differ from one year\'s own');
  const tx = win.ryagramZoomMapCounties['48'].counties;
  assert.deepEqual([...levelBreaks(tx)], [...breaks(tx.flatMap((c) => c.pop))]);
  const page = read('assets/app-zoom-map.js');
  assert.match(page, /const usBreaks = levelBreaks\(us\.states\);/);
  assert.match(page, /state\.countyBreaks = levelBreaks\(data\.counties\);/);
  assert.equal((page.match(/levelBreaks\(/g) || []).length, 3, 'the map and its legend take their bands from levelBreaks only (states, counties, legend)');
  assert.equal((page.match(/[^A-Za-z]breaks\(/g) || []).length, 2, 'plain breaks() only in its definition and levelBreaks');
  assert.match(page, /const br = levelBreaks\(places\);/);   // the legend: the same bands as the map
  assert.match(page, /const values = allYears\(places\)/);
  assert.equal(change([100, 0, 0, 0, 110], 4), '+10 (+10.0%)');
  assert.equal(change([2000, 0, 0, 1900, 0], 3), '-100 (-5.0%)');
  assert.equal(change([5, 5, 5, 5, 5], 4), '0 (0.0%)');
  assert.equal(change([100000, 0, 99990, 0, 0], 2), '-10 (0.0%)');
  assert.equal(change(null, 4), null);
});

test('the legend reads as plain ranges in every mode: bands, one band per figure ("each"), one place, and one value', () => {
  const w = {};
  vm.runInNewContext(read('assets/app-zoom-map.js'), { window: w, document: {} });
  const { legendKeys, WORDS } = w.ryagramZoomMap;
  const P = (...pops) => pops.map((pop) => ({ pop }));
  const plain = /^(under [\d,]+|[\d,]+ to [\d,]+|[\d,]+|[\d,]+ and over)$/;
  // bands: Ohio's 88 counties over five years
  const oh = legendKeys(win.ryagramZoomMapCounties['39'].counties);
  assert.equal(oh.n, 5);
  assert.equal(oh.each, false);
  assert.match(oh.labels[0], /^under [\d,]+$/);
  assert.match(oh.labels[4], /^[\d,]+ and over$/);
  for (const l of oh.labels.slice(1, 4)) assert.match(l, /^[\d,]+ to [\d,]+$/);
  assert.ok(oh.labels.every((l) => !/to under|or more/.test(l)));
  // ranges meet without a gap: 'under 50,000', '50,000 to 99,999', '100,000 and over'
  const num = (s) => Number(s.replace(/,/g, ''));
  for (let i = 1; i < oh.labels.length - 1; i++) assert.equal(num(oh.labels[i].split(' to ')[0]), num(oh.labels[i - 1].split(' ').pop()) + (i === 1 ? 0 : 1));
  // each: three places, three distinct figures over the five years, so one band per figure, still as ranges
  const few = legendKeys(P([100, 100, 100, 100, 100], [50000, 50000, 50000, 50000, 50000], [100000, 100000, 100000, 100000, 100000]));
  assert.equal(few.each, true);
  assert.deepEqual([...few.labels], ['under 50,000', '50,000 to 99,999', '100,000 and over']);
  // Rhode Island: 5 counties, no bare numbers
  const ri = legendKeys(win.ryagramZoomMapCounties['44'].counties);
  assert.equal(ri.n, 5);
  for (const l of ri.labels) assert.match(l, plain);
  assert.ok(ri.labels.every((l) => /under|to|and over/.test(l)), `Rhode Island: ${ri.labels}`);
  // one place (DC): one colour and one line, never 'all' or five numbers
  const dc = legendKeys(win.ryagramZoomMapCounties['11'].counties);
  assert.equal(dc.single, true);
  assert.equal(dc.n, 1);
  assert.deepEqual([...dc.labels], ['One county equivalent: see its numbers below.']);
  assert.equal(WORDS.onePlace, 'One county equivalent: see its numbers below.');
  // one value for every place: one band that says the figure
  assert.deepEqual([...legendKeys(P([7, 7, 7, 7, 7], [7, 7, 7, 7, 7])).labels], ['7 (every place, every year)']);
  assert.deepEqual([...legendKeys([]).labels], ['no figures']);
  // the words of 5, 6 and 7
  assert.equal(WORDS.smallStates, 'Small states and counties: pick them from the lists.');
  assert.equal(WORDS.connecticut, 'Connecticut\'s nine planning regions (the Census Bureau\'s county equivalents since 2022).');
  const page = read('assets/app-zoom-map.js');
  assert.match(page, /if \(s\.id === '09'\) out\.push\(h\('p', \{ class: 'meta', id: 'zm-ct' \}, WORDS\.connecticut\)\);/);
  assert.match(page, /the \$\{fmt\(YEARS\.length \* places\.length\)\} figures/, 'the figure count goes through fmt()');
  assert.equal(win.ryagramZoomMapCounties['09'].counties.length, 9);
});

// A small stand-in DOM, enough for assets/app-library.js's mount() and route() on #/labs/map.
function fakeDom() {
  const made = [], appendedToHead = [];
  const el = (tag) => {
    const e = { tagName: String(tag).toUpperCase(), children: [], attrs: {}, className: '', textContent: '', parentElement: null,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener() {}, removeEventListener() {}, focus() {}, before() {}, remove() {},
      append(...kids) { for (const k of kids) { const c = typeof k === 'string' ? { text: k } : k; if (c && typeof c === 'object') c.parentElement = this; this.children.push(c); } },
      replaceChildren(...kids) { this.children = []; this.append(...kids); },
      get childElementCount() { return this.children.filter((c) => c.tagName).length; },
      get innerText() { return this.children.map((c) => c.text ?? c.innerText ?? '').join(''); },
      querySelectorAll(sel) {
        const out = [], walk = (n) => { for (const c of n.children || []) { if (c.tagName && match(c, sel)) out.push(c); walk(c); } };
        walk(this); return out;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; } };
    made.push(e);
    return e;
  };
  const match = (e, sel) => sel.split(',').map((s) => s.trim()).some((s) => {
    const m = s.match(/^([a-z0-9]+)?(?:\.([\w-]+))?(?:\[(\w+)="([^"]*)"\])?$/i);
    return !!m && (!m[1] || e.tagName === m[1].toUpperCase()) && (!m[2] || e.className.split(' ').includes(m[2])) && (!m[3] || e.attrs[m[3]] === m[4]);
  });
  const document = { title: '', hidden: false, body: el('body'), head: { append: (s) => appendedToHead.push(s) },
    createElement: el, createElementNS: (ns, t) => el(t), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {} };
  return { document, made, appendedToHead, el };
}

async function routeLabsMap(on) {
  const { document, made, appendedToHead, el } = fakeDom();
  const window = { addEventListener() {}, removeEventListener() {}, ryagramConfig: {},
    ryagramSwitches: { load: async () => {}, featureOn: (n) => n === 'zoomMap' && on } };
  const location = { hash: '#/labs/map', search: '', replace() {} };
  const ctx = { window, document, location, console, setTimeout, clearTimeout, setInterval, clearInterval, MutationObserver: class { observe() {} disconnect() {} }, URLSearchParams };
  vm.runInNewContext(read('assets/app-zoom-map.js'), ctx);           // the real map module: its view() asks for the data file through document.head
  vm.runInNewContext(read('assets/app-library.js'), ctx);
  const root = el('main');
  const data = { isAppAdmin: async () => false, serviceStatus: async () => null };
  window.ryagramLibrary.mount(root, data);
  for (let i = 0; i < 50 && !(on ? appendedToHead.length : root.querySelector('h1')); i++) await new Promise((r) => setTimeout(r, 10));
  return { root, made, appendedToHead };
}

test('the router with a stub featureOn: switch off gives one plain line and loads no map data; switch on asks for the states file', async () => {
  const off = await routeLabsMap(false);
  assert.equal(off.root.querySelector('h1').innerText, 'Not switched on');
  const line = off.root.querySelectorAll('p').filter((p) => p.attrs.id === 'zoom-map-off');
  assert.equal(line.length, 1);
  assert.equal(line[0].innerText, 'This page is not switched on for this account.');
  assert.equal(off.root.querySelectorAll('a').filter((a) => a.attrs.id === 'zoom-map-off-home').length, 1);
  assert.equal(off.appendedToHead.length, 0, 'no script tag was added');
  assert.equal(off.made.filter((e) => e.tagName === 'SCRIPT' || e.tagName === 'SVG').length, 0, 'no data script and no map were made');
  // must-fail: the same harness with the switch on does ask for the data (so "nothing asked for" above is not a harness that never asks)
  const on = await routeLabsMap(true);
  assert.equal(on.appendedToHead.length, 1);
  assert.match(on.appendedToHead[0].src, /^\/assets\/zoom-map\/states\.js\?v=20261127zm\d+$/);
});
