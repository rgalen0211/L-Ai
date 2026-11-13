// The browser half of "the editor shows your film's REAL frames" (WEB, 2026-11-13, CC1 item 1, piece B foundation). The house worker builds a film in WINDOWS of at most 10 seconds (job type
// film_bundle, ENGINE's `ryagram.preview.frames --seconds A:B`); each finished window is one file, film.bundle.zip: scene.json.gz (the engine's own frames, kind "frames", version 4),
// manifest.json and the fonts. This file opens such a window safely, keeps the windows in a small store, and draws a frame from one. It never asks a server for anything itself: the page hands it
// a fetchWindow(text) function (CONNECT's request_film_bundle plus the signed link), so the same code runs in tests on a real bundle made by the engine.
//
//   open(bytes, { drawer }) -> { scene, manifest, fonts, first, frames, fps, seconds: [a, b] }       checked: manifest, window, every file's size and sha256
//   windowFor(second) -> { a, b, text }                                                                the 10-second window that holds a moment
//   new FrameStore({ fetchWindow, drawer, onChange }): want(second) -> state, frameAt(second) -> { state, svg } , thumbUri(second, width), states()
//
// A window's state is one of: 'idle', 'building' (asked for, not here yet), 'ready', 'failed' (with a reason in words). Nothing is invented: a moment whose window is not ready has no picture.
(() => {
  const WINDOW = 10;
  const clean = v => String(v == null ? '' : v).replace(/[^\x20-\x7e]/g, ' ').slice(0, 200);
  const fail = msg => { throw new FramesError(msg); };
  class FramesError extends Error {}

  // The window that holds a moment (whole seconds, 10 s wide, from 0): the same rule the database and the worker enforce.
  function windowFor(second) {
    const s = Number(second); const t = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
    const a = Math.floor(t / WINDOW) * WINDOW;
    return { a, b: a + WINDOW, text: `${a}:${a + WINDOW}` };
  }

  async function sha256Hex(bytes) {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const isInt = v => Number.isInteger(v) && v >= 0;

  // Opens a bundle: the zip (checksums and names checked by ryagramZip), the manifest read and checked against what is inside, the scene read.
  async function open(input, { drawer } = {}) {
    const Z = window.ryagramZip; if (!Z) fail('The film reader is not loaded.');
    const files = await Z.read(input);
    if (!files['manifest.json']) fail('This part of your film has no manifest, so it is not used.');
    let manifest;
    try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json'])); } catch { fail('The manifest of this part of your film is damaged.'); }
    if (!isObj(manifest) || manifest.format !== 'ryagram-scene' || manifest.kind !== 'frames' || manifest.version !== 4) fail('This part of your film is not in a format this page can draw.');
    const w = manifest.window;
    if (!isObj(w) || !Array.isArray(w.seconds) || w.seconds.length !== 2 || !isInt(w.seconds[0]) || !isInt(w.seconds[1]) || w.seconds[1] <= w.seconds[0] || w.seconds[1] - w.seconds[0] > WINDOW
        || !isInt(w.first_frame) || !isInt(w.frames) || w.frames < 1) fail('The window named in this part of your film is not valid.');
    if (!Array.isArray(manifest.files)) fail('The manifest lists no files.');
    const listed = new Map();
    for (const f of manifest.files) {
      if (!isObj(f) || typeof f.path !== 'string' || !isInt(f.bytes) || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256) || listed.has(f.path)) fail('The manifest of this part of your film is not valid.');
      listed.set(f.path, f);
    }
    const inside = Object.keys(files).filter(n => n !== 'manifest.json');
    if (inside.length !== listed.size || inside.some(n => !listed.has(n))) fail('The files in this part of your film are not the files its manifest names.');
    for (const n of inside) {
      const f = listed.get(n);
      if (files[n].length !== f.bytes) fail(`The size of ${clean(n)} is not the size its manifest gives.`);
      if (await sha256Hex(files[n]) !== f.sha256) fail(`${clean(n)} is not the file its manifest describes.`);
    }
    const scene = await Z.sceneJson(files['scene.json.gz']);
    if (!isObj(scene) || scene.kind !== 'frames' || scene.frames !== w.frames || scene.first_frame !== w.first_frame || scene.story_sha256 !== manifest.story_sha256) fail('The picture data of this part of your film does not match its manifest.');
    if (drawer && typeof drawer.draw !== 'function') fail('The drawing code is not loaded.');
    const fonts = {}; for (const n of inside) if (n.startsWith('fonts/')) fonts[n] = files[n];
    return { scene, manifest, fonts, first: w.first_frame, frames: w.frames, fps: Number(manifest.fps) || Number(scene.fps) || 30, seconds: [w.seconds[0], w.seconds[1]] };
  }

  // Which frame of an opened window holds a moment (0-based inside the window), or null when the moment is outside it.
  function frameIn(win, second) {
    const rel = (Number(second) - win.seconds[0]) * win.fps;
    if (!Number.isFinite(rel) || rel < 0) return null;
    const f = Math.floor(rel + 1e-9);
    return f < win.frames ? f : (Number(second) <= win.seconds[1] ? win.frames - 1 : null);
  }

  class FrameStore {
    // fetchWindow(text, { onProgress }) -> Promise<Uint8Array | ArrayBuffer>: the page's own way to get one window (request, wait, signed link, download); it may reject with an Error whose message is the reason.
    constructor({ fetchWindow, drawer = window.RyagramScene, onChange = () => {}, keep = 6 } = {}) {
      if (typeof fetchWindow !== 'function') fail('A film store needs a way to get a window.');
      this.fetchWindow = fetchWindow; this.drawer = drawer; this.onChange = onChange; this.keep = Math.max(2, keep);
      this.wins = new Map();                       // text -> { state, reason, win, at, progress }
      this.clock = 0;
    }
    _entry(text) { if (!this.wins.has(text)) this.wins.set(text, { state: 'idle', reason: '', win: null, at: 0, progress: null }); return this.wins.get(text); }
    _evict() {
      const ready = [...this.wins.entries()].filter(([, e]) => e.state === 'ready').sort((a, b) => a[1].at - b[1].at);
      while (ready.length > this.keep) this.wins.delete(ready.shift()[0]);        // the oldest windows go first: a thumbnail of a hatched map is about a million characters
    }
    // Ask for the window that holds this moment, then the next one. Returns the state of the first.
    want(second) {
      const w = windowFor(second);
      this._start(w.text);
      this._start(windowFor(w.b).text, true);
      return this._entry(w.text).state;
    }
    _start(text, quiet = false) {
      const e = this._entry(text); e.at = ++this.clock;
      if (e.state === 'ready' || e.state === 'building') return;
      if (e.state === 'failed') return;                                          // a failure is final for this story (the database says so too): it is not asked again until the store is replaced
      e.state = 'building'; e.reason = '';
      const progress = p => { e.progress = p; this.onChange(text, e); };
      Promise.resolve().then(() => this.fetchWindow(text, { onProgress: progress })).then(bytes => open(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { drawer: this.drawer })).then(win => {
        e.win = win; e.state = 'ready'; e.progress = 100; this._evict(); this.onChange(text, e);
      }).catch(err => { e.state = 'failed'; e.reason = clean(err && err.message) || 'This part of your film could not be drawn.'; if (!quiet || true) this.onChange(text, e); });
    }
    states() { return Object.fromEntries([...this.wins.entries()].map(([k, e]) => [k, e.state])); }
    stateOf(second) { return this._entry(windowFor(second).text).state; }
    reasonOf(second) { return this._entry(windowFor(second).text).reason; }
    progressOf(second) { return this._entry(windowFor(second).text).progress; }
    // The drawing of a moment, or { state } alone when its window is not ready. The picture is the engine's own SVG.
    frameAt(second) {
      const e = this._entry(windowFor(second).text);
      if (e.state !== 'ready') return { state: e.state, svg: null, reason: e.reason };
      const f = frameIn(e.win, second);
      if (f === null) return { state: 'idle', svg: null, reason: '' };
      e.at = ++this.clock;
      return { state: 'ready', frame: f, svg: this.drawer.draw(e.win.scene, f, { parts: 'all' }), reason: '' };
    }
    // A small picture of a moment as a data: address for an <img>, drawn on demand (one at a time by the caller), or null when the window is not ready.
    thumbUri(second, width = 160) {
      const e = this._entry(windowFor(second).text);
      if (e.state !== 'ready') return null;
      const f = frameIn(e.win, second); if (f === null || typeof this.drawer.thumbUri !== 'function') return null;
      return this.drawer.thumbUri(e.win.scene, f, Math.min(4096, Math.max(16, Math.floor(width))));
    }
  }

  window.ryagramEditorFrames = { WINDOW, windowFor, open, frameIn, FrameStore, FramesError };
})();
