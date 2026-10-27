// The stand-in for the live-editor functions (tests/fake-editor-rpcs.js) behaves like the SQL where the page depends on it: same answer shapes, same refusals, same codes.
// The op check is the TypeScript twin of the SQL one, so a page built on this mock sees the real vocabulary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { opProblem } from '../supabase/functions/connect-core/edit_state.ts';

const { createEditorRpcs } = createRequire(import.meta.url)('./fake-editor-rpcs.js');
const P = '00000000-0000-4000-8000-0000000000a1';
const DARK = '#112233', LIGHT = '#EEEEEE';
const SUMMARY = { duration: 12, clips: [{ id: 'c1', track: 'video', start: 0, len: 4 }, { id: 'c2', track: 'text', start: 4, len: 3, text: 'Hello' }] };
const make = (extra = {}) => createEditorRpcs({ check: opProblem, projects: [P], ...extra });
const person = (m, mode, base, ops) => m.rpcs.editor_apply_ops({ p_project: P, p_mode: mode, p_base_revision: base, p_ops: ops });

test('the person applies a colour: the answer has the SQL\'s shape, the state is returned, the log is readable since a revision', () => {
  const m = make();
  const r = person(m, 'data', 0, [{ op: 'set_look', key: 'network.color', value: DARK }]);
  assert.equal(r.error, null);
  assert.deepEqual(r.data, { revision: 1, changes: 1, state: { look: { 'network.color': DARK } }, pending: false });
  const since = m.rpcs.my_edit_ops_since({ p_project: P, p_mode: 'data', p_revision: 0 }).data;
  assert.deepEqual(Object.keys(since).sort(), ['ai_visible', 'mirrored', 'ops', 'revision', 'state']);
  assert.deepEqual(Object.keys(since.ops[0]).sort(), ['actor', 'at', 'client', 'id', 'op', 'revision', 'status']);
  assert.equal(m.rpcs.my_edit_ops_since({ p_project: P, p_mode: 'data', p_revision: 1 }).data.ops.length, 0);
});

test('stale revision, bad op, empty and oversized batches are refused with the SQL\'s codes and change nothing', () => {
  const m = make();
  person(m, 'data', 0, [{ op: 'set_look', key: 'network.color', value: DARK }]);
  assert.equal(person(m, 'data', 0, [{ op: 'set_look', key: 'network.color', value: LIGHT }]).error.code, 'PT409');
  assert.equal(person(m, 'data', 1, [{ op: 'set_look', key: 'network.color', value: DARK }, { op: 'set_look', key: 'nope', value: 1 }]).error.code, '22023');
  assert.equal(person(m, 'data', 1, []).error.code, '22023');
  assert.equal(person(m, 'data', 1, Array.from({ length: 21 }, () => ({ op: 'unset_look', key: 'network.color' }))).error.code, '22023');
  assert.deepEqual(m.draft(P, 'data').state, { look: { 'network.color': DARK } });
  assert.equal(m.draft(P, 'data').revision, 1);
});

test('a project that is not the person\'s looks absent', () => {
  const m = make();
  const r = m.rpcs.editor_apply_ops({ p_project: '00000000-0000-4000-8000-0000000000ff', p_mode: 'data', p_base_revision: 0, p_ops: [{ op: 'unset_look', key: 'network.color' }] });
  assert.equal(r.error.code, 'PT404');
});

test('the AI\'s change shows in the person\'s next poll marked as the AI\'s, and "undo all of my AI\'s changes" takes only those back', () => {
  const m = make();
  person(m, 'data', 0, [{ op: 'set_look', key: 'state.fill', value: LIGHT }]);
  assert.equal(m.ai.apply(P, 'data', 1, [{ op: 'set_look', key: 'network.color', value: DARK }], 'Claude').error, null);
  const poll = m.rpcs.my_edit_ops_since({ p_project: P, p_mode: 'data', p_revision: 1 }).data;
  assert.deepEqual(poll.ops.map((o) => [o.actor, o.client]), [['ai', 'Claude']]);
  const u = m.rpcs.editor_undo_all_ai({ p_project: P, p_mode: 'data' }).data;
  assert.equal(u.undone, 1);
  assert.deepEqual(u.state, { look: { 'state.fill': LIGHT } });
});

test('the person undoes one AI change; the AI may not repeat it for ten minutes', () => {
  let t = 1_000_000;
  const m = make({ now: () => t });
  m.ai.apply(P, 'data', 0, [{ op: 'set_look', key: 'network.color', value: DARK }]);
  const id = m.ops[0].id;
  assert.equal(m.rpcs.editor_undo({ p_project: P, p_mode: 'data', p_op_id: id }).data.undone, 1);
  assert.equal(m.ai.apply(P, 'data', 2, [{ op: 'set_look', key: 'network.color', value: DARK }]).error.code, 'PT409');
  t += 11 * 60 * 1000;
  assert.equal(m.ai.apply(P, 'data', 2, [{ op: 'set_look', key: 'network.color', value: DARK }]).error, null);
});

test('compilation: the page needs the mirror, the AI needs the tick; the AI\'s changes wait for the app, which acknowledges them', () => {
  const m = make();
  assert.equal(person(m, 'compilation', 0, [{ op: 'delete_clip', id: 'c1' }]).error.code, 'PT403');        // not mirrored yet
  assert.equal(m.app.post(P, { mirror: true, aiVisible: false, summary: SUMMARY }).data.revision, 1);
  assert.equal(m.ai.apply(P, 'compilation', 1, [{ op: 'delete_clip', id: 'c2' }]).error.code, 'PT403');      // mirrored, but the AI is not allowed to see it
  assert.equal(person(m, 'compilation', 1, [{ op: 'move_clip', id: 'c2', start: 5 }]).data.pending, true);     // the person's page may edit the mirror
  m.app.post(P, { mirror: true, aiVisible: true, summary: SUMMARY });
  const r = m.ai.apply(P, 'compilation', m.draft(P, 'compilation').revision, [{ op: 'set_clip_text', id: 'c2', text: 'Bye' }]);
  assert.equal(r.error, null); assert.equal(r.data.state, null);
  const [w] = m.app.pending(P).slice(-1);
  assert.deepEqual(Object.keys(w).sort(), ['client', 'id', 'op', 'project_id', 'revision']);
  m.app.post(P, { mirror: true, aiVisible: true, summary: SUMMARY, applied: [{ op_id: w.id, ok: true }] });
  assert.equal(m.ops.find((o) => o.id === w.id).status, 'applied');
  m.app.post(P, { mirror: true, aiVisible: false, summary: SUMMARY });                                      // unticked
  assert.equal(m.draft(P, 'compilation').ai_visible, false);
  m.app.post(P, { mirror: false });
  assert.deepEqual([m.draft(P, 'compilation').state, m.draft(P, 'compilation').mirrored], [{}, false]);
});
