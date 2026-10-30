// Guided footage (NEXT-CONNECT 161, PUNCH P10, the part that needs no decision): the compilation request the AI writes can carry a MEDIA CHECKLIST of footage the PERSON gets for themselves.
// TEXT ONLY: Ryagram downloads nothing, the AI sends no file, and no item can carry a web address or a place on a computer. The connector half; the desktop app's half is tools/check-media-checklist.py.
// tests/connect_checklist_mutants.mjs proves each must-fail by breaking the code.
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
  w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId);
  const env = () => ({ data: w.data(A.userId), policy: w.policy(), deps: { compile } });
  const call = (name, args) => callTool(name, args, A, env());
  return { w, call };
}
const project = async (call) => (await call('create_project', { title: 'Compilation' })).data.project_id;
const ITEM = { what: 'The 1969 launch, wide shot', from: 'the National Archives', must_contain: 'the words "lift-off"', folder: 'Apollo', count: 2 };
const GOOD = (project_id, extra = {}) => ({ project_id, phrase: 'lift-off', folders: ['Apollo', 'Hearings'], checklist: [ITEM], ...extra });

test('the schema: an optional, bounded checklist whose items are closed objects', () => {
  const t = TOOLS.find((x) => x.name === 'set_compilation_request');
  const c = t.inputSchema.properties.checklist;
  assert.ok(c, 'has a checklist'); assert.equal(c.type, 'array'); assert.equal(c.maxItems, 12);
  assert.equal(c.items.additionalProperties, false);
  assert.deepEqual(c.items.required, ['what', 'folder']);
  assert.deepEqual(Object.keys(c.items.properties).sort(), ['count', 'folder', 'from', 'must_contain', 'what']);
  assert.ok(!t.inputSchema.required.includes('checklist'), 'optional: older callers keep working');
  assert.ok(!('url' in c.items.properties) && !('path' in c.items.properties) && !('link' in c.items.properties), 'no field can carry a place or a link');
});

test('a checklist is saved with the request: ids c1.. are given by the tool, text is cut clean, the count defaults to 1; nothing is built', async () => {
  const { w, call } = world();
  const id = await project(call);
  const r = await call('set_compilation_request', GOOD(id, { checklist: [ITEM, { what: '  A hearing\u0007 clip  ', folder: ' Hearings ' }] }));
  assert.equal(r.isError, undefined, r.text);
  assert.equal(r.data.checklist, 2);
  const stored = w.users.get(A.userId).requests.get(id).request;
  assert.deepEqual(stored.checklist, [
    { id: 'c1', what: 'The 1969 launch, wide shot', from: 'the National Archives', must_contain: 'the words "lift-off"', folder: 'Apollo', count: 2 },
    { id: 'c2', what: 'A hearing clip', from: '', must_contain: '', folder: 'Hearings', count: 1 },
  ]);
  const u = w.users.get(A.userId);
  assert.deepEqual([u.jobs.length, u.credits, u.held], [0, 100, 0]);
});

test('no checklist: the stored request is exactly what it was before (no empty field)', async () => {
  const { w, call } = world();
  const id = await project(call);
  await call('set_compilation_request', { project_id: id, phrase: 'great news', folders: ['My Videos'] });
  assert.ok(!('checklist' in w.users.get(A.userId).requests.get(id).request));
  await call('set_compilation_request', { project_id: id, phrase: 'great news', folders: ['My Videos'], checklist: [] });
  assert.ok(!('checklist' in w.users.get(A.userId).requests.get(id).request), 'an empty list stores nothing');
});

test('MUST-FAIL: a web address or a link anywhere in an item is refused and nothing is saved', async () => {
  const { w, call } = world();
  const id = await project(call);
  for (const bad of ['https://archive.example/video', 'file:///c/x.mp4', 'www.nasa.gov/video', 'archives.gov', 'see nasa.gov/media', 'ftp://host/x', 'www.somewhere']) {
    for (const field of ['what', 'from', 'must_contain']) {
      const r = await call('set_compilation_request', GOOD(id, { checklist: [{ ...ITEM, [field]: bad }] }));
      assert.equal(r.isError, true, `${field}: ${bad}`); assert.equal(r.code, 'args', `${field}: ${bad}`);
    }
  }
  assert.equal(w.users.get(A.userId).requests.size, 0, 'nothing was saved');
  const ok = await call('set_compilation_request', GOOD(id, { checklist: [{ ...ITEM, from: 'the U.S. National Archives, film section' }] }));
  assert.equal(ok.isError, undefined, 'a site named in words is fine: ' + ok.text);
});

test('MUST-FAIL: a place on the computer in an item is refused', async () => {
  const { call } = world();
  const id = await project(call);
  for (const bad of ['C:\\Users\\Ryan\\Videos', 'D:/clips/a.mp4', '\\\\server\\share', '../up/a.mp4', 'put it in /Users/ryan/x']) {
    for (const field of ['what', 'from', 'must_contain']) {
      const r = await call('set_compilation_request', GOOD(id, { checklist: [{ ...ITEM, [field]: bad }] }));
      assert.equal(r.isError, true, `${field}: ${bad}`);
    }
  }
});

test('MUST-FAIL: an item must name one of the request\'s own folders, a folder NAME (never a path), and have words', async () => {
  const { w, call } = world();
  const id = await project(call);
  for (const bad of [{ ...ITEM, folder: 'Elsewhere' }, { ...ITEM, folder: 'C:\\Videos' }, { ...ITEM, folder: '..' }, { ...ITEM, folder: 'a/b' }, { ...ITEM, what: '' }, { ...ITEM, what: '   ' }]) {
    const r = await call('set_compilation_request', GOOD(id, { checklist: [bad] }));
    assert.equal(r.isError, true, JSON.stringify(bad)); assert.equal(r.code, 'args', JSON.stringify(bad));
  }
  assert.equal(w.users.get(A.userId).requests.size, 0);
});

test('MUST-FAIL: the bounds: at most 12 items, a count of 1 to 20, whole numbers, no extra fields, no overlong text', async () => {
  const { call } = world();
  const id = await project(call);
  const many = Array.from({ length: 13 }, () => ITEM);
  const bads = [{ checklist: many }, { checklist: [{ ...ITEM, count: 0 }] }, { checklist: [{ ...ITEM, count: 21 }] }, { checklist: [{ ...ITEM, count: 1.5 }] }, { checklist: [{ ...ITEM, count: '2' }] },
    { checklist: [{ ...ITEM, url: 'x' }] }, { checklist: [{ ...ITEM, what: 'x'.repeat(201) }] }, { checklist: [{ ...ITEM, from: 'x'.repeat(201) }] }, { checklist: 'a list' }, { checklist: [7] }];
  for (const b of bads) {
    const r = await call('set_compilation_request', GOOD(id, b));
    assert.equal(r.isError, true, JSON.stringify(b).slice(0, 80));
  }
  const twelve = await call('set_compilation_request', GOOD(id, { checklist: Array.from({ length: 12 }, () => ITEM) }));
  assert.equal(twelve.isError, undefined, 'twelve is allowed: ' + twelve.text);
});

test('saving again replaces the checklist with the new one (one request per project)', async () => {
  const { w, call } = world();
  const id = await project(call);
  await call('set_compilation_request', GOOD(id));
  await call('set_compilation_request', GOOD(id, { checklist: [{ what: 'Only this', folder: 'Hearings' }] }));
  assert.deepEqual(w.users.get(A.userId).requests.get(id).request.checklist.map((c) => c.what), ['Only this']);
  assert.equal(w.users.get(A.userId).requests.size, 1);
});

test('the checklist text that the person will read cannot carry markup or control characters', async () => {
  const { w, call } = world();
  const id = await project(call);
  const r = await call('set_compilation_request', GOOD(id, { checklist: [{ ...ITEM, what: 'A\u0000B\u202Ec clip' }] }));
  assert.equal(r.isError, undefined, r.text);
  const what = w.users.get(A.userId).requests.get(id).request.checklist[0].what;
  assert.doesNotMatch(what, /[\u0000-\u001f\u202e]/);
});
