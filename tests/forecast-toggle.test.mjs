// The forecast drawing on the site (assets/app-forecast.js, CC1 for Claude 15:30 item 2, behind forecastToggle OFF). The two fixtures are REAL outputs of ENGINE's tools/predict_run.py
// (Ryagram main cd2bb25b) on a made-up series: one Estimated, one Simulated what-if. The checks mirror RENDERER's tools/forecast_look.py validate, so the site refuses what the engine's drawer refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = () => { const win = {}; vm.runInNewContext(read('assets/app-forecast.js'), { window: win }); return win.ryagramForecast; };
const F = load();
const est = JSON.parse(read('tests/fixtures/forecast-estimated-1104.json'));
const wif = JSON.parse(read('tests/fixtures/forecast-whatif-1104.json'));
const clone = x => JSON.parse(JSON.stringify(x));
const refuses = (s, re) => assert.throws(() => F.validate(s), e => re.test(e.message), String(re));

test('the switch is off unless exactly true', () => {
  assert.equal(F.on({ forecastToggle: false }), false); assert.equal(F.on({ forecastToggle: 'true' }), false); assert.equal(F.on({}), false); assert.equal(F.on(null), false);
  assert.equal(F.on({ forecastToggle: true }), true);
});

test('both real engine outputs pass the same checks the engine\'s drawer uses', () => {
  assert.equal(F.validate(est).kind, 'estimated'); assert.equal(F.validate(wif).kind, 'simulated');
});

test('MUST-FAIL: every rule of forecast_look.validate refuses in words (a planted fault each)', () => {
  let s = clone(est); s.forecast[2][2] = s.forecast[2][1] - 0.01; s.forecast[2][3] = s.forecast[2][1] + 0.01; refuses(s, /band narrows/);                         // a band that narrows
  s = clone(est); s.forecast[0][1] = s.forecast[0][3] + 1; refuses(s, /inside its band/);                              // a value outside its band
  s = clone(est); s.kind = 'observed'; refuses(s, /never Observed/);                                                    // called Observed
  s = clone(est); s.label = 'Observed'; refuses(s, /never Observed/);
  s = clone(est); delete s.backtest; refuses(s, /backtest error is missing/);                                           // no backtest
  s = clone(est); s.backtest = { hidden_years: 0, mean_abs_pct_error: 1 }; refuses(s, /backtest error is missing/);
  s = clone(est); s.breaks = [s.forecast[1][0]]; refuses(s, /method break .* lies inside the forecast/);               // a break inside the forecast
  s = clone(est); s.forecast[0][0] = s.observed[s.observed.length - 1][0]; refuses(s, /must start after the last observed year/);
  s = clone(est); s.forecast.splice(1, 1); refuses(s, /one year at a time/);                                            // a hole in the forecast
  s = clone(est); s.basis = ''; refuses(s, /written in words/);
  s = clone(est); s.basis = 'Simulated, based on a guess'; refuses(s, /the words say Simulated but the forecast is Estimated/);
  s = clone(est); s.basis = 'Observed trend'; refuses(s, /but the forecast is Estimated/);
  s = clone(est); s.observed = [s.observed[0]]; refuses(s, /at least two values/);
  s = clone(est); s.forecast = []; refuses(s, /no forecast to draw/);
  for (const x of [null, [], 'x', 3]) refuses(x, /a series is a dictionary/);
});

test('the drawing: observed SOLID, forecast DASHED and faded inside a shaded range, a "Forecast begins" line, Estimated on the chart, never Observed', () => {
  const { shapes, key } = F.shapes(est);
  const obs = shapes.filter(s => s.attrs['data-part'] === 'observed'), fc = shapes.filter(s => s.attrs['data-part'] === 'forecast');
  assert.ok(obs.length >= 1 && obs.every(s => !('stroke-dasharray' in s.attrs)), 'observed is solid');
  assert.equal(fc.length, 1); assert.ok(fc[0].attrs['stroke-dasharray'] && fc[0].attrs['stroke-opacity'] < 1, 'forecast is dashed and faded');
  assert.equal(shapes.filter(s => s.attrs['data-part'] === 'band').length, 1);
  assert.equal(shapes.filter(s => s.attrs['data-part'] === 'begins').length, 1);
  const texts = shapes.filter(s => s.text).map(s => s.text);
  assert.ok(texts.includes(`Forecast begins ${est.forecast[0][0]}`)); assert.ok(texts.includes('Estimated')); assert.ok(!texts.some(t => /Observed/.test(t)));
  assert.ok(!key.some(t => /Observed/.test(t)), 'the key never calls a forecast Observed');
});

test('the key: as published, the engine\'s own basis words (no doubled label), the range, the backtest ALWAYS', () => {
  const key = F.keyLines(F.validate(est));
  assert.equal(key[0], `Solid line: as published, ${est.observed[0][0]}-${est.observed[est.observed.length - 1][0]}.`);
  assert.equal(key[1], `Dashed line: ${est.basis}.`); assert.ok(!/Estimated, Estimated/.test(key[1]));
  assert.match(key[2], new RegExp(`Forecast begins ${est.forecast[0][0]}\\.`));
  assert.match(key[3], new RegExp(`^A test: hiding the last ${est.backtest.hidden_years} years .* missed by ${Math.round(est.backtest.mean_abs_pct_error * 10) / 10}% on average\\.$`));
  const noLabel = clone(est); noLabel.basis = 'based on the 2012-2023 trend';
  assert.equal(F.keyLines(F.validate(noLabel))[1], 'Dashed line: Estimated, based on the 2012-2023 trend.');
});

test('a range that failed its own test says so: fewer than 8 of 10 hidden years inside it', () => {
  const s = clone(est); s.backtest = { ...s.backtest, inside_band: 1, of: 4 };
  assert.ok(F.keyLines(F.validate(s)).some(t => /only 1 of 4 test years: treat the range as too optimistic/.test(t)));
  const ok = clone(est); ok.backtest = { ...ok.backtest, inside_band: 8, of: 10 };
  assert.ok(!F.keyLines(F.validate(ok)).some(t => /too optimistic/.test(t)), '8 of 10 is not flagged');
});

test('a what-if is Simulated everywhere, and its test is named as the TREND\'s, not the what-if\'s', () => {
  const key = F.keyLines(F.validate(wif));
  assert.match(key[1], /^Dashed line: Simulated, based on the what-if: /); assert.ok(!/Simulated, Simulated/.test(key[1]));
  assert.match(key[3], /^A test of the trend shown for scale \(not of the what-if\): /);
  assert.ok(key.includes('Simulated: this shows what happens IF the assumption holds, not what will happen.'));
  assert.ok(F.shapes(wif).shapes.some(s => s.text === 'Simulated'));
});

test('missing years stay missing: a gap is never bridged by a line', () => {
  const s = clone(est); s.observed = s.observed.filter(r => r[0] !== s.observed[5][0]);
  const obs = F.shapes(s).shapes.filter(x => x.attrs['data-part'] === 'observed');
  assert.equal(obs.length, 2, 'two separate runs either side of the missing year');
});

test('the page code puts server words in as text only and loads nothing', () => {
  const src = read('assets/app-forecast.js');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|fetch\(|https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(src));
});

test('WIRING: the switch is OFF in the committed config; both pages load the drawing first; the editor fetches the made-up fixture ONLY in mock mode; the film page shows nothing without a forecast', () => {
  assert.match(read('assets/ryagram-config.js'), /\n  forecastToggle: false,\n/);
  const app = read('app/index.html'), film = read('film/index.html');
  assert.ok(app.indexOf('/assets/app-forecast.js?v=') > 0 && app.indexOf('/assets/app-forecast.js?v=') < app.indexOf('/assets/app-editor.js?v='), 'app: forecast before the editor');
  assert.ok(film.indexOf('/assets/app-forecast.js?v=') > 0 && film.indexOf('/assets/app-forecast.js?v=') < film.indexOf('/assets/film.js?v='), 'film page: forecast before film.js');
  const ed = read('assets/app-editor.js');
  assert.match(ed, /const fcOn = isData && !!FC && FC\.onHere\(\);/); assert.ok(!/ryagramConfig|supabase/i.test(ed.slice(ed.indexOf('const FC = window.ryagramForecast'), ed.indexOf('function paintForecast'))), 'the editor part never names the config or the database (the maker bundle forbids both)');
  assert.match(ed, /if \(bundle && bundle\.forecast\) return bundle\.forecast;\n\s*if \(window\.ryagramMock && window\.RYAGRAM_MOCK_FORECAST\) return window\.RYAGRAM_MOCK_FORECAST;/);
  assert.ok(!/fetch\(/.test(ed.slice(ed.indexOf('async function forecastSeries'), ed.indexOf('function paintForecast'))), 'no fetch: the app page may only connect to Supabase');
  assert.match(ed, /\]\.filter\(Boolean\)\);/, 'empty parts are dropped (replaceChildren(null) prints "null")');
  const mock = read('tests/fake-supabase.js').match(/\(typeof window !== 'undefined' \? window : globalThis\)\.RYAGRAM_MOCK_FORECAST = (\{.*\});/);
  assert.ok(mock, 'the mock carries the series'); assert.deepEqual(JSON.parse(mock[1]), est, 'the mock series is the fixture, exactly');
  assert.match(ed, /'This film has no forecast yet\.'/); assert.match(ed, /'A made-up example series, not real data\.'/);
  assert.match(ed, /warns, fcOn \? fcHolder : null,/);
  const fj = read('assets/film.js');
  assert.match(fj, /if \(!FC \|\| !FC\.on\(window\.ryagramConfig\) \|\| !series\) return null;/);
  assert.match(fj, /remixSection\(page\),\n\s*forecastSection\(page\),/);
  assert.ok(!/\bforecast\b[^\n]*\b(compute|fit|predict)\(/.test(ed + fj), 'neither page computes a forecast');
});

test('every label stays inside the chart: "Forecast begins" sits left of its marker, and the value scale has numbers', () => {
  for (const s of [est, wif]) {
    const { shapes } = F.shapes(s, { w: 320, h: 180 });
    const begins = shapes.find(x => x.text && x.text.startsWith('Forecast begins'));
    assert.equal(begins.attrs['text-anchor'], 'end'); assert.ok(begins.attrs.x > 0 && begins.attrs.x < 320, 'inside the width');
    const marker = shapes.find(x => x.attrs['data-part'] === 'begins'); assert.ok(begins.attrs.x < marker.attrs.x1, 'left of the marker');
    const nums = shapes.filter(x => x.text && /^-?[0-9.]+[kM]?$/.test(x.text) && !/^(19|20)\d\d$/.test(x.text));
    assert.ok(nums.length >= 2, 'the lowest and highest values are written on the left');
    assert.ok(shapes.filter(x => x.tag === 'text').every(x => x.attrs.x >= 0 && x.attrs.x <= 320 && x.attrs.y >= 0 && x.attrs.y <= 180), 'no text outside the box');
  }
});
