// Clip padding controls (assets/app-editor-padding.js, NEXT-BUILDER 43), run against the editor core itself (assets/app-editor-core.js): each control is the
// core's own trim_clip op, a refused one is disabled with the core's reason, an applied one is undone exactly by the editor's Undo, and no page loads the file yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-editor-core.js'), { window: win });
vm.runInNewContext(read('assets/app-editor-padding.js'), { window: win });
const E = win.ryagramEditor, P = win.ryagramClipPadding;
const plain = x => JSON.parse(JSON.stringify(x));
const h = (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, children: children.flat().filter(c => c != null) });
const all = (el, out = []) => { if (el && typeof el === 'object') { out.push(el); el.children.forEach(c => all(c, out)); } return out; };

// Three clips of a compilation: a starts 2 s into its file; b starts at the very start of its file with 1.2 s of file; c starts 5 s into its file.
const BASE = () => ({ look: {}, duration: 0, clips: [
  { id: 'a', track: 'video', start: 0, len: 3, label: 'Take 1', source: 'one.mp4', source_start: 2, max_len: 10 },
  { id: 'b', track: 'video', start: 3, len: 1, label: 'Take 2', source: 'two.mp4', source_start: 0, max_len: 1.2 },
  { id: 'c', track: 'video', start: 4, len: 2, label: 'Take 3', source: 'three.mp4', source_start: 5, max_len: 20 }] });

test('OPS: more lead-in moves the start earlier, more lead-out the end later; they are the core\'s own trim_clip', () => {
  const a = BASE().clips[0];
  assert.deepEqual(plain(P.padOp(a, 'start', 0.25)), { op: 'trim_clip', id: 'a', edge: 'start', to: -0.25 });
  assert.deepEqual(plain(P.padOp(a, 'end', 0.1)), { op: 'trim_clip', id: 'a', edge: 'end', to: 3.1 });
  assert.equal(P.padOp(a, 'middle', 0.1), null);
  assert.ok(E.OPS.includes('trim_clip'));
});

test('APPLIED AND UNDONE: a lead-in on clip c takes its file 0.25 s earlier and the run is packed again; Undo puts every clip back exactly', () => {
  const ed = new E.Editor(E.newState ? E.newState(BASE()) : BASE());
  const before = plain(ed.state.clips);
  const c = P.controls(E, ed.state, ed.state.clips.find(x => x.id === 'c')).find(x => x.edge === 'start' && x.delta === 0.25);
  assert.equal(c.refused, null);
  assert.equal(ed.do(c.op).ok, true);
  const b = ed.state.clips.find(x => x.id === 'b'), cc = ed.state.clips.find(x => x.id === 'c');
  assert.deepEqual([cc.source_start, cc.len, cc.start, b.start, b.len], [4.75, 2.25, 4, 3, 1], 'the file starts earlier, the clip is longer, the clip before it is untouched, the run stays packed');
  assert.equal(ed.log.length, 1, 'one change in the undo list');
  assert.equal(ed.undo().ok, true);
  assert.deepEqual(plain(ed.state.clips), before);
});

test('REFUSED BY THE CORE: no lead-in before the file starts, no lead-out past its end, never shorter than a clip may be; the reason is the core\'s', () => {
  const s = E.newState ? E.newState(BASE()) : BASE();
  const b = s.clips.find(x => x.id === 'b');
  const cs = P.controls(E, s, b);
  const get = (edge, d) => cs.find(x => x.edge === edge && x.delta === d);
  assert.equal(get('start', 0.1).refused, 'That is before the start of the video file.');
  assert.equal(get('end', 0.25).refused, 'That is past the end of the video file.');
  assert.equal(get('end', 0.1).refused, null, '0.1 s more still fits in the file');
  const short = { ...b, len: 0.35, max_len: 5 };
  const s2 = { ...s, clips: [s.clips[0], short] };
  assert.match(P.controls(E, s2, short).find(x => x.edge === 'end' && x.delta === -0.1).refused, /can not be shorter than 0\.3 seconds/);
  for (const c of cs) assert.equal(c.refused, E.check(s, c.op, E.LOOK_KEYS), 'the reason is exactly the core\'s');
});

test('VIEW: one row per edge, four steps each, a refused step is disabled with its reason; a click hands the op over; read-only without a handler', () => {
  const s = E.newState ? E.newState(BASE()) : BASE();
  const b = s.clips.find(x => x.id === 'b');
  const got = [];
  const v = P.view(h, E, s, b, { onPad: op => got.push(op) });
  const buttons = all(v).filter(e => e.tag === 'button');
  assert.deepEqual(buttons.map(x => x.children[0]), ['−0.25 s', '−0.1 s', '+0.1 s', '+0.25 s', '−0.25 s', '−0.1 s', '+0.1 s', '+0.25 s']);
  const more = buttons[2];                                          // +0.1 s before the words: refused at the file's start
  assert.equal(more.attrs.disabled, true);
  assert.equal(more.attrs.title, 'That is before the start of the video file.');
  more.attrs.onclick();
  assert.deepEqual(got, [], 'a refused step does nothing even if clicked');
  const after = buttons[6];                                         // +0.1 s after the words: allowed
  assert.equal(after.attrs.disabled, undefined);
  assert.equal(after.attrs['aria-label'], 'More time after the words of Take 2: 0.1 seconds');
  after.attrs.onclick();
  assert.deepEqual(plain(got), [{ op: 'trim_clip', id: 'b', edge: 'end', to: 4.1 }]);
  assert.ok(all(P.view(h, E, s, b)).filter(e => e.tag === 'button').every(x => x.attrs.disabled === true), 'no handler: every button disabled');
  assert.deepEqual(plain(P.controls(E, s, { ...b, track: 'text' })), [], 'only video clips have padding');
});

test('NO RULES OF ITS OWN, TEXT ONLY, OFF: the file checks nothing itself, builds no HTML, and no page loads it yet', () => {
  const src = read('assets/app-editor-padding.js').replace(/\/\/.*$/gm, '');
  assert.match(src, /E\.check\(state, op, lookKeys \|\| E\.LOOK_KEYS\)/, 'every control is checked by the core');
  assert.doesNotMatch(src, /MIN_LEN|max_len|source_start|innerHTML|outerHTML|insertAdjacentHTML|localStorage|fetch\(/);
  for (const f of ['app/index.html', 'assets/app-editor.js']) if (fs.existsSync(new URL(`../${f}`, import.meta.url))) assert.doesNotMatch(read(f), /app-editor-padding|ryagramClipPadding/, f);
  const live = new URL('../tools/maker-live/live.js', import.meta.url);
  if (fs.existsSync(live)) assert.doesNotMatch(fs.readFileSync(live, 'utf8'), /ryagramClipPadding/);
});

// FOUND (for WEB, the core's owner): the editor core refuses ANY start trim below 0 ('That is outside the film.') before it looks at the track, so the FIRST
// video clip of a film can never get more lead-in, though a video start trim only moves the file (source_start) and the run is packed again. This test pins
// today's behaviour so a change to the core shows up here; the control is shown disabled with the core's own sentence.
test('FIRST CLIP (core limitation, reported to WEB): more lead-in on the clip at 0 s is refused by the core, and the control gives the core reason', () => {
  const s = E.newState ? E.newState(BASE()) : BASE();
  const a = s.clips.find(x => x.id === 'a');
  const c = P.controls(E, s, a).find(x => x.edge === 'start' && x.delta === 0.1);
  assert.equal(c.refused, 'That is outside the film.');
  assert.equal(P.controls(E, s, a).find(x => x.edge === 'start' && x.delta === -0.1).refused, null, 'less lead-in still works');
});
