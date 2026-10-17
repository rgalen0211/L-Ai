// The guided builder page (assets/app-builder.js): its wording and request-making, the data layer against the mock, and the guards that keep every rule with ENGINE.
// The function behind it is tests/guided-builder.test.mjs; the compile rules are ENGINE's tests/film-compile.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['app-builder.js', 'app-data.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout });
const B = win.ryagramBuilder;
const plain = x => JSON.parse(JSON.stringify(x));

test('STEPS: seven steps in the order Ryan gave: dataset, measure, years, film type, look, title, then the free contact sheet at the review', () => {
  assert.deepEqual(plain(B.STEPS.map(([, l]) => l)), ['Dataset', 'Measure', 'Years', 'Film type', 'Look', 'Title', 'Review']);
});

test('REQUEST: what the person chose becomes ENGINE\'s request: years only when changed, a blank subtitle or measure left out, the look as the profile itself', () => {
  assert.deepEqual(plain(B.requestFrom({ dataset: 'd', type: 'bars', title: '  A film  ', subtitle: '  ', measure: '', start: '', end: '' })), { dataset: 'd', film_type: 'bars', title: 'A film' });
  assert.deepEqual(plain(B.requestFrom({ dataset: 'd', type: 'map', title: 'T', subtitle: ' S ', measure: 'obesity', start: ' 2012 ', end: '2020', look: { profile_version: 1, name: 'x' } })),
                   { dataset: 'd', film_type: 'map', title: 'T', subtitle: 'S', measure: 'obesity', years: { start: '2012', end: '2020' }, look: { profile_version: 1, name: 'x' } });
  assert.deepEqual(plain(B.requestFrom({ dataset: 'd', type: 'line', title: 'T', start: '2012', end: '' }).years), { start: '2012' });
});

test('ENGINE SENTENCES: each reason points back at the step it is about; anything else belongs to the review', () => {
  const errs = ["years.start: 1990 is outside this dataset's coverage, 2011 to 2023", "measure: 'x' is not a measure of d", 'film_type: required', 'places: choosing a subset of places is not supported', "look: ramp is wrong",
                'title: required', 'subtitle: longer than 320 characters', "dataset: 'z' is not in the catalog", "the story would be refused by the worker: sequence.clips: too many", "request: unknown key 'extra'"];
  assert.deepEqual(plain(errs.map(B.stepOf)), ['years', 'measure', 'type', 'type', 'look', 'title', 'title', 'dataset', 'review', 'review']);
  const g = B.groupErrors(errs);
  assert.equal(g.years.length, 1);
  assert.equal(g.title.length, 2);
  assert.deepEqual(plain(B.groupErrors([])), {});
});

test('YEARS: only the shape is checked here (a typo costs no round trip); coverage is the engine\'s to say', () => {
  const annual = { period: { cadence: 'annual' } }, monthly = { period: { cadence: 'monthly' } };
  assert.equal(B.yearsShape(annual, '2012', '2020'), null);
  assert.equal(B.yearsShape(annual, '', ''), null);
  assert.equal(B.yearsShape(annual, '2012-06', ''), 'Use a four-digit year, like 2019.');
  assert.equal(B.yearsShape(annual, '12', ''), 'Use a four-digit year, like 2019.');
  assert.equal(B.yearsShape(monthly, '2019-06', '2020'), null);
  assert.equal(B.yearsShape(monthly, '2019-13', ''), 'Use a year like 2019 or a month like 2019-06.');
  assert.equal(B.yearsShape(annual, '1800', '2999'), null);                                                  // out of coverage is not this page's call
});

test('WORDS: film types, period, source line, title suggestion, dataset filter', () => {
  assert.deepEqual(plain(B.typeWords('bars')), ['Bar race', 'Ranks the top places as bars that move as the years pass.']);
  assert.deepEqual(plain(B.typeWords('new_kind')), ['new_kind', '']);
  assert.equal(B.periodWord({ from: '2011', to: '2023', cadence: 'annual' }), '2011 to 2023');
  assert.equal(B.periodWord({ from: '1976-01', to: '', cadence: 'monthly' }), '1976-01 to now, monthly');
  assert.equal(B.sourceLine({ publisher: 'CDC', url: 'https://x.example', licence_short: 'Public domain' }), 'Source: CDC (https://x.example). Licence: Public domain.');
  const d = { title: 'Obesity', window: ['2011', '2023'], measures: [{ id: 'obesity', label: 'Adult obesity prevalence' }] };
  assert.equal(B.suggestTitle(d, 'obesity', '2012', ''), 'Adult obesity prevalence, 2012 to 2023');
  assert.equal(B.suggestTitle(d, '', '', ''), 'Obesity, 2011 to 2023');
  const list = [{ title: 'Obesity and fast food', topic: 'Health', publisher: 'CDC', geography: 'US state' }, { title: 'Permits', topic: 'Housing', publisher: 'Census', geography: 'US county' }];
  assert.deepEqual(plain(B.filterDatasets(list, 'health cdc').map(d => d.title)), ['Obesity and fast food']);
  assert.equal(B.filterDatasets(list, '').length, 2);
  assert.equal(B.filterDatasets(list, 'zzz').length, 0);
});

test('DATA: the page asks the function for the catalog, one dataset and a compile, and a refusal carries EVERY reason', async () => {
  const client = createFakeClient();
  const data = win.ryagramData(client);
  const { datasets } = await data.builderCatalog();
  assert.ok(datasets.length >= 3 && datasets.every(d => d.publisher && d.licence_short));
  const { dataset } = await data.builderDescribe('state_obesity_fastfood');
  assert.match(dataset.licence, /public domain/);
  await assert.rejects(data.builderDescribe('nope'), /not available/);
  const ok = await data.builderCompile({ dataset: 'state_obesity_fastfood', film_type: 'bars', title: 'A film' });
  assert.equal(ok.story.schema, 1);
  assert.equal(ok.report.window.start, '2011');
  let err;
  try { await data.builderCompile({ dataset: 'state_obesity_fastfood', film_type: 'bars', title: '', years: { start: '1990' }, measure: 'zzz' }); } catch (e) { err = e; }
  assert.ok(err && err.errors && err.errors.length >= 3, err && err.message);
  assert.deepEqual(plain(err.errors.map(B.stepOf).sort()), ['measure', 'title', 'years']);
  assert.ok(client.log.filter(l => l.fn === 'guided-builder').length >= 4);
});

test('GUARDS: the page has no catalog, licence rule or story rule of its own, no raw HTML, and the engine\'s server-only modules are never imported into assets/', () => {
  const src = read('assets/app-builder.js');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|\bstyle:|setAttribute\('style'/);
  assert.doesNotMatch(code, /listable|catalog_data|film\.ts|compileFilm|CATALOG\b|STORY_SCHEMA|licence ?\.test|PUBLIC_LICENCE/);          // the rules live with ENGINE, behind the function
  for (const f of fs.readdirSync(new URL('../assets/', import.meta.url)).filter(f => f.endsWith('.js'))) {
    assert.doesNotMatch(read(`assets/${f}`).replace(/\/\/.*$/gm, ''), /catalog_data\.ts|_shared\/film\.ts|catalog_rules/, f);
  }
  assert.match(code, /data\.builderCompile\(requestFrom\(s\)\)/);
  assert.match(code, /data\.createProject\(s\.title\.trim\(\)\)[\s\S]*data\.saveStory\([\s\S]*data\.submitJob\(made\.version\.id, 'contact_sheet', \{\}, null\)/);       // the order: project, story, a CONTACT SHEET only
  assert.doesNotMatch(code, /final_render|preview'/);                                                                                  // never a paid render from this page
  assert.doesNotMatch(code, /per credit|\$\d|price/i);                                                                                  // no price per credit anywhere
});

test('ORDER OF WHAT THE PERSON SEES: the source and licence box is shown from the first chosen dataset and again before anything is made (review)', () => {
  const src = read('assets/app-builder.js');
  assert.match(src, /h3', \{\}, 'Source and licence'/);
  assert.match(src, /summary', \{\}, 'Read the full licence'/);
  assert.match(src, /sourceHolder\.replaceChildren\(sourceBox\(\)\)/);                                          // right after a dataset is chosen
  assert.match(src.slice(src.indexOf('function stepReview')), /return \[h\('h2', \{ tabindex: '-1' \}, 'Review'\), out, sourceBox\(\)/);   // and on the review, above the Make button
  assert.match(src, /Advanced: the story/);                                                                     // the raw story is behind Advanced
});

test('WIRING AND FLAG: #/build and its link exist only behind guidedBuilder (off), the scripts load in order, and the old dataset flags stay off', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const builderOn = \(\) => window\.ryagramConfig\?\.guidedBuilder === true \|\| !!window\.ryagramMock;/);
  assert.match(lib, /builderOn\(\) && hash === '#\/build'\) view = await builderUi\(\)\.builderView\(onStop\)/);
  assert.match(lib, /const buildLink = builderOn\(\)/);
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /guidedBuilder: false,/);
  assert.match(cfg, /catalog: false,/);
  assert.match(cfg, /catalogComingSoon: false/);
  const html = read('app/index.html');
  assert.ok(html.indexOf('app-builder.js') > 0 && html.indexOf('app-builder.js') < html.indexOf('app-library.js'));
});
