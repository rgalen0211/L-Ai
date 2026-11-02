// NEXT-WEB 201: the JSON contract "ryagram.site-comparison/0" between the website page and ENGINE's geo module (Ryagram ryagram/geo/catchment.py + compare.py, branch geo-catchment-1102).
// tests/fixtures/geo-site-comparison-demo.json is ENGINE's own output (tools/make-geo-fixture.py) for the SYNTHETIC inputs in tests/fixtures/geo-demo-inputs.json. The page's JavaScript must give the same
// values, labels, sources and notes for the same inputs, and the validator must accept the real thing and refuse every kind of damage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/geo-catchment.js'), { window: win });
const G = win.ryagramGeo, J = x => JSON.parse(JSON.stringify(x));
const inp = JSON.parse(read('tests/fixtures/geo-demo-inputs.json')), want = JSON.parse(read('tests/fixtures/geo-site-comparison-demo.json'));
const mine = () => J(G.compareSites(inp.sites, inp.radii_m, inp.areas, inp.points, inp.categories, { areaSource: inp.area_source, pointSource: inp.point_source, snapshot: inp.snapshot }));

test('the page\'s maths gives EXACTLY what ENGINE\'s code gave for the same synthetic inputs: structure, values, labels, sources and notes', () => {
  assert.deepEqual(mine(), want);
});

test('the inputs are plainly synthetic and the expected file says what it is', () => {
  assert.match(inp.note, /SYNTHETIC/); assert.equal(inp.snapshot, 'synthetic'); assert.match(inp.area_source, /Synthetic/);
  assert.equal(want.schema, 'ryagram.site-comparison/0'); assert.equal(want.ranking, null);
  assert.ok(inp.areas.length >= 20 && inp.points.length >= 30);
  assert.ok(!/(Dayton|Montgomery|Census|OpenStreetMap)/.test(JSON.stringify(inp.areas.map(a => a.id)) + JSON.stringify(inp.points.map(p => p.id))));
});

test('labels follow the rules: residents and income are Estimated (an even spread is assumed), counts and distances are Calculated, a difference carries the weaker label', () => {
  for (const s of want.sites) {
    for (const r of Object.values(s.rings)) { assert.equal(r.residents.label, 'Estimated'); assert.equal(r.income_range.label, 'Estimated'); assert.match(r.residents.note, /spread evenly/); for (const c of Object.values(r.counts)) assert.equal(c.label, 'Calculated'); }
    for (const n of Object.values(s.nearest)) assert.equal(n.label, 'Calculated');
  }
  for (const d of Object.values(want.differences)) { assert.equal(d.residents.label, 'Estimated'); for (const c of Object.values(d.counts)) assert.equal(c.label, 'Calculated'); }
  assert.ok(want.notes.some(n => /no score and no 'better' site/.test(n)) && want.notes.some(n => /not drive times/.test(n)));
});

test('the validator accepts ENGINE\'s file and the page\'s own output, and refuses each kind of damage in plain words', () => {
  assert.deepEqual(J(G.validateComparison(want)), []); assert.deepEqual(J(G.validateComparison(mine())), []);
  const broke = fn => { const c = J(want); fn(c); return G.validateComparison(c); };
  assert.match(broke(c => { c.schema = 'other/1'; })[0], /schema is not/);
  assert.ok(broke(c => { c.ranking = ['A', 'B']; }).some(m => /ranking must be null/.test(m)), 'a winner is refused');
  assert.ok(broke(c => { c.sites[0].rings['2000'].residents.label = 'Guaranteed'; }).some(m => /not a labelled result/.test(m)), 'a made-up label is refused');
  assert.ok(broke(c => { delete c.sites[1].rings['1000']; }).some(m => /no ring 1000/.test(m)));
  assert.ok(broke(c => { delete c.sites[0].nearest.burger; }).some(m => /no labelled nearest for burger/.test(m)));
  assert.ok(broke(c => { c.sites = c.sites.slice(0, 1); }).some(m => /fewer than two sites/.test(m)));
  assert.ok(broke(c => { delete c.differences['4000']; }).some(m => /no labelled difference/.test(m)));
  assert.ok(broke(c => { c.radii_m = []; }).some(m => /radii_m/.test(m)));
  assert.deepEqual(J(G.validateComparison(null)), ['not an object']); assert.ok(G.validateComparison('x').length > 0);
});

test('the rules of the maths: swapping the sites flips every difference, the same site twice differs by nothing, a missing figure is left out and named, never zero', () => {
  const a = inp.sites[0], b = inp.sites[1];
  const ab = G.compareSites([a, b], [2000], inp.areas, inp.points, inp.categories, {}), ba = G.compareSites([b, a], [2000], inp.areas, inp.points, inp.categories, {});
  assert.equal(ab.differences['2000'].residents.value + 0, -ba.differences['2000'].residents.value + 0);
  for (const c of inp.categories) assert.equal(ab.differences['2000'].counts[c].value + 0, -ba.differences['2000'].counts[c].value + 0);
  const same = G.compareSites([a, { ...a, id: 'A2' }], [2000], inp.areas, inp.points, inp.categories, {});
  assert.equal(same.differences['2000'].residents.value, 0);
  const holes = inp.areas.map((x, i) => (i === 14 ? { ...x, population: null } : x));
  const withHole = G.residentsInside({ id: 'X', lon: inp.sites[0].lon, lat: inp.sites[0].lat }, 4000, holes, {}), full = G.residentsInside({ id: 'X', lon: inp.sites[0].lon, lat: inp.sites[0].lat }, 4000, inp.areas, {});
  assert.ok(withHole.value < full.value && /no published figure and are left out, not counted as zero/.test(withHole.note), 'one area without a figure is left out and the note says so');
  assert.equal(G.nearest(a, [], { category: 'chicken' }).value, null);
  assert.throws(() => G.compareSites([a], [1000], [], [], []), /at least two sites/); assert.throws(() => G.compareSites([a, a], [1000], [], [], []), /share an id/); assert.throws(() => G.circle(a, 0), /radius above zero/);
});

test('Python rounding is matched on the half (round half to even), so the two languages cannot disagree by one person', () => {
  assert.equal(G.pyRound(0.5), 0); assert.equal(G.pyRound(1.5), 2); assert.equal(G.pyRound(2.5), 2); assert.equal(G.pyRound(2.4999), 2); assert.equal(G.pyRound(3.5), 4); assert.equal(G.pyRound(1766.94, 1), 1766.9);
});

test('the fixture generator exists and says how to check it, and the expected file is what it would write', () => {
  const py = read('tools/make-geo-fixture.py');
  assert.match(py, /compare_sites/); assert.match(py, /--check/); assert.match(py, /geo-site-comparison-demo\.json/);
  assert.ok(fs.existsSync(new URL('../tests/fixtures/geo-site-comparison-demo.json', import.meta.url)));
});
