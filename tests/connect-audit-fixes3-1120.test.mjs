// Pins for the third audit round (CONNECT, 2026-11-20; RENDERER's and CC1's deep reviews of connect-audit-merge-1120): text-level, offline.
// (1) the daily connector purge must survive a failing editor purge; the apply note names what the first run deletes; (2) the plan-asks migration carries the drift guard (the builder's --check proves the hashes);
// (3) the in-site AI editor's dataset lookups no longer accept an inherited object key such as constructor (the class story_check.ts closed in the connector).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('connect_purge catches a failing edit_purge, keeps the earlier deletes and answers with the error code', () => {
  const m = read('supabase/migrations/20261120000100_connect_purge_edit.sql');
  const i = m.indexOf("if to_regprocedure('ryagram_private.edit_purge()') is not null then");
  const blk = m.slice(i, m.indexOf('end if;', i));
  assert.ok(blk.includes("begin\n      execute 'select ryagram_private.edit_purge()' into e;"), 'the call sits inside a begin block');
  assert.ok(blk.includes('exception when others then') && blk.includes("e := jsonb_build_object('error', sqlstate);"), 'and an exception handler records the failure');
  assert.ok(m.indexOf('delete from public.connect_requests') < i, 'the connector deletes come before the editor purge, in the same function');
});

test('the apply note names every thing the first run deletes, including the edit log backlog and the re-apply guard', () => {
  const m = read('supabase/migrations/20261120000100_connect_purge_edit.sql');
  for (const t of ['DELETES DATA', 'THE FIRST RUN ALSO DELETES every public.edit_ops row older than 7 days', "re-apply guard", 'mirrored track list']) assert.ok(m.includes(t), t);
});

test('the plan-asks migration and its rollback check the live function first (the md5 drift guard) and the builder agrees', () => {
  for (const f of ['supabase/migrations/20261120000200_plan_asks_lock_and_host.sql', 'supabase/rollbacks/20261120000200_plan_asks_lock_and_host_rollback.sql']) {
    const t = read(f);
    assert.equal((t.match(/select md5\(replace\(f\.prosrc, chr\(13\), ''\)\) into cur/g) || []).length, 2, f + ': both functions are checked');
    assert.equal((t.match(/raise exception 'The live function/g) || []).length, 2, f + ': a drifted function stops the file');
    assert.ok(t.includes("repository''s") || t.includes('repository'), f);
  }
  assert.ok(fs.existsSync(new URL('../supabase/tests/build_plan_asks_guard.py', import.meta.url)) && fs.existsSync(new URL('../supabase/tests/test_plan_asks_guard.py', import.meta.url)));
});

test('the in-site AI editor refuses an inherited key as a dataset (constructor, __proto__), like the connector', () => {
  const t = read('supabase/functions/ai-editor/tools.ts');
  assert.ok(t.includes('if (!Object.hasOwn(DATASETS, id))') && t.includes('if (!Object.hasOwn(DATASETS, dataset))'));
  assert.ok(!/if \(!DATASETS\[(id|dataset)\]\)/.test(t), 'no truthiness lookup is left');
});
