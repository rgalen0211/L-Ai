// Ryan's ruling (2026-10-06): NIGHT is the default theme for EVERY map type, dot maps included. A map film must start
// on the dark page with no colour overrides, whichever way it is started (template, catalog dataset, upload).
// Bars and line charts are not maps and keep what they start on (also dark today); they are listed, not required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
function load(...files) {
  const ctx = { window: {}, document: undefined };
  for (const f of files) vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', f), 'utf8'), ctx);
  return ctx.window;
}
const w = load('app-catalog-data.js', 'app-templates.js', 'app-catalog.js', 'app-look.js', 'app-uploads.js');
const T = w.ryagramTemplates, K = w.ryagramCatalog, D = w.ryagramCatalogData, L = w.ryagramLook, U = w.ryagramUploads;
const plain = v => JSON.parse(JSON.stringify(v));

// Every view a story can use, classified. A new view must be added here on purpose, as a map or as a chart.
const MAP_VIEWS = ['map', 'paired', 'panel'];          // choropleth (hatch or solid), map + bars, dot maps ride on these
const CHART_VIEWS = ['bars', 'line'];
const colourKeys = so => Object.keys(so || {}).filter(k => k !== 'bars');

function assertNight(story, what) {
  assert.equal(story.sequence.theme, 'dark', `${what}: theme`);
  assert.equal(L.describe(story).theme_name === 'night' || L.describe(story).theme_name === 'custom', true);
  const so = story.sequence.style_overrides || {};
  for (const k of ['page', 'text', 'globe']) assert.equal(so[k], undefined, `${what}: ${k} override`);
  assert.equal((so.choropleth || {}).low, undefined, `${what}: choropleth.low`);
  assert.equal((so.choropleth || {}).high, undefined, `${what}: choropleth.high`);
  assert.equal((so.dots || {}).color, undefined, `${what}: dots.color`);
  assert.equal((so.state || {}).fill, undefined, `${what}: state.fill`);
}

test('every view is classified as a map or a chart (a new view cannot slip in unnoticed)', () => {
  const views = new Set(T.TEMPLATES.map(t => t.view).concat(K.BUILD_VIEWS));
  for (const v of views) assert.ok(MAP_VIEWS.includes(v) || CHART_VIEWS.includes(v), `view ${v} is neither listed as a map nor as a chart`);
});

test('every MAP template on every dataset it is offered for starts on Night', () => {
  const maps = T.TEMPLATES.filter(t => MAP_VIEWS.includes(t.view));
  assert.ok(maps.length >= 2, 'map and paired templates exist');
  for (const t of maps) for (const d of t.datasets) {
    const s = plain(T.build(t.id, d, 'H'));
    assertNight(s, `${t.id}/${d}`);
    assert.equal(L.describe(s).theme_name === 'custom' ? 'custom' : 'night', L.describe(s).theme_name);
  }
});

test('choropleth: a state map and a county map (smooth colour) both start on Night', () => {
  const state = plain(T.build('map', 'state_obesity_fastfood', 'H'));
  assertNight(state, 'state map');
  assert.equal(L.describe(state).theme_name, 'night');
  const county = plain(T.build('map', 'bps_county_permits', 'H'));
  assertNight(county, 'county map');
  assert.deepEqual(county.sequence.style_overrides, { choropleth: { mode: 'solid', continuous: true } });   // a fill mode, not a colour or theme
});

test('map and paired views from the catalog, for every usable dataset, start on Night', () => {
  let n = 0;
  for (const e of D.entries.filter(x => x.status === 'usable')) {
    for (const c of K.viewChoices(e, T.TEMPLATES)) {
      if (!MAP_VIEWS.includes(c.view) || c.blocked) continue;
      assertNight(plain(T.buildFor(K.storyInfo(e, c.view), '')), `${e.id}/${c.view}`);
      n++;
    }
  }
  assert.ok(n > 10, `only ${n} map films checked`);
});

test('dot maps start on Night: a story with dots and no colours stays dark, and the picker names it Night', () => {
  const s = plain(T.build('paired', 'state_obesity_fastfood', 'H'));
  const withDots = L.apply(s, { look: { dot_value: 500 } });
  assert.equal(withDots.ok, true);
  assert.equal(withDots.story.sequence.theme, 'dark');
  assert.equal((withDots.story.sequence.style_overrides.dots || {}).color, undefined);
  // The engine's dark-theme dot colour is the default; choosing Night puts it back.
  const dotted = L.apply(s, { look: { dot_color: '#00e5ff' } }).story;
  const reset = L.apply(dotted, { theme: 'night' }).story;
  assert.equal(reset.sequence.theme, 'dark');
  assert.equal((reset.sequence.style_overrides || {}).dots, undefined);
  assert.equal(L.describe(reset).theme_name, 'night');
});

test('an upload dropped into a film keeps the film on Night', () => {
  const s = plain(T.build('map', 'state_obesity_fastfood', 'H'));
  assertNight(plain(U.useInStory(s, 'u_0123456789abcdef01234567')), 'upload on a map film');
});

test('the Edge Function builds the same Night stories (templates.ts mirrors the page)', async () => {
  const shared = await import('../supabase/functions/_shared/templates.ts');
  for (const t of shared.TEMPLATES.filter(x => MAP_VIEWS.includes(x.view))) for (const d of t.datasets) assertNight(plain(shared.build(t.id, d, 'H')), `edge ${t.id}/${d}`);
});

test('LISTED, not required: bars and line charts start on dark too (not maps; kept as they are)', () => {
  const charts = T.TEMPLATES.filter(t => CHART_VIEWS.includes(t.view)).map(t => `${t.id} (${t.view})`);
  assert.deepEqual([...charts].sort(), ['bars (bars)', 'highest (line)', 'line (line)', 'sector (bars)']);
  for (const t of T.TEMPLATES.filter(x => CHART_VIEWS.includes(x.view))) {
    assert.equal(plain(T.build(t.id, t.datasets[0], 'H')).sequence.theme, 'dark', t.id);   // what they start on now
  }
});
