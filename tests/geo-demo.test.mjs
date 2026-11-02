// NEXT-WEB 198 and 199: the Geographic Intelligence demo page (/geo-demo/, behind geoDemo, OFF) on SYNTHETIC data: the catchment maths, the labels on every number, and the page wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/geo-catchment.js'), { window: win });
const G = win.ryagramGeo, J = x => JSON.parse(JSON.stringify(x));
const dwin = {}; vm.runInNewContext(read('assets/geo-demo-data.js'), { window: dwin }); const D = dwin.ryagramGeoDemoData;

test('distance: known values, symmetric, zero to itself, NaN for a bad point', () => {
  const a = { lat: 39.76, lon: -84.19 }, b = { lat: 39.76, lon: -84.19 + 1 / 111.19492664 / Math.cos(39.76 * Math.PI / 180) };
  assert.ok(Math.abs(G.haversineKm(a, b) - 1) < 0.01, 'one km east');
  assert.equal(G.haversineKm(a, a), 0); assert.equal(G.haversineKm(a, b), G.haversineKm(b, a));
  assert.ok(Math.abs(G.haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111.195) < 0.01, 'one degree of latitude');
  assert.ok(Number.isNaN(G.haversineKm(a, { lat: 'x', lon: 1 }))); assert.ok(Number.isNaN(G.haversineKm(null, a)));
});

test('point in polygon: inside, outside, on an edge and a corner count as inside, bad input is outside', () => {
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.equal(G.pointInPolygon({ lon: 2, lat: 2 }, sq), true); assert.equal(G.pointInPolygon({ lon: 5, lat: 2 }, sq), false); assert.equal(G.pointInPolygon({ lon: -0.001, lat: 2 }, sq), false);
  assert.equal(G.pointInPolygon({ lon: 4, lat: 2 }, sq), true); assert.equal(G.pointInPolygon({ lon: 0, lat: 0 }, sq), true);
  const concave = [[0, 0], [6, 0], [6, 6], [3, 2], [0, 6]];                                 // a notch cut from the top
  assert.equal(G.pointInPolygon({ lon: 3, lat: 5 }, concave), false); assert.equal(G.pointInPolygon({ lon: 1, lat: 1 }, concave), true);
  assert.equal(G.pointInPolygon({ lon: 1, lat: 1 }, []), false); assert.equal(G.pointInPolygon(null, sq), false);
});

test('a ring: every vertex is the radius away, it closes around the centre, and a bad radius gives nothing', () => {
  const c = { lat: 39.76, lon: -84.19 }, ring = G.ringPolygon(c, 3);
  assert.equal(ring.length, 72);
  for (const [lon, lat] of ring) assert.ok(Math.abs(G.haversineKm(c, { lon, lat }) - 3) < 0.02);
  assert.equal(G.pointInPolygon(c, ring), true);
  assert.deepEqual(J(G.ringPolygon(c, 0)), []); assert.deepEqual(J(G.ringPolygon(c, -1)), []); assert.deepEqual(J(G.ringPolygon(null, 1)), []);
});

test('counts and the nearest: only the asked category, only inside the radius (just inside the edge counts), the nearest is the nearest, none is null', () => {
  const c = { lat: 0, lon: 0 }, at = km => ({ lat: km / 111.19492664, lon: 0 });
  const pts = [{ ...at(1), category: 'chicken', name: 'near' }, { ...at(2.5), category: 'chicken', name: 'far' }, { ...at(0.5), category: 'burger', name: 'b' }, { ...at(1.99), category: 'chicken', name: 'edge' }];
  assert.equal(G.countInside(pts, c, 2, 'chicken').value, 2); assert.equal(G.countInside(pts, c, 2, 'burger').value, 1); assert.equal(G.countInside(pts, c, 2, 'retail').value, 0);
  assert.equal(G.countInside(pts, c, 2.01, 'chicken').value, 2); assert.equal(G.countInside(pts, c, 2.6, 'chicken').value, 3);
  assert.deepEqual(J(G.nearestOf(pts, c, 'chicken').value), { name: 'near', km: 1 });
  assert.equal(G.nearestOf(pts, c, 'retail').value, null); assert.equal(G.nearestOf(null, c, 'chicken').value, null);
  assert.equal(G.countInside(null, c, 2, 'chicken').value, 0);
});

test('residents inside: a ring over a whole area gives its population, over none gives zero, over half gives about half, and it says it assumes an even spread', () => {
  const area = { ring: [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]], population: 1000 };
  const mid = { lat: 0.01, lon: 0.01 };
  assert.equal(G.residentsInside([area], mid, 50).value, 1000);
  assert.equal(G.residentsInside([area], { lat: 40, lon: 40 }, 1).value, 0);
  const half = G.residentsInside([area], { lat: 0.01, lon: 0 }, 1.1).value;                  // a ring centred on the west edge, radius a bit over the half width
  assert.ok(half > 300 && half < 750, `about half: ${half}`);
  const r = G.residentsInside([area], mid, 50); assert.equal(r.label, 'Calculated'); assert.match(r.note, /spread evenly/);
  assert.equal(G.residentsInside([], mid, 5).value, 0); assert.equal(G.residentsInside([{ ring: 'x', population: 5 }, null], mid, 5).value, 0);
});

test('EVERY result carries one of the four labels and a source; a made-up label is refused', () => {
  assert.deepEqual(J(G.LABELS), ['Observed', 'Calculated', 'Estimated', 'Simulated']);
  const c = { lat: 39.76, lon: -84.19 };
  for (const r of [G.countInside(D.points, c, 2, 'chicken', 's'), G.nearestOf(D.points, c, 'burger', 's'), G.residentsInside(D.areas, c, 2, 's')]) { assert.ok(G.LABELS.includes(r.label)); assert.ok(r.source.length > 0); }
  assert.throws(() => G.result(1, 'Guaranteed', 'x'), /label must be one of/);
});

test('the fixture is plainly synthetic: labelled Simulated, made-up names, deterministic, and every point lies inside the box', () => {
  assert.equal(D.LABEL, 'Simulated'); assert.match(D.SOURCE, /Synthetic/);
  assert.ok(D.areas.length >= 20 && D.points.length >= 30);
  for (const a of D.areas) assert.match(a.name, /^Made-up area/);
  for (const p of D.points) { assert.match(p.name, /^Made-up/); assert.ok(p.lon > D.bbox.lon0 && p.lon < D.bbox.lon1 && p.lat > D.bbox.lat0 && p.lat < D.bbox.lat1, p.id); }
  const again = {}; vm.runInNewContext(read('assets/geo-demo-data.js'), { window: again });
  assert.deepEqual(J(again.ryagramGeoDemoData.points), J(D.points)); assert.deepEqual(J(again.ryagramGeoDemoData.areas), J(D.areas));
  assert.deepEqual([...new Set(D.points.map(p => p.category))].sort(), ['burger', 'chicken', 'retail']);
  assert.ok(!/(Dayton|Montgomery|Census|OpenStreetMap)/.test(D.areas.concat(D.points).map(x => x.name).join(' ')), 'no real place or source in the names');
});

test('the page: noindex, hidden unless geoDemo is exactly true, no outside request, no map library, the synthetic banner and the rules in the words', () => {
  const html = read('geo-demo/index.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/); assert.match(html, /<p id="not-available">This page is not available yet\.<\/p>/); assert.match(html, /<div id="geo-demo" hidden><\/div>/);
  assert.match(html, /script-src 'self'; style-src 'self' https:\/\/fonts\.googleapis\.com/); assert.ok(!/connect-src/.test(html) || /default-src 'self'/.test(html));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline script'); assert.ok(!/<script[^>]*src="https?:/.test(html), 'no outside script');
  assert.ok(html.indexOf('ryagram-config.js') < html.indexOf('geo-demo.js') && html.indexOf('geo-catchment.js') < html.indexOf('geo-demo.js') && html.indexOf('geo-demo-data.js') < html.indexOf('geo-demo.js'));
  assert.match(html, /<a href="\/ai-content\/">AI content<\/a>/);
  assert.match(read('assets/ryagram-config.js'), /\n  geoDemo: false,/);
  const code = read('assets/geo-demo.js');
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|eval\(|import\(|https?:\/\//.test(code.replace(/http:\/\/www\.w3\.org\/2000\/svg/, '')), 'no network, storage or outside address');
  assert.match(code, /SYNTHETIC DEMO DATA/); assert.match(code, /not Dayton, not the Census and not OpenStreetMap/); assert.match(code, /straight-line circle, not a drive time/); assert.match(code, /not built yet/);
  // the real script against a minimal page: off shows only the plain line, on builds the page
  const run = cfg => {
    const els = { 'geo-demo': { hidden: true, replaceChildren() { this.built = true; } }, 'not-available': { hidden: false } };
    const doc = { getElementById: id => els[id], createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {}, replaceChildren() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 520 }; } }), createElementNS: () => ({ append() {}, setAttribute() {}, addEventListener() {}, replaceChildren() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 520 }; } }), createTextNode: t => ({ nodeType: 3, t }) };
    vm.runInNewContext(code, { window: { ryagramConfig: cfg, ryagramGeo: G, ryagramGeoDemoData: D }, document: doc, Math, Number, String, Object, Array });
    return { demoHidden: els['geo-demo'].hidden, off: els['not-available'].hidden, built: !!els['geo-demo'].built };
  };
  assert.deepEqual(run({}), { demoHidden: true, off: false, built: false }); assert.deepEqual(run({ geoDemo: 'true' }), { demoHidden: true, off: false, built: false });
  assert.deepEqual(run({ geoDemo: true }), { demoHidden: false, off: true, built: true });
});

test('it is linked from nowhere else', () => {
  const all = fs.readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.html')).map(f => read(f)).join('\n') + read('help/index.html') + read('ryagram/index.html');
  assert.ok(!/geo-demo/.test(all)); assert.ok(!/geo-demo/.test(read('assets/app-library.js') + read('assets/app-departments.js')));
});

test('NEXT-WEB 199: two sites side by side use identical rules, the difference is B minus A and labelled, and the page never says which site is better', () => {
  const c = { lat: 39.76, lon: -84.19 }, near = { lat: 39.76 + 0.005, lon: -84.19 };
  const rows = G.compareSites(D, c, near, 2, 'src');
  assert.deepEqual(J(rows.map(r => r.key)), ['residents', 'chicken', 'burger', 'retail', 'nearest']);
  for (const r of rows) { assert.ok(G.LABELS.includes(r.a.label) && G.LABELS.includes(r.b.label) && r.diff.label === 'Calculated'); assert.match(r.diff.note, /site B minus site A/); }
  const m = G.measures(D, c, 2, 'src');
  assert.deepEqual(J(m.map(x => x.r.value)), J(rows.map(r => r.a.value)), 'site A in the comparison is exactly what one site alone shows');
  const res = rows[0]; assert.equal(res.diff.value, res.b.value - res.a.value);
  const same = G.compareSites(D, c, c, 2, 'src'); for (const r of same) assert.equal(r.diff.value, 0, 'the same site twice differs by nothing');
  const swapped = G.compareSites(D, near, c, 2, 'src'); assert.equal(swapped[0].diff.value + 0, -res.diff.value + 0, 'swapping the sites flips the sign');
  const none = G.compareSites({ areas: [], points: [], categories: D.categories }, c, near, 2, 's'); assert.equal(none[4].diff.value, null, 'no chicken place on either side: not comparable, never a number');
  const code = read('assets/geo-demo.js');
  assert.match(code, /does not say which site is better/); assert.match(code, /B minus A/); assert.match(code, /dashed ring, B a dotted ring/);
  assert.ok(!/(better than|best site|winner|score)/i.test(code.replace(/does not say which site is better/, '')), 'no verdict words');
});
