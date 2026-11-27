// Timeline honesty (WEB audit 11-27, FACES-EDITOR-CONTROLS-DESIGN-1127): a time edit changes only WHEN things are shown, never what they say or the data behind them.
// Pins the editor core as it is: trim, move and reorder leave the look, every clip's words, picture, source and label alone; on a film with no clips (a data film) they are refused in words;
// the slider's keys only name a position and never an op. No new rule here: it reads the core's own check() and apply().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-editor-core.js'), { window: win });
vm.runInNewContext(read('assets/app-editor-timeline.js'), { window: win, document: {}, Math, Number, Array, Object, String });
const E = win.ryagramEditor;
const plain = x => JSON.parse(JSON.stringify(x));
const base = () => ({
  look: { 'network.color': '#6fd1bd', 'state.outline_width': 2 }, duration: 12,
  clips: [
    { id: 'v1', track: 'video', start: 0, len: 3, label: 'one', source: 'a.mp4', source_start: 2, max_len: 10 },
    { id: 'v2', track: 'video', start: 3, len: 3, label: 'two', source: 'b.mp4', source_start: 1, max_len: 10 },
    { id: 'p1', track: 'pictures', start: 5, len: 2, label: 'chart', picture: 'chart.png' },
    { id: 't1', track: 'text', start: 1, len: 3, label: 'Title', text: 'Housing in 1990' }] });
const fixed = s => plain({ look: s.look, clips: s.clips.map(({ id, track, label, text, picture, source }) => ({ id, track, label, text, picture, source })).sort((a, b) => a.id < b.id ? -1 : 1) });

test('trim, move and reorder never change the look, words, pictures or sources of any clip', () => {
  const ops = [
    { op: 'trim_clip', id: 'v1', edge: 'end', to: 2 }, { op: 'trim_clip', id: 'v1', edge: 'start', to: 1 }, { op: 'trim_clip', id: 'v2', edge: 'end', to: 5 },
    { op: 'trim_clip', id: 't1', edge: 'end', to: 3.5 }, { op: 'trim_clip', id: 'p1', edge: 'start', to: 5.5 },
    { op: 'move_clip', id: 't1', start: 4 }, { op: 'move_clip', id: 'p1', start: 8 }, { op: 'reorder_clip', id: 'v2', index: 0 }];
  for (const op of ops) {
    const s = E.newState(base()), before = fixed(s);
    assert.equal(E.check(s, op), null, JSON.stringify(op));
    assert.deepEqual(fixed(E.apply(s, op)), before, JSON.stringify(op));
  }
});

test('the whole run, then Undo to the start, gives the first state byte for byte', () => {
  const ed = new E.Editor(base()), start = JSON.stringify(plain(ed.state));
  for (const op of [{ op: 'trim_clip', id: 'v1', edge: 'end', to: 2 }, { op: 'move_clip', id: 't1', start: 4 }, { op: 'reorder_clip', id: 'v2', index: 0 }]) assert.equal(ed.do(op).ok, true);
  while (ed.undo().ok) { /* back to the base */ }
  assert.equal(JSON.stringify(plain(ed.state)), start);
});

test('a film with no clips (a data film) refuses every timeline op in words, and its look is untouched', () => {
  const s = E.newState({ look: { 'network.color': '#6fd1bd' }, clips: [], duration: 0 });
  for (const op of [{ op: 'trim_clip', id: 'title', edge: 'end', to: 3 }, { op: 'move_clip', id: 'outro', start: 2 }, { op: 'reorder_clip', id: 'title', index: 0 }]) {
    const why = E.check(s, op);
    assert.equal(typeof why, 'string', JSON.stringify(op)); assert.ok(why.length > 5);
  }
  assert.deepEqual(plain(s.look), { 'network.color': '#6fd1bd' });
});

test('slider keys only name a place on the slider: no op comes out of them', () => {
  const T = win.ryagramEditorTimeline;
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'j', 'k', 'l', ' ']) for (const shiftKey of [false, true]) {
    const r = T.keyTarget({ key, shiftKey, ctrlKey: false, altKey: false, metaKey: false }, { value: 5, min: 0, max: 20, step: 1 });
    if (r) assert.deepEqual(Object.keys(r).sort().filter(k => k !== 'value' && k !== 'toggle'), [], key);
  }
});
