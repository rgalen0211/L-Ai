// Sign-up opens at launch (CONNECT 2026-11-21, CC1's 12:4x order; migrations/20261121000800_join_open.sql, NOT APPLIED), read from the SQL files: runs nothing and talks to nothing.
// Customer step: a stranger can make an account at launch without waiting for Ryan.
// What is pinned: the flag is OFF by default and not null; join_reserve is the 20261106000100 function PLUS one condition (take the flag out and it is the old function, character for character), so the limits, the lock and the answers are the old ones;
// nothing but live step 47 turns it on, 48 turns it off; the migration grants and revokes nothing and ends with the gate line; the rollback restores the old function byte for byte and drops the flag.
// The local-Postgres proof is supabase/tests/test_join_open.py. Must-fails: tests/connect_join_open_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const MIG = flat(read('supabase/migrations/20261121000800_join_open.sql'));
const RB = flat(read('supabase/rollbacks/20261121000800_join_open_rollback.sql'));
const OLD = flat(read('supabase/migrations/20261106000100_waiting_gate_hardening.sql'));
const fn = (sql, name) => { const m = new RegExp('create (?:or replace )?function ' + name.replace('.', '\\.') + '\\([^)]*\\)[\\s\\S]*?end \\$\\$;', 'i').exec(sql); assert.ok(m, 'no definition of ' + name); return m[0]; };

test('the flag is OFF by default and not null, on the one settings row; the migration turns nothing on', () => {
  assert.match(MIG, /^begin; create table public\.account_adult_confirmation /);
  assert.match(MIG, / alter table public\.ops_settings add column join_open boolean not null default false; /);
  assert.ok(!/join_open\s*=\s*true/.test(MIG), 'no update that turns it on');
  assert.match(MIG, / alter table public\.ops_settings add column join_daily_max integer not null default 200 check \(join_daily_max >= 0\); /, 'the daily size: not null, default 200, never negative');
  assert.match(MIG, / select ryagram_private\.gate_apply\(\); commit;$/);
  assert.ok(!/\bdrop /i.test(MIG), 'no drop');
  assert.deepEqual(MIG.match(/\bgrant [^;]*;/gi), ['grant execute on function public.join_release(text, text) to service_role;'], 'the only grant is the service role on the NEW join_release: join_reserve keeps its owner and grants through create or replace');
  const revokes = (MIG.match(/revoke [^;]*;/g) || []).map((x) => x.replace(/^revoke (all|execute) on (table |function )?/, '').split(' ')[0]);
  assert.deepEqual(revokes, ['public.account_adult_confirmation', 'ryagram_private.account_adult_new()', 'public.join_release(text,'], 'the only revokes are on the three new objects');
  const rel = fn(MIG, 'public.join_release');
  assert.match(rel, /security definer set search_path = ''/);
  assert.match(rel, /pg_advisory_xact_lock\(hashtextextended\('ryagram-join', 0\)\)/, 'takes turns with join_reserve');
  assert.match(rel, /order by a\.at desc limit 1/, 'gives back ONE try, the newest');
  assert.match(rel, /a\.at > now\(\) - interval '10 minutes'/, 'only a try made in the last 10 minutes: the one just counted');
  assert.match(MIG, /revoke execute on function public\.join_release\(text, text\) from public, anon, authenticated;/);
});

test('join_reserve is the 20261106000100 function plus exactly two changes: with the flag taken out and the daily size read from the setting (as its own answer), it is the old function character for character', () => {
  const now = fn(MIG, 'public.join_reserve'), before = fn(OLD, 'public.join_reserve');
  const FULLBLOCK = "if (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day') >= coalesce((select o.join_daily_max from public.ops_settings o limit 1), 200) and not exists (select 1 from public.join_attempts a where a.email_hash = eh and a.at > now() - interval '1 day') then return jsonb_build_object('ok', false, 'reason', 'full'); end if; ";
  const noflag = now.replace(' and not coalesce((select o.join_open from public.ops_settings o limit 1), false)', '');
  assert.notEqual(noflag, now, 'the flag condition is there');
  assert.ok(noflag.includes(FULLBLOCK), 'the daily size is read from the setting and answers its own reason full, before the per-caller limits');
  const stripped = noflag.replace(FULLBLOCK, '').replace("email_hash = eh and at > now() - interval '1 day') >= 3 then", "email_hash = eh and at > now() - interval '1 day') >= 3 or (select count(*) from public.join_attempts where at > now() - interval '1 day') >= 200 then");
  assert.equal(stripped, before);
  assert.match(now, /if not ryagram_private\.waiting_on\(\) and not coalesce\(\(select o\.join_open from public\.ops_settings o limit 1\), false\) then return jsonb_build_object\('ok', false, 'reason', 'off'\); end if;/);
});

test('the limits and the lock are still there with the flag on (5 an hour, 10 a day per caller, 3 a day per address, the daily size from the setting with 200 as the fallback, one lock)', () => {
  const f = fn(MIG, 'public.join_reserve');
  for (const part of ["pg_advisory_xact_lock(hashtextextended('ryagram-join', 0))", "interval '1 hour') >= 5", "interval '1 day') >= 10", "email_hash = eh and at > now() - interval '1 day') >= 3", "coalesce((select o.join_daily_max from public.ops_settings o limit 1), 200)", "return jsonb_build_object('ok', false, 'reason', 'full')", "return jsonb_build_object('ok', false, 'reason', 'throttled')", "reason', 'email'"]) assert.ok(f.includes(part), part);
});

test('the rollback restores the 20261106000100 function byte for byte, drops the flag, and ends with the gate line', () => {
  assert.equal(fn(RB, 'public.join_reserve'), fn(OLD, 'public.join_reserve'));
  assert.ok(!/join_open/.test(fn(RB, 'public.join_reserve')));
  assert.match(RB, /alter table public\.ops_settings drop column join_daily_max; alter table public\.ops_settings drop column join_open; drop trigger account_adult_new_trg on auth\.users; drop function ryagram_private\.account_adult_new\(\); drop table public\.account_adult_confirmation; select ryagram_private\.gate_apply\(\); commit;$/);
  assert.ok(fs.existsSync(new URL('../supabase/rollbacks/20261121000800_join_open_rollback.sql', import.meta.url)) && !fs.existsSync(new URL('../supabase/migrations/20261121000800_join_open_rollback.sql', import.meta.url)), 'the rollback is outside migrations/');
});

test('ONLY live step 47 turns it on and 48 turns it off; no other SQL file in the repo sets it', () => {
  assert.match(flat(read('supabase/live-steps/47_join_open_ON.sql')), /update public\.ops_settings set join_open = true;/);
  assert.match(flat(read('supabase/live-steps/48_join_open_OFF.sql')), /update public\.ops_settings set join_open = false;/);
  for (const d of ['supabase/migrations', 'supabase/live-steps', 'supabase/rollbacks', 'supabase/connect-live']) for (const f of fs.readdirSync(new URL('../' + d + '/', import.meta.url)).filter((x) => x.endsWith('.sql'))) {
    if (f === '47_join_open_ON.sql') continue;
    assert.ok(!/join_open\s*=\s*true/i.test(flat(read(d + '/' + f))), d + '/' + f + ' must not turn the flag on');
  }
});

test('the check step (46) names every column, looks at the flag, the function text, the grants and the settings row, and says which way the flag is', () => {
  const c = flat(read('supabase/live-steps/46_join_open_check.sql'));
  assert.equal((c.match(/union all select/g) || []).length, 7, 'eight rows');
  for (const part of ["column_name = 'join_open' and is_nullable = 'NO'", "like '%join_open%'", "like '%waiting_on()%'", "has_function_privilege('service_role', to_regprocedure('public.join_reserve(text,text)')", "not has_function_privilege('authenticated', to_regprocedure('public.join_reserve(text,text)')", "not has_function_privilege('anon', to_regprocedure('public.join_reserve(text,text)')", "like '%pg_advisory_xact_lock%'", "like '%join_daily_max%'", "like '%''full''%'", "column_name = 'join_daily_max' and is_nullable = 'NO' and column_default = '200'", "to_regprocedure('public.join_release(text,text)') is not null", "has_table_privilege('anon', 'public.ops_settings', 'select')", "has_table_privilege('service_role', 'public.ops_settings', 'update')", "CLOSED by this flag", "the brake, step 20", "to_regclass('public.account_adult_confirmation') is not null", "has_table_privilege('authenticated', 'public.account_adult_confirmation', 'select')", "t.tgname = 'account_adult_new_trg'"]) assert.ok(c.includes(part), part);
});

test('nothing else in the repo redefines join_reserve after the hardening except this file (so the flag cannot be lost to a later migration)', () => {
  const later = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql') && f > '20261106000100_waiting_gate_hardening.sql' && f !== '20261121000800_join_open.sql');
  for (const f of later) assert.ok(!/function public\.join_reserve/.test(read('supabase/migrations/' + f)), f + ' redefines join_reserve');
});

test('the 18+ record: a closed table, one row per account, written only by the trigger when the new account carries adult_confirmed = true, and never able to stop a sign-up', () => {
  assert.match(MIG, /create table public\.account_adult_confirmation \( user_id uuid primary key references auth\.users \(id\) on delete cascade, confirmed_at timestamptz not null default now\(\), source text not null check \(source in \('join', 'invite'\)\) \);/);
  assert.match(MIG, /alter table public\.account_adult_confirmation enable row level security; revoke all on public\.account_adult_confirmation from public, anon, authenticated, service_role;/);
  assert.ok(!/create policy/i.test(MIG), 'no policy: nothing for the account gate to cover');
  const t = fn(MIG, 'ryagram_private.account_adult_new');
  assert.match(t, /security definer set search_path = ''/);
  assert.match(t, /begin begin if new\.raw_user_meta_data ->> 'adult_confirmed' = 'true' then insert into public\.account_adult_confirmation \(user_id, source\) values \(new\.id, case when new\.raw_user_meta_data ->> 'adult_source' = 'invite' then 'invite' else 'join' end\) on conflict \(user_id\) do nothing; end if; exception when others then raise warning /);
  assert.match(MIG, /create trigger account_adult_new_trg after insert on auth\.users for each row execute function ryagram_private\.account_adult_new\(\);/);
  assert.ok(!/confirmed_at\s*=|update public\.account_adult_confirmation/i.test(MIG), 'the time is the moment of the row, never set from the metadata');
});
