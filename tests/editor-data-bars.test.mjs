// NEXT-WEB 169: the data editor with a BAR RACE (ENGINE's bars-rules scene, drawn by the rules drawer after look-draw's barsApply) and with a STREAMED bundle (look.pack_progressive:
// a head, then one chunk per period). The scene is REAL engine output (public-domain CDC data, the first 2 seconds); the streamed bundle is the synthetic map fixture, packed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8');
const ctx = { Math, Number, String, Object, Array, JSON, parseFloat, isFinite, Error, encodeURIComponent, Date };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['assets/preview/look-draw.js', 'assets/preview/scene-draw-rules.min.js', 'assets/app-editor-core.js', 'assets/app-editor-data.js']) vm.runInContext(read(f), ctx);
const RL = ctx.RyagramLook, D = ctx.ryagramEditorData, SC = ctx.RyagramScene;
const J = x => JSON.parse(JSON.stringify(x));
const scene = JSON.parse(read('tests/fixtures/look-bars-scene.json'));
const mapBundle = JSON.parse(read('tests/fixtures/look-bundle-synthetic.json'));
const stream = JSON.parse(read('tests/fixtures/look-bundle-synthetic-stream.json'));
const svgOf = r => decodeURIComponent(r.src.split(',')[1]);

test('the rules drawer is vendored and pinned, drawing only, and does not replace the v2 drawer', () => {
  const bytes = fs.readFileSync(path.join(here, '..', 'assets/preview/scene-draw-rules.min.js')), pin = read('assets/preview/scene-draw-rules.PIN');
  assert.match(pin, /Ryagram main [0-9a-f]{7,}/);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), pin.match(/sha256 ([0-9a-f]{64})/)[1]);
  assert.equal(String(bytes.length), pin.match(/\n(\d+) bytes, LF/)[1]);
  assert.ok(!bytes.includes(13));
  for (const w of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'document.', 'eval(', 'new Function', 'importScripts', 'navigator.']) assert.ok(!bytes.toString('utf8').includes(w), w);
  assert.equal(SC.RULES_VERSION, 5);
  assert.notEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(here, '..', 'assets/preview/scene-draw.min.js'))).digest('hex'), crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('the bar-race scene is a valid bundle, and the fixture script copy holds the same data', () => {
  assert.equal(D.isBars(scene), true); assert.equal(D.isBars(mapBundle), false);
  assert.equal(D.bundleProblem(scene), null);
  assert.match(D.bundleProblem({ ...scene, version: 4 }), /different version/);
  assert.match(D.bundleProblem({ ...scene, clock: null }), /incomplete/);
  const m = read('tests/fixtures/look-bars-scene.js').match(/window\.RYAGRAM_MOCK_LOOK_BARS = (.*);\r?\n$/s);
  assert.deepEqual(J(JSON.parse(m[1])), scene);
  assert.match(read('tests/fixtures/look-bundle-synthetic.PROVENANCE.txt'), /REAL engine bar-race scene/);
});

test('the editor draws the bar race: the picture is the engine own frame, the page colour and the theme change it, the bar colour is not offered', () => {
  const plain = D.pictureFor(RL, scene, 0, {});
  assert.ok(!plain.error, plain.error);
  assert.equal(svgOf(plain), SC.draw(scene, 0));                               // no look: exactly the engine's frame
  const page = D.pictureFor(RL, scene, 0.5, { 'page.background': '#102040' });
  assert.ok(svgOf(page).includes('rgb(16,32,64)') && svgOf(page) !== SC.draw(scene, 15));
  const light = D.pictureFor(RL, scene, 0, { 'sequence.theme': 'light' });
  assert.notEqual(svgOf(light), SC.draw(scene, 0));
  assert.deepEqual(J(D.rowsFor(RL, scene).map(r => r[0])), ['page.background', 'sequence.theme']);                 // no low, high or border width; no bar colour either (the worker has no key for it)
  assert.deepEqual(J(D.rowsFor(RL, { ...scene, look_themes: {} }).map(r => r[0])), ['page.background']);          // a scene with no other theme offers no Theme row
  assert.deepEqual(J(D.warnings(scene, { 'page.background': '#000000' })), []);
});

test('presets on a bar race change only the page colour and theme, and say nothing false', () => {
  const white = D.PRESETS.find(p => p.id === 'white-background'), mono = D.PRESETS.find(p => p.id === 'monochrome');
  assert.deepEqual(J(D.presetOps(white, {}, scene).map(o => o.key).sort()), ['page.background', 'sequence.theme']);
  assert.deepEqual(J(D.presetOps(mono, {}, scene)), []);
  assert.equal(D.defaults(scene, {})['page.background'], D.rgbHex(scene.rules.page));
});

test('the scrubber of a bar race has one step per frame, and its label is the period on screen', () => {
  const tl = D.timeline(RL, scene);
  assert.equal(tl.frames, scene.frames); assert.equal(tl.fps, scene.fps);
  assert.equal(tl.label(0), SC.describe(scene, 0).period);
  assert.equal(tl.label(tl.seconds(tl.frames - 1)), SC.describe(scene, tl.frames - 1).period);
  assert.ok(tl.ticks.length >= 1 && tl.ticks[0].at === 0);
  assert.equal(tl.frame(tl.seconds(17)), 17);
});

test('a streamed bundle: the head alone gives a whole scrubber, a period whose chunk has not arrived is loading, and each chunk fills its period in', () => {
  assert.equal(D.streamProblem(stream.head), null);
  assert.match(D.streamProblem({ ...stream.head, format: 'x' }), /not drawing data/);
  assert.match(D.streamProblem({ ...stream.head, period_list: [] }), /incomplete|not drawing/);
  const b = RL.progressive(stream.head);
  const tl = D.timeline(RL, b);
  assert.equal(tl.frames, (stream.head.period_list.length - 1) * stream.head.frames_per_period + 1);
  assert.equal(tl.label(0), stream.head.period_list[0]);
  assert.equal(tl.label(tl.seconds(tl.frames - 1)), stream.head.period_list[stream.head.period_list.length - 1]);
  assert.deepEqual(J(D.pictureFor(RL, b, 0, {})), { loading: true });           // nothing has arrived: no half picture
  const order = stream.head.period_list;
  RL.addPeriod(b, order[0], stream.periods[order[0]]);
  assert.deepEqual(J(D.pictureFor(RL, b, 0, {})), { loading: true });           // a period tweens to the next one, so it also waits for the NEXT chunk
  RL.addPeriod(b, order[1], stream.periods[order[1]]);
  const first = D.pictureFor(RL, b, 0, {});
  assert.ok(first.src && !first.loading, 'the first two chunks draw the first period');
  const lastSec = tl.seconds(tl.frames - 1);
  assert.deepEqual(J(D.pictureFor(RL, b, lastSec, {})), { loading: true });     // a later period is still on its way
  for (const p of order) if (!b.loaded[p]) RL.addPeriod(b, p, stream.periods[p]);
  assert.ok(D.pictureFor(RL, b, lastSec, {}).src, 'every chunk in: the last period draws');
});

test('a streamed bundle draws the same pictures as the whole bundle it was packed from, once the chunks are in', () => {
  const b = RL.progressive(stream.head);
  for (const p of stream.head.period_list) RL.addPeriod(b, p, stream.periods[p]);
  const tl = D.timeline(RL, b), whole = D.timeline(RL, mapBundle);
  assert.equal(tl.frames, whole.frames);
  for (const f of [0, 1, 5, tl.frames - 1]) {
    const a = D.pictureFor(RL, b, tl.seconds(f), { 'page.background': '#101820' }), w = D.pictureFor(RL, mapBundle, whole.seconds(f), { 'page.background': '#101820' });
    assert.ok(a.src && w.src);
    assert.equal(a.src, w.src);
    assert.equal(tl.label(tl.seconds(f)), whole.label(whole.seconds(f)));
  }
});
