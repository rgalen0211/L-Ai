// set_compilation_request: CLIP LABELS (BUILDER 11-04 19:27, builder-clip-labels-1104): "file" labels every video clip with its file's name, "file_and_time" with the name and where in the file the clip starts. DATA only, like every other
// field; the desktop app makes the labels from file names and times alone. Against the connector's own code and its in-memory stand-in world. Must-fails are in tests/connect_request_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };

function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId);
  const call = (p, name, args) => callTool(name, args, p, { data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  return { w, call };
}
const project = async (call) => (await call(A, 'create_project', { title: 'Labels' })).data.project_id;
const GOOD = (project_id) => ({ project_id, phrase: 'great news', folders: ['My Videos'] });
const saved = (w, id) => w.users.get(A.userId).requests.get(id).request;

test('the schema offers clip_labels: exactly "file" or "file_and_time", optional, nothing else', () => {
  const t = TOOLS.find((x) => x.name === 'set_compilation_request');
  const p = t.inputSchema.properties.clip_labels;
  assert.equal(p.type, 'string');
  assert.deepEqual(p.enum, ['file', 'file_and_time']);
  assert.ok(!t.inputSchema.required.includes('clip_labels'), 'optional');
});

test('each setting is saved exactly as given and told back to the AI in the answer', async () => {
  for (const how of ['file', 'file_and_time']) {
    const { w, call } = world();
    const id = await project(call);
    const r = await call(A, 'set_compilation_request', { ...GOOD(id), clip_labels: how });
    assert.equal(r.isError, undefined, r.text);
    assert.equal(r.data.clip_labels, how);
    assert.equal(saved(w, id).clip_labels, how);
    assert.equal(w.users.get(A.userId).requests.get(id).sha256, r.data.request_sha256);
  }
});

test('not given: the saved request has NO clip_labels key (older requests and drafts are exactly as before) and the answer carries none', async () => {
  const { w, call } = world();
  const id = await project(call);
  const r = await call(A, 'set_compilation_request', GOOD(id));
  assert.equal(r.isError, undefined, r.text);
  assert.equal('clip_labels' in saved(w, id), false);
  assert.equal('clip_labels' in r.data, false);
});

test('it travels with the other optional fields without disturbing them (cards stay, the key order is not a contract)', async () => {
  const { w, call } = world();
  const id = await project(call);
  const r = await call(A, 'set_compilation_request', { ...GOOD(id), clip_labels: 'file_and_time', cards: [{ text: 'Hello', where: 'start', seconds: 2 }] });
  assert.equal(r.isError, undefined, r.text);
  const q = saved(w, id);
  assert.equal(q.clip_labels, 'file_and_time'); assert.deepEqual(q.cards, [{ text: 'Hello', where: 'start', seconds: 2 }]); assert.equal(r.data.cards, 1);
});

test('MUST FAIL: any other word, a boolean, a number, an object or an empty string is refused and nothing is saved', async () => {
  const { w, call } = world();
  const id = await project(call);
  for (const bad of ['name', 'File', 'file_and_times', 'time', '', true, 1, null, { how: 'file' }, ['file']]) {
    const r = await call(A, 'set_compilation_request', { ...GOOD(id), clip_labels: bad });
    assert.equal(r.isError, true, JSON.stringify(bad) + ' must be refused');
    assert.equal(r.code, 'args', JSON.stringify(bad));
  }
  assert.equal(w.users.get(A.userId).requests.size, 0);
});
