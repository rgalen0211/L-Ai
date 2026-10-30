// Must-fail proof for tests/connect-structured-errors.test.mjs (NEXT-CONNECT 157): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_get_story_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
fresh();
const base = run(scratch).status;
if (base) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
