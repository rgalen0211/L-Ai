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
});

test('the colour bands and the zoom box', () => {
  const w = {};
  vm.runInNewContext(read('assets/app-zoom-map.js'), { window: w, document: {} });
  const { breaks, band, fitBox } = w.ryagramZoomMap;
  const br = breaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([...br], [3, 5, 7, 9]);
  assert.deepEqual([1, 3, 6, 10, null].map((x) => band(x, br)), [0, 1, 2, 4, -1]);
  assert.deepEqual([...breaks([5, 5, 5])], []);
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
  assert.equal((page.match(/levelBreaks\(/g) || []).length, 2, 'the map takes its bands from levelBreaks only (states, counties)');
  assert.equal((page.match(/[^A-Za-z]breaks\(/g) || []).length, 3, 'plain breaks() only in its definition, levelBreaks and the legend');
  assert.match(page, /const br = breaks\(values\);/);       // the legend: values = allYears(places)
  assert.match(page, /const values = allYears\(places\);/);
  assert.equal(change([100, 0, 0, 0, 110], 4), '+10 (+10.0%)');
  assert.equal(change([2000, 0, 0, 1900, 0], 3), '-100 (-5.0%)');
  assert.equal(change([5, 5, 5, 5, 5], 4), '0 (0.0%)');
  assert.equal(change([100000, 0, 99990, 0, 0], 2), '-10 (0.0%)');
  assert.equal(change(null, 4), null);
});
