// ENGINE 2026-11-23: 18 catalog films fail the engine's own checks and 2 county bars did not finish. A stranger must not be offered any of them
// (their first sheet would end "checks failed"). The block list is ENGINE's JSON; the ONE committed copy is tools/data/engine-catalog-block-list-1123.json (v2, also read by tests/catalog-block-list.test.mjs and the generator).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ctx = { window: {}, document: undefined };
for (const f of ['app-catalog-data.js', 'app-templates.js', 'app-catalog.js', 'app-builder.js']) {
  try { vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', f), 'utf8'), ctx); } catch (e) { if (f !== 'app-builder.js') throw e; }
}
const K = ctx.window.ryagramCatalog;
const FIXTURE = path.join(root, 'tools', 'data', 'engine-catalog-block-list-1123.json');
const ENGINE_COPY = 'C:\\Users\\Ryan\\Ryagram-logs\\proposals\\ENGINE-CATALOG-BLOCK-LIST-1123-v2.json';
const full = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
// The site builds map, bars and line only: `fixture` is the part of ENGINE's v2 list the site can offer (paired, panel and shares are for the worker and the seed).
const SITE_VIEWS = ['map', 'bars', 'line'];
const fixture = Object.fromEntries(Object.entries(full).map(([id, vs]) => [id, vs.filter(v => SITE_VIEWS.includes(v))]).filter(([, vs]) => vs.length));
const pairs = o => Object.entries(o).flatMap(([id, views]) => views.map(v => `${id}/${v}`)).sort();
// what the site blocked before this list: not in ENGINE's JSON, kept as they were
const EARLIER = ['bls_state_unemployment/map', 'cbp_suppression/bars', 'state_obesity_fastfood/bars'];

test('the one committed list is ENGINE\'s v2: 58 pairs, of which 20 are the map/bars/line films the site could offer; ENGINE\'s file (parsed JSON) must be the same', () => {
  assert.equal(pairs(full).length, 58);
  assert.equal(pairs(fixture).length, 20);
  assert.equal(fs.existsSync(path.join(__dirname, 'fixtures', 'engine-catalog-block-list-1123.json')), false, 'a second committed copy came back: keep only tools/data/engine-catalog-block-list-1123.json');
  if (fs.existsSync(ENGINE_COPY)) assert.deepEqual(JSON.parse(fs.readFileSync(ENGINE_COPY, 'utf8')), full, 'ENGINE changed its list: copy it to tools/data and update app-catalog.js');
});

test('MEASURED.blocked holds every map/bars/line pair of the list, plus only the three earlier blocks (no drift either way)', () => {
  const blocked = Object.fromEntries(Object.entries(K.MEASURED.blocked).map(([id, o]) => [id, Object.keys(o)]));
  const have = pairs(blocked);
  for (const p of pairs(fixture)) assert.ok(have.includes(p), `${p} is on ENGINE's block list but the catalog still offers it`);
  assert.deepEqual(have.filter(p => !pairs(fixture).includes(p)).sort(), EARLIER, 'a block that is not on ENGINE\'s list and not one of the earlier three');
  for (const [id, o] of Object.entries(K.MEASURED.blocked)) for (const [v, why] of Object.entries(o)) assert.ok(/^[a-z]/.test(why) && !/\s{2}/.test(why), `${id}/${v} needs a plain reason`);
});

test('a blocked view is never offered or built, and is not also listed as tested', () => {
  for (const [id, views] of Object.entries(fixture)) {
    const entry = ctx.window.ryagramCatalogData.entries.find(e => e.id === id);
    assert.ok(entry, id);
    const choices = K.viewChoices(entry, []);
    for (const v of views) {
      const c = choices.find(x => x.view === v);
      if (!c) continue;
      assert.ok(c.blocked && !c.tested, `${id}/${v}`);
      assert.throws(() => K.storyInfo(entry, v), /isn.t offered/, `${id}/${v}`);
    }
    for (const v of K.MEASURED.ok[id] || []) assert.ok(!views.includes(v), `${id}/${v} cannot be both tested and blocked`);
  }
});

test('the catalog offers 48 films, not 68: 24 usable datasets with a period, each view the site builds and the engine passed', () => {
  let n = 0;
  for (const e of ctx.window.ryagramCatalogData.entries.filter(x => x.status === 'usable' && x.window)) n += K.viewChoices(e, []).filter(c => !c.blocked).length;
  assert.equal(n, 48);
});

test('all three ready-made starts are films the engine passed, and none is on the block list (Housing was a county map that failed legend_separability, also on the live engine)', () => {
  const B = ctx.window.ryagramBuilder;
  assert.ok(B, 'app-builder.js loads');
  const PASSED = ['bps_county_permits/line', 'state_obesity_fastfood/map', 'bls_state_unemployment/line'];   // ENGINE-CATALOG-SHEET-CHECKS-1123.md, Passing
  assert.deepEqual(JSON.parse(JSON.stringify(B.READY_MADE.map(r => `${r.dataset}/${r.film_type}`))), PASSED);
  const blocked = pairs(Object.fromEntries(Object.entries(K.MEASURED.blocked).map(([id, o]) => [id, Object.keys(o)])));
  for (const r of B.READY_MADE) assert.ok(!blocked.includes(`${r.dataset}/${r.film_type}`) && !pairs(fixture).includes(`${r.dataset}/${r.film_type}`), r.id);
  assert.doesNotMatch(B.READY_MADE.map(r => r.blurb).join(' '), /county by county/);
});

test('no template pair that a stranger can be offered is on the block list (Map on county permits and Bars on state unemployment were dropped)', () => {
  const on = pairs(fixture);
  const T = ctx.window.ryagramTemplates;
  const cfg = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', 'ryagram-config.js'), 'utf8'), { window: cfg });
  for (const t of T.TEMPLATES.filter(x => !x.unmeasured && !x.flag)) for (const d of t.datasets) assert.ok(!on.includes(`${d}/${t.view}`), `template ${t.id} offers ${d}/${t.view}, which the engine refuses`);
  assert.equal(T.TEMPLATES.find(x => x.id === 'bars'), undefined);
  assert.ok(!T.TEMPLATES.find(x => x.id === 'map').datasets.includes('bps_county_permits'));
});

test('the Industry template stays OFF while 11 of its sector bars are on the block list, and its switch carries the warning where someone would flip it', () => {
  const on = pairs(fixture);
  const T = ctx.window.ryagramTemplates;
  const sector = T.TEMPLATES.find(x => x.id === 'sector');
  const refused = sector.datasets.filter(d => on.includes(`${d}/bars`));
  assert.equal(refused.length, 11, 'ENGINE refuses 11 sector bars; if that changed, the comment and this number must change together');
  const cfgSrc = fs.readFileSync(path.join(root, 'assets', 'ryagram-config.js'), 'utf8');
  assert.match(cfgSrc, /\n  industryTemplate: false,/);
  // the words say which views are left, read from the v2 list: 7 of 18 sectors keep bars, the map is refused for arts, finance and mining, line is open for all 18
  assert.equal(sector.datasets.length, 18);
  assert.equal(sector.datasets.filter(d => !on.includes(`${d}/bars`)).length, 7);
  assert.deepEqual([...sector.datasets.filter(d => on.includes(`${d}/map`))].sort(), ['cbp_arts_share_state', 'cbp_finance_share_state', 'cbp_mining_share_state']);
  assert.equal(sector.datasets.filter(d => on.includes(`${d}/line`)).length, 0);
  const WORDS = /DO NOT TURN ON as it stands: this is a Bars template and the engine refuses Bars for 11 of its 18 sector datasets; only 7 keep bars \(mining, manufacturing, transportation, information, real estate, education, health care\)\. It also refuses the Map for arts, finance and mining\. Line is open for all 18 and Map for the other 15 \(ENGINE-CATALOG-BLOCK-LIST-1123-v2\.json\)/;
  const tplSrc = fs.readFileSync(path.join(root, 'assets', 'app-templates.js'), 'utf8');
  assert.match(cfgSrc, WORDS);
  assert.match(tplSrc, WORDS);
  assert.doesNotMatch(cfgSrc + tplSrc, /or switch it to map\/line/, 'the old wording said map was open for every sector');
  assert.match(fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'templates.ts'), 'utf8'), /No flag here on purpose: the site hides this template with ryagramConfig\.industryTemplate/);
});
