// Perfect City engine adapter: page-shaped MADE-UP data in, the engine's golden numbers out (nothing real in this file or its fixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../assets/perfect-city-engine-adapter.js');
const core = require('../assets/perfect-city-core.js');
const golden = JSON.parse(readFileSync(new URL('./fixtures/perfect-city-made-up/golden.json', import.meta.url), 'utf8'));
const radii = golden.radii_km;

// The page's own shapes: only the units of the one county (in_place), fields as in assets/perfect-city/<county>.census.js
// (id, rings, pop, km2, density, income, centre). dp = decimals to round vertices to (null = the fixture's full precision).
function pageData(dp) {
  const q = (v) => (dp == null ? v : Number(v.toFixed(dp)));
  return { units: golden.units.filter((u) => u.in_place).map((u) => ({
    id: u.id, pop: u.pop, km2: u.area_km2, density: null, income: u.income, centre: u.centroid,
    rings: u.rings.map((r) => r.map((p) => [q(p[0]), q(p[1])])) })) };
}
// The server's places: name, lat, lon only (no county filter here, the fixture's points are already the kept ones).
const serverPoints = golden.points.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));
const peopleOk = (got, want) => Math.abs(got - want) <= Math.max(0.02 * want, 30);   // the golden tolerance for people_est

// opts.dist: a planted distance function; opts.centre: count people by block group centre (the old page method).
function check(page, opts = {}) {
  const bad = [];
  for (const c of golden.cases) {
    const out = A.toEngineNumbers(page, c.click, radii, serverPoints);
    if (out.click_block_group !== c.click_block_group) bad.push(c.name + ' bg');
    if (opts.dist && Math.abs(Math.min(...serverPoints.map((p) => opts.dist(c.click, p))) - c.nearest_km) > 0.00005) bad.push(c.name + ' nearest_km (planted distance)');
    if (Math.abs(out.nearest_km - c.nearest_km) > 0.00015) bad.push(c.name + ' nearest_km');
    c.nearest.forEach((n, i) => { if (out.nearest[i].name !== n.name || Math.abs(out.nearest[i].km - n.km) > 0.00015) bad.push(c.name + ' nearest[' + i + ']'); });
    for (const r of radii) {
      const k = String(r);
      if (out.within[k] !== c.within[k]) bad.push(c.name + ' within ' + k);
      const got = opts.centre ? core.peopleWithin(c.click, page.units.map((u) => ({ pop: u.pop, centre: u.centre })), [r])[0].about : out.people_est[k];
      if (!peopleOk(got, c.people_est[k])) bad.push(c.name + ' people ' + k + ' ' + got + ' vs ' + c.people_est[k]);
      if (Math.abs(c.county_edge_km - r) >= 0.01 && out.ring_leaves_place[k] !== c.ring_leaves_place[k]) bad.push(c.name + ' ring ' + k);
    }
    if (Math.abs(out.county_edge_km - c.county_edge_km) > 0.002) bad.push(c.name + ' county_edge_km');
    if (out.nearest_may_miss_across_edge !== c.nearest_may_miss_across_edge) bad.push(c.name + ' may_miss');
  }
  return bad;
}

test('full-precision page shapes reproduce the golden file (distances, counts, ring flags, people within tolerance)', () => {
  assert.equal(golden.cases.length, 9);
  assert.deepEqual(check(pageData(null)), []);
});

test('the area passed for sharing people is the page\'s own flat local area of the same rings, holes subtracting', () => {
  const page = pageData(null), spot = golden.cases[0].click;
  assert.ok(page.units.some((u) => u.rings.length > 1), 'the fixture must hold a block group with a hole');
  for (const u of page.units) {
    let want = 0;                                                      // core.js's own arithmetic, written out the way peopleWithinArea does it
    const kx = Math.PI / 180 * 6371.0088 * Math.cos(spot[1] * Math.PI / 180), ky = Math.PI / 180 * 6371.0088;
    u.rings.forEach((ring, i) => {
      const hole = u.rings.some((o, j) => j !== i && core.inRing(ring[0], o));
      want += (hole ? -1 : 1) * core.shoelace(ring.slice(0, -1).map((p) => [(p[0] - spot[0]) * kx, (p[1] - spot[1]) * ky]));
    });
    assert.ok(Math.abs(A.pageAreaKm2(u, spot) - want) < 1e-9, u.id);
    const trueKm2 = golden.units.find((g) => g.id === u.id).area_km2;
    assert.ok(Math.abs(A.pageAreaKm2(u, spot) / trueKm2 - 1) < 0.01, 'flat local area within 1 per cent of the true area: ' + u.id);
  }
});

test('simplified to 4 decimals: measured difference from the golden file stays under a stated bound (not equality)', () => {
  const page = pageData(4);
  const m = { nearest: 0, edge: 0, within: 0, ring: 0, peopleRel: 0, bg: 0 };
  for (const c of golden.cases) {
    const out = A.toEngineNumbers(page, c.click, radii, serverPoints);
    m.nearest = Math.max(m.nearest, Math.abs(out.nearest_km - c.nearest_km));
    m.edge = Math.max(m.edge, Math.abs(out.county_edge_km - c.county_edge_km));
    if (out.click_block_group !== c.click_block_group) m.bg++;
    for (const r of radii) {
      const k = String(r);
      m.within = Math.max(m.within, Math.abs(out.within[k] - c.within[k]));
      if (out.ring_leaves_place[k] !== c.ring_leaves_place[k]) m.ring++;
      m.peopleRel = Math.max(m.peopleRel, Math.abs(out.people_est[k] - c.people_est[k]) / Math.max(c.people_est[k], 100));  // relative to the golden, floor 100 people
    }
  }
  console.log('simplified-to-4-decimals measured:', JSON.stringify(m));
  // Measured 11-27: nearest 0 km, edge 0.0028 km, within 0, ring flips 0, people 1.8 per cent (of the golden, floor 100 people), 1 click moved to the next block group.
  assert.equal(m.nearest, 0);                  // points are not simplified, so distances are unchanged
  assert.ok(m.edge < 0.006, 'edge ' + m.edge);   // 4 decimals is about 11 m of vertex movement
  assert.ok(m.within <= 1, 'within ' + m.within);
  assert.ok(m.ring <= 1, 'ring flips ' + m.ring);
  assert.ok(m.peopleRel < 0.03, 'people ' + m.peopleRel);
  assert.ok(m.bg <= 1, 'block group changes ' + m.bg);
});

test('page units with a missing population add nothing, and an empty server answer gives no places', () => {
  const page = pageData(null);
  const out = A.toEngineNumbers(page, golden.cases[0].click, radii, []);
  assert.equal(out.nearest_km, null);
  assert.deepEqual(out.nearest, []);
  assert.ok(out.people_est['5'] > 0);
});

// A REAL planted fault: the geodesy module's own source with the ellipsoid distance replaced by a haversine, loaded as a second module
// and handed to the adapter; the golden comparison must fail on it (and must pass on the untouched module).
function plantedGeodesy() {
  const src = readFileSync(new URL('../assets/perfect-city-geodesy.js', import.meta.url), 'utf8');
  const marker = 'function ellipsoidDistanceKm(lon1, lat1, lon2, lat2) { return inverse(lon1, lat1, lon2, lat2).m / 1000; }';
  assert.ok(src.includes(marker), 'the line to plant into moved: update this test');
  const hav = 'function ellipsoidDistanceKm(lon1, lat1, lon2, lat2) { const r = Math.PI / 180; const s = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2; return 2 * 6371.0088 * Math.asin(Math.sqrt(s)); }';
  const m = { exports: {} };
  new Function('module', 'exports', 'self', src.replace(marker, hav))(m, m.exports, undefined);
  return m.exports;
}

test('must-fail: a REAL haversine planted into the geodesy module is caught by the golden comparison', () => {
  const page = pageData(null);
  const planted = plantedGeodesy();
  let bad = 0;
  for (const c of golden.cases) {
    const out = A.toEngineNumbers(page, c.click, radii, serverPoints, planted);
    if (out.nearest_km != null && Math.abs(out.nearest_km - c.nearest_km) > 0.00015) bad++;
  }
  assert.ok(bad > 0, 'the planted haversine must move at least one nearest_km beyond the golden tolerance');
  // control: the untouched module passes the same comparison
  assert.deepEqual(check(page), []);
});

test('a click that is not two finite numbers returns null, never NaN (a string is refused, not dropped)', () => {
  const page = pageData(null);
  const click = golden.cases[0].click;
  assert.equal(A.toEngineNumbers(page, [NaN, click[1]], radii, serverPoints), null);
  assert.equal(A.toEngineNumbers(page, [click[0], Infinity], radii, serverPoints), null);
  assert.equal(A.toEngineNumbers(page, [String(click[0]), click[1]], radii, serverPoints), null);
  assert.equal(A.toEngineNumbers(page, [click[0]], radii, serverPoints), null);
  assert.equal(A.toEngineNumbers(page, click, [], serverPoints), null);
  assert.equal(A.toEngineNumbers(page, click, [1, NaN], serverPoints), null);
  assert.equal(A.toEngineNumbers(null, click, radii, serverPoints), null);
  assert.notEqual(A.toEngineNumbers(page, click, radii, serverPoints), null);
});

test('must-fail: counting people by block group centre (the old page method) is caught', () => {
  assert.notDeepEqual(check(pageData(null), { centre: true }), []);
});
