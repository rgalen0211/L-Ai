// The gate every tool call passes (connect-core/dispatch.ts): the paths where something BREAKS. Added by the coverage audit of 2026-10-19: the existing tests prove
// what the gate refuses when everything works; these pin that a failing database never lets a call through, that a failing log never changes the answer, that a tool's
// own error never shows its raw text, and that an unknown tool name is never logged as supplied. Each has a mutant in tests/connect_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };

/** A world where every database access the tools make is counted, and the policy can be made to fail. */
function setup({ policy = {}, dataOverrides = {} } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId);
  const calls = { data: 0, hit: 0 };
  const realData = w.data(A.userId);
  const data = new Proxy(realData, {
    get(t, k) {
      const v = dataOverrides[k] ?? t[k];
      return typeof v === 'function' ? (...a) => { calls.data++; return v.apply(t, a); } : v;
    },
  });
  const base = w.policy();
  const pol = { ...base, hit: async (...a) => { calls.hit++; return base.hit(...a); }, ...policy };
  const call = (name, args = {}, principal = A) => callTool(name, args, principal, { data, policy: pol, deps: { compile } });
  return { w, call, calls };
}

test('a grant lookup that FAILS never lets the call through: an error, the tool is not run, the log says why', async () => {
  const { w, call, calls } = setup({ policy: { grantFor: async () => { throw new Error('connection to db-secret-host.example failed'); } } });
  const r = await call('list_projects');
  assert.equal(r.isError, true); assert.equal(r.code, 'error');
  assert.doesNotMatch(r.text, /db-secret-host|connection/i, 'the raw error text is never shown');
  assert.equal(calls.data, 0, 'the tool did not run');
  assert.deepEqual(w.logs.map((l) => [l.tool, l.result, l.code]), [['list_projects', 'error', 'grant_lookup']]);
});

test('a rate-limit lookup that FAILS never lets the call through (the tools fail CLOSED, unlike the open sign-in endpoints)', async () => {
  const { w, call, calls } = setup({ policy: { hit: async () => { throw new Error('limiter down'); } } });
  const r = await call('list_projects');
  assert.equal(r.isError, true); assert.equal(r.code, 'error'); assert.doesNotMatch(r.text, /limiter down/);
  assert.equal(calls.data, 0, 'the tool did not run');
  assert.deepEqual(w.logs.map((l) => [l.tool, l.result, l.code]), [['list_projects', 'error', 'limit_lookup']]);
});

test('the ladder limit failing closed too: a sheet is not started when the hourly counter cannot be read', async () => {
  const { call, calls } = setup({ policy: { hit: async (_p, bucket) => { if (bucket === 'ladder') throw new Error('down'); return true; } } });   // only the hourly ladder counter fails
  const made = await call('create_project', { title: 'Gate' });
  assert.equal(made.isError, undefined);
  const before = calls.data;
  const r = await call('make_contact_sheet', { project_id: made.data.project_id });
  assert.equal(r.isError, true); assert.equal(r.code, 'error');
  assert.equal(calls.data, before, 'no database work was done for the refused call');
});

test('a failing log write changes nothing the person sees', async () => {
  const { call } = setup({ policy: { log: async () => { throw new Error('log table full'); } } });
  const r = await call('list_projects');
  assert.equal(r.isError, undefined, 'the call still succeeds');
  const refused = await call('request_full_render', { project_id: '00000000-0000-4000-8000-000000000001', confirm: true });
  assert.equal(refused.isError, true);
  assert.doesNotMatch(refused.text, /log table/);
});

test('a tool that throws shows the person a plain sentence, never the raw message, and the log records tool_error', async () => {
  const { w, call } = setup({ dataOverrides: { listProjects: async () => { throw new Error('select * from secret_table failed at db-host-9'); } } });
  const r = await call('list_projects');
  assert.equal(r.isError, true); assert.equal(r.code, 'error');
  assert.doesNotMatch(r.text, /secret_table|db-host/);
  assert.match(r.text, /could not do that right now/i);
  assert.deepEqual(w.logs.map((l) => [l.result, l.code]), [['error', 'tool_error']]);
});

test('an unknown tool is refused, its name is cut in the answer, and the log records "unknown", never the supplied text', async () => {
  const { w, call, calls } = setup();
  const evil = 'drop_table_' + 'x'.repeat(200) + '<script>';
  const r = await call(evil);
  assert.equal(r.isError, true); assert.equal(r.code, 'unknown_tool');
  assert.ok(r.text.length < 200, 'the supplied name is cut');
  assert.equal(calls.data, 0); assert.equal(calls.hit, 0, 'an unknown tool consumes no rate');
  assert.equal(w.logs.length, 1); assert.equal(w.logs[0].tool, 'unknown');
});

test('the gate order holds: no grant and no scope are refused BEFORE any rate counter or database work, and arguments are checked before the tool runs', async () => {
  const { w, call, calls } = setup();
  const stranger = { tokenHash: 'h-x', userId: 'u-nobody', clientId: 'client-claude' };
  const r = await call('list_projects', {}, stranger);
  assert.equal(r.code, 'no_grant'); assert.equal(calls.hit, 0, 'no rate counter was touched'); assert.equal(calls.data, 0);
  const bad = await call('list_projects', ['not', 'an', 'object']);
  assert.equal(bad.code, 'args'); assert.equal(calls.data, 0, 'the tool did not run');
  const bad2 = await call('create_project', { title: 'x', extra: 'not allowed' });
  assert.equal(bad2.code, 'args'); assert.equal(calls.data, 0);
  assert.ok(w.logs.every((l) => l.result === 'refused'));
});
