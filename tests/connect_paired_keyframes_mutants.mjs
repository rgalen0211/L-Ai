// Must-fail proof for tests/connect-paired-keyframes.test.mjs (WALK A, CC1 18:19): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_paired_keyframes_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-pk');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-paired-keyframes.test.mjs'];
const HEAD = 'name: "get_story", title: "Read back a project\'s saved story", scope: "read", readOnly: true';
const SC = C + 'story_check.ts';
const mutants = [
  ['the paired check is gone', SC, 'if ((c.view === "paired" || c.view === "panel") && !(isObj(c.settings) && Number.isInteger(c.settings.keyframes_per_year))) {', 'if (false) {'],
  ['a panel view is let through', SC, '(c.view === "paired" || c.view === "panel") && !(isObj', '(c.view === "paired") && !(isObj'],
  ['a paired view is let through', SC, '(c.view === "paired" || c.view === "panel") && !(isObj', '(c.view === "panel") && !(isObj'],
  ['any settings object counts as measured', SC, '!(isObj(c.settings) && Number.isInteger(c.settings.keyframes_per_year))', '!isObj(c.settings)'],
  ['a map view is refused too', SC, '(c.view === "paired" || c.view === "panel") && !(isObj', '(c.view === "paired" || c.view === "panel" || c.view === "map") && !(isObj'],
  ['the refusal is not given its field path', SC, 'return mk(`${clip}/settings/keyframes_per_year`, "missing_field",', 'return mk(`${clip}`, "missing_field",'],
  ['the refusal does not say what to do instead', SC, 'A connection cannot measure it, so use a line view (it works for every dataset; a map or bars only where dataset_info says the engine draws them).', 'A connection cannot measure it.'],
  ['the AI is not told the rule before it writes the story', C + 'tools.ts', 'which is measured for each film and cannot be measured here', 'which is any number you like'],
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
