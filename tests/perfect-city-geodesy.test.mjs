// Perfect City geodesy: reproduces the Ryagram engine's golden numbers (made-up place, nothing real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../assets/perfect-city-geodesy.js');
const golden = JSON.parse(readFileSync(new URL('./fixtures/perfect-city-made-up/golden.json', import.meta.url), 'utf8'));
const place = { units: golden.units };
const radii = golden.radii_km;

const peopleOk = (got, want) => Math.abs(got - want) <= Math.max(0.02 * want, 30);

// opts.radii / opts.dist let a must-fail plant a fault.
function check(opts = {}) {
  const bad = [];
  const rr = opts.radii || radii;
  for (const c of golden.cases) {
    const out = G.computeNumbers(place, c.click, rr, golden.points);
    if (out.click_block_group !== c.click_block_group) bad.push(c.name + ' bg');
    if (opts.dist) {
      const sp = golden.points.map((p) => opts.dist(c.click, p));
      if (Math.abs(Math.min(...sp) - c.nearest_km) > 0.00005) bad.push(c.name + ' nearest_km (planted distance)');
    }
    if (Math.abs(out.nearest_km - c.nearest_km) > 0.00015) bad.push(c.name + ' nearest_km');
    c.nearest.forEach((n, i) => { if (out.nearest[i].name !== n.name || Math.abs(out.nearest[i].km - n.km) > 0.00015) bad.push(c.name + ' nearest[' + i + ']'); });
    for (const r of radii) {
      const k = String(r);
      if (out.within[k] !== c.within[k]) bad.push(c.name + ' within ' + k);
      if (!peopleOk(out.people_est[k], c.people_est[k])) bad.push(c.name + ' people ' + k + ' ' + out.people_est[k] + ' vs ' + c.people_est[k]);
      if (Math.abs(c.county_edge_km - r) >= 0.01 && out.ring_leaves_place[k] !== c.ring_leaves_place[k]) bad.push(c.name + ' ring ' + k);
    }
    if (Math.abs(out.county_edge_km - c.county_edge_km) > 0.002) bad.push(c.name + ' county_edge_km');
    if (out.nearest_may_miss_across_edge !== c.nearest_may_miss_across_edge) bad.push(c.name + ' may_miss');
  }
  return bad;
}

test('nine golden clicks reproduce the engine within the golden tolerance', () => {
  assert.equal(golden.cases.length, 9);
  assert.deepEqual(check(), []);
});

test('distance: ellipsoid matches golden to 4 decimals', () => {
  let maxDiff = 0;
  for (const c of golden.cases) for (const n of c.nearest) maxDiff = Math.max(maxDiff, Math.abs(G.ellipsoidDistanceKm(c.click[0], c.click[1], n.lon, n.lat) - n.km));
  assert.ok(maxDiff < 0.00006, 'max diff ' + maxDiff);
  assert.equal(G.ellipsoidDistanceKm(10, 20, 10, 20), 0);
  assert.ok(Math.abs(G.ellipsoidDistanceKm(0, 0, 0, 90) - 10001.965729) < 1e-4);      // WGS84 quarter meridian
  assert.ok(Math.abs(G.ellipsoidDistanceKm(0, 0, 90, 0) - 10018.754171) < 1e-4);      // quarter of the equator
  const near = G.ellipsoidDistanceKm(0, 0, 179.9, 0.1);                                // near antipodal: falls back, stays finite
  assert.ok(Number.isFinite(near) && near > 19000);
});

test('must-fail: a planted wrong radius is caught', () => {
  assert.notDeepEqual(check({ radii: [1.1, 2, 5] }), []);
});

test('must-fail: haversine on a sphere is caught', () => {
  const hav = (a, p) => {
    const r = Math.PI / 180;
    const s = Math.sin((p.lat - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(p.lat * r) * Math.sin((p.lon - a[0]) * r / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.sqrt(s));
  };
  assert.notDeepEqual(check({ dist: hav }), []);
});
