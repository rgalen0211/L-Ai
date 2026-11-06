// WEB sweep 11-06 of the editor core (assets/app-editor-core.js) with hostile input: a project that is empty or half-written must open as an empty editor, never throw, and a drag that
// sends a start that is not a number must still land on a finite time. (A fixed-seed probe of 6000 random ops found check() and apply() clean; these are the three things it did find.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = process.env.EDITOR_CORE_SRC ? fs.readFileSync(process.env.EDITOR_CORE_SRC, 'utf8') : fs.readFileSync(new URL('../assets/app-editor-core.js', import.meta.url), 'utf8');
const win = {}; vm.runInNewContext(SRC, { window: win });
const E = win.ryagramEditor, J = x => JSON.parse(JSON.stringify(x));

test('an empty or odd project opens as an empty editor: null, a number, a list, a string, null clips', () => {
  for (const base of [null, undefined, 5, 'a string', [], true, {}, { clips: null }, { look: null }, { clips: [null, 1, 'x', [], { id: 'a', track: 'video', start: 0, len: 3 }] }]) {
    const s = E.newState(base);
    assert.ok(Array.isArray(s.clips) && s.look && typeof s.look === 'object', JSON.stringify(base));
    assert.ok(s.clips.every(c => c && typeof c === 'object' && !Array.isArray(c)), 'only real clips are kept');
    assert.equal(new E.Editor(base).revision, 0); const ed = new E.Editor({}); ed.reload(base); assert.equal(ed.revision, 0);
  }
  assert.deepEqual(J(E.newState({ clips: [null, 1, 'x', { id: 'a', track: 'video', start: 0, len: 3 }] }).clips.map(c => c.id)), ['a'], 'the one real clip survives');
  assert.equal(E.newState({ duration: NaN }).duration, 0); assert.equal(E.newState({ duration: 12 }).duration, 12);
});

test('snap always answers a finite time of 0 or more, whatever the start, grid, reach or playhead', () => {
  const st = E.newState({ clips: [{ id: 'a', track: 'video', start: 0, len: 3 }, { id: 'b', track: 'video', start: 3, len: 3 }] });
  const bad = [NaN, Infinity, -Infinity, undefined, null, 'x', {}, [], -5, 1e308, -1e308, 5e-324, 1e-320];
  for (const start of [...bad, 1.23]) for (const grid of [...bad, 0, 0.1]) for (const playhead of [...bad, 2]) {
    const v = E.snap(st, 'a', start, { playhead, grid, reach: grid });
    assert.ok(typeof v === 'number' && Number.isFinite(v) && v >= 0, `snap(${String(start)}, grid ${String(grid)}, playhead ${String(playhead)}) = ${v}`);
  }
  assert.equal(E.snap(st, 'b', 3.04), 3, 'a good drag still snaps to the clip edge'); assert.equal(E.snap(st, 'b', 4.5), 4.5, 'and on the grid when no edge is near');
});

test('check() and apply() on a hostile op never throw, and an accepted op leaves finite, unique clips (a fixed-seed run of 3000)', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, pick = a => a[Math.floor(rnd() * a.length)];
  const VALS = [undefined, null, 0, -1, 1, 0.5, NaN, Infinity, 1e308, '', 'abc', '#fff', '<b>', '__proto__', true, [], {}, 'music', 'title'];
  const st = E.newState({ clips: [{ id: 'a', track: 'video', start: 0, len: 3 }, { id: 'b', track: 'video', start: 3, len: 3 }, { id: 'music', track: 'music', start: 0, len: 6 }], lanes: ['video', 'music', 'text'] });
  for (let i = 0; i < 3000; i++) {
    const op = { op: pick([...E.OPS, 'nope']) };
    for (let f = 0; f < 4; f++) op[pick(['id', 'key', 'value', 'start', 'len', 'text', 'style', 'phrase', 'seconds', 'mode', 'level_db', 'to', 'index'])] = pick(VALS);
    const why = E.check(st, op);
    assert.ok(why === null || typeof why === 'string');
    if (why === null) { const n = E.apply(st, op); assert.ok(n.clips.every(c => Number.isFinite(c.start) && Number.isFinite(c.len)), JSON.stringify(op)); assert.equal(new Set(n.clips.map(c => c.id)).size, n.clips.length); }
  }
});

test('phone layout (WEB night pass): the stand-in drawing\'s year labels sit in a row (not piled at the left), the drawing\'s label fits its box, and a long unbroken heading wraps', () => {
  const js = fs.readFileSync(new URL('../assets/app-editor.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(new URL('../assets/app-editor.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(js, /class: bundleMode \? 'le-ticks' : 'le-ticks le-ticks-flat'/);
  assert.match(js, /textLength: 140, lengthAdjust: 'spacingAndGlyphs'/);
  assert.match(css, /\.le-ticks\.le-ticks-flat\{position:static;height:auto;display:flex;justify-content:space-between\}\.le-ticks\.le-ticks-flat span\{position:static;transform:none\}/);
  assert.match(css, /\.le-top h1\{min-width:0;overflow-wrap:anywhere\}/);
  assert.ok(css.indexOf('.le-ticks.le-ticks-flat') > css.indexOf('.le-ticks span:last-child{transform:translateX(-100%)}'), 'the row layout comes after the positioned one so it wins');
});
