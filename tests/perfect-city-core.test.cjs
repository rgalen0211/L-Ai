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

// CC1 11-27 09:15 MEDIUM: the share of a block group inside a ring must be measured against the SAME (simplified) shape the
// page clips, never against the exported km2 (the full shape's true area, kept for the density figure). Check: for every unit
// in both counties, a circle that covers the whole unit gives back exactly its pop. The pop is scaled by 1e6 so the rounding
// to the nearest 100 cannot hide a share of a few percent.
const COVER_SCALE = 1e6;
function coverCheck(core, county) {
  const win = {};
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'perfect-city', `${county}.census.js`), 'utf8'), { window: win });
  const bad = [];
  let n = 0;
  for (const u of win.ryagramPerfectCityData[county].units) {
    if (!u.pop) continue;
    let far = 0;
    for (const ring of u.rings) for (const p of ring) far = Math.max(far, core.km(u.centre, p));
    const r = far * 1.02 + 0.05;              // covers every vertex, with room for the 96-sided circle and the flat projection
    const got = core.peopleWithinArea(u.centre, [{ ...u, pop: u.pop * COVER_SCALE }], [r])[0].about / COVER_SCALE;
    n++;
    if (Math.abs(got - u.pop) > 0.001) bad.push(`${u.id}: ${got} vs ${u.pop}`);
  }
  return { n, bad };
}
for (const county of ['montgomery_oh', 'greene_oh']) {
  test(`${county}: a circle covering a whole block group gives back exactly its people, for every block group (CC1 09:15)`, () => {
    const { n, bad } = coverCheck(pc, county);
    assert.ok(n > 100, `${n} units checked`);
    assert.deepEqual(bad, []);
  });
}
test('MUST-FAIL: a core that shares a block group by its full-shape km2 instead of the simplified shape fails the covering check', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'perfect-city-core.js'), 'utf8');
  const was = 'total += u.pop * Math.min(1, inside / full);';
  assert.equal(src.split(was).length, 2, 'the line the fault is planted on is there exactly once');
  const mutant = src.replace(was, 'total += u.pop * Math.min(1, inside / u.km2);');
  const box = { module: { exports: {} } };
  require('node:vm').runInNewContext(mutant, box);
  const core = box.module.exports;
  assert.equal(typeof core.peopleWithinArea, 'function', 'the mutant loaded');
  for (const county of ['montgomery_oh', 'greene_oh']) {
    const { n, bad } = coverCheck(core, county);
    assert.ok(n > 100, `${county}: ${n} units checked`);
    assert.ok(bad.length > n / 4, `${county}: the full-shape area must break many units (got ${bad.length} of ${n})`);
  }
});

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
  assert.equal(page.KINDS.sandwich, 'Sandwich places'); assert.equal(page.KINDS.mexican, 'Mexican places'); assert.equal(page.KINDS.asian, 'Asian places');
  // the export tool writes the same kinds: its base KINDS plus the sub-kinds copied from the Ryagram engine, in the engine's order (first match wins)
  const py = fs.readFileSync(path.join(__dirname, '..', 'tools', 'perfect-city', 'export_perfect_city.py'), 'utf8');
  const base = [...py.match(/^KINDS = \{(.*)\}$/m)[1].matchAll(/'([a-z_]+)': \(/g)].map((m) => m[1]);
  const subs = [...py.matchAll(/^ {4}\{"id": "([a-z_]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(subs, ['chicken', 'burger', 'pizza', 'sandwich', 'mexican', 'asian']);
  const fdicKind = py.match(/^FDIC_KIND = '([a-z_]+)'$/m);      // bank branches: the FDIC Summary of Deposits, not OpenStreetMap
  assert.ok(fdicKind, 'the export names its FDIC kind');
  assert.deepEqual([...base, ...subs, fdicKind[1]].sort(), table, 'the export tool writes only kinds the table accepts');
  // every food sub-kind says what its rule misses under the results; asian says independents are often untagged, so undercounted; bank says its list's limit
  assert.deepEqual(Object.keys(page.KIND_LIMITS), [...subs, 'bank']);
  for (const k of subs) assert.ok(page.KIND_LIMITS[k].startsWith(page.KINDS[k] + ' are sorted by'), k);
  assert.match(page.KIND_LIMITS.asian, /Independent places are often not tagged with a cuisine, so Asian places are undercounted\./);
  assert.match(page.KIND_LIMITS.asian, /Indian places are not counted here\./);
  for (const k of ['sandwich', 'mexican']) assert.match(page.KIND_LIMITS[k], /checked in the order chicken, burger, pizza, sandwich, Mexican, Asian/, k);
  // the refusal sentence names every kind the check accepts
  const refusal = sql.match(/'Choose a kind this county has: ([^(]*) \(grocery in montgomery_oh only\)\.'/);
  assert.ok(refusal, 'the refusal sentence');
  assert.deepEqual(refusal[1].replace(' or ', ', ').split(', ').sort(), table.filter((k) => k !== 'grocery'));
  // the page mock (tests/fake-supabase.js) accepts the same kinds and refuses in the same words
  const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
  const fakeKinds = fake.match(/const KINDS_OK = \[([^\]]*)\]/);
  assert.ok(fakeKinds, 'the mock names its kinds');
  assert.deepEqual(fakeKinds[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort(), table, 'the mock accepts exactly the server kinds');
  assert.ok(fake.includes(`fail('Choose a kind this county has: ${refusal[1]} (grocery in montgomery_oh only).')`), 'the mock refuses in the server\'s words');
});

// Bank branches (GEO 11-27): FDIC Summary of Deposits (public domain), NOT OpenStreetMap, so the credit, the not-known line and the official line follow the kind.
const FDIC_CREDIT = 'Bank branches: FDIC Summary of Deposits, June 30, 2026';
const OSM_CREDIT = 'Map data (c) OpenStreetMap contributors (ODbL)';
function pageModule() {
  const win = {};
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-perfect-city.js'), 'utf8'), { window: win });
  return win.ryagramPerfectCityPage;
}

test('bank branches: offered in both counties, labelled, with the FDIC limits line', () => {
  const page = pageModule();
  assert.equal(page.KINDS.bank, 'Bank branches');
  for (const c of page.COUNTIES) assert.ok(c.kinds.includes('bank'), c.id);
  assert.equal(page.KIND_LIMITS.bank, 'FDIC-insured bank branches only. Credit unions are not included.');
});

test('the credit switches by kind: FDIC for bank branches, OpenStreetMap for every other kind (server, mock and page agree)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261127000900_perfect_city_places.sql'), 'utf8').replace(/\r\n/g, '\n');
  // the page's answer and the AI summary's credits both pick the credit by kind; no fixed OpenStreetMap credit is left in either
  assert.ok(sql.includes(`'credit', case when p_kind = 'bank' then '${FDIC_CREDIT}' else '${OSM_CREDIT}' end,`), 'the places answer picks its credit by kind');
  assert.ok(sql.includes(`case when p_kind = 'bank' then '${FDIC_CREDIT}'\n           else '${OSM_CREDIT}' end));`), 'the AI summary picks its credit by kind');
  assert.equal(sql.split(`'${OSM_CREDIT}'`).length - 1, 2, 'the OpenStreetMap credit appears only in the two by-kind choices');
  assert.match(sql, /case when p_kind = 'bank' then 'The bank branches come from the FDIC Summary of Deposits/, 'the AI summary\'s not-known line follows the kind');
  // the mock answers like the server
  const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
  assert.ok(fake.includes(`const credit = args.p_kind === 'bank' ? '${FDIC_CREDIT}' : '${OSM_CREDIT}';`), 'the mock picks the credit by kind');
  // the page links OpenStreetMap's copyright page for an OpenStreetMap credit only, and swaps the OpenStreetMap not-known line for the FDIC one
  const page = pageModule();
  assert.equal(page.creditLinked(OSM_CREDIT), true);
  assert.equal(page.creditLinked(FDIC_CREDIT), false);
  assert.equal(page.creditLinked(''), false);
  const bank = page.notKnownFor('bank'), food = page.notKnownFor('fast_food');
  assert.equal(bank.length, food.length);
  assert.ok(food.some((t) => /OpenStreetMap/.test(t)));
  assert.ok(!bank.some((t) => /OpenStreetMap/.test(t)), 'no OpenStreetMap line for bank branches');
  assert.ok(bank.includes(page.WORDS.notKnownBank) && /FDIC Summary of Deposits/.test(page.WORDS.notKnownBank));
  assert.deepEqual([...page.notKnownFor('chicken')], [...food]);
});

test('the official line for bank branches is said in plain words, with no industry code', () => {
  const page = pageModule();
  assert.equal(page.OFFICIAL_PLAIN.bank, 'bank offices');
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-perfect-city.js'), 'utf8');
  assert.ok(src.includes("`The Census Bureau's count of ${OFFICIAL_PLAIN[state.kind]} in this county is ${n} (observed, County Business Patterns ${o.year}); ${m}.`"));
  const plain = src.slice(src.indexOf('if (OFFICIAL_PLAIN[state.kind]) {'), src.indexOf('const name = OFFICIAL_KIND[state.kind]'));
  assert.ok(plain.length > 0 && !/NAICS|naics/.test(plain), 'the plain-words branch shows no code');
});

// The export's SUBKINDS are a COPY of rows in the Ryagram engine's ryagram/geo/categories.py DEFAULT. With RYAGRAM_ENGINE set to a Ryagram checkout,
// every row must equal the engine's (requires, tags, match, cuisine, brands) and keep the engine's relative order.
const ENGINE = process.env.RYAGRAM_ENGINE;
test('the export\'s sub-kind rules equal the Ryagram engine\'s categories.py rows, in its order', { skip: !ENGINE && 'RYAGRAM_ENGINE not set: SKIPPED, not passed' }, () => {
  const cat = fs.readFileSync(path.join(ENGINE, 'ryagram', 'geo', 'categories.py'), 'utf8');
  const py = fs.readFileSync(path.join(__dirname, '..', 'tools', 'perfect-city', 'export_perfect_city.py'), 'utf8');
  const rows = (text) => {
    const out = new Map();
    for (const m of text.matchAll(/^ {4}\{"id": "([a-z_]+)"([\s\S]*?)\}(?:,|\n)/gm)) {
      const body = m[2], grab = (re) => { const g = body.match(re); return g ? g[1] : null; };
      out.set(m[1], { requires: grab(/"requires": (\[.*?\]), "tags"/), tags: grab(/"tags": (\[.*?\]), "(?:match|cuisine)"/), match: grab(/"match": "([a-z]+)"/),
        cuisine: grab(/"cuisine": (\[[^\]]*\])/), brands: grab(/"brands": (\[[^\]]*\])/) });
    }
    return out;
  };
  const mine = rows(py), theirs = rows(cat);
  const ids = [...mine.keys()];
  assert.deepEqual(ids, ['chicken', 'burger', 'pizza', 'sandwich', 'mexican', 'asian']);
  assert.deepEqual([...theirs.keys()].filter((k) => mine.has(k)), ids, 'the engine has every sub-kind, in the same relative order');
  for (const k of ids) {
    assert.ok(theirs.get(k).cuisine && theirs.get(k).brands, `${k}: the engine row was read`);
    assert.deepEqual(mine.get(k), theirs.get(k), `${k}: the export's rule is the engine's`);
  }
});
