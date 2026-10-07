// The live preview's logic (assets/preview/*.js, phase 1): the bundle zip, the scene checks, the clock and exact-year marks,
// the smoothness controller, the exact-year cache plan, keyboard and speech, and the fixture the whole thing is built on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { scene as fixtureScene, zip as makeZip, gz as fixtureGz, crc32 } from '../tools/make-scene-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8');
function load(...files) {
  const window = {};
  const ctx = { window, Blob, DecompressionStream, TextDecoder, Uint8Array, Uint32Array, DataView, URL, Error, Promise, Math, Number, Array, Object, String, JSON, Map, Set, Date, Infinity };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(read(f), ctx);
  return window;
}
const Z = load('assets/preview/preview-zip.js').ryagramZip;
const C = load('assets/preview/preview-core.js').ryagramPreviewCore;
const plain = x => JSON.parse(JSON.stringify(x));
const fixtureZip = fs.readFileSync(path.join(here, 'fixtures', 'scene-fixture.zip'));
const msg = async (fn, re) => assert.rejects(Promise.resolve().then(fn), err => { assert.match(err.message, re); return true; });

// ---- the fixture is what the generator makes ----------------------------------------------------------------------
test('the committed fixture is exactly what tools/make-scene-fixture.mjs makes (nothing drifts by hand)', () => {
  assert.ok(Buffer.compare(fixtureZip, makeZip([['scene.json.gz', fixtureGz]])) === 0);
  assert.ok(fs.readFileSync(path.join(here, 'fixtures', 'scene-fixture.js'), 'utf8').includes(fixtureZip.toString('base64')));
  assert.match(fixtureScene.note, /SYNTHETIC FIXTURE/);
});

// ---- the zip ------------------------------------------------------------------------------------------------------
test('the fixture zip opens and holds a scene the page accepts', async () => {
  const files = await Z.read(new Uint8Array(fixtureZip));
  assert.deepEqual(Object.keys(files), ['scene.json.gz']);
  const scene = await Z.sceneJson(files['scene.json.gz']);
  assert.equal(scene.format, 'ryagram-scene');
  assert.doesNotThrow(() => C.parseScene(scene));
});
test('deflated entries and fonts open too, and the CRC is checked', async () => {
  const woff = Buffer.from('wOF2-fake-font-bytes');
  const files = await Z.read(new Uint8Array(makeZip([['scene.json.gz', fixtureGz], ['fonts/Arial-Bold.woff2', woff]], true)));
  assert.equal(Buffer.from(files['fonts/Arial-Bold.woff2']).toString(), 'wOF2-fake-font-bytes');
  const bad = Buffer.from(makeZip([['scene.json.gz', fixtureGz]]));
  bad[bad.indexOf(Buffer.from('scene.json.gz')) + 13 + 20] ^= 0xff;            // flip a byte of the stored gzip
  await msg(() => Z.read(new Uint8Array(bad)), /damaged/);
});
test('the zip is refused when it holds anything the worker would not pack, or is cut, repeated, encrypted or huge', async () => {
  for (const name of ['x.txt', '../scene.json.gz', 'fonts/../scene.json.gz', 'fonts/x.exe', 'fonts/', 'fonts/sub/x.woff2', 'FONTS/x.woff2', 'scene.json']) {
    await msg(() => Z.read(new Uint8Array(makeZip([['scene.json.gz', fixtureGz], [name, Buffer.from('x')]]))), /unexpected|damaged/);
  }
  await msg(() => Z.read(new Uint8Array(makeZip([['scene.json.gz', fixtureGz], ['scene.json.gz', fixtureGz]]))), /repeats/);
  await msg(() => Z.read(new Uint8Array(makeZip([['fonts/a.woff2', Buffer.from('x')]]))), /no scene/);
  await msg(() => Z.read(new Uint8Array(fixtureZip.subarray(0, fixtureZip.length - 30))), /isn.t a preview file|damaged/);
  await msg(() => Z.read(new Uint8Array(Buffer.from('not a zip at all'))), /isn.t a preview file/);
  const enc = Buffer.from(makeZip([['scene.json.gz', fixtureGz]]));
  enc.writeUInt16LE(1, enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);   // the central entry's "encrypted" flag
  await msg(() => Z.read(new Uint8Array(enc)), /encrypted/);
  const many = Array.from({ length: 65 }, (_, i) => [`fonts/f${i}.woff2`, Buffer.from('x')]);
  await msg(() => Z.read(new Uint8Array(makeZip([['scene.json.gz', fixtureGz], ...many]))), /too many/);
});
test('a gzip bomb stops at the cap and a scene that is not JSON is refused', async () => {
  const bomb = zlib.gzipSync(Buffer.alloc(210 * 1024 * 1024), { level: 9 });
  await msg(() => Z.sceneJson(new Uint8Array(bomb)), /larger than expected/);
  await msg(() => Z.sceneJson(new Uint8Array(zlib.gzipSync(Buffer.from('{not json')))), /damaged/);
  assert.equal(Z.crc32(new Uint8Array(Buffer.from('123456789'))), 0xcbf43926);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

// ---- the scene check ----------------------------------------------------------------------------------------------
test('a scene is checked before anything draws it', () => {
  const ok = plain(fixtureScene);
  assert.doesNotThrow(() => C.parseScene(ok));
  const refuse = (mut, re) => { const s = plain(fixtureScene); mut(s); assert.throws(() => C.parseScene(s), re); };
  refuse(s => { s.format = 'other'; }, /isn.t a scene/);
  refuse(s => { s.version = 2; }, /newer app/);
  refuse(s => { delete s.version; }, /no version/);
  refuse(s => { s.canvas = [1920]; }, /picture size/);
  refuse(s => { s.canvas = [10, 1080]; }, /picture size/);
  refuse(s => { s.fps = 0; }, /frame rate/);
  refuse(s => { s.frames = 0; }, /length/);
  refuse(s => { s.clock.periods = []; }, /timeline/);
  refuse(s => { s.marks = s.marks.slice(1); }, /timeline/);
  refuse(s => { s.marks[3] = s.marks[2]; }, /timeline/);
  refuse(s => { s.marks[5] = 99999; }, /timeline/);
  assert.throws(() => C.parseScene(null), /isn.t a scene/);
});

// ---- the clock ----------------------------------------------------------------------------------------------------
test('exact-year marks: listed by the bundle, or derived the way the engine spaces them (stills hold the clock)', () => {
  const s = plain(fixtureScene);
  assert.deepEqual(plain(C.marksOf(s)), s.marks);
  delete s.marks;
  assert.deepEqual(plain(C.marksOf(s)), fixtureScene.marks);          // derived == listed for the fixture
  assert.equal(C.marksOf(s)[1] - C.marksOf(s)[0], 30 + 45);          // the first still adds its 45 frames
  assert.equal(C.periodAt(fixtureScene.marks, 0), 0);
  assert.equal(C.periodAt(fixtureScene.marks, fixtureScene.marks[5] - 1), 4);
  assert.equal(C.periodAt(fixtureScene.marks, fixtureScene.frames - 1), 37);
  assert.equal(C.clampFrame(fixtureScene, -5), 0);
  assert.equal(C.clampFrame(fixtureScene, 1e9), fixtureScene.frames - 1);
  assert.equal(C.clampFrame(fixtureScene, 'x'), 0);
});
test('the nearest exact-year frame, ties going forward, ends included', () => {
  const m = [0, 100, 200];
  assert.deepEqual([0, 49, 50, 51, 100, 149, 150, 199, 250].map(f => C.nearestMark(m, f)), [0, 0, 100, 100, 100, 100, 200, 200, 200]);
});

// ---- smoothness ---------------------------------------------------------------------------------------------------
test('over budget for 10 frames -> snap to exact years, and it stays snapped until three full draws are comfortably fast', () => {
  const b = new C.FrameBudget({ device: 'desktop' });
  for (let i = 0; i < 9; i++) assert.equal(b.record(40), 'live');       // not enough evidence yet
  assert.equal(b.record(40), 'snap');
  for (let i = 0; i < 30; i++) assert.equal(b.record(1), 'snap');        // cached frames being shown are fast, which proves nothing
  assert.equal(b.probe(14), 'snap');                                    // 14 ms is not under 75% of 16
  assert.equal(b.probe(5), 'snap'); assert.equal(b.probe(5), 'snap');   // [14, 5, 5]: the 14 is still one of the last three
  assert.equal(b.probe(5), 'live');                                     // [5, 5, 5]
  const fine = new C.FrameBudget({ device: 'desktop' });
  for (let i = 0; i < 40; i++) fine.record(8);
  assert.equal(fine.mode, 'live');
  const spiky = new C.FrameBudget({ device: 'desktop' });
  for (let i = 0; i < 20; i++) spiky.record(i % 5 === 0 ? 60 : 4);      // a median under budget is not slow, whatever the spikes
  assert.equal(spiky.mode, 'live');
});
test('phones get 33 ms, desktops 16 ms; heavy scenes can start snapped; the device is told from the browser', () => {
  assert.deepEqual([C.BUDGET_MS.desktop, C.BUDGET_MS.phone], [16, 33]);
  const phone = new C.FrameBudget({ device: 'phone' });
  for (let i = 0; i < 10; i++) phone.record(25);
  assert.equal(phone.mode, 'live');
  for (let i = 0; i < 10; i++) phone.record(40);
  assert.equal(phone.mode, 'snap');
  assert.equal(new C.FrameBudget({ startSnapped: true }).mode, 'snap');
  assert.equal(C.deviceClass({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' }), 'phone');
  assert.equal(C.deviceClass({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0, width: 1440 }), 'desktop');
  assert.equal(C.deviceClass({ userAgent: 'x', maxTouchPoints: 5, width: 390 }), 'phone');
  const m = [0, 100, 200];
  assert.equal(C.frameWhileDragging('live', m, 130), 130);
  assert.equal(C.frameWhileDragging('snap', m, 130), 100);
});

// ---- the exact-year cache -----------------------------------------------------------------------------------------
test('the cache plan starts nearest the person and spreads outward; the cache keeps a bounded set and closes what it drops', () => {
  const marks = [0, 10, 20, 30, 40, 50];
  assert.deepEqual(C.cachePlan(marks, 31), [30, 20, 40, 10, 50, 0]);
  assert.deepEqual(C.cachePlan(marks, 0), [0, 10, 20, 30, 40, 50]);
  const closed = [];
  const cache = new C.FrameCache(3);
  for (const f of [0, 10, 20, 30]) cache.set(f, { f, close: () => closed.push(f) }, 30);
  assert.equal(cache.size, 3);
  assert.deepEqual(closed, [0]);                                         // the oldest goes first
  assert.equal(cache.get(10).f, 10);                                     // reading refreshes it
  cache.set(40, { f: 40, close: () => closed.push(40) }, 40);
  assert.deepEqual(closed, [0, 20]);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(closed.length, 5);
});

// ---- keyboard and speech ------------------------------------------------------------------------------------------
test('keys: arrows one frame (Shift ten), Page Up and Down one year, Home and End; nothing else', () => {
  const s = plain(fixtureScene), m = s.marks;
  assert.equal(C.keyTarget(s, m, 100, 'ArrowRight'), 101);
  assert.equal(C.keyTarget(s, m, 100, 'ArrowLeft'), 99);
  assert.equal(C.keyTarget(s, m, 100, 'ArrowRight', true), 110);
  assert.equal(C.keyTarget(s, m, 0, 'ArrowLeft'), 0);
  assert.equal(C.keyTarget(s, m, s.frames - 1, 'ArrowRight'), s.frames - 1);
  assert.equal(C.keyTarget(s, m, m[3], 'PageUp'), m[4]);
  assert.equal(C.keyTarget(s, m, m[3] + 7, 'PageDown'), m[3]);          // within a year: back to its mark first
  assert.equal(C.keyTarget(s, m, m[3], 'PageDown'), m[2]);
  assert.equal(C.keyTarget(s, m, m[37], 'PageUp'), m[37]);
  assert.equal(C.keyTarget(s, m, 100, 'Home'), 0);
  assert.equal(C.keyTarget(s, m, 100, 'End'), s.frames - 1);
  assert.equal(C.keyTarget(s, m, 100, 'a'), null);
});
test('what a screen reader hears: the year, "moving to the next year" between marks, and the drawer\'s readout when it has one', () => {
  const s = plain(fixtureScene), m = s.marks;
  assert.equal(C.valueText(s, m, m[9]), '1965');
  assert.equal(C.valueText(s, m, m[9] + 10), '1965, moving to the next year');
  const describe = () => ({ readout: '3,148 miles built' });
  assert.equal(C.valueText(s, m, m[9], describe), '1965, 3,148 miles built');
  assert.equal(C.valueText(s, m, m[9], () => { throw new Error('x'); }), '1965');
  assert.equal(C.mmss(0, 30), '0:00');
  assert.equal(C.mmss(1214, 30), '0:40');
  assert.equal(C.mmss(30 * 125, 30), '2:05');
});

// ---- the stand-in drawer (the real one is BUILDER's) --------------------------------------------------------------
test('the fixture drawer: pure, attributes only (no inline style), parts split cleanly, roads reveal as the clock says', () => {
  const D = load('tests/fixtures/scene-draw-fixture.js').ryagramSceneDraw;
  const s = plain(fixtureScene), m = s.marks;
  const all = D.draw(s, m[10]);
  assert.equal(all, D.draw(s, m[10]));                                   // deterministic
  assert.doesNotMatch(all, /\sstyle=|<style|<script|on\w+=/);
  assert.match(all, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1920 1080"/);
  const g = D.draw(s, m[10], { parts: 'graphics' }), t = D.draw(s, m[10], { parts: 'texts' });
  assert.doesNotMatch(g, /<text/);
  assert.doesNotMatch(t, /<path|<rect/);
  assert.match(t, />1966</);                                             // the year text at the 11th mark
  const early = D.draw(s, m[2] + 5, { parts: 'graphics' }).length, late = D.draw(s, m[30], { parts: 'graphics' }).length;
  assert.ok(late > early, 'later years carry more drawn road');
  const mid = D.draw(s, m[10] + 45 + 15, { parts: 'graphics' });         // halfway through a tween: some miles partly faded in
  assert.match(mid, /opacity="0\.\d+"/);
  assert.equal(D.describe(s, m[0]).readout, '0.0 miles built (made up)');
  assert.equal(D.tick(s, s.frames - 1).index, 37);
});
