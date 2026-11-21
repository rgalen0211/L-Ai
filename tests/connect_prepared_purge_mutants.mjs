// Must-fail proof for tests/connect-prepared-purge.test.mjs (the daily connector purge also runs the prepared-data purge): each mutant breaks ONE thing in a scratch copy of the migrations, rollback or live step and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_prepared_purge_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-prepurge');
const MG = 'supabase/migrations/20261120000600_prepared_purge_daily.sql', RB = 'supabase/rollbacks/20261120000600_prepared_purge_daily_rollback.sql', DATA = 'supabase/migrations/20261120000500_prepared_data.sql', CHK = 'supabase/live-steps/38_prepared_purge_after_check.sql';
const SUITES = ['connect-prepared-purge.test.mjs'];
const mutants = [
  ['connect_purge never calls the prepared purge', MG, "  if to_regprocedure('ryagram_private.prepared_purge()') is not null then\n    begin\n      execute 'select to_jsonb(ryagram_private.prepared_purge())' into f;\n    exception when others then\n      f := jsonb_build_object('error', sqlstate);", "  if false then\n    begin\n      execute 'select to_jsonb(ryagram_private.prepared_purge())' into f;\n    exception when others then\n      f := jsonb_build_object('error', sqlstate);"],
  ['a failing prepared purge is no longer swallowed', MG, "exception when others then\n      f := jsonb_build_object('error', sqlstate);", "exception when no_data_found then\n      f := jsonb_build_object('error', sqlstate);"],
  ['the guard on the function existing is dropped', MG, "if to_regprocedure('ryagram_private.prepared_purge()') is not null then", "if true then"],
  ['the answer loses the prepared key', MG, ", 'edit', e, 'prepared', f);", ", 'edit', e);"],
  ['the editor purge call is lost from the new function', MG, "execute 'select ryagram_private.edit_purge()' into e;", "e := null;"],
  ['the migration grants connect_purge to the signed-in role', MG, "select ryagram_private.gate_apply();", "grant execute on function public.connect_purge() to authenticated;\nselect ryagram_private.gate_apply();"],
  ['the rollback keeps the prepared call', RB, ", 'edit', e);", ", 'edit', e, 'prepared', 0);"],
  ['the one-day rule for decided rows becomes thirty days', DATA, "(state <> 'waiting' and decided_at < now() - interval '1 day')", "(state <> 'waiting' and decided_at < now() - interval '30 days')"],
  ['the seven days become thirty', DATA, "expires_at timestamptz not null default now() + interval '7 days',", "expires_at timestamptz not null default now() + interval '30 days',"],
  ['the after-check no longer looks for the prepared key', CHK, "''prepared'', f", "''prepared'', g"],
  ['the after-check no longer looks at who can run the purge', CHK, "not has_function_privilege('anon', to_regprocedure('public.connect_purge()'), 'execute')", "true"],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase'), path.join(scratch, 'supabase'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests/connect-prepared-purge.test.mjs'), path.join(scratch, 'tests/connect-prepared-purge.test.mjs'));
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
