// The data-film editor's helper (assets/app-editor-data.js, NEXT-WEB 154) against ENGINE's real drawer (assets/preview/look-draw.js) and the SYNTHETIC bundle fixture:
// only keys the drawer honours are offered, presets are complete looks made only of keys the worker accepts today, the scrubber follows the bundle's own frames, and a bad bundle is refused in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8');
const ctx = { Math, Number, String, Object, Array, JSON, parseFloat, isFinite, Error, encodeURIComponent };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read('assets/preview/look-draw.js'), ctx);
vm.runInContext(read('assets/app-editor-core.js'), ctx);
vm.runInContext(read('assets/app-editor-data.js'), ctx);
const RL = ctx.RyagramLook, D = ctx.ryagramEditorData, E = ctx.ryagramEditor;
const J = x => JSON.parse(JSON.stringify(x));
const bundle = JSON.parse(read('tests/fixtures/look-bundle-synthetic.json'));

test('the fixture is a valid bundle, and its script copy (used by the mock page) holds the same data', () => {
  assert.equal(D.bundleProblem(bundle), null);
  const js = read('tests/fixtures/look-bundle-synthetic.js');
  const m = js.match(/window\.RYAGRAM_MOCK_LOOK_BUNDLE = (.*);\n$/s);
  assert.deepEqual(JSON.parse(m[1]), bundle);
  assert.match(read('tests/fixtures/look-bundle-synthetic.PROVENANCE.txt'), /SYNTHETIC/);
});

test('bad drawing data is refused in words', () => {
  for (const b of [null, 'x', {}, { ...bundle, format: 'other' }, { ...bundle, version: 2 }, { ...bundle, periods: [] }, { ...bundle, fps: 0 }, { ...bundle, templates: null }]) assert.equal(typeof D.bundleProblem(b), 'string');
});

test('the panel offers exactly what the drawer honours: border width is named as ignored and is not offered', () => {
  const keys = D.honoured(RL).map(r => r[0]);
  assert.deepEqual(J(keys), ['choropleth.low', 'choropleth.high', 'page.background', 'sequence.theme']);
  assert.ok(RL.lookFromStory(D.story({ 'state.outline_width': 1 })).ignored.includes('state.outline_width'));
});

test('every key a preset sets is one the worker accepts today (the editor core’s list), and a preset is a complete look', () => {
  for (const p of D.PRESETS) {
    const ops = D.presetOps(p, { 'choropleth.low': '#123456', 'choropleth.high': '#654321', 'page.background': '#111111', 'sequence.theme': 'light' });
    for (const op of ops) assert.ok(op.key in E.LOOK_KEYS, `${p.id}: ${op.key}`);
    const ed = new E.Editor({ look: { 'choropleth.low': '#123456', 'choropleth.high': '#654321', 'page.background': '#111111', 'sequence.theme': 'light' }, clips: [], duration: 0 });
    for (const op of ops) assert.ok(ed.do(op).ok, `${p.id} ${JSON.stringify(op)}`);
    assert.equal(D.presetOf(ed.state.look).id, p.id);
    assert.equal(D.presetOps(p, ed.state.look).length, 0);
  }
  assert.deepEqual(J(D.presetOps(D.PRESETS[0], { 'choropleth.low': '#123456', 'sequence.theme': 'light' }).map(o => o.op)), ['unset_look', 'unset_look']);
});

test('cautions come from RENDERER’s numbers: monochrome carries both, the approved look none', () => {
  const by = id => D.PRESETS.find(p => p.id === id);
  assert.equal(D.cautions(by('monochrome')).length, 2);
  assert.equal(D.cautions(by('dark-default')).length, 0);
  assert.equal(D.cautions(by('high-contrast')).length, 0);
});

test('the scrubber has a step per frame and ticks at the periods; a long film gets at most about eight labels', () => {
  const tl = D.timeline(RL, bundle);
  assert.equal(tl.frames, 31);
  assert.deepEqual(J(tl.ticks.map(t => t.period)), ['2000', '2001', '2002', '2003']);
  assert.equal(tl.ticks[0].at, 0); assert.equal(tl.ticks[3].at, 1);
  assert.equal(tl.label(tl.seconds(30)), '2003'); assert.equal(tl.label(0), '2000');
  assert.equal(tl.frame(tl.seconds(17)), 17);
  const long = { ...bundle, periods: Array.from({ length: 50 }, (_, i) => String(1975 + i)) };
  assert.ok(D.timeline(RL, long).ticks.length <= 9);
});

test('a frame is drawn by the engine’s drawer; the look changes the picture; an unknown theme is said, not thrown', () => {
  const dark = D.pictureFor(RL, bundle, 0, {}), light = D.pictureFor(RL, bundle, 0, { 'sequence.theme': 'light', 'page.background': '#ffffff' });
  assert.match(dark.src, /^data:image\/svg\+xml/); assert.notEqual(dark.src, light.src);
  assert.ok(decodeURIComponent(light.src).includes('rgb(255,255,255)'));
  const noLight = { ...bundle, templates: Object.fromEntries(Object.entries(bundle.templates).map(([k, v]) => [k, { ...v, themes: {} }])) };
  assert.equal(typeof D.pictureFor(RL, noLight, 0, { 'sequence.theme': 'light' }).error, 'string');
  assert.equal(typeof D.pictureFor(RL, { ...bundle, templates: {} }, 0, {}).error, 'string');
});

test('warnings: a colour that matches the page is said; a look that is fine is not', () => {
  assert.deepEqual(J(D.warnings(bundle, {})), []);
  assert.equal(D.warnings(bundle, { 'choropleth.low': '#14141a' }).length, 1);
  assert.equal(D.warnings(bundle, { 'choropleth.low': '#808080', 'choropleth.high': '#828282' }).length, 1);
});
