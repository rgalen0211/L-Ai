// A stranger never loses a free preview to the machine's fault (CONNECT 2026-11-23, CC1's ruling on WORKER's audit; migrations/20261123000100_free_preview_machine_faults.sql, NOT APPLIED), read from the SQL files: runs nothing.
// Customer step: a stranger whose first free preview fails because the render machine hit its own limit or is not set up for that film keeps the free preview (and, at the allowance, is not asked for a credit).
// What is pinned: the one extra condition is in the migration AND in phase-2b/credits_ledger.sql in the same words (a fresh ledger apply and a live change give the same function); the rest of the counting is the old function
// character for character; the rollback is the old function; nothing here touches an error class (error_class_for is not redefined), a table, a grant or a price; the migration does nothing without the ledger;
// it ends with the gate line; live step 51 asks about both codes. The local-Postgres proof is supabase/tests/test_free_preview_machine_faults.py. Must-fails: tests/connect_free_preview_fault_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const MIG = flat(read('supabase/migrations/20261123000100_free_preview_machine_faults.sql'));
const RB = flat(read('supabase/rollbacks/20261123000100_free_preview_machine_faults_rollback.sql'));
const LEDGER = flat(read('supabase/phase-2b/credits_ledger.sql'));
const CHK = flat(read('supabase/live-steps/51_free_preview_machine_faults_check.sql'));
const NEWRULE = "and not (state = 'failed' and (error_class = 'infrastructure' or error_code = 'engine_unsupported' or (error_code = 'limit_exceeded' and p_since is null))) and not (state = 'cancelled' and claimed_at is null)";
const OLDRULE = "and not (state = 'failed' and error_class = 'infrastructure')";
const COUNTING = "select count(*)::int from public.jobs where owner_id = p_owner and job_type = 'preview' and free_preview and (p_project is null or project_id = p_project) and (p_since is null or created_at >= p_since)";

test('the extra condition is in the migration and in the ledger file in the same words, and the rest of the counting is the old function', () => {
  assert.ok(MIG.includes(COUNTING + ' ' + NEWRULE), 'the migration: the old counting plus the one new rule');
  assert.ok(LEDGER.includes(COUNTING + ' ' + NEWRULE), 'the ledger file: the same');
  assert.ok(!LEDGER.includes(OLDRULE), 'the ledger no longer carries the old rule');
  assert.equal((MIG.match(/engine_unsupported/g) || []).length, 1);
  assert.equal((MIG.match(/limit_exceeded/g) || []).length, 1);
  assert.match(MIG, /\(error_code = 'limit_exceeded' and p_since is null\)/, 'a limit is the machine\'s fault for a project\'s 6, but still counts in the 15 a day');
  assert.match(MIG, /create or replace function ryagram_private\.free_previews_used\(p_owner uuid, p_project uuid, p_since timestamptz\) returns int language sql stable set search_path = '' as \$body\$/);
});

test('the rollback is the old function: only an infrastructure failure is skipped', () => {
  assert.ok(RB.includes(COUNTING + ' ' + OLDRULE), 'the old rule');
  assert.ok(!/engine_unsupported|limit_exceeded/.test(RB));
  assert.match(RB, / select ryagram_private\.gate_apply\(\); commit;$/);
});

test('the migration does nothing without the credits ledger, ends with the gate line, and changes no class, table, grant or price', () => {
  assert.match(MIG, /^begin; do \$mig\$ begin if to_regprocedure\('ryagram_private\.free_previews_used\(uuid,uuid,timestamptz\)'\) is null then raise notice '[^']*'; return; end if; execute \$f\$ create or replace function /);
  assert.match(MIG, / select ryagram_private\.gate_apply\(\); commit;$/);
  assert.ok(!/error_class_for/.test(MIG), 'the class of a code is not touched: the worker contract and the page rest on it');
  assert.ok(!/\b(grant|revoke|alter|drop|insert|update|delete|create table|create policy)\b/i.test(MIG.replace(/create or replace function/g, '')), 'no grant, no table, no data');
});

test('live step 51 asks about the ledger, both codes, the infrastructure rule and who may run the function; one SELECT with every column named', () => {
  assert.equal((CHK.match(/union all select/g) || []).length, 5, 'six rows');
  for (const part of ["to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is not null as ok", "like '%engine_unsupported%'", "like '%limit_exceeded%'", "like '%p_since is null%'", "like '%state = ''cancelled'' and claimed_at is null%'", "like '%state = ''failed''%'", "like '%error_class = ''infrastructure''%'", "not has_function_privilege('anon'", "not has_function_privilege('authenticated'"]) assert.ok(CHK.includes(part), part);
  assert.ok(!/\b(update|insert|delete|drop|alter|create)\b/i.test(CHK), 'read-only');
});

test('the page keeps its words for these two codes: they are keyed on the code, not on a class that moved', () => {
  const jobs = read('assets/app-jobs.js');
  assert.match(jobs, /job\.error_code === 'engine_unsupported'/);
  assert.match(jobs, /case 'limit': \{/);
});
