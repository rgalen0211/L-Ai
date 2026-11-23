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
const SUITES = ['connect-join-open.test.mjs', 'connect-join-adult.test.mjs', 'connect-redeem-adult.test.mjs'];
const JN = 'supabase/functions/join/join.ts', IX = 'supabase/functions/join/index.ts', RD = 'supabase/functions/redeem-invite/redeem.ts', RX = 'supabase/functions/redeem-invite/index.ts';
const COND = "if not ryagram_private.waiting_on() and not coalesce((select o.join_open from public.ops_settings o limit 1), false) then";
const mutants = [
  ['the flag is ON by default', MG, 'join_open boolean not null default false;', 'join_open boolean not null default true;'],
  ['the flag may be null', MG, 'join_open boolean not null default false;', 'join_open boolean default false;'],
  ['join_reserve ignores the flag (the old condition)', MG, COND, 'if not ryagram_private.waiting_on() then'],
  ['join is closed while the waiting list is on and the flag is off', MG, 'waiting_on() and not coalesce(', 'waiting_on() or not coalesce('],
  ['join is open whatever the flag says', MG, COND, 'if false then'],
  ['the per-caller hourly limit is loosened', MG, "interval '1 hour') >= 5", "interval '1 hour') >= 50"],
  ['the daily size is a fixed 200 again (the setting is ignored)', MG, ">= coalesce((select o.join_daily_max from public.ops_settings o limit 1), 200)", ">= 200"],
  ['the daily size falls back to a loose number', MG, "from public.ops_settings o limit 1), 200) then", "from public.ops_settings o limit 1), 2000) then"],
  ['the daily size counts tries again, not different addresses', MG, "select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day') >= coalesce(", "select count(*) from public.join_attempts where at > now() - interval '1 day') >= coalesce("],
  ['a full day answers throttled (the person is blamed)', MG, "return jsonb_build_object('ok', false, 'reason', 'full');", "return jsonb_build_object('ok', false, 'reason', 'throttled');"],
  ['the daily size can be set negative', MG, " check (join_daily_max >= 0)", ""],
  ['the daily size default is not 200', MG, "join_daily_max integer not null default 200", "join_daily_max integer not null default 20000"],
  ['the rollback leaves the daily size column behind', RB, "alter table public.ops_settings drop column join_daily_max;\n", ""],
  ['the check no longer looks at the daily size column', CHK, "and column_name = 'join_daily_max' and is_nullable = 'NO' and column_default = '200'", "and column_name = 'join_daily_max'"],
  ['the turn-taking lock is gone', MG, "  perform pg_advisory_xact_lock(hashtextextended('ryagram-join', 0));                                          -- count-then-write", '  null;  -- count-then-write'],
  ['the release no longer takes turns with join_reserve', MG, "  perform pg_advisory_xact_lock(hashtextextended('ryagram-join', 0));                                          -- takes turns with join_reserve", '  null;  -- takes turns with join_reserve'],
  ['the release gives back every try of the caller, not one', MG, 'order by a.at desc limit 1', 'order by a.at desc'],
  ['the release can be run by a signed-in person', MG, 'revoke execute on function public.join_release(text, text) from public, anon, authenticated;', 'revoke execute on function public.join_release(text, text) from public, anon;'],
  ['the release reaches back over an hour of tries', MG, "a.at > now() - interval '10 minutes'", "a.at > now() - interval '1 hour'"],
  ['the migration turns the flag on itself', MG, 'select ryagram_private.gate_apply();                       -- every', 'update public.ops_settings set join_open = true;\nselect ryagram_private.gate_apply();                       -- every'],
  ['the migration opens join_reserve to the signed-in role', MG, 'select ryagram_private.gate_apply();                       -- every', 'grant execute on function public.join_reserve(text, text) to authenticated;\nselect ryagram_private.gate_apply();                       -- every'],
  ['the migration forgets the gate line', MG, 'select ryagram_private.gate_apply();                       -- every', '-- every'],
  ['the rollback keeps the flag in the function', RB, 'if not ryagram_private.waiting_on() then', COND],
  ['the rollback leaves the flag column behind', RB, 'alter table public.ops_settings drop column join_open;\n', ''],
  ['the rollback forgets the gate line', RB, 'select ryagram_private.gate_apply();                       -- same', '-- same'],
  ['the ON step turns it off', ON, 'set join_open = true', 'set join_open = false'],
  ['the OFF step leaves it on', OFF, 'set join_open = false', 'set join_open = true'],
  ['the function no longer asks for the 18+ box', JN, '  if (body.adult_confirmed !== true) return reply(400, { error: ADULT_WORDS });', ''],
  ['any truthy value counts as the box', JN, 'if (body.adult_confirmed !== true)', 'if (!body.adult_confirmed)'],
  ['the invite does not carry the confirmation', JN, 'await deps.invite(email, `${deps.siteUrl}/app/`, { adult_confirmed: true });', 'await deps.invite(email, `${deps.siteUrl}/app/`, {} as { adult_confirmed: true });'],
  ['index.ts drops the data on the way to Supabase Auth', IX, 'inviteUserByEmail(email, { redirectTo, data })', 'inviteUserByEmail(email, { redirectTo })'],
  ['the trigger records every account, box or not', MG, "if new.raw_user_meta_data ->> 'adult_confirmed' = 'true' then", 'if true then'],
  ['the trigger can stop a sign-up (no guard)', MG, 'exception when others then', 'exception when no_data_found then'],
  ['the record table is open to the signed-in role', MG, 'revoke all on public.account_adult_confirmation from public, anon, authenticated, service_role;', 'revoke all on public.account_adult_confirmation from public, anon, service_role;'],
  ['the record table accepts any source', MG, "check (source in ('join', 'invite'))", "check (source <> '')"],
  ['the rollback leaves the 18+ table behind', RB, 'drop table public.account_adult_confirmation;', ''],
  ['the rollback leaves the 18+ trigger behind', RB, 'drop trigger account_adult_new_trg on auth.users;\n', ''],
  ['redeem-invite no longer asks for the 18+ box', RD, '  if (body.adult_confirmed !== true) return reply(400, { error: ADULT_WORDS });', ''],
  ['redeem-invite counts any truthy value as the box', RD, 'if (body.adult_confirmed !== true)', 'if (!body.adult_confirmed)'],
  ['redeem-invite does not say where the account came from', RD, '{ adult_confirmed: true, adult_source: "invite" }));', '{ adult_confirmed: true, adult_source: "join" as "invite" }));'],
  ['redeem-invite index.ts drops the data on the way to Supabase Auth', RX, 'inviteUserByEmail(email, { redirectTo, data: meta })', 'inviteUserByEmail(email, { redirectTo })'],
  ['the trigger ignores where the account came from', MG, "case when new.raw_user_meta_data ->> 'adult_source' = 'invite' then 'invite' else 'join' end", "'join'"],
  ['the record table refuses the invite source', MG, "check (source in ('join', 'invite'))", "check (source = 'join')"],
  ['the check no longer looks at the 18+ trigger', CHK, "and t.tgname = 'account_adult_new_trg' ", ''],
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
  for (const t of SUITES) fs.copyFileSync(path.join(root, 'tests', t), path.join(scratch, 'tests', t));
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
