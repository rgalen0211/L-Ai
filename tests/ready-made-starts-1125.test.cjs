// BUILDER 2026-11-25 (Claude 08:05 wave 2 (C)): every one-click ready-made start must be a film a stranger with 8 welcome credits can really make.
// Five gates, all read from committed files (no live call): (1) its dataset is a usable catalog entry and the builder offers that view; (2) its
// (dataset, view) passed the engine's own sheet checks as the site builds it (ENGINE-CATALOG-SHEET-CHECKS-1123.md, Passing; copied below);
// (3) it is on neither the engine's block list (tools/data/engine-catalog-block-list-1123.json) nor MEASURED.blocked; (4) its years are the
// dataset's own window (app-templates.js DATASETS), the story the engine checked; (5) its full film costs 8 credits or less (credits_ledger.sql:
// final_line 6, final_map 8, and the dataset has a 'standard' shape row). The must-fail starts at the bottom are each caught by exactly one gate.
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
const B = ctx.window.ryagramBuilder;
const T = ctx.window.ryagramTemplates;
const BLOCK = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'data', 'engine-catalog-block-list-1123.json'), 'utf8'));
// ENGINE-CATALOG-SHEET-CHECKS-1123.md, 'Passing (no failed check)', the map and line films (the only views a start may use: bars cost 10)
const PASSED = new Set(['state_obesity_fastfood/map', 'state_obesity_fastfood/line', 'bps_county_permits/line', 'bea_sainc1_state_income_index/map',
  'bea_sainc1_state_income_index/line', 'bls_state_unemployment/line', 'cbp_suppression/line', 'cbp_county_grocery/line',
  'cbp_accommodation_food_share_state/map', 'cbp_accommodation_food_share_state/line', 'cbp_admin_support_share_state/map',
  'cbp_admin_support_share_state/line', 'cbp_arts_share_state/line', 'cbp_construction_share_state/map', 'cbp_construction_share_state/line',
  'cbp_education_share_state/map', 'cbp_education_share_state/line', 'cbp_finance_share_state/line', 'cbp_health_care_share_state/map',
  'cbp_health_care_share_state/line', 'cbp_information_share_state/map', 'cbp_information_share_state/line', 'cbp_management_share_state/map',
  'cbp_management_share_state/line', 'cbp_manufacturing_share_state/map', 'cbp_manufacturing_share_state/line', 'cbp_mining_share_state/line',
  'cbp_other_services_share_state/map', 'cbp_other_services_share_state/line', 'cbp_professional_share_state/map', 'cbp_professional_share_state/line',
  'cbp_real_estate_share_state/map', 'cbp_real_estate_share_state/line', 'cbp_retail_share_state/map', 'cbp_retail_share_state/line',
  'cbp_transportation_share_state/map', 'cbp_transportation_share_state/line', 'cbp_utilities_share_state/map', 'cbp_utilities_share_state/line',
  'cbp_wholesale_share_state/map', 'cbp_wholesale_share_state/line']);
const LEDGER = fs.readFileSync(path.join(root, 'supabase', 'phase-2b', 'credits_ledger.sql'), 'utf8');
const PRICE = Object.fromEntries([...LEDGER.matchAll(/\('2026-09', '(final_[a-z]+)', (\d+),/g)].map(m => [m[1], Number(m[2])]));
const CBP_SECTORS = (LEDGER.match(/unnest\(array\[([^\]]+)\]\) sector/) || [])[1] || '';
function standardShape(dataset) {
  if (new RegExp(`\\('${dataset}', 'standard'`).test(LEDGER)) return true;
  const m = /^cbp_([a-z_]+?)(_establishments|_employment|_share|_share_state)$/.exec(dataset);   // the CBP sector rule (Ryan 2026-10-03)
  return Boolean(m && CBP_SECTORS.includes(`'${m[1]}'`));
}
const WELCOME = 8;

function failures(r) {
  const out = [];
  const pair = `${r.dataset}/${r.film_type}`;
  const entry = ctx.window.ryagramCatalogData.entries.find(e => e.id === r.dataset);
  if (!entry || entry.status !== 'usable') out.push('catalog');
  else {
    const c = K.viewChoices(entry, []).find(x => x.view === r.film_type);
    if (!c || c.blocked) out.push('catalog');
  }
  if (!PASSED.has(pair)) out.push('engine-passed');
  if ((BLOCK[r.dataset] || []).includes(r.film_type) || (K.MEASURED.blocked[r.dataset] || {})[r.film_type]) out.push('blocked');
  const d = T.DATASETS[r.dataset];
  if (!d || r.start !== d.start || r.end !== d.end) out.push('years');
  const price = PRICE[`final_${r.film_type}`];
  if (!standardShape(r.dataset) || !(price <= WELCOME)) out.push('cost');
  return out;
}

test('the price table the cost gate reads is the real one: a line 6, a map 8, bars are not a final code (they price as map/line by view)', () => {
  assert.equal(PRICE.final_line, 6);
  assert.equal(PRICE.final_map, 8);
  assert.ok(CBP_SECTORS.includes("'health_care'") && CBP_SECTORS.includes("'manufacturing'") && CBP_SECTORS.includes("'accommodation_food'"));
  assert.ok(CBP_SECTORS.includes("'construction'") && CBP_SECTORS.includes("'retail'") && CBP_SECTORS.includes("'transportation'"));   // the three 11-26 starts
});

test('every ready-made start passes all five gates (catalog, engine passed, not blocked, the dataset\'s own years, 8 credits or less)', () => {
  assert.equal(B.READY_MADE.length, 9);
  for (const r of B.READY_MADE) assert.deepEqual(failures(r), [], `${r.id}: ${failures(r).join(', ')}`);
  assert.equal(new Set(B.READY_MADE.map(r => r.id)).size, B.READY_MADE.length, 'ids are unique');
  assert.equal(new Set(B.READY_MADE.map(r => r.dataset)).size, B.READY_MADE.length, 'one start per dataset');
});

test('the six job starts read true: label, blurb years and title match the dataset; a line blurb says lines, a map blurb says state by state', () => {
  const jobs = B.READY_MADE.filter(r => /^cbp_/.test(r.dataset));
  assert.deepEqual(JSON.parse(JSON.stringify(jobs.map(r => r.id))), ['health-care-jobs', 'factory-jobs', 'food-jobs', 'construction-jobs', 'shop-jobs', 'trucking-jobs']);
  for (const r of jobs) {
    assert.ok(r.blurb.includes(`${r.start} to ${r.end}`), `${r.id} blurb names its years`);
    assert.equal(r.title, T.DATASETS[r.dataset].headline, `${r.id} title is the dataset's own headline`);
    assert.match(r.blurb, r.film_type === 'line' ? /as lines/ : /state by state/, r.id);
    assert.doesNotMatch(`${r.label} ${r.blurb} ${r.title}`, /\b(view|beta|invite|free film)\b/i, r.id);
  }
});

test('MUST-FAIL: each bad start is caught, by the gate it breaks', () => {
  const good = B.READY_MADE.find(r => r.id === 'factory-jobs');
  const cases = [
    [{ ...good, dataset: 'bls_state_unemployment', film_type: 'map', start: '2019-01', end: '2022-12' }, ['engine-passed', 'blocked', 'catalog']],   // blocked map
    [{ ...good, film_type: 'bars' }, ['engine-passed', 'cost']],                                                    // bars: not a start view, final_bars does not exist
    [{ ...good, start: '2005' }, ['years']],                                                                         // not the window the engine checked
    [{ ...good, dataset: 'not_a_dataset' }, ['catalog', 'engine-passed', 'years', 'cost']],                          // not in the catalog
    [{ ...good, dataset: 'cbp_finance_share_state', film_type: 'map', title: 'x' }, ['engine-passed', 'blocked', 'catalog']]   // band_flicker
  ];
  for (const [r, want] of cases) assert.deepEqual(failures(r).sort(), [...want].sort(), JSON.stringify(r).slice(0, 120));
});
