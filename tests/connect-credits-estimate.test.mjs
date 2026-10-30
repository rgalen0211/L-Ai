// What a step costs and what is left, said before asking (NEXT-CONNECT 170): get_cost_estimate. Read-only: it prices a contact sheet, a preview or the final render from the same quote the job tools use,
// starts nothing, holds nothing, and says who can start the step. Against the in-memory stand-in for the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { toolList } from '../supabase/functions/connect-core/mcp.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
function world(credits = 100) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', credits); w.addUser(B.userId, 'bob@example.test', credits);
  w.invite(A.userId, A.clientId); w.invite(B.userId, B.clientId);
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  return { w, call: (p, name, args) => callTool(name, args, p, env(p)) };
}
const goodStory = () => { const t = TEMPLATES[0]; return build(t.id, t.datasets[0], 'Cost check'); };
const project = async (call, p = A, withStory = true) => {
  const id = (await call(p, 'create_project', { title: withStory ? 'Film' : 'Empty film' })).data.project_id;       // the same title would return the same project
  if (withStory) assert.equal((await call(p, 'set_story', { project_id: id, story: goodStory() })).isError, undefined);
  return id;
};
const settle = async (call, p, jobId) => { for (let i = 0; i < 4; i++) await call(p, 'job_status', { job_id: jobId }); };
const snapshot = (w) => JSON.stringify([...w.users].map(([k, u]) => [k, u.credits, u.held, u.jobs.length, [...u.previewsUsed]]));

test('the contact sheet is free, and nothing is started or held', async () => {
  const { w, call } = world();
  const id = await project(call);
  const before = snapshot(w);
  const r = await call(A, 'get_cost_estimate', { project_id: id, step: 'contact_sheet' });
  assert.equal(r.isError, undefined, r.text);
  assert.equal(r.data.credits, 0); assert.equal(r.data.free, true); assert.equal(r.data.connection_can_start, true); assert.equal(r.data.started, false); assert.equal(r.data.credits_used, 0);
  assert.equal(r.data.available, 100); assert.equal(r.data.enough, true); assert.equal(r.data.left_after, 100);
  assert.match(r.text, /free/i); assert.match(r.text, /Nothing was started and no credits were used/);
  assert.equal(snapshot(w), before, 'asking changed something');
});

test('a preview: free while the project has free previews, then it costs credits that only the person can spend', async () => {
  const { w, call } = world();
  const id = await project(call);
  const first = await call(A, 'get_cost_estimate', { project_id: id, step: 'preview' });
  assert.equal(first.data.credits, 0); assert.equal(first.data.free_preview, true); assert.equal(first.data.connection_can_start, true);
  assert.equal(first.data.needs_contact_sheet_first, true, 'the preview waits for the finished contact sheet');
  assert.match(first.text, /waits for the finished contact sheet/);
  const sheet = await call(A, 'make_contact_sheet', { project_id: id }); await settle(call, A, sheet.data.job_id);
  for (const [s, e] of [[0, 3], [3, 6], [6, 9]]) { const p = await call(A, 'make_preview', { project_id: id, start_seconds: s, end_seconds: e }); assert.equal(p.data.started, true, p.text); await settle(call, A, p.data.job_id); }
  const after = await call(A, 'get_cost_estimate', { project_id: id, step: 'preview' });
  assert.equal(after.data.credits, 5); assert.equal(after.data.free, false); assert.equal(after.data.free_preview, false); assert.equal(after.data.connection_can_start, false);
  assert.equal(after.data.needs_contact_sheet_first, false);
  assert.match(after.text, /would cost 5 credits/); assert.match(after.text, /cannot spend credits/);
  const left = after.data.available;
  assert.equal(after.data.left_after, left - 5);
  assert.equal(w.users.get(A.userId).held, 0, 'nothing held');
});

test('the final render: its cost, and only the person can press it', async () => {
  const { call } = world();
  const id = await project(call);
  const r = await call(A, 'get_cost_estimate', { project_id: id, step: 'final_render' });
  assert.equal(r.data.credits, 40); assert.equal(r.data.connection_can_start, false); assert.equal(r.data.enough, true); assert.equal(r.data.left_after, 60);
  assert.match(r.text, /Render final film/);
  assert.equal(r.data.started, false);
});

test('not enough credits: said plainly, with no negative balance', async () => {
  const { call } = world(30);
  const id = await project(call);
  const r = await call(A, 'get_cost_estimate', { project_id: id, step: 'final_render' });
  assert.equal(r.data.credits, 40); assert.equal(r.data.available, 30); assert.equal(r.data.enough, false); assert.equal(r.data.left_after, null);
  assert.match(r.text, /not enough/);
});

test('refusals: a project that is not yours, no saved story, a bad step, extra arguments', async () => {
  const { call } = world();
  const id = await project(call);
  assert.equal((await call(B, 'get_cost_estimate', { project_id: id, step: 'preview' })).code, 'not_found', "another person's project");
  assert.equal((await call(A, 'get_cost_estimate', { project_id: '00000000-0000-4000-8000-0000000000ff', step: 'preview' })).code, 'not_found');
  const empty = await project(call, A, false);
  assert.equal((await call(A, 'get_cost_estimate', { project_id: empty, step: 'preview' })).code, 'no_story');
  for (const bad of [{ project_id: id }, { project_id: id, step: 'render' }, { project_id: id, step: 'preview', confirm: true }, { step: 'preview' }, { project_id: id, step: 'preview', credits: 0 }]) {
    const r = await call(A, 'get_cost_estimate', bad);
    assert.equal(r.isError, true, JSON.stringify(bad)); assert.equal(r.code, 'args', JSON.stringify(bad));
  }
});

test('the tool is listed, read-only, takes no confirm, and asking often does not use up the render ladder', async () => {
  const t = TOOLS.find((x) => x.name === 'get_cost_estimate');
  assert.ok(t && t.readOnly === true && t.scope === 'read' && !t.ladder && t.listed !== false);
  assert.equal(t.inputSchema.properties.confirm, undefined);
  assert.deepEqual(t.inputSchema.properties.step.enum, ['contact_sheet', 'preview', 'final_render']);
  assert.equal(t.inputSchema.additionalProperties, false);
  const listed = toolList().find((x) => x.name === 'get_cost_estimate');
  assert.deepEqual(listed.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const { call } = world(); const id = await project(call);
  for (let i = 0; i < 40; i++) assert.equal((await call(A, 'get_cost_estimate', { project_id: id, step: 'preview' })).isError, undefined);
  assert.equal((await call(A, 'make_contact_sheet', { project_id: id })).data.started, true, 'the render ladder is untouched by estimates');
});

test('the answer holds no internal ids or timestamps beyond what the next call needs', async () => {
  const { call } = world(); const id = await project(call);
  const r = await call(A, 'get_cost_estimate', { project_id: id, step: 'preview' });
  assert.deepEqual(Object.keys(r.data).sort(), ['available', 'connection_can_start', 'credits', 'credits_used', 'enough', 'free', 'free_preview', 'left_after', 'needs_contact_sheet_first', 'started', 'step']);
  assert.ok(!JSON.stringify(r).includes(id));
});
