// Must-fail proof for tests/connect-join-open.test.mjs (sign-up opens at launch): each mutant breaks ONE thing in a scratch copy of the migration, rollback or live steps and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_join_open_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it; a timeout is neither "caught" nor "missed"
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '): end its node child by its own PID and write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-joinopen');
const MG = 'supabase/migrations/20261121000800_join_open.sql', RB = 'supabase/rollbacks/20261121000800_join_open_rollback.sql', ON = 'supabase/live-steps/47_join_open_ON.sql', OFF = 'supabase/live-steps/48_join_open_OFF.sql', CHK = 'supabase/live-steps/46_join_open_check.sql';
const SUITES = ['connect-join-open.test.mjs'];
const COND = "if not ryagram_private.waiting_on() and not coalesce((select o.join_open from public.ops_settings o limit 1), false) then";
const mutants = [
  ['the flag is ON by default', MG, 'join_open boolean not null default false;', 'join_open boolean not null default true;'],
  ['the flag may be null', MG, 'join_open boolean not null default false;', 'join_open boolean default false;'],
  ['join_reserve ignores the flag (the old condition)', MG, COND, 'if not ryagram_private.waiting_on() then'],
  ['join is closed while the waiting list is on and the flag is off', MG, 'waiting_on() and not coalesce(', 'waiting_on() or not coalesce('],
  ['join is open whatever the flag says', MG, COND, 'if false then'],
  ['the per-caller hourly limit is loosened', MG, "interval '1 hour') >= 5", "interval '1 hour') >= 50"],
  ['the overall daily limit is loosened', MG, "interval '1 day') >= 200", "interval '1 day') >= 2000"],
  ['the turn-taking lock is gone', MG, "  perform pg_advisory_xact_lock(hashtextextended('ryagram-join', 0));", '  null;'],
  ['the migration turns the flag on itself', MG, 'select ryagram_private.gate_apply();                       -- every', 'update public.ops_settings set join_open = true;\nselect ryagram_private.gate_apply();                       -- every'],
  ['the migration opens join_reserve to the signed-in role', MG, 'select ryagram_private.gate_apply();                       -- every', 'grant execute on function public.join_reserve(text, text) to authenticated;\nselect ryagram_private.gate_apply();                       -- every'],
  ['the migration forgets the gate line', MG, 'select ryagram_private.gate_apply();                       -- every', '-- every'],
  ['the rollback keeps the flag in the function', RB, 'if not ryagram_private.waiting_on() then', COND],
  ['the rollback leaves the flag column behind', RB, 'alter table public.ops_settings drop column join_open;\n', ''],
  ['the rollback forgets the gate line', RB, 'select ryagram_private.gate_apply();                       -- same', '-- same'],
  ['the ON step turns it off', ON, 'set join_open = true', 'set join_open = false'],
  ['the OFF step leaves it on', OFF, 'set join_open = false', 'set join_open = true'],
  ['the check no longer looks at who can run join_reserve', CHK, "         and has_function_privilege('service_role', to_regprocedure('public.join_reserve(text,text)'), 'execute')\n", ''],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase'), path.join(scratch, 'supabase'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests/connect-join-open.test.mjs'), path.join(scratch, 'tests/connect-join-open.test.mjs'));
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
