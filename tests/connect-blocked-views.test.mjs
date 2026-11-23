// dataset_info tells an AI which views it may use in a story, MINUS ENGINE's v2 list of dataset+view pairs the engine fails (CONNECT 2026-11-23, GAMES 13:19 MEDIUM 1; tools/data/engine-catalog-block-list-1123.json).
// Customer step: a stranger's AI never offers a map or bars for a dataset where they fail (county permits, state unemployment, most industry shares): it offers the line. Runs the real tool; talks to nothing. Must-fails: tests/connect_blocked_views_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { BLOCKED_VIEWS } from '../supabase/functions/_shared/blocked_views.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const w = new FakeWorld(); w.addUser(A.userId, 'alice@example.test', 0); w.invite(A.userId, A.clientId);
const info = (id) => callTool('dataset_info', { dataset_id: id }, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile } });
const viewsLine = (text) => /Views to use in a story for it: ([^.]*)\./.exec(text)[1].split(', ');

test('the generated TypeScript list is exactly the committed JSON list (no drift)', () => {
  const json = JSON.parse(fs.readFileSync(new URL('../tools/data/engine-catalog-block-list-1123.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(BLOCKED_VIEWS).sort(), Object.keys(json).sort());
  for (const k of Object.keys(json)) assert.deepEqual([...BLOCKED_VIEWS[k]].sort(), [...json[k]].sort(), k);
});

test('a dataset where map and bars fail is offered as a line only, and says the others fail', async () => {
  const r = await info('bps_county_permits');
  assert.ok(!r.isError, r.text);
  assert.deepEqual(viewsLine(r.text), ['line']);
  assert.match(r.text, /A map or bars view is known to FAIL for this dataset: do not offer it\./);
});

test('a dataset where only bars fail keeps the map and the line', async () => {
  const r = await info('bls_state_unemployment');
  assert.deepEqual(viewsLine(r.text), ['line', 'map']);
  assert.match(r.text, /A bars view is known to FAIL for this dataset: do not offer it\./);
});

test('a dataset that is not on the list offers every view the engine draws, and says nothing fails', async () => {
  const r = await info('bea_cainc1_county_income_index');
  assert.deepEqual(viewsLine(r.text), ['line', 'map', 'bars']);
  assert.doesNotMatch(r.text, /known to FAIL/);
});

test('every catalog dataset the connector serves always has at least the line, and never a blocked view', async () => {
  const ids = Object.keys(BLOCKED_VIEWS);
  for (const id of ids) {
    const r = await info(id);
    if (r.isError) continue;                                   // a dataset the connector does not serve is not described at all
    const shown = viewsLine(r.text);
    assert.ok(shown.includes('line'), id);
    for (const bad of BLOCKED_VIEWS[id]) assert.ok(!shown.includes(bad), `${id} must not offer ${bad}`);
  }
});
