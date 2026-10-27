// The editor's side of the shared draft (assets/app-editor-draft.js) against CONNECT's stand-in of the SQL (tests/fake-editor-rpcs.js): the person's change goes to the server first and
// is applied on screen only when accepted; the AI's changes arrive by polling, tagged, and undo as a group; a stale revision brings the page up to date; the person's undo reaches the draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(here, '..', f), 'utf8');
const window = {};
const ctx = { window, Error, Math, Number, Array, Object, String, JSON, Set, Map, RegExp, Promise };
for (const f of ['assets/app-editor-core.js', 'assets/app-editor-draft.js']) vm.runInNewContext(read(f), ctx);
const E = window.ryagramEditor, D = window.ryagramEditorDraft;
const { createEditorRpcs } = createRequire(import.meta.url)('./fake-editor-rpcs.js');
const plain = x => JSON.parse(JSON.stringify(x));
const P = '00000000-0000-4000-8000-0000000000a1';
const RED = '#ff0000', GREEN = '#00ff00', BLUE = '#0000ff';

function world(mode = 'data', summary = null) {
  const m = createEditorRpcs({ projects: [P] });
  const rpc = async (name, args) => (m.rpcs[name] ? m.rpcs[name](args) : { data: null, error: { code: 'PT404', message: 'no such function' } });
  const base = mode === 'data'
    ? { look: { 'network.color': '#6fd1bd' } }
    : { duration: 12, clips: [{ id: 'v1', track: 'video', start: 0, len: 2, label: 'one' }, { id: 'v2', track: 'video', start: 2, len: 2, label: 'two' }, { id: 't1', track: 'text', start: 1, len: 3, label: 'T', text: 'Hi' }] };
  const editor = new E.Editor(base);
  const events = { change: [], summary: [] };
  const draft = D.createDraft({ rpc, project: P, mode, editor, onChange: x => events.change.push(x), onSummary: s => events.summary.push(s) });
  if (mode === 'compilation') m.app.post(P, { mirror: true, aiVisible: true, summary: summary || base });
  return { m, draft, editor, events, base };
}

test('opening a data film reads the draft: what the server holds becomes the editor\'s base', async () => {
  const w = world('data');
  w.m.rpcs.editor_apply_ops({ p_project: P, p_mode: 'data', p_base_revision: 0, p_ops: [{ op: 'set_look', key: 'network.color', value: RED }] });
  const r = await w.draft.open(look => ({ look: { 'network.color': '#6fd1bd', ...look } }));
  assert.equal(r.ok, true);
  assert.equal(w.editor.state.look['network.color'], RED);
  assert.equal(w.editor.log.length, 0);
  assert.equal(w.draft.revision, 1);
});

test('the person\'s change goes to the server first; accepted, it is applied on screen and gets its server id; refused, the screen does not change', async () => {
  const w = world('data'); await w.draft.open();
  const r = await w.draft.send([{ op: 'set_look', key: 'network.color', value: RED }]);
  assert.equal(r.ok, true);
  assert.equal(w.editor.state.look['network.color'], RED);
  assert.equal(w.m.draft(P, 'data').state.look['network.color'], RED);
  assert.equal(w.editor.log[0].by, 'you');
  assert.equal(typeof w.editor.log[0].serverId, 'number');
  const bad = await w.draft.send([{ op: 'set_look', key: 'network.color', value: 'red' }]);                    // the page's own check refuses it before any call
  assert.equal(bad.ok, false);
  assert.equal(w.editor.state.look['network.color'], RED);
  assert.equal(w.m.draft(P, 'data').revision, 1);
  assert.equal((await w.draft.send([{ op: 'set_look', key: 'bad.key', value: RED }])).ok, false);
});

test('the AI\'s change arrives on the next poll as a tagged step; our own ops are not applied twice', async () => {
  const w = world('data'); await w.draft.open();
  await w.draft.send([{ op: 'set_look', key: 'state.fill', value: BLUE }]);
  const ai = w.m.ai.apply(P, 'data', w.draft.revision, [{ op: 'set_look', key: 'network.color', value: GREEN }], 'Claude');
  assert.equal(ai.error, null);
  const r = await w.draft.poll();
  assert.equal(r.applied.length, 1);
  assert.equal(w.editor.state.look['network.color'], GREEN);
  assert.equal(w.editor.state.look['state.fill'], BLUE);
  assert.deepEqual(plain(w.editor.log.map(e => e.by)), ['you', 'ai']);
  assert.deepEqual(plain(w.editor.aiTouched()), ['look:network.color']);
  assert.equal((await w.draft.poll()).applied.length, 0);                                                       // nothing twice
  assert.equal(w.events.change.length >= 1, true);
});

test('a stale revision: the page reads the draft, applies the AI\'s change, says so, and the retry on top works', async () => {
  const w = world('data'); await w.draft.open();
  w.m.ai.apply(P, 'data', 0, [{ op: 'set_look', key: 'network.color', value: GREEN }], 'Claude');              // the AI got in first
  const r = await w.draft.send([{ op: 'set_look', key: 'state.fill', value: RED }]);
  assert.equal(r.ok, false);
  assert.equal(r.stale, true);
  assert.match(r.reason, /Your AI changed this just now/);
  assert.equal(w.editor.state.look['network.color'], GREEN);                                                    // brought up to date
  assert.equal(w.editor.state.look['state.fill'], undefined);                                                   // the person's change was not applied
  assert.equal((await w.draft.send([{ op: 'set_look', key: 'state.fill', value: RED }])).ok, true);
  assert.equal(w.m.draft(P, 'data').state.look['state.fill'], RED);
});

test('Undo my AI\'s changes reaches the draft (so the AI is told it was undone) and the screen; the AI can not repeat it at once', async () => {
  const w = world('data'); await w.draft.open();
  w.m.ai.apply(P, 'data', 0, [{ op: 'set_look', key: 'network.color', value: GREEN }], 'Claude');
  await w.draft.poll();
  const r = await w.draft.undoAi();
  assert.equal(r.ok, true);
  assert.equal(r.undone, 1);
  assert.equal(w.editor.state.look['network.color'], '#6fd1bd');
  assert.equal(w.m.draft(P, 'data').state.look['network.color'], undefined);
  const again = w.m.ai.apply(P, 'data', w.draft.revision, [{ op: 'set_look', key: 'network.color', value: GREEN }], 'Claude');
  assert.equal(again.error.code, 'PT409');                                                                      // the person undid exactly this a moment ago
  assert.match(again.error.message, /undid exactly this/);
});

test('the person\'s undo is sent with its server id; with nothing to undo it does nothing', async () => {
  const w = world('data'); await w.draft.open();
  assert.equal((await w.draft.undo()).ok, false);
  await w.draft.send([{ op: 'set_look', key: 'network.color', value: RED }]);
  const r = await w.draft.undo();
  assert.equal(r.ok, true);
  assert.equal(w.editor.state.look['network.color'], '#6fd1bd');
  assert.equal(w.m.draft(P, 'data').state.look['network.color'], undefined);
  assert.equal(w.m.ops.find(o => o.actor === 'person').status, 'undone');
});

test('a compilation: the computer\'s summary is the base; the person\'s ops go to the app as pending; a film the app has not shared is refused in words, nothing applied', async () => {
  const w = world('compilation'); await w.draft.open();
  assert.equal(w.draft.mirrored, true);
  const r = await w.draft.send([{ op: 'reorder_clip', id: 'v2', index: 0 }]);
  assert.equal(r.ok, true);
  assert.equal(r.pending, true);
  assert.equal(w.editor.state.clips[0].id, 'v2');
  assert.equal(w.m.app.pending(P).length, 1);                                                                   // the computer will apply it
  const lone = world('compilation'); lone.m.app.post(P, { mirror: false });
  await lone.draft.open();
  const refused = await lone.draft.send([{ op: 'reorder_clip', id: 'v2', index: 0 }]);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /Ryagram app on your computer has not shared/);
  assert.equal(lone.editor.state.clips[0].id, 'v1');                                                            // not applied
});

test('a new track summary from the computer replaces the clips (and says so); the AI sees a track list only when the person shared it', async () => {
  const w = world('compilation'); await w.draft.open();
  const next = { duration: 13, clips: [{ id: 'v1', track: 'video', start: 0, len: 2, label: 'one' }, { id: 'v9', track: 'video', start: 2, len: 3, label: 'new' }] };
  w.m.app.post(P, { mirror: true, aiVisible: false, summary: next });
  const r = await w.draft.poll();
  assert.equal(r.ok, true);
  assert.deepEqual(plain(w.editor.state.clips.map(c => c.id)), ['v1', 'v9']);
  assert.equal(w.events.summary.length >= 2, true);
  assert.equal(w.draft.aiVisible, false);
  const ai = w.m.ai.apply(P, 'compilation', w.draft.revision, [{ op: 'trim_clip', id: 'v9', edge: 'end', to: 4 }], 'Claude');
  assert.equal(ai.error.code, 'PT403');                                                                         // not shared with the AI
});

test('the add_clip and unset_look ops are in the vocabulary; a project that is not the person\'s looks absent; the heartbeat is a call, not a change', async () => {
  const s = E.newState({ duration: 12, lanes: ['video', 'text'], clips: [{ id: 'v1', track: 'video', start: 0, len: 2, label: 'a' }] });
  assert.equal(E.check(s, { op: 'add_clip', track: 'text', start: 3, len: 2.5, text: 'Added' }), null);
  assert.match(E.check(s, { op: 'add_clip', track: 'video', start: 3, len: 2 }), /text line or a picture/);
  assert.match(E.check(s, { op: 'add_clip', track: 'pictures', start: 3, len: 2, picture: 'p' }), /can not be edited here yet/);
  assert.match(E.check(s, { op: 'add_clip', track: 'text', start: 11.5, len: 2.5, text: 'x' }), /outside the film/);
  assert.equal(E.apply(s, { op: 'add_clip', track: 'text', start: 3, len: 2.5, text: 'Added' }).clips.at(-1).text, 'Added');
  assert.equal(E.check(E.newState({ look: { 'network.color': '#000000' } }), { op: 'unset_look', key: 'network.color' }), null);
  assert.deepEqual(plain(E.apply(E.newState({ look: { 'network.color': '#000000' } }), { op: 'unset_look', key: 'network.color' }).look), {});
  const w = world('data');
  const other = D.createDraft({ rpc: async (n, a) => w.m.rpcs[n](a), project: '00000000-0000-4000-8000-0000000000ff', mode: 'data', editor: w.editor });
  assert.equal((await other.open()).ok, false);
  assert.equal((await w.draft.heartbeat()).error, null);
  assert.equal(w.m.draft(P, 'data').revision, 0);
});
