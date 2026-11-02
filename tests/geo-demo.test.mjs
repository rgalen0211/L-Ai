// NEXT-WEB 198 and 199: the Geographic Intelligence demo page (/geo-demo/, behind geoDemo, OFF) on SYNTHETIC data: the catchment maths, the labels on every number, and the page wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/geo-catchment.js'), { window: win });
const G = win.ryagramGeo, J = x => JSON.parse(JSON.stringify(x));
const dwin = {}; vm.runInNewContext(read('assets/geo-demo-data.js'), { window: dwin }); const D = dwin.ryagramGeoDemoData;

test('the basics in metres: distance, a point in a polygon, and a ring whose every vertex is the radius away', () => {
  const a = { lat: 39.76, lon: -84.19 };
  assert.ok(Math.abs(G.haversineM(a.lon, a.lat, a.lon, a.lat + 1 / 111.19492664) - 1000) < 1, 'one km north');
  assert.equal(G.haversineM(a.lon, a.lat, a.lon, a.lat), 0);
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.equal(G.pointInPolygon(2, 2, sq), true); assert.equal(G.pointInPolygon(5, 2, sq), false); assert.equal(G.pointInPolygon(4, 2, sq), true, 'an edge counts as inside');
  const ring = G.circle(a, 3000); assert.equal(ring.length, 96);
  for (const [lon, lat] of ring) assert.ok(Math.abs(G.haversineM(a.lon, a.lat, lon, lat) - 3000) < 6);
  assert.throws(() => G.circle(a, 0), /radius above zero/);
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


test('NEXT-WEB 201: every number on the page comes from the contract: the page builds the comparison with compareSites, checks it with validateComparison, and refuses to draw what does not pass', () => {
  const code = read('assets/geo-demo.js');
  assert.match(code, /G\.compareSites\(\[siteOf\('A'\), siteOf\('B'\)\], \[state\.m\], D\.areas, D\.points, NAMES, opts\)/); assert.match(code, /G\.validateComparison\(cmp\)/);
  assert.match(code, /nothing is shown/); assert.match(code, /G\.siteBlock\(/); assert.ok(!/ringPolygon|countInside|measures\(/.test(code), 'no leftover from the old maths');
  assert.match(code, /does not say which site is better/); assert.match(code, /an estimated/);
  assert.match(code, /Median household income across the areas touched/);
});

test('NEXT-WEB 202: RENDERER\'s map look is applied: near-black page, one blue ramp, page-coloured halo on markers, shape differs as well as colour, a pin with its letter, a solid ring with a red wash, place labels on plates', () => {
  const code = read('assets/geo-demo.js'), css = read('assets/geo-demo.css');
  assert.match(code, /const PAGE = '#111218'/); assert.match(code, /const RAMP = \['#243a63', '#2c4f85', '#3b6aa8', '#5588c6', '#7fb0ea'\]/);
  assert.match(code, /chicken: '#f5a623', burger: '#c9ced6'/); assert.match(code, /'stroke-width': 3, 'paint-order': 'stroke'/);
  assert.match(code, /if \(p\.category === 'chicken'\) return s\('circle'/); assert.match(code, /if \(p\.category === 'burger'\) return s\('rect'/);
  assert.match(code, /pin with a letter = a site/); assert.match(code, /rgba\(229,72,77,0\.16\)/); assert.match(code, /D\.places/);
  assert.match(css, /--gp:#111218/); assert.match(css, /@media \(max-width:820px\)\{\.geo-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.equal(D.places.length, 3); for (const pl of D.places) { assert.match(pl.name, /^MADE-UP /); assert.ok(pl.lon > D.bbox.lon0 && pl.lon < D.bbox.lon1 && pl.lat > D.bbox.lat0 && pl.lat < D.bbox.lat1); }
});
