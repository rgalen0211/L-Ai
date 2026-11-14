// The browser half of "the editor shows your film's REAL frames" (WEB, 2026-11-13, CC1 item 1, piece B foundation). The house worker builds a film in WINDOWS of at most 10 seconds (job type
// film_bundle, ENGINE's `ryagram.preview.frames --seconds A:B`); each finished window is one file, film.bundle.zip: scene.json.gz (the engine's own frames, kind "frames", version 4),
// manifest.json and the fonts. This file opens such a window safely, keeps the windows in a small store, and draws a frame from one. It never asks a server for anything itself: the page hands it
// a fetchWindow(text) function (CONNECT's request_film_bundle plus the signed link), so the same code runs in tests on a real bundle made by the engine.
//
//   open(bytes, { drawer }) -> { scene, manifest, fonts, first, frames, fps, seconds: [a, b] }       checked: manifest, window, every file's size and sha256
//   windowFor(second) -> { a, b, text }                                                                the 10-second window that holds a moment
//   new FrameStore({ fetchWindow, drawer, onChange, plan }): SECONDS: with a plan, want/frameAt/thumbUri take FILM seconds (the window second is the film second minus plan.timeline.render_start); without one they take
//   window seconds on the 10-second grid (tests only). want(second) -> state, frameAt(second) -> { state, svg } , thumbUri(second, width), states()
//
// A window's state is one of: 'idle', 'building' (asked for, not here yet), 'ready', 'failed' (with a reason in words). Nothing is invented: a moment whose window is not ready has no picture.
(() => {
  // The engine's frames drawer, captured NOW: this file loads right after frames-draw.min.js and BEFORE scene-draw-rules.min.js, which writes window.RyagramScene again for the look editor.
  const DRAWER = window.RyagramScene && typeof window.RyagramScene.thumbUri === 'function' && typeof window.RyagramScene.draw === 'function' ? window.RyagramScene : null;
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

  // ENGINE's --plan (python -m ryagram.preview.frames --plan): { fps, frames, seconds, windows: [{ seconds: [A, B], window: 'A:B' }], timeline: { clips: [{ id, kind, label, start, seconds, drawn }], render_clip,
  // render_start, total_seconds, total_frames } }. Window seconds count from the render clip's OWN first frame; the timeline is in FILM seconds; film second = window second + render_start (GEO 09:20).
  // Checked before it is trusted: the windows tile the render clip from 0 with no gap, each at most 10 s; the timeline is consistent with them. The labels are the story's own text: draw with textContent.
  function checkPlan(plan) {
    if (!isObj(plan) || !Array.isArray(plan.windows) || !plan.windows.length || !isObj(plan.timeline)) fail('The plan of your film is not valid.');
    let at = 0; const windows = [];
    for (const w of plan.windows) {
      if (!isObj(w) || !Array.isArray(w.seconds) || w.seconds.length !== 2 || !isInt(w.seconds[0]) || !isInt(w.seconds[1]) || w.seconds[0] !== at || w.seconds[1] <= w.seconds[0] || w.seconds[1] - w.seconds[0] > WINDOW
          || w.window !== `${w.seconds[0]}:${w.seconds[1]}`) fail('The windows in the plan of your film are not valid.');
      windows.push({ seconds: [w.seconds[0], w.seconds[1]], window: w.window }); at = w.seconds[1];
    }
    const tl = plan.timeline, fps = Number(plan.fps);
    if (!Number.isFinite(fps) || fps < 1 || fps > 240 || !Array.isArray(tl.clips) || !Number.isFinite(Number(tl.render_start)) || Number(tl.render_start) < 0
        || !(Number(tl.total_seconds) > 0) || !isInt(tl.total_frames) || tl.total_frames < 1) fail('The timeline in the plan of your film is not valid.');
    const clips = tl.clips.map(c => {
      if (!isObj(c) || !Number.isFinite(Number(c.start)) || Number(c.start) < 0 || !(Number(c.seconds) >= 0)) fail('A clip in the plan of your film is not valid.');
      return { id: clean(c.id), kind: clean(c.kind), label: clean(c.label), start: Number(c.start), seconds: Number(c.seconds), drawn: c.drawn === true };
    });
    return { fps, windows, renderStart: Number(tl.render_start), renderSeconds: at, totalSeconds: Number(tl.total_seconds), totalFrames: tl.total_frames, clips };
  }
  // The index of the plan window holding a render-clip second (A <= t < B; the very end belongs to the last), or -1.
  function windowIndex(windows, t) {
    if (!Array.isArray(windows) || !windows.length || !Number.isFinite(t)) return -1;
    for (let i = 0; i < windows.length; i++) if (t >= windows[i].seconds[0] && t < windows[i].seconds[1]) return i;
    return t === windows[windows.length - 1].seconds[1] ? windows.length - 1 : -1;
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
    if (scene.engine_commit !== manifest.engine_commit) fail('The picture data of this part of your film was drawn by another version of the engine than its manifest names.');
    if (Number(scene.fps) !== Number(manifest.fps)) fail('The picture data of this part of your film has another frame rate than its manifest.');
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
    constructor({ fetchWindow, drawer = DRAWER, onChange = () => {}, keep = 6, plan = null, maxInFlight = 2, now = () => Date.now() } = {}) {
      if (typeof fetchWindow !== 'function') fail('A film store needs a way to get a window.');
      if (!drawer) fail('The drawing code for your film is not loaded.');
      this.now = now; this.fetchWindow = fetchWindow; this.drawer = drawer; this.onChange = onChange; this.keep = Math.max(2, keep);
      this.plan = plan ? checkPlan(plan) : null; this.maxInFlight = Math.max(1, maxInFlight);
      this.colours = {}; this.cver = 0;           // a preview-only colour swap {from: to} in #rrggbb, applied to every window as it is drawn (ENGINE's recolour)
      this.wins = new Map();                       // text -> { state, reason, win, at, progress }
      this.clock = 0;
    }
    _entry(text) { if (!this.wins.has(text)) this.wins.set(text, { state: 'idle', reason: '', win: null, at: 0, progress: null }); return this.wins.get(text); }
    _evict() {
      const ready = [...this.wins.entries()].filter(([, e]) => e.state === 'ready').sort((a, b) => a[1].at - b[1].at);
      while (ready.length > this.keep) this.wins.delete(ready.shift()[0]);        // the oldest windows go first: a thumbnail of a hatched map is about a million characters
    }
    // Which window holds a moment, and the second to read inside it: with a plan the moment is a FILM second (window second = film second - render_start) and the plan's windows are used;
    // without one the moment is a window second and the windows are the 10-second grid.
    _where(second) {
      if (!this.plan) { const w = windowFor(second); return { text: w.text, sec: Number(second), idx: -1 }; }
      const t = Number(second) - this.plan.renderStart, i = windowIndex(this.plan.windows, t);
      return i < 0 ? { text: null, sec: t, idx: -1 } : { text: this.plan.windows[i].window, sec: t, idx: i };
    }
    _settled(e) { return e.state === 'ready' || e.state === 'building' || e.state === 'failed'; }   // nothing more to ask for: here, on its way, or refused for good
    building() { return [...this.wins.values()].filter(e => e.state === 'building').length; }
    // Ask for the window under the playhead first, then the ones ahead, then one behind, never more than maxInFlight building at once (the worker builds one at a time). Returns the state of the first.
    want(second) {
      if (!this.plan) { const w = windowFor(second); this._start(w.text); this._start(windowFor(w.b).text); return this._entry(w.text).state; }
      const here = this._where(second); if (here.idx < 0) return 'outside';
      const order = [here.idx]; for (let k = 1; k <= 2; k++) if (here.idx + k < this.plan.windows.length) order.push(here.idx + k); if (here.idx > 0) order.push(here.idx - 1);
      for (const i of order) {
        const text = this.plan.windows[i].window, e = this._entry(text);
        if (this._settled(e)) { e.at = ++this.clock; continue; }
        if (this.building() >= this.maxInFlight) break;
        this._start(text);
      }
      return this._entry(this.plan.windows[here.idx].window).state;
    }
    // Starts a window. A failure is FINAL only when the bundle itself is refused (open() throws a FramesError, or it is not the window asked for) or the fetch says its job failed on its input (err.final === true):
    // that is what the database remembers too. Anything else (a dropped connection, a timeout, a limit or a pause: SQLSTATE 42501) puts the window back to 'idle' with the words and a pause before it is asked again.
    _start(text) {
      const e = this._entry(text); e.at = ++this.clock;
      if (this._settled(e)) return;
      if (e.retryAt && this.now() < e.retryAt) return;
      e.state = 'building'; e.reason = ''; e.retryAt = 0;
      const progress = p => { e.progress = p; this.onChange(text, e); };
      Promise.resolve().then(() => this.fetchWindow(text, { onProgress: progress })).then(bytes => open(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { drawer: this.drawer })).then(win => {
        const [a, b] = String(text).split(':').map(Number);
        if (win.seconds[0] !== a || win.seconds[1] !== b) fail('This part of your film is not the part that was asked for.');
        e.win = win; e.state = 'ready'; e.progress = 1; this._evict(); this.onChange(text, e);
      }).catch(err => {
        e.reason = clean(err && err.message) || 'This part of your film could not be drawn.';
        if (err instanceof FramesError || (window.ryagramZip && err instanceof window.ryagramZip.BundleError) || (err && err.final === true)) e.state = 'failed';
        else { e.state = 'idle'; e.progress = null; e.retryAt = this.now() + (Number(err && err.retryAfterMs) > 0 ? Number(err.retryAfterMs) : (err && err.code === '42501' ? 15000 : 3000)); }
        this.onChange(text, e);
      });
    }
    // Try colours (preview only): map is { '#rrggbb': '#rrggbb' }; anything else is dropped; {} puts the film's own colours back. The window's own scene is never changed: a recoloured copy is drawn.
    setColours(map) {
      const out = {}; const HEX = /^#[0-9a-f]{6}$/;
      for (const k of Object.keys(map || {})) { const from = String(k).toLowerCase(), to = String(map[k]).toLowerCase(); if (HEX.test(from) && HEX.test(to) && from !== to) out[from] = to; }
      this.colours = out; this.cver++;
    }
    // The colours a moment's window uses, most used first: [{ colour, uses, elements, fixed, spellings }], or [] when its window is not ready.
    paletteAt(second) {
      const w = this._where(second); const e = w.text && this.wins.get(w.text);
      if (!e || e.state !== 'ready' || typeof this.drawer.palette !== 'function') return [];
      return this.drawer.palette(e.win.scene).map(c => ({ colour: c.colour, uses: c.uses, elements: c.elements, fixed: c.fixed, spellings: c.spellings.slice(0, 4) }));
    }
    _sceneFor(e) {
      if (!Object.keys(this.colours).length || typeof this.drawer.recolour !== 'function') return e.win.scene;
      if (e.rc && e.rc.ver === this.cver) return e.rc.scene;
      const have = new Set(this.drawer.palette(e.win.scene).map(c => c.colour)), pairs = {};
      for (const [from, to] of Object.entries(this.colours)) if (have.has(from)) pairs[from] = to;
      let scene = e.win.scene;
      if (Object.keys(pairs).length) { try { scene = this.drawer.recolour(e.win.scene, pairs); } catch { scene = e.win.scene; } }
      e.rc = { ver: this.cver, scene }; return scene;
    }
    states() { return Object.fromEntries([...this.wins.entries()].map(([k, e]) => [k, e.state])); }
    stateOf(second) { const w = this._where(second); return w.text ? this._entry(w.text).state : 'outside'; }
    reasonOf(second) { const w = this._where(second); return w.text ? this._entry(w.text).reason : ''; }
    progressOf(second) { const w = this._where(second); return w.text ? this._entry(w.text).progress : null; }
    // The drawing of a moment, or { state } alone when its window is not ready. The picture is the engine's own SVG.
    frameAt(second) {
      const w = this._where(second); if (!w.text) return { state: 'outside', svg: null, reason: '' };
      const e = this._entry(w.text);
      if (e.state !== 'ready') return { state: e.state, svg: null, reason: e.reason };
      const f = frameIn(e.win, w.sec);
      if (f === null) return { state: 'idle', svg: null, reason: '' };
      e.at = ++this.clock;
      return { state: 'ready', frame: f, svg: this.drawer.draw(this._sceneFor(e), f, { parts: 'all' }), reason: '' };
    }
    // A small picture of a moment as a data: address for an <img>, drawn on demand (one at a time by the caller), or null when the window is not ready.
    thumbUri(second, width = 160) {
      const w = this._where(second); if (!w.text) return null;
      const e = this._entry(w.text);
      if (e.state !== 'ready') return null;
      const f = frameIn(e.win, w.sec); if (f === null || typeof this.drawer.thumbUri !== 'function') return null;
      return this.drawer.thumbUri(e.win.scene, f, Math.min(4096, Math.max(16, Math.floor(width))));
    }
  }

  window.ryagramEditorFrames = { drawer: DRAWER, WINDOW, windowFor, windowIndex, checkPlan, open, frameIn, FrameStore, FramesError };
})();
