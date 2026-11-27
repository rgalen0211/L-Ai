// Live editor colour tools (WEB 11-27): a Background choice and "Use the film's own colours". Both are made ONLY of ops the shared op list already has
// (set_look page.background, unset_look): no new op, no new key, no data change. Undo and Redo must return them byte-equal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(read('assets/app-editor-core.js'), { window, Error, Math, Number, Array, Object, String, JSON, Set, RegExp });
const E = window.ryagramEditor;
const base = () => ({ look: { 'network.color': '#6fd1bd', 'page.background': '#0d0d11' }, duration: 12, clips: [{ id: 'v1', track: 'video', start: 0, len: 2, label: 'one' }] });
const BACKGROUNDS = ['#000000', '#0d0d11', '#ffffff'];
const strip = s => { const c = JSON.parse(JSON.stringify(s)); delete c.look; delete c.revision; return JSON.stringify(c); };

test('BACKGROUND: each choice is a plain set_look; undo and redo are byte-equal; nothing but the look changes', () => {
  for (const hex of BACKGROUNDS) {
    const e = new E.Editor(base()), before = JSON.stringify(e.state), data = strip(e.state);
    assert.equal(e.do({ op: 'set_look', key: 'page.background', value: hex }).ok, true);
    const after = JSON.stringify(e.state);
    assert.equal(strip(e.state), data, 'data and clips never change');
    e.undo(); assert.equal(JSON.stringify(e.state), before);
    assert.equal(e.redoStep().ok, true); assert.equal(JSON.stringify(e.state), after);
  }
});
test('USE THE FILM’S OWN COLOURS: one group of unset_look; one Undo returns every colour, one Redo takes them away again', () => {
  const e = new E.Editor(base());
  e.do({ op: 'set_look', key: 'page.background', value: '#ffffff' }, 'you');
  e.do({ op: 'set_look', key: 'choropleth.low', value: '#112233' }, 'you');
  const coloured = JSON.stringify(e.state), data = strip(e.state);
  const keys = ['network.color', 'page.background', 'choropleth.low'];
  for (const key of keys) assert.equal(e.do({ op: 'unset_look', key }, 'you', 'preset-9').ok, true);
  const cleared = JSON.stringify(e.state);
  for (const key of keys) assert.equal(e.state.look[key], undefined);
  assert.equal(strip(e.state), data);
  e.undo(); assert.equal(JSON.stringify(e.state), coloured, 'one Undo returns the whole group');
  assert.equal(e.redoStep().ok, true); assert.equal(JSON.stringify(e.state), cleared);
});
test('NO NEW OP: the controls send only set_look page.background and unset_look, both already in the shared connector cases', () => {
  const page = read('assets/app-editor.js'), cases = JSON.parse(read('tests/edit-op-cases.json'));
  const i = page.indexOf('const BACKGROUNDS'), body = page.slice(i, page.indexOf('function paintBundleLook'));
  const ops = [...body.matchAll(/op: '([a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ops)].sort(), ['set_look', 'unset_look']);
  assert.ok(E.OPS.includes('set_look') && E.OPS.includes('unset_look'));
  assert.ok(cases.look_keys.includes('page.background'));
  assert.ok(read('tests/edit-op-cases.json').includes('"op": "set_look"'));
  assert.ok(read('tests/edit-op-cases.json').includes('"op": "unset_look"'));
  for (const hex of BACKGROUNDS) assert.ok(body.includes(`'${hex}'`));
});
test('PAGE: the groups are labelled, the buttons are real buttons (keyboard reachable, aria-pressed), locked while a render uses the draft, in both look panels, and phone width is 44px', () => {
  const page = read('assets/app-editor.js'), css = read('assets/app-editor.css');
  assert.ok(page.includes("role: 'group', 'aria-labelledby': 'le-bg-h'") && page.includes("role: 'group', 'aria-labelledby': 'le-pal-h'"));
  assert.ok(page.includes("'aria-pressed': cur === hex ? 'true' : 'false'") && page.includes('disabled: locked || set.length === 0'));
  assert.equal((page.match(/\.\.\.colourTools\(/g) || []).length, 2);
  assert.ok(css.includes('.le-bgchoices .button') && css.includes('min-height:44px'));
});
