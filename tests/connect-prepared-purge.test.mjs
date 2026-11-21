// The daily connector purge also runs the prepared-data purge (CONNECT 2026-11-21; GEO's 12:00 review MEDIUM 1; migrations/20261120000600_prepared_purge_daily.sql, NOT APPLIED), read from the SQL files: runs nothing and talks to nothing.
// Customer step: a customer's AI-prepared table is gone after 7 days, as the Privacy page will say. Before this, ryagram_private.prepared_purge() (20261120000500) was called by nothing, so an expired table kept its full text for ever.
// Pinned: connect_purge is the editor-purge version PLUS exactly one guarded call and one key; the rollback restores the editor-purge version byte for byte; the purge's own deletes are the 7 days and the one day;
// no other file calls or redefines it. The local-Postgres proof (supabase/tests/test_prepared_data.py, two new tests) is written and NOT RUN. Must-fails: tests/connect_prepared_purge_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const fn = (sql, name) => { const m = new RegExp('create (?:or replace )?function ' + name.replace('.', '\\.') + '\\([^)]*\\)[\\s\\S]*?end \\$\\$;', 'i').exec(sql); assert.ok(m, 'no definition of ' + name); return m[0]; };
const NEW = read('supabase/migrations/20261120000600_prepared_purge_daily.sql');
const EDIT = read('supabase/migrations/20261120000100_connect_purge_edit.sql');
const DATA = read('supabase/migrations/20261120000500_prepared_data.sql');
const RB = read('supabase/rollbacks/20261120000600_prepared_purge_daily_rollback.sql');

test('the new connect_purge is the editor-purge version plus exactly one guarded call and one key: take them out and it is the old function, character for character', () => {
  const now = fn(NEW, 'public.connect_purge'), before = fn(EDIT, 'public.connect_purge');
  const stripped = now
    .replace('declare a int; b int; c int; d int; e jsonb := null; f jsonb := null;', 'declare a int; b int; c int; d int; e jsonb := null;')
    .replace(/  -- AI-prepared tables[^\n]*\n  if to_regprocedure\('ryagram_private\.prepared_purge\(\)'\) is not null then\n    begin\n      execute 'select to_jsonb\(ryagram_private\.prepared_purge\(\)\)' into f;\n    exception when others then\n      f := jsonb_build_object\('error', sqlstate\);[^\n]*\n    end;\n  end if;\n/, '')
    .replace(", 'edit', e, 'prepared', f);", ", 'edit', e);");
  assert.equal(flat(stripped), flat(before));
});

test('the call is guarded exactly like the editor\'s: skipped without the function, and a failure there never stops the purge above it; the answer gains the key prepared', () => {
  const f = flat(fn(NEW, 'public.connect_purge'));
  assert.match(f, /if to_regprocedure\('ryagram_private\.prepared_purge\(\)'\) is not null then begin execute 'select to_jsonb\(ryagram_private\.prepared_purge\(\)\)' into f; exception when others then f := jsonb_build_object\('error', sqlstate\); end; end if;/);
  assert.match(f, /return jsonb_build_object\('requests', a, 'codes', b, 'tokens', c, 'calls', d, 'edit', e, 'prepared', f\);/);
  assert.ok(f.indexOf('edit_purge') < f.indexOf('prepared_purge'), 'after the editor purge, so neither can stop the other');
});

test('same function, same grants: create or replace keeps them, nothing is granted or revoked, and the file ends with the usual gate', () => {
  const body = flat(NEW);
  assert.ok(!/\b(grant|revoke|drop|alter) /i.test(body), 'no grant, revoke, drop or alter');
  assert.match(body, /^begin; create or replace function public\.connect_purge\(\) returns jsonb language plpgsql security definer set search_path = '' as \$\$/);
  assert.match(body, / select ryagram_private\.gate_apply\(\); commit;$/);
});

test('the rollback restores the editor-purge version byte for byte (no prepared call, no prepared key)', () => {
  assert.equal(flat(fn(RB, 'public.connect_purge')), flat(fn(EDIT, 'public.connect_purge')));
  assert.ok(!/prepared/.test(flat(fn(RB, 'public.connect_purge'))));
});

test('what the call removes is the 7 days and the one day the Privacy page and the migration promise, and ONLY this function calls it', () => {
  const p = flat(fn(DATA, 'ryagram_private.prepared_purge'));
  assert.match(p, /delete from public\.prepared_data where expires_at < now\(\) or \(state <> 'waiting' and decided_at < now\(\) - interval '1 day'\);/);
  assert.match(DATA, /expires_at[^\n]*interval '7 days'/);
  const callers = [];
  for (const d of ['supabase/migrations', 'supabase/functions', 'supabase/connect-live']) for (const f of fs.readdirSync(new URL('../' + d + '/', import.meta.url), { recursive: true }).map(String).filter((x) => /\.(sql|ts)$/.test(x))) {
    if (/prepared_purge\(\)/.test(read(d + '/' + f)) && !/20261120000500_prepared_data|20261120000600_prepared_purge/.test(f)) callers.push(d + '/' + f);
  }
  assert.deepEqual(callers, [], 'no other migration or function calls or redefines it');
});

test('the after-check (live step 38) looks at the keys, the guard, who can run connect_purge and who can run the prepared purge', () => {
  const c = flat(read('supabase/live-steps/38_prepared_purge_after_check.sql'));
  assert.equal((c.match(/union all select/g) || []).length, 3, 'four rows, every column named');
  for (const part of ["''prepared'', f", "''edit'', e", "''requests'', a", "exception when others", "has_function_privilege('anon', to_regprocedure('public.connect_purge()')", "has_function_privilege('connect_runner', to_regprocedure('ryagram_private.prepared_purge()')"]) assert.ok(c.includes(part), part);
});
