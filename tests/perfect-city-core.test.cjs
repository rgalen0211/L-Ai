// Perfect City arithmetic (GEO 11-27): distances, rings, people within rings, bands, and the real Census page data.
// Points here are INVENTED test points (never OpenStreetMap data: that stays out of the repo, attorney row G11).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pc = require('../assets/perfect-city-core.js');

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('km: one degree of latitude is 111.19 km; distance is symmetric; zero to itself', () => {
  near(pc.km([0, 0], [0, 1]), 111.195, 0.01);
  near(pc.km([-84.19, 39.76], [-83.93, 39.68]), pc.km([-83.93, 39.68], [-84.19, 39.76]), 1e-9);
  assert.equal(pc.km([-84, 39], [-84, 39]), 0);
});

test('nearest and counts within 1, 2 and 5 km, on invented points', () => {
  const spot = [-84.2, 39.75];
  const dLat = (k) => k / 111.195;                         // km north of the spot
  const pts = [0.5, 1.5, 1.9, 3, 4.99, 7].map((k, i) => ({ name: `Test place ${i}`, lat: 39.75 + dLat(k), lon: -84.2 }));
  const n = pc.nearest(spot, pts, 3);
  assert.deepEqual(n.map((p) => p.name), ['Test place 0', 'Test place 1', 'Test place 2']);
  near(n[0].km, 0.5, 0.001);
  assert.deepEqual(pc.countsWithin(spot, pts).map((c) => [c.km, c.count, c.label]), [[1, 1, 'calculated'], [2, 3, 'calculated'], [5, 5, 'calculated']]);
});

test('people within a ring are ESTIMATED by block-group centre, rounded to 100, with the method in words', () => {
  const units = [{ pop: 1234, centre: [-84.2, 39.751] }, { pop: 900, centre: [-84.2, 39.77] }, { pop: null, centre: [-84.2, 39.75] }];
  const r = pc.peopleWithin([-84.2, 39.75], units, [1, 5]);
  assert.deepEqual(r.map((x) => [x.km, x.about, x.blockGroups, x.label]), [[1, 1200, 1, 'estimated'], [5, 2100, 2, 'estimated']]);
  assert.match(r[0].method, /centre is inside the ring/);
});

test('people within a ring, AREA-WEIGHTED: a block group fully inside counts in full, one cut in half counts half, a hole is left out', () => {
  // a 0.2 x 0.2 km square block group centred on the spot, 1,000 people: fully inside a 1 km ring
  const d = 0.1 / 111.195, sq = (x0, y0, w, h) => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]];
  const spot = [0, 0];
  const inside = { pop: 1000, centre: [0, 0], rings: [sq(-d, -d, 2 * d, 2 * d)] };
  assert.equal(pc.peopleWithinArea(spot, [inside], [1])[0].about, 1000);
  // a long strip from the spot eastwards, 4 km long: about a quarter of it lies inside a 1 km ring
  const strip = { pop: 4000, centre: [2 / 111.195, 0], rings: [sq(0, -d, 4 / 111.195, 2 * d)] };
  near(pc.peopleWithinArea(spot, [strip], [1])[0].about, 1000, 100);
  // the same square with a hole of a quarter of its area: the people still count once (the share is of the unit's own area)
  const holed = { pop: 1000, centre: [0, 0], rings: [sq(-d, -d, 2 * d, 2 * d), sq(-d / 2, -d / 2, d, d)] };
  assert.equal(pc.peopleWithinArea(spot, [holed], [1])[0].about, 1000);
  const r = pc.peopleWithinArea(spot, [inside], [1])[0];
  assert.equal(r.label, 'estimated'); assert.match(r.method, /spread evenly/);
});

test('area weighting matches the Ryagram engine (catchment.residents_inside) on real Census block groups: pinned from GEO\'s 11-27 check', () => {
  const win = {};
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'perfect-city', 'montgomery_oh.census.js'), 'utf8'), { window: win });
  const u = win.ryagramPerfectCityData.montgomery_oh.units;
  // 600 spot-ring pairs agreed within 50 people (the rounding to 100); two pinned here
  assert.deepEqual(pc.peopleWithinArea([-84.1916, 39.7589], u).map((x) => x.about), [3500, 13900, 104000]);
  assert.deepEqual(pc.peopleWithinArea([-84.2374, 39.7509], u).map((x) => x.about), [3400, 12900, 65100]);
});

test('point in a unit, with a hole', () => {
  const sq = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];
  const u = { rings: [sq(0, 0, 10), sq(4, 4, 2)] };
  assert.equal(pc.inUnit([1, 1], u), true);
  assert.equal(pc.inUnit([5, 5], u), false, 'inside the hole');
  assert.equal(pc.inUnit([11, 1], u), false);
});

test('bands: five equal-count bands; a missing value has no band', () => {
  const units = Array.from({ length: 10 }, (_, i) => ({ v: i + 1 }));
  const br = pc.bands(units, (u) => u.v);
  assert.deepEqual(br, [3, 5, 7, 9]);
  assert.equal(pc.band(1, br), 0); assert.equal(pc.band(10, br), 4); assert.equal(pc.band(null, br), -1);
});

test('projector: the bbox corners land inside the box and invert back', () => {
  const p = pc.projector([-84.5, 39.5, -84.0, 39.9], 600, 400);
  for (const c of [[-84.5, 39.5], [-84.0, 39.9], [-84.25, 39.7]]) {
    const [x, y] = p.fwd(c);
    assert.ok(x >= 0 && x <= 600 && y >= 0 && y <= 400);
    const back = p.inv([x, y]);
    near(back[0], c[0], 1e-9); near(back[1], c[1], 1e-9);
  }
});

for (const [county, pop, km2] of [['montgomery_oh', 537309, 1202.4], ['greene_oh', 167966, 1078.1]]) {
  test(`${county}: the Census page data adds up to the 2020 Census county total and the county area`, () => {
    const win = {};
    require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'perfect-city', `${county}.census.js`), 'utf8'), { window: win });
    const d = win.ryagramPerfectCityData[county];
    assert.equal(d.units.reduce((s, u) => s + u.pop, 0), pop, 'OBSERVED population total');
    near(d.units.reduce((s, u) => s + u.km2, 0), km2, 0.5);
    assert.match(d.sources.licence, /Public domain/);
    assert.match(d.sources.population, /OBSERVED/); assert.match(d.sources.income, /ESTIMATE/); assert.match(d.sources.calculated, /CALCULATED/);
    for (const u of d.units) {
      assert.match(u.id, /^39\d{10}$/);
      assert.ok(u.km2 > 0, u.id);
      assert.ok(u.income === null || (Array.isArray(u.income) && u.income[0] > 0), u.id);
    }
    // every block group's centre falls inside the county box
    const [x0, y0, x1, y1] = d.bbox;
    for (const u of d.units) assert.ok(u.centre[0] >= x0 && u.centre[0] <= x1 && u.centre[1] >= y0 && u.centre[1] <= y1, u.id);
  });
}

test('NO OpenStreetMap data in the repo: no file under assets/perfect-city carries OSM ids or the ODbL notice', () => {
  const dir = path.join(__dirname, '..', 'assets', 'perfect-city');
  for (const f of fs.readdirSync(dir)) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(t, /openstreetmap|ODbL|"osm_ref"|amenity/i, f);
  }
});

test('the page offers exactly the kinds the server allows, county by county (read from both files)', () => {
  const win = {};
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-perfect-city.js'), 'utf8'), { window: win });
  const page = JSON.parse(JSON.stringify(win.ryagramPerfectCityPage));      // out of the vm's realm, so deepEqual compares plain arrays
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261127000900_perfect_city_places.sql'), 'utf8');
  const list = (re) => { const m = sql.match(re); assert.ok(m, String(re)); return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort(); };
  const table = list(/kind text not null check \(kind in \(([^)]*)\)\)/);
  const check = list(/p_kind not in \(([^)]*)\)/);
  assert.deepEqual(check, table, 'the table check and perfect_city_check name the same kinds');
  const onlyMontgomery = [...sql.matchAll(/p_county = 'greene_oh' and p_kind = '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(onlyMontgomery, ['grocery']);
  const allowed = { montgomery_oh: table, greene_oh: table.filter((k) => !onlyMontgomery.includes(k)) };
  assert.deepEqual(page.COUNTIES.map((c) => c.id).sort(), Object.keys(allowed).sort());
  for (const c of page.COUNTIES) {
    assert.deepEqual([...c.kinds].sort(), allowed[c.id], c.id);
    for (const k of c.kinds) assert.ok(page.KINDS[k], `${k} has a label`);
  }
  assert.deepEqual(Object.keys(page.KINDS).sort(), table, 'a label for every server kind and no other');
  assert.equal(page.KINDS.chicken, 'Chicken places'); assert.equal(page.KINDS.burger, 'Burger places'); assert.equal(page.KINDS.pizza, 'Pizza places');
  // the export tool writes the same kinds: its base KINDS plus the sub-kinds copied from the Ryagram engine
  const py = fs.readFileSync(path.join(__dirname, '..', 'tools', 'perfect-city', 'export_perfect_city.py'), 'utf8');
  const base = [...py.match(/^KINDS = \{(.*)\}$/m)[1].matchAll(/'([a-z_]+)': \(/g)].map((m) => m[1]);
  const subs = [...py.matchAll(/^ {4}\{"id": "([a-z_]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(subs, ['chicken', 'burger', 'pizza']);
  assert.deepEqual([...base, ...subs].sort(), table, 'the export tool writes only kinds the table accepts');
});
