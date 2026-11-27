// THE FINAL COMPILATIONS GATE (CONNECT 11-27, CC1's 09:45 ruling: the tester door is CLOSED). The database function connect_compilations_open (migration 20261127000400) must follow BUILDER's
// ryagram_private.compilations_on EXCLUSIVELY once it exists, and before it exists be closed by default: an invited tester only, never an administrator, never a stranger.
// This test reads the migration's text (no Postgres here: the SQL test supabase/tests/test_connect_compilation_status.py is WRITTEN for CONNECT to run), so it proves the shape of the gate, not its behaviour.
// Every check has a planted fault in tests/connect_comp_final_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const MIG = read('supabase/migrations/20261127000400_connect_compilation_status.sql');
const RB = read('supabase/rollbacks/20261127000400_connect_compilation_status_rollback.sql');
const CHECK = read('supabase/live-steps/66_connect_compilation_status_check.sql');
const code = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');          // the same text without its comments

function gateBody() {
  const m = /create function ryagram_private\.connect_compilations_open\(p_person uuid\) returns boolean[\s\S]*?end \$\$;/.exec(MIG);
  assert.ok(m, 'the gate function is in the migration');
  return code(m[0]);
}

test('the gate follows BUILDER\'s compilations_on, looked up by name on every call, and returns ITS answer and nothing else', () => {
  const g = gateBody();
  assert.match(g, /if to_regprocedure\('ryagram_private\.compilations_on\(uuid\)'\) is not null then/);
  assert.match(g, /execute 'select ryagram_private\.compilations_on\(\$1\)' into is_open using p_person;/);
  assert.match(g, /return coalesce\(is_open, false\);\s*\n\s*end if;/, 'inside the lookup the only thing returned is his answer, a maybe being a no');
  const inside = g.slice(g.indexOf('execute'), g.indexOf('end if;'));
  assert.doesNotMatch(inside, /local_compute|app_admins|\bor\b/, 'no tester door, no administrator door, nothing added to his answer');
});

test('before his function exists the fallback is closed by default: an invited tester only; no administrator door, no open door', () => {
  const g = gateBody();
  const fallback = g.slice(g.indexOf('end if;') + 'end if;'.length);
  assert.match(fallback, /return coalesce\(\(select s\.local_compute from public\.account_settings s where s\.owner_id = p_person\), false\);/);
  assert.doesNotMatch(fallback, /app_admins|\btrue\b|\bor\b/, 'the fallback has no administrator door and no way to say yes by default');
  assert.doesNotMatch(g, /app_admins/, 'an administrator is nowhere in the gate');
});

test('the gate is not callable by any API role, and both functions ask it right after the person is resolved', () => {
  assert.match(code(MIG), /revoke all on function ryagram_private\.connect_compilations_open\(uuid\) from public, anon, authenticated, service_role;/);
  const get = /create function public\.connect_compilation_get[\s\S]*?end \$\$;/.exec(code(MIG))[0];
  const set = /create or replace function public\.connect_set_compilation_request[\s\S]*?end \$\$;/.exec(code(MIG))[0];
  for (const [name, body] of [['reader', get], ['writer', set]]) {
    assert.match(body, /if not ryagram_private\.connect_compilations_open\(me\) then\s*\n\s*raise exception 'Compilations are not open for this account yet\.' using errcode = '42501';/, name);
    assert.ok(body.indexOf('connect_compilations_open(me)') < body.indexOf('public.projects'), name + ': the gate comes before any read of the person\'s data');
  }
});

test('the header says plainly that BUILDER\'s function does not cover testers or administrators, what that costs, and where the one line would go', () => {
  const head = MIG.slice(0, MIG.indexOf('begin;'));
  assert.match(head, /FINAL VERSION \(CC1's ruling 09:45: the tester door is CLOSED\)/);
  assert.match(head, /does NOT cover an invited tester \(local_compute\) and does NOT cover an administrator/);
  assert.match(head, /'compilations' switch turned on \(admin_account_switch_set\), or step 82a/);
  assert.match(head, /the line belongs on BUILDER's side/);
  assert.match(head, /CLOSED BY DEFAULT/);
});

test('the after-check (live step 66) asserts the closed gate: his function by name, no administrator door; and still has its twelve rows', () => {
  assert.match(CHECK, /p\.prosrc like '%ryagram_private\.compilations_on\(\$1\)%' and p\.prosrc like '%local_compute%' and p\.prosrc not like '%app_admins%'/);
  assert.equal((CHECK.match(/union all select/g) ?? []).length, 11, 'twelve rows');
});

test('the rollback still removes exactly the gate and the reader and restores the writer without any gate', () => {
  const c = code(RB);
  assert.match(c, /drop function if exists public\.connect_compilation_get\(text, uuid\);/);
  assert.match(c, /drop function if exists ryagram_private\.connect_compilations_open\(uuid\);/);
  const writer = /create or replace function public\.connect_set_compilation_request[\s\S]*?end \$\$;/.exec(c)[0];
  assert.doesNotMatch(writer, /connect_compilations_open/);
});
