// NEXT-WEB 205: City Anatomy on the geo demo page: ENGINE's access share (Ryagram ryagram/geo/anatomy.py, NEXT-ENGINE 75) as a shaded layer with a category picker. The page's JavaScript is a port; this proves it
// gives ENGINE's own output (tests/fixtures/geo-city-anatomy-demo.json, written by tools/make-geo-fixture.py over the SYNTHETIC inputs) and that the rules hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/geo-catchment.js'), { window: win });
const G = win.ryagramGeo, J = x => JSON.parse(JSON.stringify(x));
const inp = JSON.parse(read('tests/fixtures/geo-demo-inputs.json')), want = JSON.parse(read('tests/fixtures/geo-city-anatomy-demo.json'));
const run = (cat, m) => J(G.accessShare(inp.areas, inp.points, cat, m, { areaSource: inp.area_source, pointSource: inp.point_source, snapshot: inp.snapshot }));

test('the page\'s maths gives EXACTLY ENGINE\'s access share for every category and distance: value, label, source, note, per-area flags and distances (centres to the sixth decimal)', () => {
  let n = 0;
  for (const [cat, byMiles] of Object.entries(want.results)) for (const [m, w] of Object.entries(byMiles)) {
    const got = run(cat, Number(m)); n++;
    const strip = r => ({ ...r, by_area: r.by_area.map(a => ({ ...a, centre: undefined })) });
    assert.deepEqual(strip(got), strip(w), `${cat} at ${m} mile(s)`);
    got.by_area.forEach((a, i) => { assert.ok(Math.abs(a.centre[0] - w.by_area[i].centre[0]) < 2e-6 && Math.abs(a.centre[1] - w.by_area[i].centre[1]) < 2e-6, `${cat} ${m} centre ${a.id}`); });
  }
  assert.equal(n, 10);
});

test('the rules: nothing listed gives NO value (never 0 percent) and says why; more miles never lowers the share; the share is a whole-block-group definition so 100 means every counted block group has access', () => {
  const none = run('nothing_listed', 1);
  assert.equal(none.share.value, null); assert.match(none.share.note, /not the same as none existing, so there is no percentage/); assert.equal(none.points_listed, 0); assert.ok(none.by_area.every(a => a.has_access === null));
  for (const cat of ['chicken', 'burger', 'retail']) { const v = [0.5, 1, 2].map(m => run(cat, m).share.value); assert.ok(v[0] <= v[1] && v[1] <= v[2], `${cat}: ${v}`); }
  assert.equal(run('burger', 2).share.value, 100);
  assert.throws(() => G.accessShare(inp.areas, inp.points, 'chicken', 0), /above zero miles/); assert.throws(() => G.accessShare(inp.areas, inp.points, 'chicken', -1), /above zero miles/);
  const sq = [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]], c = G.centroid(sq); assert.ok(Math.abs(c[0] - 0.01) < 1e-9 && Math.abs(c[1] - 0.01) < 1e-9, 'a square\'s centre');
});

test('a block group with no figure is named and left out of both sides, never counted as zero; the share is the people with access over the people counted', () => {
  const areas = [{ id: 'a', ring: [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]], population: 100 }, { id: 'b', ring: [[0.5, 0.5], [0.51, 0.5], [0.51, 0.51], [0.5, 0.51]], population: 300 }, { id: 'c', ring: [[0, 0.5], [0.01, 0.5], [0.01, 0.51], [0, 0.51]], population: null }];
  const pts = [{ id: 'p', lon: 0.005, lat: 0.005, category: 'x' }];
  const r = J(G.accessShare(areas, pts, 'x', 1, {}));
  assert.equal(r.share.value, 25); assert.deepEqual(r.missing, ['c']); assert.match(r.share.note, /1 block group\(s\) with no published figure are left out of both sides, not counted as zero/);
  assert.deepEqual(r.by_area.map(a => a.has_access), [true, false, false]);
});

test('the validator accepts ENGINE\'s results and refuses a share out of range, a wrong schema, a missing label, a missing reason, and zero percent with nothing listed', () => {
  for (const byMiles of Object.values(want.results)) for (const r of Object.values(byMiles)) assert.deepEqual(J(G.validateAnatomy(r)), []);
  const ok = J(want.results.chicken['1']), bad = fn => { const o = J(ok); fn(o); return J(G.validateAnatomy(o)); };
  assert.ok(bad(o => { o.schema = 'x'; })[0].match(/schema is not/)); assert.ok(bad(o => { o.share.value = 130; }).some(m => /not a percentage/.test(m)));
  assert.ok(bad(o => { o.share.label = 'Guaranteed'; }).some(m => /not a labelled result/.test(m))); assert.ok(bad(o => { o.miles = 0; }).some(m => /miles/.test(m)));
  assert.ok(bad(o => { o.by_area = []; }).some(m => /no areas/.test(m))); assert.ok(bad(o => { o.by_area[0].has_access = 'yes'; }).some(m => /access flag/.test(m)));
  assert.ok(bad(o => { o.share.value = null; o.share.note = 'x'; }).some(m => /must say why/.test(m))); assert.ok(bad(o => { o.share.value = 0; o.points_listed = 0; }).some(m => /zero percent with nothing listed/.test(m)));
  assert.deepEqual(J(G.validateAnatomy(null)), ['not an object']);
});

test('the fixture generator writes both files and checks both', () => {
  const py = read('tools/make-geo-fixture.py'); assert.match(py, /access_share/); assert.match(py, /geo-city-anatomy-demo\.json/); assert.match(py, /adest\.exists\(\)/);
  assert.match(want.note, /SYNTHETIC/);
});
