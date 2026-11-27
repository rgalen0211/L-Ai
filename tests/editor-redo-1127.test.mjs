// Live editor technical layer, first step (WEB 11-27, FACES' design 08:24): a Redo button, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, and a Shortcuts list (?). Presentation only: no control here changes data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(read('assets/app-editor-core.js'), { window, Error, Math, Number, Array, Object, String, JSON, Set, RegExp });
const E = window.ryagramEditor;
const base = () => ({ look: { 'network.color': '#6fd1bd' }, duration: 12, clips: [{ id: 'v1', track: 'video', start: 0, len: 2, label: 'one' }, { id: 'v2', track: 'video', start: 2, len: 2, label: 'two' }, { id: 'v3', track: 'video', start: 4, len: 3, label: 'three' }] });
test('REDO STEP: undo then redo restores the edit list exactly; a second redo has nothing; a new edit empties the redo stack', () => {
  const e = new E.Editor(base());
  e.do({ op: 'set_look', key: 'network.color', value: '#ff0000' }); e.do({ op: 'reorder_clip', id: 'v3', index: 0 });
  const after = JSON.stringify(e.state);
  e.undo(); e.undo();
  assert.equal(e.redoStep().ok, true); assert.equal(e.redoStep().ok, true);
  assert.equal(JSON.stringify(e.state), after, 'byte-equal after undo and redo');
  assert.equal(e.redoStep().ok, false);
  e.undo(); e.do({ op: 'set_look', key: 'network.color', value: '#00ff00' });
  assert.equal(e.redo.length, 0);
});
test('REDO GROUP: a ready-made look (several ops with one group) is undone and redone as one step', () => {
  const e = new E.Editor(base());
  e.do({ op: 'set_look', key: 'network.color', value: '#111111' }, 'you', 'g1'); e.do({ op: 'reorder_clip', id: 'v3', index: 0 }, 'you', 'g1');
  const after = JSON.stringify(e.state);
  e.undo();
  assert.equal(e.log.length, 0);
  assert.equal(e.redoStep().ok, true);
  assert.equal(JSON.stringify(e.state), after); assert.equal(e.log.length, 2);
});
test('PAGE: Redo button next to Undo (disabled with nothing to redo or while locked), the keys skip typing fields, the list names only keys that exist, and the draft redo sends the op again', () => {
  const page = read('assets/app-editor.js'), draft = read('assets/app-editor-draft.js');
  assert.ok(page.includes("btn('Redo', 'secondary'") && page.includes('redoBtn.disabled = locked || histBusy || commitOpen() || ed.redo.length === 0'));
  assert.ok(page.includes('undoBtn, redoBtn, revertBtn'));
  assert.ok(page.includes("if (typingIn(ev.target) || ev.altKey) return;") && page.includes("(k === 'y' || (k === 'z' && ev.shiftKey))") && page.includes("ev.key === '?'"));
  for (const w of ['Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Space', 'In Pro:']) assert.ok(page.includes(w), w);
  assert.ok(draft.includes('async function redoNow()') && draft.includes('const r = await sendNow(ops, top.group || null);') && draft.includes('undo, redo, undoAi'));
});
