// Connect-an-AI opens to every signed-up account at launch (CONNECT 2026-11-21, Ryan 11:30; migrations/20261121000700_connect_ai_open_to_all.sql, NOT APPLIED), read from the SQL files: runs nothing and talks to nothing.
// What is pinned: the flag is OFF by default; with it off the person rule is EXACTLY the old one (the rollback restores the old definition byte for byte); with it on an administrator, a worker and an account an administrator disabled are
// still refused; nothing but the admin function and the live step 36 turns it on; the migration changes nothing else. The local-Postgres proof is supabase/tests/test_connect_open.py (NOT RUN yet). Must-fails: tests/connect_open_all_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const MIG = flat(read('supabase/migrations/20261121000700_connect_ai_open_to_all.sql'));
const RB = flat(read('supabase/rollbacks/20261121000700_connect_ai_open_to_all_rollback.sql'));
const ORIGINAL = flat(read('supabase/migrations/20261018000100_connect_ai.sql'));
const fnBody = (sql, name) => { const m = new RegExp('create (?:or replace )?function ' + name.replace('.', '\\.') + '\\([^)]*\\)[\\s\\S]*?\\$\\$;', 'i').exec(sql); assert.ok(m, 'no definition of ' + name); return m[0]; };

test('the flag is OFF by default and not null, on the one flags row; nothing is turned on by the migration itself', () => {
  assert.match(MIG, /alter table public\.connect_flags add column open_to_all boolean not null default false;/);
  assert.ok(!/open_to_all\s*=\s*true|set open_to_all = (true|coalesce\(p_on)/.test(MIG.replace(fnBody(MIG, 'public.admin_connect_set_open'), '')), 'only the admin function may set it');
  assert.match(MIG, /^begin; /);
  assert.match(MIG, / select ryagram_private\.gate_apply\(\); commit;$/);
});

test('with the flag OFF the person rule is exactly the old one: the rollback restores the 20261018 definition, byte for byte', () => {
  const old = fnBody(ORIGINAL, 'ryagram_private.connect_person_ok');
  const plain = (s) => s.replace('create or replace function', 'create function');
  assert.equal(plain(fnBody(RB, 'ryagram_private.connect_person_ok')), plain(old));
  assert.match(old, /connect_access a where a\.user_id = p_owner and a\.enabled/);
});

test('with the flag ON: an administrator, a worker and an account an administrator DISABLED are still refused; an unlisted account is allowed only through the flag', () => {
  const b = fnBody(MIG, 'ryagram_private.connect_person_ok');
  assert.match(b, /select p_owner is not null/);
  assert.match(b, /exists \(select 1 from public\.connect_access a where a\.user_id = p_owner and a\.enabled\)/, 'the list still lets its enabled accounts in');
  assert.match(b, /ryagram_private\.connect_open\(\) and not exists \(select 1 from public\.connect_access a where a\.user_id = p_owner\)/, 'the flag lets in only an account with NO row (a disabled row is an explicit block that wins)');
  assert.match(b, /and not exists \(select 1 from public\.app_admins ad where ad\.user_id = p_owner\)/);
  assert.match(b, /and not exists \(select 1 from public\.workers w where w\.user_id = p_owner\)/);
  assert.ok(!/ or [^;]*open[^;]*\bis not null\b/.test(b));
});

test('the helper reads the one row as a security-definer function (like connect_on) and is closed to every API role; the admin function mirrors set_enabled: an app session and an administrator, signed-in only', () => {
  assert.match(fnBody(MIG, 'ryagram_private.connect_open'), /security definer set search_path = '' as \$\$ select coalesce\(\(select open_to_all from public\.connect_flags where id\), false\) \$\$;/);
  assert.match(MIG, /revoke all on function ryagram_private\.connect_open\(\) from public, anon, authenticated, connect_runner;/);
  assert.match(MIG, /revoke all on function public\.admin_connect_set_open\(boolean\) from public, anon, authenticated, connect_runner;/);
  assert.match(MIG, /grant execute on function public\.admin_connect_set_open\(boolean\) to authenticated;/);
  const set = fnBody(MIG, 'public.admin_connect_set_open'), en = fnBody(ORIGINAL, 'public.admin_connect_set_enabled');
  for (const part of ["perform ryagram_private.connect_app_session();", "if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;"]) { assert.ok(set.includes(part), part); assert.ok(en.includes(part), 'the same as set_enabled: ' + part); }
  assert.ok(!/grant execute[^;]*anon/.test(MIG));
});

test('the migration changes nothing else: its statements are the column, two functions, the person rule, the revokes, one grant and the gate', () => {
  const stmts = MIG.replace(/\$\$.*?\$\$/g, '$$$$').split(';').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^begin /, '').split(' ').slice(0, 4).join(' '));
  assert.deepEqual(stmts.filter((s) => !/^begin$|^commit$/.test(s)), ['alter table public.connect_flags add', 'create function ryagram_private.connect_open() returns', 'create or replace function', 'create function public.admin_connect_set_open(p_on boolean)', 'revoke all on function', 'revoke all on function', 'grant execute on function', 'select ryagram_private.gate_apply()']);
  assert.match(RB, /drop function public\.admin_connect_set_open\(boolean\); drop function ryagram_private\.connect_open\(\); alter table public\.connect_flags drop column open_to_all; select ryagram_private\.gate_apply\(\); commit;$/);
});

test('ONLY live step 36 and the admin function turn it on, and step 37 turns it off; no other SQL file in the repo sets it', () => {
  assert.match(flat(read('supabase/live-steps/36_connect_open_ON.sql')), /update public\.connect_flags set open_to_all = true where id;/);
  assert.match(flat(read('supabase/live-steps/37_connect_open_OFF.sql')), /update public\.connect_flags set open_to_all = false where id;/);
  const dirs = ['supabase/migrations', 'supabase/live-steps', 'supabase/rollbacks', 'supabase/connect-live'];
  for (const d of dirs) for (const f of fs.readdirSync(new URL('../' + d + '/', import.meta.url)).filter((x) => x.endsWith('.sql'))) {
    if (f === '36_connect_open_ON.sql' || f === '20261121000700_connect_ai_open_to_all.sql') continue;
    assert.ok(!/open_to_all\s*=\s*true/i.test(flat(read(d + '/' + f))), d + '/' + f + ' must not turn the flag on');
  }
  const check = flat(read('supabase/live-steps/35_connect_open_check.sql'));
  assert.equal((check.match(/union all select/g) || []).length, 4, 'five rows, every column named');
  for (const part of ["like '%connect_access%'", "like '%app_admins%'", "like '%workers%'", "like '%connect_open()%'", "has_function_privilege('anon'", "has_function_privilege('connect_runner'"]) assert.ok(check.includes(part), 'the check looks at ' + part);
});
