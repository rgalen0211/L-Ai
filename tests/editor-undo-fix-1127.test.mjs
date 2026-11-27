// Undo/redo fixes (WEB 11-27, CC1 review): double or held Ctrl+Z, a redo over a newer AI edit, keys behind the commit panel, a redone look keeps its group.
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
const RED = '#ff0000', GREEN = '#00ff00', BLUE = '#0000ff';
async function world(rpcWrap) {
  const m = createEditorRpcs({ projects: [P] });
  const rpc = async (name, args) => (rpcWrap ? rpcWrap(name, args, m) : null) || (m.rpcs[name] ? m.rpcs[name](args) : { data: null, error: { code: 'PT404', message: 'x' } });
  const editor = new E.Editor({ look: { 'network.color': '#6fd1bd' } });
  const draft = D.createDraft({ rpc, project: P, mode: 'data', editor, onChange: () => {}, onSummary: () => {} });
  await draft.open();
  return { m, draft, editor };
}
const setC = v => ({ op: 'set_look', key: 'network.color', value: v });

test('HIGH: two undos pressed together undo two different edits, one each; the server holds both undone', async () => {
  const w = await world();
  await w.draft.send([setC(RED)]); await w.draft.send([setC(GREEN)]);
  const [a, b] = await Promise.all([w.draft.undo(), w.draft.undo()]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(w.editor.log.length, 0);
  assert.notEqual(w.editor.state.look['network.color'], GREEN); assert.notEqual(w.editor.state.look['network.color'], RED);
  assert.equal(w.m.draft(P, 'data').state.look['network.color'], undefined);
});
test('HIGH: a server reply with undone 0 is a failure and the screen stays as it was', async () => {
  const w = await world((name, args) => (name === 'editor_undo' ? { data: { undone: 0, skipped: 1, revision: 5 }, error: null } : null));
  await w.draft.send([setC(RED)]);
  const r = await w.draft.undo();
  assert.equal(r.ok, false); assert.ok(r.reason);
  assert.equal(w.editor.log.length, 1); assert.equal(w.editor.state.look['network.color'], RED);
});
test('HIGH page: held key (ev.repeat), a running undo or redo, and the commit panel all stop the keys; buttons disable while one runs', () => {
  for (const f of ['assets/app-editor.js', 'tools/maker-live/live.js', 'supabase/functions/connect-core/editor_page.ts']) {
    const s = read(f).replace(/\r\n/g, '\n');
    assert.ok(s.includes("(ev.repeat || histBusy || commitOpen() || locked)"), f);
    assert.ok(s.includes('undoBtn.disabled = locked || histBusy || commitOpen() ||') && s.includes('redoBtn.disabled = locked || histBusy || commitOpen() ||'), f);
    assert.ok(s.includes('const histRun = async fn => { if (histBusy || commitOpen() || locked) return; histBusy = true;'), f);
    assert.ok(s.includes("renderBox.replaceChildren(); if (typeof paint === 'function') paint(); };"), f);
  }
});
test('MEDIUM a: a redo that meets a newer AI edit does not keep the older redo stack', async () => {
  const w = await world();
  await w.draft.send([setC(RED)]); await w.draft.send([setC(GREEN)]);
  await w.draft.undo(); await w.draft.undo();
  assert.equal(w.editor.redo.length, 2);
  const r1 = await w.draft.redo();                       // redoes RED
  assert.equal(r1.ok, true); assert.equal(w.editor.redo.length, 1);
  w.m.ai.apply(P, 'data', w.draft.revision, [setC(BLUE)]);
  await w.draft.poll();                                  // the newer edit empties the redo stack
  assert.equal(w.editor.redo.length, 0);
  assert.equal((await w.draft.redo()).ok, false);
  assert.equal(w.editor.state.look['network.color'], BLUE);
});
test('MEDIUM a: an AI edit landing during the redo\'s own send clears what is left to redo', async () => {
  let w, injected = false;
  w = await world((name, args, m) => {
    if (name === 'my_edit_ops_since' && !injected && w && w.editor.redo.length === 0 && w.armed) { injected = true; m.ai.apply(P, 'data', w.draft.revision, [{ op: 'set_look', key: 'sequence.theme', value: 'dark' }]); }
    return null;
  });
  await w.draft.send([setC(RED)]); await w.draft.send([setC(GREEN)]);
  await w.draft.undo(); await w.draft.undo();
  w.armed = true;
  const r = await w.draft.redo();
  assert.equal(r.ok, true);
  assert.equal(w.editor.redo.length, 0, 'the older undone op is not redoable over the newer change');
});
test('MEDIUM c: redone ready-made look keeps its group: undo, redo, undo removes it in ONE undo', () => {
  const e = new E.Editor({ look: { 'network.color': '#6fd1bd' }, duration: 12, clips: [] });
  e.do(setC(RED), 'you', 'g1'); e.do({ op: 'set_look', key: 'sequence.theme', value: 'dark' }, 'you', 'g1');
  e.undo(); assert.equal(e.log.length, 0);
  assert.equal(e.redoStep().ok, true); assert.equal(e.log.length, 2);
  assert.ok(e.log.every(x => x.group === 'g1'));
  e.undo(); assert.equal(e.log.length, 0);
  assert.equal(e.state.look['network.color'], '#6fd1bd');
});
test('MEDIUM c via the draft: redo of a group keeps the group on screen', async () => {
  const w = await world();
  await w.draft.send([setC(RED), { op: 'set_look', key: 'sequence.theme', value: 'dark' }], 'g9');
  await w.draft.undo(); await w.draft.redo();
  assert.ok(w.editor.log.length === 2 && w.editor.log.every(x => x.group === 'g9'));
  await w.draft.undo(); assert.equal(w.editor.log.length, 0);
});
