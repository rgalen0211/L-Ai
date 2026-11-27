// Zoom map prototype (GEO 11-27): the data files, the switch gate and the stamps.
//   data: 49 areas (the contiguous states and DC); one county file per state, loaded lazily, whose county count equals the
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
    assert.ok(Number.isInteger(s.pop) && s.pop > 0, s.name);
    assert.ok(s.bbox[0] >= 0 && s.bbox[1] >= 0 && s.bbox[2] <= us.width && s.bbox[3] <= us.height, s.name);
  }
  assert.ok(fs.statSync(path.join(root, DIR, 'states.js')).size < 150 * 1024);
  assert.equal(us.value.kind, 'estimated');
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
    for (const x of c.counties) { assert.ok(x.id.startsWith(s.id) && x.d.startsWith('M'), x.id); assert.ok(Number.isInteger(x.pop), `${x.id} has no value`); }
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
  assert.equal((lib.match(/#\/labs\/map/g) || []).length, 2);         // the comment and the route, never a link
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
