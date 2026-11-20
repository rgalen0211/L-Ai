// Must-fail proof for tests/connect-structured-errors.test.mjs (NEXT-CONNECT 157): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_structured_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-se');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-structured-errors.test.mjs'];
const HEAD = 'name: "get_story", title: "Read back a project\'s saved story", scope: "read", readOnly: true';
const SC = C + 'story_check.ts';
const mutants = [
  ['the other kind rules are listed (follow-on noise)', SC, 'if (inOther || e.keyword === "oneOf") { suppressed++; continue; }', 'if (e.keyword === "oneOf") { suppressed++; continue; }'],
  ['the "must match exactly one" error is listed', SC, 'if (inOther || e.keyword === "oneOf") { suppressed++; continue; }', 'if (inOther) { suppressed++; continue; }'],
  ['suppressed messages are not counted', SC, 'if (inOther || e.keyword === "oneOf") { suppressed++; continue; }', 'if (inOther || e.keyword === "oneOf") { continue; }'],
  ['a clip with no usable kind gets both branch complaints', SC, 'if (branch === null) {', 'if (false) {'],
  ['a title rule and the schema both say the same thing', SC, 'if (branch === 0 && titleHasExtra.has(n) &&', 'if (false &&'],
  ['clips are listed before the story as a whole', SC, 'errors.sort((a, b) => clipOf(a.path) - clipOf(b.path));', 'errors.sort((a, b) => clipOf(b.path) - clipOf(a.path));'],
  ['the schema errors carry no paths (the detailed errors are not exposed)', C + 'ajv_adapter.ts', 'fn.detailed = (value', 'fn.detailedOff = (value'],
  ['set_story failure is a tool error again', C + 'tools.ts', 'refused: true, code: "checks_failed", failedChecks: n,', 'isError: true, code: "checks_failed", failedChecks: n,'],
  ['set_story failure is not counted as refused in the log', C + 'dispatch.ts', 'r.isError || r.refused ? "refused" : "ok"', 'r.isError ? "refused" : "ok"'],
  ['the structured errors are left out of the result', C + 'tools.ts', 'errors: chk.errors, failed_checks: chk.plain', 'failed_checks: chk.plain'],
  ['the old plain list is left out of the result', C + 'tools.ts', 'errors: chk.errors, failed_checks: chk.plain', 'errors: chk.errors'],
  ['the full-render refusal says ok', C + 'tools.ts', 'data: { ok: false, allowed: false, started: false', 'data: { ok: true, allowed: false, started: false'],
  ['the full-render refusal is a tool error again', C + 'tools.ts', 'return { text: `${reason} ${what}`, refused: true,', 'return { text: `${reason} ${what}`, isError: true,'],
  ['a title card with a bad length is not given its field path', SC, 'return mk(`${clip}/${field}`, "length",', 'return mk(`${clip}`, "length",'],
];

// How many copies of each fault's "from" text its target file has today (11-20 audit, CC1 MEDIUM 2). The planted fault replaces the FIRST copy, so a later copy could move it to another tool; a fault whose count is not what is written here (default 1) is refused as BROKEN, in words, and must be looked at.
const COPIES = {};
const wantCopies = (name, i) => { const w = COPIES[name]; return Array.isArray(w) ? w[i] : (w ?? 1); };
const copiesProblem = (src, from, name, i) => { const have = src.split(from).length - 1, want = wantCopies(name, i); return have === want ? null : (have ? `BROKEN MUTANT (${have} copies of the text, expected ${want}): ${name}` : `BROKEN MUTANT (text not found): ${name}`); };
function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
const base = run(scratch).status;
if (base) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const problem = copiesProblem(src, from, name, 0);
  if (problem) { console.log(problem); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
