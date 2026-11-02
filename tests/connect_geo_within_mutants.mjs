// Must-fail proof for tests/connect-geo-within.test.mjs (NEXT-CONNECT 193): each mutant breaks ONE thing (or, where two layers check the same rule, both layers) in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_geo_within_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-geo');
const C = 'supabase/functions/connect-core/';
const T = C + 'tools.ts', Y = C + 'types.ts', I = 'supabase/functions/connect/index.ts';
const SUITES = ['connect-geo-within.test.mjs'];
const HEAD = 'title: "What is within N minutes of this place", scope: "read", readOnly: true, listed: false,';
// each mutant: [name, [[file, from, to], ...]]
const mutants = [
  ['the tool is listed', [[T, HEAD, HEAD.replace(' listed: false,', '')]]],
  ['the tool needs write permission', [[T, HEAD, HEAD.replace('scope: "read"', 'scope: "write"')]]],
  ['the tool says it is not read-only', [[T, HEAD, HEAD.replace('readOnly: true', 'readOnly: false')]]],
  ['the switch is ignored (the tool works with nothing wired)', [[T, 'if (!sw || !(await sw.enabled())) return refuse("Questions about places', 'if (false) return refuse("Questions about places']]],
  ['a switch that says no is ignored', [[T, '!sw || !(await sw.enabled())) return refuse("Questions about places', '!sw) return refuse("Questions about places']]],
  ['the real function wires a geo switch', [[I, 'deps: { compile }', 'deps: { compile, geo: undefined as never }']]],
  ['latitude is not range-checked (schema and run)', [[T, 'minimum: -90, maximum: 90,', ''], [T, 'lat < -90 || lat > 90 ||', '']]],
  ['minutes are not range-checked (schema and run)', [[T, 'type: "integer", minimum: 1, maximum: 60,', 'type: "integer",'], [T, '|| minutes < 1 || minutes > 60)', ')']]],
  ['minutes may be fractions (schema and run)', [[T, 'type: "integer", minimum: 1, maximum: 60,', 'type: "number", minimum: 1, maximum: 60,'], [T, '!Number.isInteger(minutes) ||', '']]],
  ['category names are not checked (schema and run)', [[T, 'pattern: "^[a-z][a-z0-9_]{1,30}$" }, description: "Kinds', '}, description: "Kinds'], [T, 'typeof c !== "string" || !GEO_CATEGORY.test(c)', 'typeof c !== "string"']]],
  ['any number of categories (schema and run)', [[T, 'categories: { type: "array", maxItems: 4,', 'categories: { type: "array",'], [T, 'raw.length > 4 ||', '']]],
  ['a repeated category is asked twice', [[T, 'const categories = [...new Set(raw as string[])];', 'const categories = raw as string[];']]],
  ['the hourly limit is gone', [[T, 'if (!(await ctx.policy.hit(ctx.principal, "geo", LIMITS.geoQuestionsPerHourPerUser, 3600))) {', 'if (false) {']]],
  ['the hourly limit is far too high', [[Y, 'geoQuestionsPerHourPerUser: 30,', 'geoQuestionsPerHourPerUser: 3000,']]],
  ['the lookup is given more than the four fields', [[T, 'sw.within({ lat, lon, minutes, categories })', 'sw.within({ lat, lon, minutes, categories, place: String(a.place ?? "") } as never)']]],
  ['a number not labelled Estimated is shown', [[T, 'if (!isObj(v) || v.label !== "Estimated") return null;', 'if (!isObj(v)) return null;']]],
  ['the whole-answer label is not checked', [[T, ' || doc.label_for_everything !== "Estimated"', '']]],
  ['the range label is not checked', [[T, ' || site.residents_range.label !== "Estimated"', '']]],
  ['any schema name is accepted', [[T, 'doc.schema !== GEO_SCHEMA ||', '']]],
  ['an answer for other minutes is accepted', [[T, ' || num(doc.minutes) !== minutes', '']]],
  ['an answer for two sites is accepted', [[T, ' || doc.sites.length !== 1', '']]],
  ['a missing asked category is accepted', [[T, 'if (!n) return null;', 'if (!n) continue;']]],
  ['the engine text is not checked for control characters or folders', [[T, 'const assumptions = str(doc.assumptions, 1600);', 'const assumptions = typeof doc.assumptions === "string" ? doc.assumptions : null;'],
    [T, 'const note = str(v.note, 1600), source = str(v.source, 300);', 'const note = typeof v.note === "string" ? v.note : null, source = typeof v.source === "string" ? v.source : null;']]],
  ['the engine sentences are shown unfenced', [[T, 'Assumed, not measured: ${untrusted("report-sentence", rep.assumptions)}', 'Assumed, not measured: ${rep.assumptions}']]],
  ['the answer does not say Estimated', [[T, '(estimated) around', 'around']]],
  ['the answer does not say it is a circle', [[T, 'This is a circle, not a routed drive time; a real drive time needs a road network and a routing program.', '']]],
  ['the refusal does not say nothing was looked up', [[T, 'Questions about places are not available yet. Nothing was looked up.', 'Questions about places are not available yet.']]],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
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
