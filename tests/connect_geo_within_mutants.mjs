// Must-fail proof for tests/connect-geo-within.test.mjs (NEXT-CONNECT 193): each mutant breaks ONE thing (or, where two layers check the same rule, both layers) in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_geo_within_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-geo');
const C = 'supabase/functions/connect-core/';
const T = C + 'tools.ts', Y = C + 'types.ts', I = 'supabase/functions/connect/index.ts';
const SUITES = ['connect-geo-within.test.mjs'];
const HEAD = 'title: "What is within N minutes of this place", scope: "read", readOnly: true, listed: false,';
const AHEAD = 'title: "Read the answer to a place question", scope: "read", readOnly: true, listed: false,';
const GOFF = 'if (!sw || !(await sw.enabled())) return refuse("Questions about places are not available yet. Nothing was looked up.", "not_available", { data: { ok: false, looked_up: false } });\n    if (!(await ctx.policy.hit(ctx.principal, "geo_read"';
// nth(k, from, to): the k-th copy of `from` in tools.ts (the later tools reuse these sentences); the earlier copies are broken harmlessly first
// The marker goes right AFTER `anchor`, which must end at a token boundary (a space, a comma, `${`): an anchor that cuts an identifier or a string in two (the old fixed 12 characters did) breaks the PARSER, and the suites then
// "catch" the fault for the wrong reason. The break must also leave the suites green; both are proved by hand for every use below (11-20 audit).
const nth = (k, from, to, anchor = from.slice(0, 12)) => [...Array.from({ length: k - 1 }, () => [T, from, from.replace(anchor, () => anchor + '/*x*/')]), [T, from, to]];
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
  ['the question is written with more than the four fields', [[T, 'ctx.data.askGeo({ lat, lon, minutes, categories })', 'ctx.data.askGeo({ lat, lon, minutes, categories, place: String(a.place ?? "") } as never)']]],
  ['a number not labelled Estimated is shown', [[T, 'if (!isObj(v) || v.label !== "Estimated") return null;', 'if (!isObj(v)) return null;']]],
  ['the whole-answer label is not checked', [[T, ' || doc.label_for_everything !== "Estimated"', '']]],
  ['the range label is not checked', [[T, ' || site.residents_range.label !== "Estimated"', '']]],
  ['any schema name is accepted', [[T, 'doc.schema !== GEO_SCHEMA ||', '']]],
  ['an answer for other minutes is accepted', [[T, ' || num(doc.minutes) !== minutes', '']]],
  ['an answer for two sites is accepted', [[T, ' || doc.sites.length !== 1', '']]],
  ['a missing asked category is accepted', [[T, 'if (!n) return null;', 'if (!n) continue;']]],
  ['the engine text is not checked for control characters or folders', [[T, 'const assumptions = str(doc.assumptions, 1600);', 'const assumptions = typeof doc.assumptions === "string" ? doc.assumptions : null;'],
    [T, 'const note = str(v.note, 1600), source = str(v.source, 300);', 'const note = typeof v.note === "string" ? v.note : null, source = typeof v.source === "string" ? v.source : null;']]],
  ['the engine sentences are shown unfenced', nth(2, 'Assumed, not measured: ${untrusted("report-sentence", rep.assumptions)}', 'Assumed, not measured: ${rep.assumptions}')],
  ['the answer does not say Estimated', [[T, '(estimated) around', 'around']]],
  ['the answer does not say it is a circle', [[T, 'This is a circle, not a routed drive time; a real drive time needs a road network and a routing program.', '']]],
  ['geo_answer is listed', [[T, AHEAD, AHEAD.replace(' listed: false,', '')]]],
  ['geo_answer needs write permission', [[T, AHEAD, AHEAD.replace('scope: "read"', 'scope: "write"')]]],
  ['geo_answer ignores the switch', [[T, GOFF, GOFF.replace('if (!sw || !(await sw.enabled()))', 'if (false)')]]],
  ['the answer checks have no limit', nth(2, 'if (!(await ctx.policy.hit(ctx.principal, "geo_read", LIMITS.geoReadsPerHourPerUser, 3600))) {', 'if (false) {')],
  ['the answer-check limit is far too high', [[Y, 'geoReadsPerHourPerUser: 120,', 'geoReadsPerHourPerUser: 120000,']]],
  ['an unanswered question says it is answered', nth(2, 'Not answered yet."', 'Answered."')],
  ['a stuck question still tells the AI to keep checking', nth(2, 'do_not_poll: stuck, poll_after_s: stuck ? null : 20', 'do_not_poll: false, poll_after_s: 20')],
  ['the machine-may-be-off words are gone', nth(2, 'may be off or busy', 'is fine')],
  ['a failed question shows an answer anyway', nth(2, 'if (row.state === "failed") {', 'if (false) {', 'if (')],
  ['the workers failure detail is shown unfenced', nth(2, '${row.fail_detail ? " " + untrusted("report-sentence", row.fail_detail) : ""}', '${row.fail_detail ? " " + row.fail_detail : ""}', '${')],
  ['example data does not announce itself', [[T, 'const example = /example data/i.test(rep.assumptions);', 'const example = false;']]],
  ['the ask claims a lookup was made', [[T, 'looked_up: false, do_not_poll: false, poll_after_s: 20 }', 'looked_up: true, do_not_poll: false, poll_after_s: 20 }']]],
  ['the ask does not tell the AI to stop checking', [[T, 'Nothing was looked up here and nothing is saved but the question itself, which is deleted after 7 days." + GEO_STOP,', 'Nothing was looked up here and nothing is saved but the question itself, which is deleted after 7 days.",']]],
  ['the real function names a geo database call that does not exist', [['supabase/functions/connect/db.ts', '"connect_geo_ask"', '"connect_geo_asks"']]],
  ['the refusal does not say nothing was looked up', [[T, 'Questions about places are not available yet. Nothing was looked up.', 'Questions about places are not available yet.']]],
];

// How many copies of each fault's "from" text its target file has today (11-20 audit, CC1 MEDIUM 2). The planted fault replaces the FIRST copy, so a later copy could move it to another tool; a fault whose count is not what is written here (default 1) is refused as BROKEN, in words, and must be looked at.
const COPIES = {
  "the switch is ignored (the tool works with nothing wired)": [3],
  "a switch that says no is ignored": [3],
  "latitude is not range-checked (schema and run)": [1,2],
  "the hourly limit is gone": [3],
  "the engine text is not checked for control characters or folders": [2,1],
  "the engine sentences are shown unfenced": [2,1],
  "the answer checks have no limit": [2,1],
  "an unanswered question says it is answered": [2,1],
  "a stuck question still tells the AI to keep checking": [2,1],
  "the machine-may-be-off words are gone": [2,1],
  "a failed question shows an answer anyway": [2,1],
  "the workers failure detail is shown unfenced": [2,1],
  "the ask claims a lookup was made": [3],
  "the ask does not tell the AI to stop checking": [2],
  "the refusal does not say nothing was looked up": [3],
};
const wantCopies = (name, i) => { const w = COPIES[name]; return Array.isArray(w) ? w[i] : (w ?? 1); };
const copiesProblem = (src, from, name, i) => { const have = src.split(from).length - 1, want = wantCopies(name, i); return have === want ? null : (have ? `BROKEN MUTANT (${have} copies of the text, expected ${want}): ${name}` : `BROKEN MUTANT (text not found): ${name}`); };
function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
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
  for (const [i, [file, from, to]] of edits.entries()) {
    const target = path.join(scratch, file);
    const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const problem = copiesProblem(src, from, name, i);
    if (problem) { console.log(problem); missed++; broken = true; break; }
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
