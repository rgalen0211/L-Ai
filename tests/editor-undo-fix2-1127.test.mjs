// Undo fix 2 (WEB 11-27, reviewer): an op already undone on the server must not leave Undo stuck; a group undo that fails partway must leave screen, draft and server agreeing; the Undo button catches a thrown error.
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
const P = '00000000-0000-4000-8000-0000000000a1';
const RED = '#ff0000', GREEN = '#00ff00';
async function world(rpcWrap) {
  const m = createEditorRpcs({ projects: [P] });
  const rpc = async (name, args) => (rpcWrap ? await rpcWrap(name, args, m) : null) || (m.rpcs[name] ? m.rpcs[name](args) : { data: null, error: { code: 'PT404', message: 'x' } });
  const editor = new E.Editor({ look: { 'network.color': '#6fd1bd' } });
  const draft = D.createDraft({ rpc, project: P, mode: 'data', editor, onChange: () => {}, onSummary: () => {} });
  await draft.open();
  return { m, draft, editor };
}
const setC = v => ({ op: 'set_look', key: 'network.color', value: v });
const setT = v => ({ op: 'set_look', key: 'sequence.theme', value: v });

test('1: an op already undone on the server (by "Undo my AI\'s changes" style undo) leaves the screen with a plain sentence, and the next Undo works', async () => {
  const w = await world();
  await w.draft.send([setC(RED)]); await w.draft.send([setC(GREEN)]);
  const ops = w.m.ops.filter(o => o.project === P);
  w.m.rpcs.editor_undo({ p_project: P, p_mode: 'data', p_op_id: ops[ops.length - 1].id });          // the server undid the newest op behind the page's back
  const r = await w.draft.undo();
  assert.equal(r.ok, true); assert.equal(r.note, 'That change was already undone.');
  assert.equal(w.editor.log.length, 1); assert.equal(w.editor.redo.length, 1);
  const r2 = await w.draft.undo();                                                                    // not stuck: the older op undoes normally
  assert.equal(r2.ok, true); assert.equal(r2.note, undefined);
  assert.equal(w.editor.log.length, 0);
  assert.equal(w.m.draft(P, 'data').state.look['network.color'], undefined);
});
test('1: undone 0 for a NEWER change standing on the same setting is a real failure: the screen stays', async () => {
  const w = await world();
  await w.draft.send([setC(RED)]);
  w.m.ai.apply(P, 'data', w.draft.revision, [setC(GREEN)]);                                          // a later applied change to the same key: the server skips the undo
  const r = await w.draft.undo();
  assert.equal(r.ok, false); assert.match(r.reason, /newer change/);
  assert.equal(w.editor.log.length, 1);
});
test('1: a genuine server error leaves the screen alone', async () => {
  const w = await world((name) => (name === 'editor_undo' ? { data: null, error: { code: 'PT429', message: 'x' } } : null));
  await w.draft.send([setC(RED)]);
  const r = await w.draft.undo();
  assert.equal(r.ok, false); assert.equal(w.editor.log.length, 1);
});
test('2: a group undo that fails partway takes the undone ones off the screen, keeps the rest, and the redo stack holds them', async () => {
  let n = 0;
  const w = await world((name) => (name === 'editor_undo' && ++n === 2 ? { data: null, error: { code: 'PT429', message: 'x' } } : null));
  await w.draft.send([setC(RED), setT('dark')], 'g1');
  assert.equal(w.editor.log.length, 2);
  const r = await w.draft.undo();                                                                     // 1st op (newest) undone on the server, 2nd refused
  assert.equal(r.ok, false); assert.equal(r.partial, true); assert.match(r.reason, /parts that were undone/);
  assert.equal(w.editor.log.length, 1); assert.equal(w.editor.redo.length, 1);
  assert.equal(w.editor.log[0].op.key, 'network.color');                                              // what the server still holds is what the screen shows
  const srv = w.m.draft(P, 'data').state.look;
  assert.equal(srv['network.color'], RED); assert.equal(srv['sequence.theme'], undefined);
  assert.equal(w.editor.state.look['network.color'], RED); assert.notEqual(w.editor.state.look['sequence.theme'], 'dark');
  const r2 = await w.draft.undo();                                                                    // the rest can still be undone
  assert.equal(r2.ok, true); assert.equal(w.editor.log.length, 0);
});
test('2: a thrown rpc partway is handled the same way', async () => {
  let n = 0;
  const w = await world((name) => { if (name === 'editor_undo' && ++n === 2) throw new Error('network'); return null; });
  await w.draft.send([setC(RED), setT('dark')], 'g1');
  const r = await w.draft.undo();
  assert.equal(r.ok, false); assert.equal(w.editor.log.length, 1);
});
test('3: histRun catches a thrown error and says so in plain words; undo shows the already-undone note (page, chat editor, maker live)', () => {
  for (const f of ['assets/app-editor.js', 'tools/maker-live/live.js', 'supabase/functions/connect-core/editor_page.ts']) {
    const s = read(f).replace(/\r\n/g, '\n');
    assert.ok(s.includes("catch (e) { say('Could not undo. Try again.'); } finally { histBusy = false; paint(); }"), f);
    assert.ok(s.includes("say(r.ok ? (r.note || 'Undone.') : (r.reason || ''))"), f);
  }
});
test('3: a draft whose undo throws outright leaves the screen as it was (the page then says Could not undo)', async () => {
  const w = await world((name) => { if (name === 'editor_undo') throw new Error('boom'); return null; });
  await w.draft.send([setC(RED)]);
  const r = await w.draft.undo();
  assert.equal(r.ok, false); assert.equal(w.editor.log.length, 1);
});
