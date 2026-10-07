// The live preview's logic (assets/preview/*.js): the bundle zip, the scene checks, the clock and exact-year marks, the smoothness
// controller, the exact-year cache plan, keyboard and speech, and the engine's own drawer (vendored, pinned) on a REAL engine export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zip as makeZip, crc32 } from '../tools/pack-scene-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8');
function load(...files) {
  const window = {};
  const ctx = { window, Blob, DecompressionStream, TextDecoder, Uint8Array, Uint32Array, DataView, URL, Error, Promise, Math, Number, Array, Object, String, JSON, Map, Set, Date, Infinity };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(read(f), ctx);
  return ctx;
}
const Z = load('assets/preview/preview-zip.js').window.ryagramZip;
const C = load('assets/preview/preview-core.js').window.ryagramPreviewCore;
const D = load('assets/preview/scene-draw.min.js').RyagramScene;
const plain = x => JSON.parse(JSON.stringify(x));
const realZip = fs.readFileSync(path.join(here, 'fixtures', 'scene-real.zip'));
const files = await Z.read(new Uint8Array(realZip));
const scene = await Z.sceneJson(files['scene.json.gz']);
const sceneGz = Buffer.from(files['scene.json.gz']);
const msg = async (fn, re) => assert.rejects(Promise.resolve().then(fn), err => { assert.match(err.message, re); return true; });

// ---- the fixture and the vendored drawer -------------------------------------------------------------------------------------
test('the fixture is a real engine export, the drawer is the pinned engine file, and the pin file says so', () => {
  assert.equal(scene.format, 'ryagram-scene');
  assert.equal(scene.version, 1);
  assert.equal(scene.engine_dirty, false);
  assert.equal(scene.frames, 180);
  assert.match(fs.readFileSync(path.join(here, 'fixtures', 'scene-real.PROVENANCE.txt'), 'utf8'), /network_fixture/);
  assert.ok(fs.readFileSync(path.join(here, 'fixtures', 'scene-real.js'), 'utf8').includes(realZip.toString('base64')));
  const bytes = fs.readFileSync(path.join(here, '..', 'assets', 'preview', 'scene-draw.min.js'));
  const pin = read('assets/preview/scene-draw.PIN');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), pin.match(/sha256 ([0-9a-f]{64})/)[1]);
  assert.equal(bytes.length, Number(pin.match(/(\d+) bytes/)[1]));
  assert.ok(!bytes.includes(13), 'the pinned bytes are LF only');
  assert.match(fs.readFileSync(path.join(here, '..', '.gitattributes'), 'utf8'), /scene-draw\.min\.js text eol=lf/);
});
test('the vendored drawer holds drawing code only: nothing that reaches the network, storage, the page, timers or eval', () => {
  const src = fs.readFileSync(path.join(here, '..', 'assets', 'preview', 'scene-draw.min.js'), 'utf8');
  for (const word of ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'document', 'window.', 'navigator', 'setTimeout', 'setInterval', 'eval(', 'Function(', 'import(', 'importScripts', 'postMessage', 'require(']) {
    assert.ok(!src.includes(word), word);
  }
});

// ---- the zip ------------------------------------------------------------------------------------------------------
test('the real fixture zip opens: the scene and the two fonts, and the scene passes the page\'s checks', async () => {
  assert.deepEqual(Object.keys(files).sort(), ['fonts/LiberationSans-Bold.woff2', 'fonts/LiberationSans-Regular.woff2', 'scene.json.gz']);
  assert.doesNotThrow(() => C.parseScene(scene));
});
test('deflated entries open too, and the CRC is checked', async () => {
  const woff = Buffer.from('wOF2-fake-font-bytes');
  const out = await Z.read(new Uint8Array(makeZip([['scene.json.gz', sceneGz], ['fonts/Arial-Bold.woff2', woff]], true)));
  assert.equal(Buffer.from(out['fonts/Arial-Bold.woff2']).toString(), 'wOF2-fake-font-bytes');
  const bad = Buffer.from(makeZip([['scene.json.gz', sceneGz]]));
  bad[bad.indexOf(Buffer.from('scene.json.gz')) + 13 + 20] ^= 0xff;
  await msg(() => Z.read(new Uint8Array(bad)), /damaged/);
});
test('the zip is refused when it holds anything the worker would not pack, or is cut, repeated, encrypted or huge', async () => {
  for (const name of ['x.txt', '../scene.json.gz', 'fonts/../scene.json.gz', 'fonts/x.exe', 'fonts/', 'fonts/sub/x.woff2', 'FONTS/x.woff2', 'scene.json']) {
    await msg(() => Z.read(new Uint8Array(makeZip([['scene.json.gz', sceneGz], [name, Buffer.from('x')]]))), /unexpected|damaged/);
  }
  await msg(() => Z.read(new Uint8Array(makeZip([['scene.json.gz', sceneGz], ['scene.json.gz', sceneGz]]))), /repeats/);
  await msg(() => Z.read(new Uint8Array(makeZip([['fonts/a.woff2', Buffer.from('x')]]))), /no scene/);
  await msg(() => Z.read(new Uint8Array(realZip.subarray(0, realZip.length - 30))), /isn.t a preview file|damaged/);
  await msg(() => Z.read(new Uint8Array(Buffer.from('not a zip at all'))), /isn.t a preview file/);
  const enc = Buffer.from(makeZip([['scene.json.gz', sceneGz]]));
  enc.writeUInt16LE(1, enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
  await msg(() => Z.read(new Uint8Array(enc)), /encrypted/);
  const many = Array.from({ length: 65 }, (_, i) => [`fonts/f${i}.woff2`, Buffer.from('x')]);
  await msg(() => Z.read(new Uint8Array(makeZip([['scene.json.gz', sceneGz], ...many]))), /too many/);
});
test('a gzip bomb stops at the cap and a scene that is not JSON is refused', async () => {
  await msg(() => Z.sceneJson(new Uint8Array(zlib.gzipSync(Buffer.alloc(210 * 1024 * 1024), { level: 9 }))), /larger than expected/);
  await msg(() => Z.sceneJson(new Uint8Array(zlib.gzipSync(Buffer.from('{not json')))), /damaged/);
  assert.equal(Z.crc32(new Uint8Array(Buffer.from('123456789'))), 0xcbf43926);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

// ---- the scene check ----------------------------------------------------------------------------------------------
test('a scene is checked before anything draws it', () => {
  const refuse = (mut, re) => { const s = plain(scene); mut(s); assert.throws(() => C.parseScene(s), re); };
  refuse(s => { s.format = 'other'; }, /isn.t a scene/);
  refuse(s => { s.version = 2; }, /newer app/);
  refuse(s => { delete s.version; }, /no version/);
  refuse(s => { s.canvas = [1920]; }, /picture size/);
  refuse(s => { s.canvas = [10, 1080]; }, /picture size/);
  refuse(s => { s.fps = 0; }, /frame rate/);
  refuse(s => { s.frames = 0; }, /length/);
  refuse(s => { s.clock.periods = []; }, /timeline/);
  refuse(s => { s.clock.ticks.pop(); }, /timeline/);
  refuse(s => { s.clock.ticks[5] = [99, 0]; }, /timeline/);
  refuse(s => { s.clock.ticks[5] = [0, 1.5]; }, /timeline/);
  refuse(s => { s.clock.ticks[100] = [0, 0]; }, /timeline/);                         // the period may never go backwards
  refuse(s => { s.marks = [0, 5, 5, 9, 12, 15]; }, /timeline/);
  assert.throws(() => C.parseScene(null), /isn.t a scene/);
});

// ---- the clock ----------------------------------------------------------------------------------------------------
test('exact-year marks come from the real clock: the first frame at which each period is shown exactly', () => {
  const marks = C.marksOf(scene);
  assert.equal(marks.length, scene.clock.periods.length);
  marks.forEach((m, i) => {
    assert.deepEqual(plain(scene.clock.ticks[m]), [i, 0], `period ${i}`);
    for (let f = 0; f < m; f++) assert.ok(!(scene.clock.ticks[f][0] === i && scene.clock.ticks[f][1] === 0), `no earlier exact frame for period ${i}`);
  });
  assert.equal(C.periodAt(marks, 0), 0);
  assert.equal(C.periodAt(marks, marks[3] - 1), 2);
  assert.equal(C.periodAt(marks, scene.frames - 1), scene.clock.periods.length - 1);
  assert.equal(C.clampFrame(scene, -5), 0);
  assert.equal(C.clampFrame(scene, 1e9), scene.frames - 1);
  assert.equal(C.clampFrame(scene, 'x'), 0);
  const listed = plain(scene); listed.marks = [0, 40, 80, 120, 150, 179];
  assert.deepEqual(plain(C.marksOf(listed)), listed.marks);                          // a bundle that lists its marks wins
  const held = C.stills(scene);                                                      // the film holds the last year
  assert.ok(held.length >= 1 && held.at(-1).last === scene.frames - 1);
  assert.ok(held.every(s => s.last > s.first));
});
test('the nearest exact-year frame, ties going forward, ends included', () => {
  const m = [0, 100, 200];
  assert.deepEqual([0, 49, 50, 51, 100, 149, 150, 199, 250].map(f => C.nearestMark(m, f)), [0, 0, 100, 100, 100, 100, 200, 200, 200]);
});

// ---- smoothness ---------------------------------------------------------------------------------------------------
test('over budget for 10 frames -> snap to exact years, and it stays snapped until three full draws are comfortably fast', () => {
  const b = new C.FrameBudget({ device: 'desktop' });
  for (let i = 0; i < 9; i++) assert.equal(b.record(40), 'live');
  assert.equal(b.record(40), 'snap');
  for (let i = 0; i < 30; i++) assert.equal(b.record(1), 'snap');
  assert.equal(b.probe(14), 'snap');
  assert.equal(b.probe(5), 'snap'); assert.equal(b.probe(5), 'snap');
  assert.equal(b.probe(5), 'live');
  const fine = new C.FrameBudget({ device: 'desktop' });
  for (let i = 0; i < 40; i++) fine.record(8);
  assert.equal(fine.mode, 'live');
  const spiky = new C.FrameBudget({ device: 'desktop' });
  for (let i = 0; i < 20; i++) spiky.record(i % 5 === 0 ? 60 : 4);
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
  assert.deepEqual(closed, [0]);
  assert.equal(cache.get(10).f, 10);
  cache.set(40, { f: 40, close: () => closed.push(40) }, 40);
  assert.deepEqual(closed, [0, 20]);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(closed.length, 5);
});

// ---- keyboard and speech ------------------------------------------------------------------------------------------
test('keys: arrows one frame (Shift ten), Page Up and Down one year, Home and End; nothing else', () => {
  const m = C.marksOf(scene), last = scene.frames - 1;
  assert.equal(C.keyTarget(scene, m, 100, 'ArrowRight'), 101);
  assert.equal(C.keyTarget(scene, m, 100, 'ArrowLeft'), 99);
  assert.equal(C.keyTarget(scene, m, 100, 'ArrowRight', true), 110);
  assert.equal(C.keyTarget(scene, m, 0, 'ArrowLeft'), 0);
  assert.equal(C.keyTarget(scene, m, last, 'ArrowRight'), last);
  assert.equal(C.keyTarget(scene, m, m[3], 'PageUp'), m[4]);
  assert.equal(C.keyTarget(scene, m, m[3] + 7, 'PageDown'), m[3]);
  assert.equal(C.keyTarget(scene, m, m[3], 'PageDown'), m[2]);
  assert.equal(C.keyTarget(scene, m, m[m.length - 1], 'PageUp'), m[m.length - 1]);
  assert.equal(C.keyTarget(scene, m, 100, 'Home'), 0);
  assert.equal(C.keyTarget(scene, m, 100, 'End'), last);
  assert.equal(C.keyTarget(scene, m, 100, 'a'), null);
});
test('what a screen reader hears: the year, "moving to the next year" between marks, and the drawer\'s own readout', () => {
  const m = C.marksOf(scene);
  assert.equal(C.valueText(scene, m, m[2]), '1957');
  assert.equal(C.valueText(scene, m, m[2] + 5), '1957, moving to the next year');
  assert.equal(C.valueText(scene, m, m[2], () => ({ readout: '3,148 miles built' })), '1957, 3,148 miles built');
  assert.equal(C.valueText(scene, m, m[2], () => { throw new Error('x'); }), '1957');
  const real = C.valueText(scene, m, m[3], D.describe);
  assert.match(real, /^1958, .+/);                                                  // the engine's own readout text is appended
  assert.equal(C.mmss(0, 30), '0:00');
  assert.equal(C.mmss(1214, 30), '0:40');
  assert.equal(C.mmss(30 * 125, 30), '2:05');
});

// ---- the engine's drawer on the real export -----------------------------------------------------------------------------------
test('the drawer draws every frame of the real export: attributes only, parts that add up, a clock that moves', () => {
  for (let f = 0; f < scene.frames; f++) {
    const all = D.draw(scene, f);
    assert.doesNotMatch(all, /\sstyle=|<style|<script|\son\w+=/, `frame ${f}`);
    if (f % 15 === 0 || f === scene.frames - 1) {
      assert.equal(D.body(scene, f), D.body(scene, f, { parts: 'graphics' }) + D.body(scene, f, { parts: 'texts' }), `parts of frame ${f}`);
    }
  }
  const m = C.marksOf(scene);
  const early = D.body(scene, m[1], { parts: 'graphics' }).length, late = D.body(scene, m[m.length - 1], { parts: 'graphics' }).length;
  assert.ok(late > early, 'later years carry more drawn road');
  assert.notEqual(D.body(scene, m[1], { parts: 'texts' }), D.body(scene, m[4], { parts: 'texts' }));
  assert.equal(D.describe(scene, m[3]).period, '1958');
  assert.throws(() => D.draw(scene, scene.frames), /outside/);
  assert.throws(() => D.draw({ ...scene, version: 2 }, 0), /version/);
  assert.match(D.draw(scene, 0), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+"><defs>/);
});
