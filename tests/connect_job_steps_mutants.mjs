// Must-fail proof for tests/connect-job-steps.test.mjs (launch slice IN 1, WORKER's row A10; GAMES 2026-11-12): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// The first is the one CC1 asked for (07:44): a planted fault that drops the step words must be caught. A baseline run on the unbroken copy must PASS first.
// Run:  node tests/connect_job_steps_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-js');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-job-steps.test.mjs'];
const T = C + 'tools.ts';
const MISSING_STEP = '" Step: not reported yet (the render machine has not said which step it is on)."';
const MISSING_LEFT = '" Time left: not known yet (no estimate has been reported for this step)."';
const mutants = [
  ['the step words are dropped from the answer', T, '    if (step) text += step.text;\n', ''],
  ['the step fields are dropped from the data', T, '...(step ? step.data : {}), ', ''],
  ['a step is worded unlike the website', T, 'drawing: "Drawing frames",', 'drawing: "Drawing",'],
  ['a missing step is left blank', T, MISSING_STEP, '""'],
  ['a missing time left is left blank', T, MISSING_LEFT, '""'],
  ['a missing time left is invented', T, MISSING_LEFT, '" Time left: ~1 min left in this step."'],
  ['the time left can read under a minute', T, 'durationWords(Math.max(60, eta))', 'durationWords(eta)'],
  ['the time left is not marked as an estimate', T, 'Time left: ~${durationWords', 'Time left: ${durationWords'],
  ['an unknown stage is shown', T, 'Object.hasOwn(STEP_WORDS, d.stage) ? d.stage : null', 'd.stage'],
  ['a stage from the object prototype is accepted', T, 'Object.hasOwn(STEP_WORDS, d.stage)', '(d.stage in STEP_WORDS)'],
  ['a count sent as text is used', T, 'const done = d ? realNum(d.done) : null', 'const done = d ? Number(d.done) : null'],
  ['more done than the total is shown', T, '${group(Math.min(done!, total!))} / ${group(total!)}', '${group(done!)} / ${group(total!)}'],
  ['the count is not grouped like the website', T, 'Math.round(n).toLocaleString("en-US")', 'String(Math.round(n))'],
  ['an unknown unit is passed through', T, 'const unit = d && d.unit === "clips" ? "clips" : "frames";', 'const unit = d && typeof d.unit === "string" ? d.unit : "frames";'],
  ['a queued job shows a step', T, 'const STEP_STATES = new Set(["claimed",', 'const STEP_STATES = new Set(["queued", "claimed",'],
  ['the minutes are rounded down unlike the website', T, 'const m = Math.round(seconds / 60);\n  if (m < 60) return `${m} min`;', 'const m = Math.floor(seconds / 60);\n  if (m < 60) return `${m} min`;'],
  ['the description does not tell the AI about the step', T, 'While it runs: the step it is on, that step\'s count and the time left,', 'While it runs:'],
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
