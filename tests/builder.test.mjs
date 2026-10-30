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
  assert.match(code, /src\.builderCompile\(requestFrom\(s\)\)/);
  assert.match(code, /const src = sample \? sampleData\(rec\) : data;/, 'the function is asked, except in the sample walk-through');
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

test('WIRING AND FLAG: #/build and its link exist only behind guidedBuilder (now on), the scripts load in order, and the old dataset flags stay off (guidedBuilder ON since Ryan 2026-10-25 22:06)', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const builderOn = \(\) => window\.ryagramConfig\?\.guidedBuilder === true \|\| !!window\.ryagramMock;/);
  assert.match(lib, /builderOn\(\) && hash === '#\/build'\) view = await builderUi\(\)\.builderView\(onStop\)/);
  assert.match(lib, /const buildLink = builderOn\(\)/);
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /guidedBuilder: true,/);
  assert.match(cfg, /catalog: false,/);
  assert.match(cfg, /catalogComingSoon: false/);
  const html = read('app/index.html');
  assert.ok(html.indexOf('app-builder.js') > 0 && html.indexOf('app-builder.js') < html.indexOf('app-library.js'));
});

// ENGINE 11cf562: compileFilm says, in report.warnings and look.converted, when a solid look is shown as a continuous ramp on a county map. The review shows every warning
// BEFORE the button that makes the film and its (free) contact sheet; nothing here decides what is converted: that is the engine's.
test('COUNTY NOTICE: a solid look on a county map shows the engine\'s sentence at the review; a state map shows no conversion notice', async () => {
  const film = read('supabase/functions/_shared/film.ts');
  const notice = /export const COUNTY_CONTINUOUS_NOTICE = "([^"]+)";/.exec(film)[1];
  const client = createFakeClient();
  const data = win.ryagramData(client);
  const solid = { profile_version: 1, name: 'solid-look', look: { theme: 'light', ramp: { mode: 'solid', low: '#eeeeee', high: '#0a4a7a' } } };
  const county = await data.builderCompile(B.requestFrom({ dataset: 'bps_county_permits', type: 'map', title: 'Permits', look: solid }));
  assert.ok(county.report.warnings.includes(notice), 'the sentence is in report.warnings, word for word the engine\'s');
  assert.deepEqual(plain(county.report.look.converted), [notice]);
  const state = await data.builderCompile(B.requestFrom({ dataset: 'state_obesity_fastfood', type: 'map', title: 'Obesity', look: solid }));
  assert.ok(!state.report.warnings.includes(notice) && state.report.look.converted.length === 0, 'no conversion notice on a state map');
  const countyBars = await data.builderCompile(B.requestFrom({ dataset: 'bps_county_permits', type: 'bars', title: 'Permits', look: solid }));
  assert.equal(countyBars.report.look.converted.length, 0, 'only the county MAP is converted');
  const own = await data.builderCompile(B.requestFrom({ dataset: 'bps_county_permits', type: 'map', title: 'Permits' }));
  assert.equal(own.report.look.converted.length, 0, 'the film\'s own look is not converted');
  // the page puts every warning into the review ABOVE the make button, so it is read before anything is made
  const src = read('assets/app-builder.js');
  const review = src.slice(src.indexOf('function stepReview'), src.indexOf('function draw()'));
  assert.ok(review.indexOf('...r.warnings.map(w =>') > -1 && review.indexOf('...r.warnings.map(w =>') < review.indexOf("h('div', { class: 'actions-row builder-nav' }"), 'warnings come before the buttons');
  assert.match(review, /make\.disabled = false/, 'the make button is enabled only after the warnings are drawn');
});

test('LINKS (CC1 LOW-3): a data link from the catalog is shown only as a plain http(s) address; javascript:, data: and the like never become a link or text', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'ftp://x.org/a', '//x.org', 'https://exa mple.org', 'https://x.org/"onmouseover=', '', null, undefined]) assert.equal(B.webLink(bad), '', String(bad));
  assert.equal(B.webLink('https://data.cdc.gov/d/hn4x-zwk7'), 'https://data.cdc.gov/d/hn4x-zwk7');
  assert.equal(B.sourceLine({ publisher: 'P', url: 'javascript:alert(1)', licence_short: 'L' }), 'Source: P. Licence: L.');
  assert.equal(B.sourceLine({ publisher: 'P', url: 'https://x.org/a', licence_short: 'L' }), 'Source: P (https://x.org/a). Licence: L.');
  const src = fs.readFileSync(new URL('../assets/app-builder.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /href: d\.url/, 'the link target always goes through webLink');
});

test('READY-MADE STARTS (NEXT-WEB 132): housing, health and work, each a view rendered before, offered only when the function\'s catalog lists its dataset; no income (nothing listable)', () => {
  assert.deepEqual(plain(B.READY_MADE.map(r => [r.id, r.dataset, r.film_type])), [['housing', 'bps_county_permits', 'map'], ['health', 'state_obesity_fastfood', 'map'], ['work', 'bls_state_unemployment', 'line']]);
  assert.ok(!B.READY_MADE.some(r => /income/i.test(`${r.id} ${r.dataset} ${r.title}`)), 'no income start until an income dataset is listable');
  const all = B.READY_MADE.map(r => ({ id: r.dataset }));
  assert.deepEqual(plain(B.readyMade(all).map(r => r.id)), ['housing', 'health', 'work']);
  assert.deepEqual(plain(B.readyMade([{ id: 'state_obesity_fastfood' }, { id: 'something_else' }]).map(r => r.id)), ['health'], 'a start whose dataset is not in the catalog is not offered');
  assert.deepEqual(plain(B.readyMade([])), []);
  assert.deepEqual(plain(B.readyMade(null)), []);
  // the years are the windows those views were rendered on (app-templates.js)
  const T = {}; vm.runInNewContext(read('assets/app-templates.js'), { window: T });
  for (const r of B.READY_MADE) { const d = T.ryagramTemplates.DATASETS[r.dataset]; assert.equal(r.start, d.start, r.id); assert.equal(r.end, d.end, r.id); }
  // each start, as a request, is exactly what the compile step takes
  for (const r of B.READY_MADE) assert.deepEqual(Object.keys(B.requestFrom({ dataset: r.dataset, type: r.film_type, title: r.title, start: r.start, end: r.end })).sort(), ['dataset', 'film_type', 'title', 'years']);
});

test('FIRST FILM (NEXT-WEB 132): with no projects the guided builder is the main button; with projects it is the quiet link', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /projects\.length \? h\('p', \{ class: 'meta' \}, h\('a', \{ href: '#\/build' \}, 'Tutorial: make a film step by step'\)\)/);
  assert.match(lib, /id: 'first-film', href: '#\/build' \}, 'Try the tutorial: your first film'/);
  assert.match(lib, /builderOn\(\) \? 'No projects yet\. The quickest way to start is above/);
});

test('BUY STRIP (NEXT-WEB 132 G5): after the free first picture the Render panel says what the full film uses and what the person has, in credits and never a price; it is hidden once a final film exists', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /That first picture was free\./);
  assert.match(lib, /The full film uses \$\{C\.plural\(q\.credits\)\}; you have \$\{C\.plural\(Math\.max\(0, q\.available \|\| 0\)\)\}\./);
  assert.match(lib, /!jobs\.some\(j => j\.job_type === 'final_render'\)/, 'gone once a final film is ordered');
  const strip = lib.slice(lib.indexOf("nextStrip.replaceChildren"), lib.indexOf("} else nextStrip.hidden = true;"));
  assert.ok(!/priceLabel|money\(|cents|\$\{?\s*price/i.test(strip), 'no money in the strip');
});

// NEXT-BUILDER 38 (Ryan: the guided builder is for testing and tutorial only): the page says it is a tutorial, each step has one tip, and "Try a sample" walks the
// steps on a bundled recording that makes nothing.
test('TUTORIAL: the page is labelled a tutorial for learning and testing, and every step has one tip', () => {
  assert.equal(B.HEADING, 'Tutorial: make a film step by step');
  assert.deepEqual(plain(Object.keys(B.TIPS)), plain(B.STEPS.map(([id]) => id)), 'one tip per step, no more');
  assert.ok(Object.values(B.TIPS).every(t => /^Tip: /.test(t) && t.length < 200));
  const src = read('assets/app-builder.js');
  assert.match(src, /'This tutorial is for learning and testing\./);
  assert.match(src, /h\('p', \{ class: 'form-note builder-tip' \}, TIPS\[stepName\(\)\]\)/, 'the tip of the current step is drawn on every step');
  assert.match(src, /h\('a', \{ href: '#\/build\/sample' \}, 'Try a sample first'\)/);
});

test('SAMPLE RECORDING: assets/app-builder-sample.js is exactly what the function\'s test double answers for the Health start (re-record with tools/build-builder-sample.mjs)', async () => {
  const { recordSample, sampleSource } = await import('../tools/build-builder-sample.mjs');
  assert.equal(read('assets/app-builder-sample.js').replace(/\r\n/g, '\n'), sampleSource(await recordSample()));
  const S = {}; vm.runInNewContext(read('assets/app-builder-sample.js'), { window: S });
  const rec = S.ryagramBuilderSample;
  assert.equal(rec.start, 'health');
  assert.equal(rec.dataset.id, rec.entry.id);
  assert.ok(rec.dataset.publisher && rec.dataset.licence_short && rec.dataset.licence, 'the sample shows a source and a licence like any dataset');
  assert.doesNotMatch(read('assets/app-builder-sample.js'), /createProject|saveStory|submitJob|supabase|https?:\/\/(?!data\.cdc\.gov)/, 'no call and no address but the dataset\'s own page');
});

test('SAMPLE DATA: answers only what was recorded; any other request is refused in words, at the review', async () => {
  const S = {}; vm.runInNewContext(read('assets/app-builder-sample.js'), { window: S });
  const rec = S.ryagramBuilderSample;
  const d = B.sampleData(rec);
  assert.deepEqual(plain((await d.builderCatalog()).datasets.map(x => x.id)), [rec.entry.id], 'ONE dataset');
  assert.deepEqual(plain((await d.builderDescribe(rec.entry.id)).dataset), plain(rec.dataset));
  await assert.rejects(d.builderDescribe('bps_county_permits'), /not in the sample/);
  const ok = await d.builderCompile(plain(rec.request));
  assert.deepEqual(plain(ok), plain({ story: rec.story, report: rec.report }));
  let err; try { await d.builderCompile({ ...plain(rec.request), film_type: 'bars' }); } catch (e) { err = e; }
  assert.ok(err && err.errors && err.errors.length === 1 && /only check its own ready-made choices/.test(err.errors[0]));
  assert.equal(B.stepOf(err.errors[0]), 'review', 'the refusal belongs to the review, not to a step');
  assert.deepEqual(plain(await d.listLooks()), []);
  ok.story.name = 'changed';
  assert.notEqual((await d.builderCompile(plain(rec.request))).story.name, 'changed', 'each answer is a fresh copy of the recording');
  assert.deepEqual(plain((await B.sampleData(null).builderCatalog()).datasets), [], 'no sample loaded: nothing offered');
});

test('SAMPLE MAKES NOTHING: in the sample the Make button is hidden and never wired; project, story and job are made only outside it; the route and script exist', () => {
  const src = read('assets/app-builder.js');
  const review = src.slice(src.indexOf('function stepReview'), src.indexOf('function draw()'));
  assert.match(review, /if \(sample\) make\.hidden = true;\r?\n\s+if \(!sample\) make\.addEventListener\('click'/);
  const wired = review.slice(review.indexOf("if (!sample) make.addEventListener('click'"));
  for (const call of ['data.createProject(', 'data.saveStory(', 'data.submitJob(']) {
    assert.equal(src.split(call).length - 1, 1, `${call} appears once`);
    assert.ok(wired.includes(call), `${call} is only inside the non-sample Make handler`);
  }
  assert.match(review, /sample \? again : make\)\]/, 'the sample offers "Start the sample again" in the Make button\'s place');
  const lib = read('assets/app-library.js');
  assert.match(lib, /builderOn\(\) && hash === '#\/build\/sample'\) view = await builderUi\(\)\.builderView\(onStop, \{ sample: true \}\)/);
  const html = read('app/index.html');
  assert.ok(html.indexOf('app-builder-sample.js') > 0 && html.indexOf('app-builder-sample.js') < html.indexOf('app-builder.js?'), 'the sample loads before the builder');
});
