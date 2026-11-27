// Live editor Text size and Legend position (WEB 11-27). ENGINE's engine-style-keys-1127 adds text.scale (a number, 0.85 to 1.0) and layout.legend_position (bottom_left | bottom_right).
// The controls are ONLY set_look / unset_look on those keys, and sit behind one gate (the core's LOOK_KEYS_V2, false; the mock turns it on with ?lookv2) until the server's look-key lists know the keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(read('assets/app-editor-core.js'), { window, Error, Math, Number, Array, Object, String, JSON, Set, RegExp });
const E = window.ryagramEditor;
const base = () => ({ look: { 'network.color': '#6fd1bd', 'page.background': '#0d0d11' }, duration: 12, clips: [{ id: 'v1', track: 'video', start: 0, len: 2, label: 'one' }] });
const strip = s => { const c = JSON.parse(JSON.stringify(s)); delete c.look; delete c.revision; return JSON.stringify(c); };
const on = () => new E.Editor(base(), { lookKeys: E.lookKeysFor(true) });
const SIZES = [0.85, 0.92, 1], LEGENDS = ['bottom_left', 'bottom_right'];

test('GATE: off by default; the shared key list does not hold the new keys, so an editor made without the gate refuses them in words', () => {
  assert.equal(E.LOOK_KEYS_V2, false);
  assert.equal(E.lookKeysFor(false), E.LOOK_KEYS);
  assert.ok(!('text.scale' in E.LOOK_KEYS) && !('layout.legend_position' in E.LOOK_KEYS));
  const e = new E.Editor(base());
  for (const op of [{ op: 'set_look', key: 'text.scale', value: 0.9 }, { op: 'set_look', key: 'layout.legend_position', value: 'bottom_right' }, { op: 'unset_look', key: 'text.scale' }]) {
    const r = e.do(op); assert.equal(r.ok, false); assert.equal(r.reason, 'That setting is not available yet.');
  }
  const page = read('assets/app-editor.js');
  assert.ok(page.includes('E.LOOK_KEYS_V2 === true || window.ryagramLookV2 === true'), 'on only by the core constant, or the mock flag');
  const lib = read('assets/app-library.js');
  assert.ok(lib.includes('window.ryagramLookV2 = !!window.ryagramMock && /[?&]lookv2'), 'the flag is read in the mock only');
  assert.ok(!page.includes('location'), 'the chat page forbids location in the editor file');
  assert.ok(page.includes('if (!LOOKV2) return [];'), 'gate off: no control is drawn');
  assert.ok(page.includes('E.lookKeysFor(LOOKV2)'));
});
test('GATE ON: both keys are accepted with their bounds; the exact keys of the engine and nothing else new', () => {
  assert.deepEqual(Object.keys(E.LOOK_KEYS_NEXT).sort(), ['layout.legend_position', 'text.scale']);
  assert.equal(E.TEXT_SCALE_MIN, 0.85); assert.equal(E.TEXT_SCALE_MAX, 1.0); assert.deepEqual([...E.LEGEND_POSITIONS], LEGENDS);
  const on2 = E.lookKeysFor(true);
  for (const k of Object.keys(E.LOOK_KEYS)) assert.ok(k in on2, 'the old keys stay');
});
test('TEXT SIZE: undo and redo are byte-equal; one Undo per use; the data never changes', () => {
  for (const v of SIZES) {
    const e = on(), before = JSON.stringify(e.state), data = strip(e.state);
    assert.equal(e.do({ op: 'set_look', key: 'text.scale', value: v }).ok, true);
    const after = JSON.stringify(e.state);
    assert.equal(e.state.look['text.scale'], v); assert.equal(strip(e.state), data);
    e.undo(); assert.equal(JSON.stringify(e.state), before, 'one Undo takes the whole control use back');
    assert.equal(e.redoStep().ok, true); assert.equal(JSON.stringify(e.state), after);
  }
});
test('TEXT SIZE: out of bounds is a refusal, never a silent clamp: 0.85 and 1.0 pass; 0.84, 1.01, 0, strings, NaN and Infinity are refused', () => {
  const e = on();
  for (const v of [0.85, 1.0, 0.9]) assert.equal(e.do({ op: 'set_look', key: 'text.scale', value: v }).ok, true);
  const had = JSON.stringify(e.state);
  for (const v of [0.84, 1.01, 0, -1, 1.5, '0.9', null, NaN, Infinity, undefined]) {
    const r = e.do({ op: 'set_look', key: 'text.scale', value: v }); assert.equal(r.ok, false, String(v)); assert.equal(r.reason, 'That value is not allowed for this setting.');
  }
  assert.equal(JSON.stringify(e.state), had, 'a refused value changes nothing');
});
test('LEGEND POSITION: each word is one op; undo and redo are byte-equal; any other word is refused', () => {
  for (const v of LEGENDS) {
    const e = on(), before = JSON.stringify(e.state), data = strip(e.state);
    assert.equal(e.do({ op: 'set_look', key: 'layout.legend_position', value: v }).ok, true);
    const after = JSON.stringify(e.state); assert.equal(strip(e.state), data);
    e.undo(); assert.equal(JSON.stringify(e.state), before);
    assert.equal(e.redoStep().ok, true); assert.equal(JSON.stringify(e.state), after);
  }
  const e = on();
  for (const v of ['top', 'bottom', 'right', '', 'BOTTOM_LEFT', 5, null]) assert.equal(e.do({ op: 'set_look', key: 'layout.legend_position', value: v }).ok, false, String(v));
});
test('THE FILM’S OWN: unset_look removes the key; Undo puts the value back, Redo removes it again; two keys are two separate Undo steps', () => {
  const e = on();
  e.do({ op: 'set_look', key: 'text.scale', value: 0.85 }); e.do({ op: 'set_look', key: 'layout.legend_position', value: 'bottom_right' });
  const both = JSON.stringify(e.state);
  assert.equal(e.do({ op: 'unset_look', key: 'text.scale' }).ok, true);
  assert.equal(e.state.look['text.scale'], undefined); assert.equal(e.state.look['layout.legend_position'], 'bottom_right');
  e.undo(); assert.equal(JSON.stringify(e.state), both);
  assert.equal(e.redoStep().ok, true); assert.equal(e.state.look['text.scale'], undefined);
  e.undo(); e.undo(); assert.equal(e.state.look['layout.legend_position'], undefined, 'the second Undo took back only the legend');
});
test('NO NEW OP, NO DATA: the controls send only set_look and unset_look on these two keys, with the engine’s bounds', () => {
  const page = read('assets/app-editor.js');
  const body = page.slice(page.indexOf('const TEXT_SIZES'), page.indexOf('function paintBundleLook'));
  assert.deepEqual([...new Set([...body.matchAll(/op: '([a-z_]+)'/g)].map(m => m[1]))].sort(), ['set_look', 'unset_look']);
  assert.deepEqual([...new Set([...body.matchAll(/'((?:text|layout)\.[a-z_]+)'/g)].map(m => m[1]))].sort(), ['layout.legend_position', 'text.scale']);
  const sizes = [...body.matchAll(/\['[A-Za-z ]+', (0\.\d+|1)\]/g)].map(m => Number(m[1]));
  assert.equal(sizes.length, 3);
  for (const v of sizes) assert.ok(v >= 0.85 && v <= 1);
  assert.ok(body.includes("['Bottom left', 'bottom_left']") && body.includes("['Bottom right', 'bottom_right']"));
  assert.ok(E.OPS.includes('set_look') && E.OPS.includes('unset_look'));
});
test('PAGE: groups labelled; real buttons with aria-pressed; locked during a render; in both look panels; 44px; Pro and the render list know the words', () => {
  const page = read('assets/app-editor.js'), css = read('assets/app-editor.css'), pro = read('assets/app-editor-pro.js');
  assert.ok(page.includes("'aria-labelledby': 'le-tsize-h'") && page.includes("'aria-labelledby': 'le-legend-h'"));
  const body = page.slice(page.indexOf('function textLegendTools'), page.indexOf('function paintBundleLook'));
  assert.equal((body.match(/'aria-pressed': /g) || []).length, 3);
  assert.equal((body.match(/disabled: locked/g) || []).length, 3);
  assert.equal((page.match(/\.\.\.textLegendTools\(\)/g) || []).length, 2);
  assert.ok(css.includes('.le-bgchoices .button') && css.includes('min-height:44px'));
  assert.ok(pro.includes("'text.scale': 'text size'") && pro.includes("'layout.legend_position': 'legend position'"));
  assert.ok(page.includes("['text.scale', 'Text size'], ['layout.legend_position', 'Legend position']"));
});
test('SERVER NEEDS: the written twin changes name both keys, the bounds, the words and the honesty tests; the shared cases file is untouched', () => {
  const doc = read('docs/editor-textlegend-needs-1127.md');
  for (const w of ['text.scale', 'layout.legend_position', '0.85', '1.0', 'bottom_left', 'bottom_right', 'edit_look_keys', 'edit_state.ts', 'LOOK_KEYS_V2', 'tests/edit-op-cases.json', 'number rule']) assert.ok(doc.includes(w), w);
  const cases = JSON.parse(read('tests/edit-op-cases.json'));
  assert.ok(!cases.look_keys.includes('text.scale') && !cases.look_keys.includes('layout.legend_position'));
  const v2 = JSON.parse(read('tests/edit-op-cases-textlegend-1127.json'));
  for (const c of v2.cases) assert.equal(E.check(E.newState(base()), c.op, E.lookKeysFor(true)) === null, c.ok, JSON.stringify(c.op));
  assert.ok(v2.cases.some(c => c.ok) && v2.cases.some(c => !c.ok));
});
