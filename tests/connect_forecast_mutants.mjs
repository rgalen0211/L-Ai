// Must-fail proof for tests/connect-forecast.test.mjs (forecast_series / forecast_answer): each mutant breaks ONE thing (or, where two layers check the same rule, both layers) in a scratch copy of the connector code and the suites
// must then FAIL. A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_forecast_mutants.mjs   (exit 0 only when every mutant is caught)
// The forecast tools share snippets with the place tools; `nth(k, from, to)` breaks the first k-1 copies of `from` harmlessly so the edit that follows lands on the k-th.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-forecast');
const C = 'supabase/functions/connect-core/';
const T = C + 'tools.ts', Y = C + 'types.ts', I = 'supabase/functions/connect/index.ts', D = 'supabase/functions/connect/db.ts';
const SUITES = ['connect-forecast.test.mjs', 'connect-geo-shapes.test.mjs', 'connect-geo-within.test.mjs'];
const SHEAD = 'name: "forecast_series", title: "Ask for a forecast of a series of years", scope: "read", readOnly: true, listed: false,';
const AHEAD = 'name: "forecast_answer", title: "Read the answer to a forecast request", scope: "read", readOnly: true, listed: false,';
const GATE = 'if (!sw || !(await sw.enabled())) return refuse("Forecasts are not available yet. Nothing was asked.", "not_available", { data: { ok: false, looked_up: false } });\n    if (!(await ctx.policy.hit(ctx.principal, "geo_read"';
const HIT = 'if (!(await ctx.policy.hit(ctx.principal, "geo", LIMITS.geoQuestionsPerHourPerUser, 3600))) {';
const LOOKED = 'looked_up: false, do_not_poll: false, poll_after_s: 20 });';
const nth = (k, from, to) => [...Array.from({ length: k - 1 }, () => [T, from, from.slice(0, 12) + '/*' + 'x' + '*/' + from.slice(12)]), [T, from, to]];
const mutants = [
  ['forecast_series is listed', [[T, SHEAD, SHEAD.replace(' listed: false,', '')]]],
  ['forecast_series needs write permission', [[T, SHEAD, SHEAD.replace('scope: "read"', 'scope: "write"')]]],
  ['forecast_series says it is not read-only', [[T, SHEAD, SHEAD.replace('readOnly: true', 'readOnly: false')]]],
  ['forecast_answer is listed', [[T, AHEAD, AHEAD.replace(' listed: false,', '')]]],
  ['forecast_answer needs write permission', [[T, AHEAD, AHEAD.replace('scope: "read"', 'scope: "write"')]]],
  ['forecast_series ignores the switch', [[T, 'if (!sw || !(await sw.enabled())) return refuse("Forecasts are not available yet. Nothing was asked.", "not_available", { data: { ok: false, looked_up: false } });\n    const raw = a.series', 'const raw = a.series']]],
  ['a switch that says no is ignored by forecast_series', [[T, '!sw || !(await sw.enabled())) return refuse("Forecasts are not available yet. Nothing was asked.", "not_available", { data: { ok: false, looked_up: false } });\n    const raw = a.series', '!sw) return refuse("Forecasts are not available yet. Nothing was asked.", "not_available", { data: { ok: false, looked_up: false } });\n    const raw = a.series']]],
  ['the place switch turns forecasts on', [[T, 'const sw = ctx.deps.forecast;\n    if (!sw || !(await sw.enabled())) return refuse("Forecasts are not available yet. Nothing was asked.", "not_available", { data: { ok: false, looked_up: false } });\n    const raw', 'const sw = ctx.deps.forecast ?? ctx.deps.geo;\n    if (!sw || !(await sw.enabled())) return refuse("Forecasts are not available yet. Nothing was asked.", "not_available", { data: { ok: false, looked_up: false } });\n    const raw']]],
  ['forecast_answer ignores the switch', [[T, GATE, GATE.replace('if (!sw || !(await sw.enabled()))', 'if (false)')]]],
  ['the real function wires a forecast switch', [[I, 'deps: { compile, editorLink }', 'deps: { compile, editorLink, forecast: undefined as never }']]],
  ['the series length is not checked (schema and run)', [[T, 'series: { type: "array", minItems: 6, maxItems: 120,', 'series: { type: "array",'], [T, 'raw.length < 6 || raw.length > 120 ||', '']]],
  ['the years ahead are not range-checked (schema and run)', [[T, 'horizon: { type: "integer", minimum: 1, maximum: 10, description: "How many', 'horizon: { type: "integer", description: "How many'], [T, '|| horizon < 1 || horizon > 10)', ')']]],
  ['the years ahead may be fractions (schema and run)', [[T, 'horizon: { type: "integer", minimum: 1, maximum: 10, description: "How many', 'horizon: { type: "number", minimum: 1, maximum: 10, description: "How many'], [T, '!Number.isInteger(horizon) ||', '']]],
  ['a pair of three is accepted (schema and run)', [[T, 'items: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } }', 'items: { type: "array", items: { type: "number" } }'], [T, 'const y = Array.isArray(r) && r.length === 2 ? num(r[0]) : null, v = Array.isArray(r) && r.length === 2 ? num(r[1]) : null;', 'const y = Array.isArray(r) ? num(r[0]) : null, v = Array.isArray(r) ? num(r[1]) : null;']]],
  ['a fractional year is accepted', [[T, '!Number.isInteger(y) || y < 1000', 'y < 1000']]],
  ['years outside 1000 to 2200 are accepted', [[T, ' || y < 1000 || y > 2200', '']]],
  ['a huge number is accepted', [[T, ' || Math.abs(v) > 1e15', '']]],
  ['years that do not go forward are accepted', [[T, ' || (series.length && y <= series[series.length - 1][0])', '']]],
  ['any method is accepted (schema and run)', [[T, 'method: { type: "string", enum: FORECAST_METHODS, description', 'method: { type: "string", description'], [T, 'FORECAST_METHODS.includes(a.method)', 'true']]],
  ['seasonal_naive is a method', [[T, 'const FORECAST_METHODS = ["linear", "log", "moving_average"];', 'const FORECAST_METHODS = ["linear", "log", "moving_average", "seasonal_naive"];']]],
  ['any number of breaks is accepted (schema and run)', [[T, 'breaks: { type: "array", maxItems: 5,', 'breaks: { type: "array",'], [T, 'rawBreaks.length > 5 ||', '']]],
  ['a unit is not checked (schema and run)', [[T, 'unit: { type: "string", pattern: "^[A-Za-z%$ ./-]{1,30}$", description: "Optional: what', 'unit: { type: "string", description: "Optional: what'], [T, 'FORECAST_UNIT.test(a.unit)', 'true']]],
  ['the shared hourly limit is gone', nth(3, HIT, 'if (false) {')],
  ['forecasts have their own hourly bucket (not shared with the place questions)', nth(3, '"geo", LIMITS.geoQuestionsPerHourPerUser, 3600))) {', '"forecast", LIMITS.geoQuestionsPerHourPerUser, 3600))) {')],
  ['the request is written with a dataset name as well', [[T, 'askForecast({ series, horizon,', 'askForecast({ series, horizon, dataset: String(a.dataset ?? ""),']]],
  ['breaks are sent unsorted and repeated', [[T, 'const breaks = [...new Set(rawBreaks as number[])].sort((x, y) => x - y);', 'const breaks = rawBreaks as number[];']]],
  ['an unset option is sent as a key', [[T, '...(method ? { method } : {})', 'method: method as never']]],
  ['the ask claims a lookup was made', nth(3, LOOKED, 'looked_up: true, do_not_poll: false, poll_after_s: 20 });')],
  ['the ask does not say the numbers are unchecked', [[T, ' The forecast will be made from exactly the numbers you gave, which this service does not check against any source.', '']]],
  ['forecast_answer reads place questions too', [[T, 'if (!row || row.shape !== "forecast") return refuse("That forecast request', 'if (!row) return refuse("That forecast request']]],
  ['geo_answer reads forecasts', [[T, '    if (row.shape === "forecast") return refuse("That is a forecast, not a place question: read it with forecast_answer.", "not_found");\n', '']]],
  ['any schema name is accepted', [[T, 'doc.schema !== FORECAST_SCHEMA ||', '']]],
  ['a label that is not Estimated is accepted', [[T, 's.label !== "Estimated" || ', '']]],
  ['a kind that is not estimated is accepted', [[T, ' || s.kind !== "estimated"', '']]],
  ['the number of forecast rows is not checked', [[T, ' || s.forecast.length !== horizon', '']]],
  ['forecast years need not follow the last observed year', [[T, ' || y !== prevYear + 1', '']]],
  ['a value outside its range is accepted', [[T, ' || lo > v || v > hi', '']]],
  ['a range that narrows with distance is accepted', [[T, ' || hi - lo < prevWidth - 1e-9', '']]],
  ['a row of other than four numbers is accepted', [[T, ' || r.length !== 4) return null;', ') return null;']]],
  ['a test that hid no years is accepted', [[T, ' || hidden < 1', '']]],
  ['more inside the range than were tested is accepted', [[T, ' || inside > of', '']]],
  ['a test with nothing in it is accepted', [[T, ' || of < 1', '']]],
  ['the benchmark claim need not be true or false', [[T, ' || typeof b.beats_benchmark !== "boolean"', '']]],
  ['the benchmark error is not required', [[T, 'bench === null || ', '']]],
  ['the method and basis are not checked for markup or control characters', [[T, 'const method = str(s.method, 300), basis = str(s.basis, 300);', 'const method = typeof s.method === "string" ? s.method : null, basis = typeof s.basis === "string" ? s.basis : null;']]],
  ['the unit is not checked', [[T, 'const unit = s.unit === undefined || s.unit === "" ? "" : str(s.unit, 30);', 'const unit = String(s.unit ?? "");']]],
  ['the engine words are not checked for markup or control characters', [[T, 'const t = str(w, 700); if (t === null) return null; words.push(t);', 'if (typeof w !== "string") return null; words.push(w);']]],
  ['any number of engine sentences is accepted', [[T, '!Array.isArray(s.words) || s.words.length > 16', '!Array.isArray(s.words)']]],
  ['the method and basis are shown unfenced', [[T, '`Method: ${untrusted("report-sentence", rep.method)} ${untrusted("report-sentence", rep.basis)}`', '`Method: ${rep.method} ${rep.basis}`']]],
  ['the engine words are shown unfenced', [[T, 'for (const w of rep.words) lines.push(untrusted("report-sentence", w));', 'for (const w of rep.words) lines.push(w);']]],
  ['a failed request\'s detail is shown unfenced', nth(2, '${row.fail_detail ? " " + untrusted("report-sentence", row.fail_detail) : ""}', '${row.fail_detail ? " " + row.fail_detail : ""}')],
  ['a stuck request still tells the AI to keep checking', nth(2, 'do_not_poll: stuck, poll_after_s: stuck ? null : 20', 'do_not_poll: false, poll_after_s: 20')],
  ['the answer checks have no limit', nth(2, 'if (!(await ctx.policy.hit(ctx.principal, "geo_read", LIMITS.geoReadsPerHourPerUser, 3600))) {', 'if (false) {')],
  ['the opening does not say the years are not measured or the numbers unchecked', [[T, ' These years are not measured, and this service did not check the numbers against any source.', '']]],
  ['the range is not said to be no promise', [[T, 'It is not a promise.', '']]],
  ['the test is not shown', [[T, 'The test: hiding the last', 'Hiding the last']]],
  ['no warning when the method was no better than doing nothing', [[T, '(bt.beats ? ', '(true ? ']]],
  ['no warning when the range was too narrow in the test', [[T, 'if (rep.narrow) lines.push(', 'if (false) lines.push(']]],
  ['a too-narrow range is only believed when the engine says so', [[T, 's.band_too_narrow_in_test === true || inside * 2 < of', 's.band_too_narrow_in_test === true']]],
  ['a too-narrow range is only believed from the counts', [[T, 's.band_too_narrow_in_test === true || inside * 2 < of', 'inside * 2 < of']]],
  ['the structured answer denies the numbers were supplied by the AI', [[T, 'from_supplied_numbers: true', 'from_supplied_numbers: false']]],
  ['the structured answer drops the range warning', [[T, 'band_too_narrow_in_test: rep.narrow, looked_up: true', 'band_too_narrow_in_test: false, looked_up: true']]],
  ['the real function names a database call that does not exist', [[D, '"connect_forecast_ask"', '"connect_forecast_asks"']]],
  ['the series travels as an array (a Postgres array literal)', [[D, 'JSON.stringify(q.series)', 'q.series']]],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/migrations'), path.join(scratch, 'supabase/migrations'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
function cleanup() { fs.rmSync(scratch, { recursive: true, force: true }); }          // the scratch copy sits inside the repo, so node finds the repo's node_modules by itself; nothing is linked
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); cleanup(); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, edits] of mutants) {
  cleanup(); fresh();
  let broken = false;
  for (const [file, from, to] of edits) {
    const target = path.join(scratch, file);
    const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; broken = true; break; }
    fs.writeFileSync(target, src.replace(from, () => to));
  }
  if (broken) continue;
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
cleanup();
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
