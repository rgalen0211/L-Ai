// NEXT-WEB 182: the pace choice in the live editor's compilation mode (assets/app-editor-pace.js; BUILDER 45's named paces). Standard is the default and changes nothing; Unhurried is the difference from the
// standard cut, applied as the editor core's own trim_clip ops, each checked by the core; a clip the core refuses is left as it is and named; the whole preset undoes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-editor-core.js'), { window: win, Error, Math, Number, Array, Object, String, JSON, Set, RegExp });
vm.runInNewContext(read('assets/app-editor-pace.js'), { window: win, Math, Number, Array, Object, String, JSON });
const E = win.ryagramEditor, P = win.ryagramClipPace;
const J = x => JSON.parse(JSON.stringify(x));

// Three video clips of a film: a has 3 s of file before and plenty after; b starts at the very start of its file and has no room after; c is short (0.6 s) with room both sides; one text clip.
const BASE = () => ({ look: {}, duration: 20, clips: [
  { id: 'a', track: 'video', start: 0, len: 2, label: 'Take 1', source: 'one.mp4', source_start: 3, max_len: 10, min_len: 0.3 },
  { id: 'b', track: 'video', start: 2, len: 1.5, label: 'Take 2', source: 'two.mp4', source_start: 0, max_len: 1.5, min_len: 0.3 },
  { id: 'c', track: 'video', start: 3.5, len: 0.6, label: 'Take 3', source: 'three.mp4', source_start: 4, max_len: 20, min_len: 0.3 },
  { id: 't', track: 'text', start: 1, len: 2, label: 'Title', text: 'Hi', min_len: 0.5, max_len: 30 }] });

test('Standard is the default and changes nothing: no ops, no skips, and the button says so', () => {
  assert.equal(P.PACES[0].id, 'standard');
  const pl = J(P.plan(E, new E.Editor(BASE()).state, 'standard'));
  assert.deepEqual(pl, { ops: [], skipped: [], clips: 0 });
  assert.equal(P.summary('standard', pl), 'Standard changes nothing.');
  assert.deepEqual(J(P.plan(E, new E.Editor(BASE()).state, 'nonsense')), { ops: [], skipped: [], clips: 0 });
});

test('Unhurried adds 0.08 s before and 0.12 s after each video clip where the file has room, and lengthens a clip under 1 s', () => {
  const ed = new E.Editor(BASE());
  const pl = P.plan(E, ed.state, 'unhurried');
  assert.ok(pl.ops.length >= 4, 'several ops');
  for (const op of pl.ops) { assert.equal(op.op, 'trim_clip'); assert.ok(['a', 'b', 'c'].includes(op.id), 'video clips only'); assert.ok(op.edge === 'start' || op.edge === 'end'); }
  for (const op of pl.ops) assert.equal(ed.do(op).ok, true, `the plan's ops apply in order on the real editor: ${JSON.stringify(op)}`);
  const a = ed.state.clips.find(c => c.id === 'a'), c = ed.state.clips.find(c => c.id === 'c'), t = ed.state.clips.find(c => c.id === 't');
  assert.ok(Math.abs(a.len - 2.2) < 1e-6, `a is 0.2 s longer (${a.len})`); assert.ok(Math.abs(a.source_start - 2.92) < 1e-6, 'its file starts 0.08 s earlier');
  assert.ok(c.len >= 1 - 1e-6, `the short clip is at least 1 s (${c.len})`);
  assert.equal(t.len, 2, 'a text clip is not touched');
});

test('a clip the video cannot give room to is left as it is and named, and the rest still change', () => {
  const pl = J(P.plan(E, new E.Editor(BASE()).state, 'unhurried'));
  const b = pl.skipped.find(s => s.id === 'b');
  assert.ok(b && /video file/.test(b.why) && b.label === 'Take 2', JSON.stringify(pl.skipped));
  assert.ok(pl.ops.some(o => o.id === 'a') && pl.ops.some(o => o.id === 'c'));
  assert.match(P.summary('unhurried', pl), /^Unhurried: \d of 3 clips? change/);
  assert.match(P.summary('unhurried', pl), /could not change fully/);
});

test('the whole preset is ordinary undoable edits: Undo steps back through the same ops, and the state returns exactly', () => {
  const ed = new E.Editor(BASE());
  const before = JSON.stringify(ed.state.clips);
  const pl = P.plan(E, ed.state, 'unhurried');
  for (const op of pl.ops) ed.do(op);
  assert.notEqual(JSON.stringify(ed.state.clips), before);
  for (let i = 0; i < pl.ops.length; i++) ed.undo();
  assert.equal(JSON.stringify(ed.state.clips), before);
});

test('planning never touches the editor it is given (it works on a copy), and applying twice on the same state gives the same plan', () => {
  const ed = new E.Editor(BASE());
  const s0 = JSON.stringify(ed.state), l0 = ed.log.length;
  const a = J(P.plan(E, ed.state, 'unhurried')), b = J(P.plan(E, ed.state, 'unhurried'));
  assert.equal(JSON.stringify(ed.state), s0); assert.equal(ed.log.length, l0);
  assert.deepEqual(a, b);
});

test('ops travel in batches of at most 20 (the server\'s limit), in order, none lost', () => {
  const ops = Array.from({ length: 47 }, (_, i) => ({ op: 'trim_clip', id: `c${i}`, edge: 'end', to: i }));
  const g = P.batches(ops);
  assert.deepEqual(J(g.map(x => x.length)), [20, 20, 7]); assert.deepEqual(J(g.flat()), ops);
  assert.deepEqual(J(P.batches([])), []);
});

test('the view: a named choice with Standard chosen, the plan in words, the skipped clips named, one button; read-only when locked', () => {
  const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, addEventListener() {}, children: kids.flat(9).filter(k => k !== null && k !== undefined && k !== false) });
  const all = (el, out = []) => { if (el && typeof el === 'object') { out.push(el); el.children.forEach(c => all(c, out)); } return out; };
  const text = el => (typeof el === 'string' ? el : el.children.map(text).join(''));
  const st = new E.Editor(BASE()).state;
  const std = P.view(h, E, st, { current: 'standard' });
  assert.equal(all(std).find(e => e.tag === 'select').attrs['aria-label'], 'Pace of the cut');
  assert.equal(all(std).find(e => e.attrs.id === 'le-pace-apply').attrs.disabled, true, 'nothing to apply for Standard');
  const un = P.view(h, E, st, { current: 'unhurried' });
  assert.equal(all(un).find(e => e.attrs.id === 'le-pace-apply').attrs.disabled, false);
  assert.match(text(un), /Make the pace unhurried/); assert.match(text(un), /Take 2: /); assert.match(text(un), /assumes the cut was planned at the standard pace/);
  assert.ok(all(P.view(h, E, st, { current: 'unhurried', locked: true })).filter(e => ['select', 'button'].includes(e.tag)).every(e => e.attrs.disabled === true));
});

test('wiring: behind its own switch (off), compilation mode only, loaded before the editor page, no rules of its own', () => {
  const cfg = read('assets/ryagram-config.js'), page = read('assets/app-editor.js'), html = read('app/index.html'), src = read('assets/app-editor-pace.js');
  assert.match(cfg, /\n  clipPace: false,/);
  assert.match(page, /paceOn = !!PACE && window\.ryagramConfig && window\.ryagramConfig\.clipPace === true && !isData/);
  assert.ok(html.indexOf('app-editor-pace.js') > 0 && html.indexOf('app-editor-pace.js') < html.indexOf('app-editor.js?'));
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|fetch\(|localStorage/.test(src));
  assert.ok(src.includes('copy.do(op)') && !/E\.check/.test(src.replace(/\/\/.*$/gm, '')), 'every op is the core\'s own do(), which checks it');
});
