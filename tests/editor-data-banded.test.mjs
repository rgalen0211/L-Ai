// NEXT-WEB 165: the data editor with the engine's BANDED bundles (solid colour bands with breaks, no ramp), drawn by the engine's own drawer (assets/preview/look-draw.js, the Ryagram main file with the
// banded rule) from a SYNTHETIC fixture. A banded film ignores the low and high colours, so the page must not offer them; the page and theme still apply; the bands are shown, not edited.
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
for (const f of ['assets/preview/look-draw.js', 'assets/app-editor-core.js', 'assets/app-editor-data.js']) vm.runInContext(read(f), ctx);
const RL = ctx.RyagramLook, D = ctx.ryagramEditorData;
const J = x => JSON.parse(JSON.stringify(x));
const banded = JSON.parse(read('tests/fixtures/look-bundle-synthetic-banded.json'));
const plainBundle = JSON.parse(read('tests/fixtures/look-bundle-synthetic.json'));

test('the banded fixture is a valid bundle in the engine’s banded mode, and its script copy holds the same data', () => {
  assert.equal(D.bundleProblem(banded), null);
  assert.equal(banded.mode, 'banded');
  assert.equal(banded.stops.length, banded.edges.length - 1);
  const m = read('tests/fixtures/look-bundle-synthetic-banded.js').match(/window\.RYAGRAM_MOCK_LOOK_BUNDLE_BANDED = (.*);\r?\n$/s);
  assert.deepEqual(J(JSON.parse(m[1])), banded);
  assert.match(read('tests/fixtures/look-bundle-synthetic.PROVENANCE.txt'), /SYNTHETIC fixture in the engine's BANDED mode/);
});

test('the drawer draws solid bands: the colour of an area is one of the bundle’s own band colours and changes as the value crosses a break', () => {
  const bandColours = banded.stops.map(c => `rgb(${c[0]},${c[1]},${c[2]})`);
  const seen = new Set();
  for (const sec of [0, 1.0, 2.0, 3.0]) {
    const svg = decodeURIComponent(D.pictureFor(RL, banded, sec, {}).src.split(',')[1]);
    const uses = [...svg.matchAll(/<use href="#h1" fill="(rgb\([^)]*\))"/g)].map(m => m[1]);
    assert.equal(uses.length, 1);
    assert.ok(bandColours.includes(uses[0]), `${sec}: ${uses[0]}`);
    seen.add(uses[0]);
  }
  assert.ok(seen.size >= 2, 'the area changes band across the periods');
});

test('rows and presets mean something for a banded film: no low or high colour, presets change only the page and theme, the bands are listed', () => {
  assert.deepEqual(J(D.rowsFor(RL, banded).map(r => r[0])), ['choropleth.low', 'choropleth.high', 'page.background']);   // a banded bundle that records its ramp takes low and high; no light theme, so no Theme row
  const oldBanded = { ...banded, ramp: undefined };                                                // an older bundle with no ramp record ignores them
  assert.deepEqual(J(D.rowsFor(RL, oldBanded).map(r => r[0])), ['page.background']);
  assert.deepEqual(J(D.rowsFor(RL, plainBundle).map(r => r[0])), ['choropleth.low', 'choropleth.high', 'page.background', 'sequence.theme']);
  const white = D.PRESETS.find(p => p.id === 'white-background'), mono = D.PRESETS.find(p => p.id === 'monochrome');
  assert.deepEqual(J(D.presetOps(white, {}, banded).map(o => o.key).sort()), ['choropleth.high', 'choropleth.low', 'page.background']);
  assert.deepEqual(J(D.presetOps(white, {}, oldBanded).map(o => o.key)), ['page.background']);
  assert.deepEqual(J(D.presetOps(mono, {}, banded).map(o => o.key).sort()), ['choropleth.high', 'choropleth.low']);
  assert.deepEqual(J(D.presetOps(mono, {}, oldBanded)), []);                                    // monochrome sets only low and high: nothing for a film that ignores them
  assert.equal(D.presetOps(white, {}, plainBundle).length, 4);
  assert.deepEqual(J(D.bandColours(banded)), ['#3c5aa0', '#a37674', '#e6963c']);                  // the recorded ramp's three colours (the middle one is the engine's Lab midpoint)
  assert.deepEqual(J(D.bandColours(plainBundle)), []);
  assert.deepEqual(J(D.warnings(banded, { 'page.background': '#000000' })), []);
});

test('the banded white-background caution comes from RENDERER\u2019s measurement and appears only for a banded film', () => {
  const white = D.PRESETS.find(p => p.id === 'white-background');
  assert.ok(J(D.cautions(white, banded)).some(t => /about 11 colour steps apart/.test(t)));
  assert.ok(!J(D.cautions(white, plainBundle)).some(t => /11 colour steps/.test(t)));
});

test('a banded bundle has no light theme: the drawer says so in words if asked, the page colour is honoured, and a bundle with a light theme still offers the Theme row', () => {
  assert.equal(D.hasLight(banded), false); assert.equal(D.hasLight(plainBundle), true);
  assert.match(D.pictureFor(RL, banded, 0, { 'sequence.theme': 'light' }).error, /theme "light" is not in this bundle/);
  const r = D.pictureFor(RL, banded, 0, { 'page.background': '#ffffff' });
  assert.ok(!r.error, r.error);
  assert.ok(decodeURIComponent(r.src).includes('rgb(255,255,255)'));
  assert.ok(D.rowsFor(RL, plainBundle).some(r => r[0] === 'sequence.theme'));
});

test('a banded bundle that records its ramp takes the low and high colours: the drawn bands change with them; one that does not ignores them', () => {
  assert.equal(D.hasRamp(banded), true); assert.equal(D.hasRamp({ ...banded, ramp: undefined }), false);
  const svg = look => decodeURIComponent(D.pictureFor(RL, banded, 0, look).src.split(',')[1]);
  const plain = svg({});
  const low = svg({ 'choropleth.low': '#ff0000', 'choropleth.high': '#00ff00' });
  assert.notEqual(low, plain, 'a new low and high change the picture');
  assert.ok(/rgb\(255,0,0\)|rgb\(0,255,0\)/.test(low), 'the picture uses the new ends');
  const ignored = decodeURIComponent(D.pictureFor(RL, { ...banded, ramp: undefined }, 0, { 'choropleth.low': '#ff0000', 'choropleth.high': '#00ff00' }).src.split(',')[1]);
  assert.equal(ignored, plain, 'a bundle with no ramp record ignores them');
  assert.deepEqual([D.defaults(banded, {})['choropleth.low'], D.defaults(banded, {})['choropleth.high']], ['#3c5aa0', '#e6963c']);
});

test('the DRAFT frame: an exact subset of the full picture for a slider being dragged, and never a different picture', () => {
  const full = D.pictureFor(RL, plainBundle, 0.5, {}), draft = D.pictureFor(RL, plainBundle, 0.5, {}, { draft: true });
  assert.ok(full.src && draft.src);
  const els = s => [...decodeURIComponent(s.split(',')[1]).matchAll(/<(use|path|rect|text|g)\b[^>]*>/g)].map(m => m[0]);
  const f = els(full.src), d = els(draft.src);
  assert.ok(d.length <= f.length, 'no more elements than the full frame');
  let i = 0; for (const e of d) { i = f.indexOf(e, i); assert.ok(i >= 0, `draft element is in the full frame in order: ${e.slice(0, 60)}`); i++; }
  assert.equal(D.pictureFor(RL, plainBundle, 0.5, {}, { draft: false }).src, full.src, 'draft:false is the full picture');
});
