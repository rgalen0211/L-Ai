// Must-fail proof for tests/connect-open-all.test.mjs (Connect-an-AI opens to every signed-up account at launch): each mutant breaks ONE thing in a scratch copy of the migration, rollback or live steps and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_open_all_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-openall');
const MG = 'supabase/migrations/20261121000700_connect_ai_open_to_all.sql', RB = 'supabase/rollbacks/20261121000700_connect_ai_open_to_all_rollback.sql', ON = 'supabase/live-steps/36_connect_open_ON.sql', OFF = 'supabase/live-steps/37_connect_open_OFF.sql', CHK = 'supabase/live-steps/35_connect_open_check.sql';
const SUITES = ['connect-open-all.test.mjs'];
const mutants = [
  ['the flag is ON by default', MG, 'open_to_all boolean not null default false;', 'open_to_all boolean not null default true;'],
  ['the flag may be null', MG, 'open_to_all boolean not null default false;', 'open_to_all boolean default false;'],
  ['an administrator counts as allowed when open', MG, "     and not exists (select 1 from public.app_admins ad where ad.user_id = p_owner)\n", ''],
  ['a worker counts as allowed when open', MG, "     and not exists (select 1 from public.workers w where w.user_id = p_owner)\n", ''],
  ['an account an administrator disabled is let in when open', MG, 'or (ryagram_private.connect_open() and not exists (select 1 from public.connect_access a where a.user_id = p_owner)))', 'or ryagram_private.connect_open())'],
  ['the list no longer lets its enabled accounts in', MG, 'exists (select 1 from public.connect_access a where a.user_id = p_owner and a.enabled)\n          or', 'false\n          or'],
  ['a missing owner is allowed when open', MG, 'select p_owner is not null\n', 'select true\n'],
  ['the helper is not a security definer', MG, "language sql stable security definer set search_path = '' as $$ select coalesce((select open_to_all", "language sql stable set search_path = '' as $$ select coalesce((select open_to_all"],
  ['the helper is open to the signed-in role', MG, 'revoke all on function ryagram_private.connect_open() from public, anon, authenticated, connect_runner;', 'revoke all on function ryagram_private.connect_open() from public, anon, connect_runner;'],
  ['anyone may flip it, not just an administrator', MG, "  if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;\n  update public.connect_flags set open_to_all", "  update public.connect_flags set open_to_all"],
  ['the admin function is open to anon', MG, 'grant execute on function public.admin_connect_set_open(boolean) to authenticated;', 'grant execute on function public.admin_connect_set_open(boolean) to authenticated, anon;'],
  ['the migration turns the flag on itself', MG, 'select ryagram_private.gate_apply();', 'update public.connect_flags set open_to_all = true where id;\nselect ryagram_private.gate_apply();'],
  ['the rollback does not restore the old rule', RB, '  select exists (select 1 from public.connect_access a where a.user_id = p_owner and a.enabled)\n', '  select true\n'],
  ['the rollback leaves the flag column behind', RB, 'alter table public.connect_flags drop column open_to_all;\n', ''],
  ['the ON step turns it off', ON, 'set open_to_all = true', 'set open_to_all = false'],
  ['the OFF step leaves it on', OFF, 'set open_to_all = false', 'set open_to_all = true'],
  ['the check no longer looks for the administrator exclusion', CHK, "         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%app_admins%'\n", ''],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase'), path.join(scratch, 'supabase'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests/connect-open-all.test.mjs'), path.join(scratch, 'tests/connect-open-all.test.mjs'));
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
