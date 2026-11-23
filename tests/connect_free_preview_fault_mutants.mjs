// Must-fail proof for tests/connect-free-preview-fault.test.mjs (a stranger never loses a free preview to the render machine's fault): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_free_preview_fault_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-freeprev');
const SUITE = 'connect-free-preview-fault.test.mjs';
const MG = 'supabase/migrations/20261123000100_free_preview_machine_faults.sql', RB = 'supabase/rollbacks/20261123000100_free_preview_machine_faults_rollback.sql', LG = 'supabase/phase-2b/credits_ledger.sql',
  CK = 'supabase/live-steps/51_free_preview_machine_faults_check.sql', JS = 'assets/app-jobs.js';
const FILES = [MG, RB, LG, CK, JS];
const LIST = "error_code in ('engine_unsupported', 'limit_exceeded')";
const NEWLINE = "        and not (state = 'failed' and (error_class = 'infrastructure' or error_code in ('engine_unsupported', 'limit_exceeded')))";
const OLDLINE = "        and not (state = 'failed' and error_class = 'infrastructure')";
const mutants = [
  ['engine_unsupported counts against the free previews again', MG, LIST, "error_code in ('limit_exceeded')"],
  ['limit_exceeded counts against the free previews again', MG, LIST, "error_code in ('engine_unsupported')"],
  ['a timeout stops counting (it is the story\'s, and a catalog film cannot be shortened by a stranger: Ryan\'s call, not ours)', MG, LIST, "error_code in ('engine_unsupported', 'limit_exceeded', 'timeout')"],
  ['a story the engine refused stops counting', MG, LIST, "error_code in ('engine_unsupported', 'limit_exceeded', 'schema_rejected')"],
  ['an infrastructure failure counts again', MG, "(error_class = 'infrastructure' or ", "("],
  ['a preview that did not fail is skipped by its code', MG, "(state = 'failed' and (error_class = 'infrastructure' or error_code in", "((error_class = 'infrastructure' or error_code in"],
  ['the ledger file keeps the old rule (a fresh apply loses it)', LG, "    and not (state = 'failed' and (error_class = 'infrastructure' or error_code in ('engine_unsupported', 'limit_exceeded')))", "    and not (state = 'failed' and error_class = 'infrastructure')"],
  ['the migration forgets to do nothing without the ledger', MG, "    return;\n", "    null;\n"],
  ['the migration changes a class of a code', MG, 'select ryagram_private.gate_apply();', "select ryagram_private.error_class_for('limit_exceeded');"],
  ['the migration does not end with the gate line', MG, 'select ryagram_private.gate_apply();', ''],
  ['the migration also writes data', MG, '  execute $f$', "  update public.jobs set free_preview = true;\n  execute $f$"],
  ['the rollback keeps the new rule', RB, OLDLINE, NEWLINE],
  ['the check no longer asks about engine_unsupported', CK, "like '%engine_unsupported%'", "like '%engine%'"],
  ['the check no longer asks about limit_exceeded', CK, "like '%limit_exceeded%'", "like '%limit%'"],
  ['the check can change something', CK, "select 'the credits ledger is applied", "update public.jobs set free_preview = free_preview; select 'the credits ledger is applied"],
  ['the page keys the unsupported words on a class that does not exist', JS, "job.error_code === 'engine_unsupported' || job.error_class === 'engine_unsupported'", "job.error_class === 'engine_unsupported'"],
];

function run(cwd) { return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  for (const f of FILES) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(scratch, f)); }
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests', SUITE), path.join(scratch, 'tests', SUITE));
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`BROKEN MUTANT (text found ${n} times, need 1): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
