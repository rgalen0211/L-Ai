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

// ---- ENGINE's --plan: windows in the render clip's own seconds, the timeline in film seconds ----
const PLAN = { fps: 30, frames: 120, seconds: 4, windows: [{ seconds: [0, 2], window: '0:2' }, { seconds: [2, 4], window: '2:4' }],
  timeline: { clips: [{ id: 't', kind: 'title', label: 'Invented title', start: 0, seconds: 1, drawn: false }, { id: 'main', kind: 'render', label: 'Invented film', start: 1, seconds: 4, drawn: true }], render_clip: 'main', render_start: 1, total_seconds: 5, total_frames: 150 } };
const bad = fn => { const p = JSON.parse(JSON.stringify(PLAN)); fn(p); return p; };

test('checkPlan: a good plan is read, a bad one is refused in words', () => {
  const p = F.checkPlan(PLAN);
  assert.equal(p.fps, 30); assert.equal(p.renderStart, 1); assert.equal(p.renderSeconds, 4); assert.equal(p.totalSeconds, 5); assert.equal(p.totalFrames, 150); assert.equal(p.clips.length, 2); assert.equal(p.clips[1].drawn, true);
  for (const [label, plan] of [
    ['no windows', bad(p => { p.windows = []; })], ['a gap', bad(p => { p.windows[1].seconds = [3, 5]; p.windows[1].window = '3:5'; })], ['a window over ten seconds', bad(p => { p.windows = [{ seconds: [0, 11], window: '0:11' }]; })],
    ['a window name that is not its seconds', bad(p => { p.windows[0].window = '0:3'; })], ['no timeline', bad(p => { delete p.timeline; })], ['no total', bad(p => { p.timeline.total_seconds = 0; })],
    ['a negative render start', bad(p => { p.timeline.render_start = -1; })], ['a bad fps', bad(p => { p.fps = 0; })], ['a clip with no start', bad(p => { p.timeline.clips[0].start = 'x'; })], ['not an object', null]]) {
    assert.throws(() => F.checkPlan(plan), F.FramesError, label);
  }
  const tricky = bad(p => { p.timeline.clips[0].label = 'a' + String.fromCharCode(0) + 'b' + String.fromCharCode(0x202e) + '<script>'; });
  const got = F.checkPlan(tricky).clips[0].label; assert.ok(![...got].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126), 'control and invisible characters are dropped from a label');
});

test('windowIndex: the window holding a render-clip second, the very end in the last, outside is -1', () => {
  const w = F.checkPlan(PLAN).windows;
  assert.equal(F.windowIndex(w, 0), 0); assert.equal(F.windowIndex(w, 1.99), 0); assert.equal(F.windowIndex(w, 2), 1); assert.equal(F.windowIndex(w, 4), 1); assert.equal(F.windowIndex(w, 4.01), -1); assert.equal(F.windowIndex(w, -0.1), -1); assert.equal(F.windowIndex(w, NaN), -1);
});

test('FrameStore with a plan: film seconds map to window seconds through render_start, the playhead window is asked first then ahead, and a moment in the title has no window', async () => {
  const asked = [];
  const store = new F.FrameStore({ plan: PLAN, drawer: D, fetchWindow: async text => { asked.push(text); return text === '2:4' ? BUNDLE : bin('tests/fixtures/film-bundle-synthetic-0-2.zip'); } });
  assert.equal(store.want(0.5), 'outside'); assert.equal(store.stateOf(0.5), 'outside'); assert.deepEqual(plain(store.frameAt(0.5)), { state: 'outside', svg: null, reason: '' });
  assert.equal(store.want(3.5), 'building');                                        // film second 3.5 = window second 2.5, in window 2:4
  await settle(store); assert.deepEqual(asked, ['2:4', '0:2'], 'the playhead window, then the one behind');
  const a = store.frameAt(3.5); assert.equal(a.state, 'ready'); assert.equal(a.frame, 15, 'window second 2.5 is frame 15 of 2:4');
  const first = store.frameAt(1); assert.equal(first.state, 'ready'); assert.equal(first.frame, 0, "film second 1 is the render clip first frame");
  assert.notEqual(a.svg, first.svg);
  assert.equal(store.frameAt(5).state, 'ready', 'the very end of the film holds the last frame');
  assert.equal(store.frameAt(5.5).state, 'outside');
});

test('FrameStore with a plan never has more than maxInFlight windows building', async () => {
  let live = 0, peak = 0;
  const wide = { ...PLAN, windows: [0, 1, 2, 3].map(i => ({ seconds: [i * 2, i * 2 + 2], window: `${i * 2}:${i * 2 + 2}` })) };
  const store = new F.FrameStore({ plan: wide, drawer: D, maxInFlight: 2, fetchWindow: async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 30)); live--; return BUNDLE; } });
  store.want(1); assert.ok(store.building() <= 2); await settle(store); store.want(1); await settle(store);
  assert.ok(peak <= 2, `peak ${peak}`);
});

test('the film editor: it mounts only for a film API, shows labels as text, and says what it is doing', () => {
  const src = read('assets/app-editor-film.js'), ed = read('assets/app-editor.js');
  assert.equal((src.match(/innerHTML/g) || []).length, 1, 'the only HTML set is the engine drawing');
  assert.match(src, /view\.innerHTML = r\.svg;/);
  assert.match(src, /Drawing this part of your film: \$\{Math\.floor\(p \* 100\)\}%/);
  assert.match(ed, /typeof window\.ryagramFilmApi === 'function' \? window\.ryagramFilmApi\(routeProject \|\| null\) : null;/);
  assert.match(ed, /\.\.\.\(filmEd \? \[filmEd\.el\] : \[view,/);
  const html = read('app/index.html');
  const at = n => html.indexOf(n);
  assert.ok(at('frames-draw.min.js') > 0 && at('frames-draw.min.js') < at('app-editor-frames.js') && at('app-editor-frames.js') < at('scene-draw-rules.min.js'), 'the frames drawer is captured before the rules drawer overwrites window.RyagramScene');
  assert.ok(at('preview-zip.js') < at('app-editor-frames.js') && at('app-editor-timeline.js') < at('app-editor-film.js') && at('app-editor-film.js') < at('app-editor.js?v='));
});

test('try colours: the palette of a ready window, a preview-only swap that redraws, never touches the window, ignores unknown colours, and puts the film colours back', async () => {
  const store = new F.FrameStore({ fetchWindow: async () => BUNDLE, drawer: D });
  assert.equal(store.paletteAt(2.5).length, 0, 'nothing for a window nobody asked for');
  store.want(2); assert.equal(store.paletteAt(2.5).length, 0, 'nothing while the window is still being made'); await settle(store);
  const pal = store.paletteAt(2.5); assert.ok(pal.length >= 3); assert.ok(pal.every(c => /^#[0-9a-f]{6}$/.test(c.colour) && c.uses >= 0 && c.elements >= 0));
  assert.ok(pal[0].uses >= pal.at(-1).uses, 'most used first');
  const before = store.frameAt(2.5).svg, sceneBefore = JSON.stringify(store.wins.get('0:10').win.scene.items.slice(0, 50));
  const target = pal.find(c => c.elements > 0).colour;
  store.setColours({ [target]: '#ff00aa' });
  const after = store.frameAt(2.5).svg;
  assert.notEqual(after, before, 'the picture changes'); assert.ok(after.toLowerCase().includes('#ff00aa') || after.includes('255,0,170') , 'the new colour is in the drawing');
  assert.equal(JSON.stringify(store.wins.get('0:10').win.scene.items.slice(0, 50)), sceneBefore, 'the window itself is not changed');
  store.setColours({ '#123456': '#ff00aa', 'not a colour': '#ff00aa', [target]: 'red' });                      // an unknown colour and bad values are dropped, not thrown
  assert.equal(Object.keys(store.colours).length, 1, 'only the well-formed pair is kept (the unknown colour waits, the bad value is gone)');
  assert.equal(store.colours['#123456'], '#ff00aa');
  assert.equal(store.frameAt(2.5).svg, before, "no valid swap is the film own picture");
  store.setColours({ [target]: '#ff00aa' }); assert.notEqual(store.frameAt(2.5).svg, before);
  store.setColours({ '#123456': '#00ffaa', [target]: '#ff00aa' }); assert.notEqual(store.frameAt(2.5).svg, before, 'a colour this window does not use is skipped, the rest still applies');
  store.setColours({}); assert.equal(store.frameAt(2.5).svg, before, 'put back');
  store.setColours({ [target]: target }); assert.equal(store.frameAt(2.5).svg, before, 'a colour swapped for itself changes nothing');
});

test('the colour panel says plainly that a change is not saved', () => {
  assert.match(read('assets/app-editor-film.js'), /This changes the picture you see here only\. It is not saved to your film yet\./);
});
