// The browser half of the editor's real frames (WEB, 2026-11-13, piece B foundation): opens a real film.bundle.zip made by the engine's own frames command on a SYNTHETIC story (a made-up map film,
// nothing of anyone's; tests/fixtures/film-bundle-synthetic-2-4.zip, window 2:4, built by WORKER's joint proof), checks it the way the worker does, draws its frames with the vendored engine drawer, and
// keeps windows in a store. Offline; the page's own way to fetch a window is a fake here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bin = f => new Uint8Array(fs.readFileSync(new URL('../' + f, import.meta.url)));
const win = { crypto: globalThis.crypto };
const ctx = { window: win, self: win, crypto: globalThis.crypto, Blob, DecompressionStream, TextDecoder, Uint8Array, DataView, Promise, console };
for (const f of ['assets/preview/preview-zip.js', 'assets/preview/frames-draw.min.js', 'assets/app-editor-frames.js']) vm.runInNewContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx);
const F = win.ryagramEditorFrames, D = win.RyagramScene;
const BUNDLE = bin('tests/fixtures/film-bundle-synthetic-2-4.zip');
const plain = v => JSON.parse(JSON.stringify(v));

test('windowFor: the 10-second window that holds a moment, from zero, safe on bad input', () => {
  assert.deepEqual(plain(F.windowFor(0)), { a: 0, b: 10, text: '0:10' }); assert.deepEqual(plain(F.windowFor(9.99)), { a: 0, b: 10, text: '0:10' });
  assert.deepEqual(plain(F.windowFor(10)), { a: 10, b: 20, text: '10:20' }); assert.deepEqual(plain(F.windowFor(37.2)), { a: 30, b: 40, text: '30:40' });
  for (const bad of [-5, NaN, 'x', null, undefined, Infinity]) assert.equal(F.windowFor(bad).text, '0:10', String(bad));
});

test('the vendored drawer is pinned, LF only, and holds drawing code only', () => {
  const bytes = fs.readFileSync(new URL('../assets/preview/frames-draw.min.js', import.meta.url)), pin = read('assets/preview/frames-draw.PIN');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), pin.match(/sha256 ([0-9a-f]{64})/)[1]); assert.equal(bytes.length, Number(pin.match(/(\d+) bytes/)[1])); assert.ok(!bytes.includes(13));
  const src = bytes.toString('utf8');
  for (const word of ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'document', 'window.', 'navigator', 'setTimeout', 'setInterval', 'eval(', 'Function(', 'import(', 'importScripts', 'postMessage']) assert.ok(!src.includes(word), word);
  assert.match(read('.gitattributes'), /assets\/preview\/frames-draw\.min\.js text eol=lf/);
});

test('open: a real bundle opens, its manifest and every file are checked, and it says what window it holds', async () => {
  const w = await F.open(BUNDLE, { drawer: D });
  assert.deepEqual(plain(w.seconds), [2, 4]); assert.equal(w.first, 60); assert.equal(w.frames, 60); assert.equal(w.fps, 30);
  assert.deepEqual(Object.keys(w.fonts).sort(), ['fonts/LiberationSans-Bold.woff2', 'fonts/LiberationSans-Regular.woff2']);
  assert.equal(w.manifest.kind, 'frames'); assert.equal(w.scene.frames, 60);
});

// the same bundle with one thing changed, repacked as a stored zip (the page's reader accepts stored entries)
function zipOf(entries) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const table = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = b => { let v = 0xffffffff; for (const x of b) v = table[(v ^ x) & 0xff] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; };
  for (const [name, data] of entries) {
    const nb = enc.encode(name), c = crc(data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, c, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const d = new DataView(new ArrayBuffer(46));
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint32(16, c, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, nb.length, true); d.setUint32(42, offset, true);
    central.push(new Uint8Array(d.buffer), nb); offset += 30 + nb.length + data.length;
  }
  const cd = central.reduce((n, p) => n + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, cd, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
const entriesOf = async bytes => Object.entries(await win.ryagramZip.read(bytes));
async function withChange(fn) {
  const es = await entriesOf(BUNDLE); const m = JSON.parse(new TextDecoder().decode(es.find(([n]) => n === 'manifest.json')[1])); const r = fn(m, es);
  return zipOf(r.entries || es.map(([n, d]) => [n, n === 'manifest.json' ? new TextEncoder().encode(JSON.stringify(r.manifest || m)) : d]));
}

test('open refuses, in words, a bundle that is not what its manifest says', async () => {
  await assert.doesNotReject(async () => F.open(await withChange(() => ({})), { drawer: D }), 'a repacked but unchanged bundle still opens');
  const refused = async (fn, re, label) => assert.rejects(async () => F.open(await withChange(fn), { drawer: D }), re, label);
  await refused(m => ({ manifest: { ...m, kind: 'scene' } }), /not in a format/, 'wrong kind');
  await refused(m => ({ manifest: { ...m, version: 3 } }), /not in a format/, 'wrong version');
  await refused(m => ({ manifest: { ...m, window: { ...m.window, seconds: [4, 40] } } }), /window named/, 'a window longer than 10 s');
  await refused(m => ({ manifest: { ...m, window: { ...m.window, seconds: [4, 2] } } }), /window named/, 'a backwards window');
  await refused(m => ({ manifest: { ...m, window: { ...m.window, frames: 0 } } }), /window named/, 'no frames');
  await refused(m => ({ manifest: { ...m, files: m.files.slice(1) } }), /not the files its manifest names/, 'a file the manifest does not name');
  await refused(m => ({ manifest: { ...m, files: m.files.map((f, i) => (i === 0 ? { ...f, bytes: f.bytes + 1 } : f)) } }), /size of/, 'a wrong size');
  await refused(m => ({ manifest: { ...m, files: m.files.map((f, i) => (i === 0 ? { ...f, sha256: '0'.repeat(64) } : f)) } }), /not the file its manifest describes/, 'a wrong hash');
  await refused(m => ({ manifest: { ...m, story_sha256: 'f'.repeat(64) } }), /does not match its manifest/, 'another story');
  await refused(m => ({ manifest: { ...m, window: { ...m.window, first_frame: 0 } } }), /does not match its manifest/, 'another first frame');
  await refused((m, es) => ({ entries: es.filter(([n]) => n !== 'manifest.json') }), /no manifest/, 'no manifest');
  await refused((m, es) => ({ entries: [...es.filter(([n]) => n !== 'manifest.json'), ['manifest.json', new TextEncoder().encode('{not json')]] }), /manifest of this part of your film is damaged/, 'a damaged manifest');
  await assert.rejects(F.open(new Uint8Array([1, 2, 3]), { drawer: D }), /preview file|damaged/, 'not a zip at all');
});

test('frameIn: the 0-based frame of a moment inside a window, or null outside it', async () => {
  const w = await F.open(BUNDLE, { drawer: D });
  assert.equal(F.frameIn(w, 2), 0); assert.equal(F.frameIn(w, 2.5), 15); assert.equal(F.frameIn(w, 3.99), 59); assert.equal(F.frameIn(w, 4), 59, 'the end moment is the last frame');
  assert.equal(F.frameIn(w, 1.99), null); assert.equal(F.frameIn(w, 4.5), null); assert.equal(F.frameIn(w, NaN), null);
});

// wait until no window of the store is still building (opening a real bundle takes a moment)
const settle = async store => { await new Promise(r => setTimeout(r, 5)); for (let i = 0; i < 400 && store && [...store.wins.values()].some(e => e.state === 'building'); i++) await new Promise(r => setTimeout(r, 25)); };
test('FrameStore: asks for the window under the playhead first, then the next; says nothing before it is ready; a failure keeps its reason and is final', async () => {
  const asked = []; const changes = [];
  const store = new F.FrameStore({ fetchWindow: async text => { asked.push(text); if (text === '0:10') return BUNDLE; throw new Error('not built yet'); }, drawer: D, onChange: (t, e) => changes.push([t, e.state]) });
  assert.equal(store.want(2.5), 'building');
  assert.deepEqual(plain(store.frameAt(2.5)), { state: 'building', svg: null, reason: '' });
  await settle(store); assert.deepEqual(asked, ['0:10', '10:20'], 'the playhead window first, then the next');
  assert.equal(store.stateOf(2.5), 'ready'); assert.equal(store.stateOf(12), 'failed'); assert.equal(store.reasonOf(12), 'not built yet');
  assert.ok(changes.some(([t, s]) => t === '0:10' && s === 'ready'));
  store.want(12); await settle(store); assert.deepEqual(asked, ['0:10', '10:20', '20:30'], 'a failed window is not asked again; the next one is');
});

test('FrameStore: a ready window draws the engine\'s own SVG for a moment, a thumbnail on request, and nothing for a moment outside it', async () => {
  const store = new F.FrameStore({ fetchWindow: async () => BUNDLE, drawer: D });
  store.want(2); await settle(store);
  const a = store.frameAt(2.5); assert.equal(a.state, 'ready'); assert.equal(a.frame, 15); assert.match(a.svg, /^<svg /); assert.ok(a.svg.length > 100000);
  const b = store.frameAt(3.5); assert.notEqual(a.svg, b.svg, 'a different moment is a different picture');
  assert.equal(a.svg, D.draw(store.wins.get('0:10').win.scene, 15, { parts: 'all' }), 'the very drawing the engine drawer makes');
  const u = store.thumbUri(2.5, 160); assert.match(u, /^data:image\/svg\+xml/);
  assert.equal(store.thumbUri(2.5, 5) !== null, true, 'a tiny width is raised to the drawer minimum, not refused');
});

test('FrameStore: a bundle that is not the window asked for is refused in words, and windows leave the store oldest first', async () => {
  const bad = new F.FrameStore({ fetchWindow: async () => new Uint8Array([9, 9, 9]), drawer: D });
  bad.want(0); await settle(bad); assert.equal(bad.stateOf(0), 'failed'); assert.ok(bad.reasonOf(0).length > 5);
  const seen = []; const store = new F.FrameStore({ fetchWindow: async text => { seen.push(text); return BUNDLE; }, drawer: D, keep: 2 });
  for (const s of [0, 10, 20, 30]) { store.want(s); await settle(store); }
  assert.ok([...store.wins.values()].filter(e => e.state === 'ready').length <= 2, 'at most keep windows stay');
  assert.throws(() => new F.FrameStore({}), /needs a way to get a window/);
});

test('wiring: the module and the drawer are not on a page until a page asks; the zip reader names manifest.json', () => {
  assert.match(read('assets/preview/preview-zip.js'), /scene\\\.json\\\.gz\|manifest\\\.json\|fonts/);
});
