// The pure logic of the live preview: no DOM, no network, so every rule here has a unit test.
// (a) checking a scene bundle before anything draws it; (b) the clock: frames, exact-year marks, stills;
// (c) the smoothness controller (live frames, or snapping to exact years when drawing is too slow);
// (d) the exact-year frame cache plan; (e) what a keyboard or a screen reader gets from the slider.
// The DRAWING RULES are not here: they are BUILDER's reference drawer (scene-draw.js, vendored); this file only
// decides WHICH frame to draw and WHEN.
(() => {
  const SUPPORTED_MAJOR = 1;

  class SceneError extends Error {}
  const bad = msg => { throw new SceneError(msg); };
  const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

  // ---- (a) the bundle ------------------------------------------------------------------------------------------
  function parseScene(scene) {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) bad('The preview file isn’t a scene.');
    if (scene.format !== 'ryagram-scene') bad('The preview file isn’t a scene.');
    if (!Number.isInteger(scene.version)) bad('The preview file has no version.');
    if (scene.version !== SUPPORTED_MAJOR) bad('This preview needs a newer app. Reload the page.');
    const c = scene.canvas;
    if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0], 64, 8192) || !isInt(c[1], 64, 8192)) bad('The preview has no picture size.');
    if (!isInt(scene.fps, 1, 120)) bad('The preview has no frame rate.');
    if (!isInt(scene.frames, 1, 200000)) bad('The preview has no length.');
    const clock = scene.clock;
    if (!clock || !Array.isArray(clock.periods) || !clock.periods.length || clock.periods.length > 2000) bad('The preview has no timeline.');
    if (clock.periods.some(p => typeof p !== 'string' || p.length > 12)) bad('The preview timeline is damaged.');
    // The engine's real clock: one [period index, tween share] per frame (BUILDER's scene-draw.js reads exactly this).
    if (clock.ticks !== undefined) {
      if (!Array.isArray(clock.ticks) || clock.ticks.length !== scene.frames) bad('The preview timeline is damaged.');
      let prev = 0;
      for (const t of clock.ticks) {
        if (!Array.isArray(t) || t.length !== 2 || !isInt(t[0], 0, clock.periods.length - 1) || typeof t[1] !== 'number' || !(t[1] >= 0 && t[1] < 1) || t[0] < prev) bad('The preview timeline is damaged.');
        prev = t[0];
      }
    }
    if (scene.marks !== undefined) {
      if (!Array.isArray(scene.marks) || scene.marks.length !== clock.periods.length) bad('The preview timeline is damaged.');
      let prev = -1;
      for (const m of scene.marks) { if (!isInt(m, 0, scene.frames - 1) || m <= prev) bad('The preview timeline is damaged.'); prev = m; }
    }
    return scene;
  }

  // ---- (b) the clock -------------------------------------------------------------------------------------------
  // The exact-year frames. BUILDER's bundle lists them (`marks`); until it does, they are derived from
  // frames_per_period and the stills, as the engine's timeline spaces them (a still holds the clock where it stands).
  function marksOf(scene) {
    if (Array.isArray(scene.marks)) return scene.marks.slice();
    // From the real clock: period i is shown exactly at the first frame whose tick is [i, 0].
    if (Array.isArray(scene.clock.ticks)) {
      const out = new Array(scene.clock.periods.length).fill(-1);
      scene.clock.ticks.forEach((t, f) => { if (t[1] === 0 && out[t[0]] < 0) out[t[0]] = f; });
      let last = 0;
      return out.map(m => { if (m < 0) m = last; last = m; return m; }).map((m, i, a) => (i > 0 && m <= a[i - 1] ? Math.min(scene.frames - 1, a[i - 1] + 1) : m));
    }
    const n = scene.clock.periods.length;
    const per = scene.clock.frames_per_period || Math.max(1, Math.floor((scene.frames - 1) / Math.max(1, n - 1)));
    const stills = (scene.clock.stills || []).slice().sort((a, b) => a.first - b.first);
    const marks = [];
    let frame = 0;
    for (let i = 0; i < n; i++) {
      marks.push(Math.min(frame, scene.frames - 1));
      const held = stills.find(s => s.first === frame);
      frame += per + (held ? held.last - held.first + 1 : 0);
    }
    return marks;
  }
  const clampFrame = (scene, f) => Math.max(0, Math.min(scene.frames - 1, Math.round(Number(f) || 0)));

  // The period whose mark is at or before this frame (0-based).
  function periodAt(marks, frame) {
    let lo = 0, hi = marks.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (marks[mid] <= frame) lo = mid; else hi = mid - 1; }
    return lo;
  }
  // The nearest exact-year frame (ties go forward).
  function nearestMark(marks, frame) {
    const i = periodAt(marks, frame);
    if (i >= marks.length - 1) return marks[i];
    return (frame - marks[i]) < (marks[i + 1] - frame) ? marks[i] : marks[i + 1];
  }
  // Where the film holds still: listed by the bundle, or the runs of two or more frames at exactly a year (tween share 0).
  function stills(scene) {
    if (Array.isArray(scene.clock.stills)) return scene.clock.stills.map(s => ({ first: s.first, last: s.last }));
    const out = [];
    const ticks = scene.clock.ticks;
    if (!Array.isArray(ticks)) return out;
    let start = -1;
    for (let f = 0; f <= ticks.length; f++) {
      const still = f < ticks.length && ticks[f][1] === 0 && (start < 0 || ticks[f][0] === ticks[start][0]);
      if (still && start < 0) start = f;
      else if (!still && start >= 0) { if (f - start >= 2) out.push({ first: start, last: f - 1 }); start = f < ticks.length && ticks[f][1] === 0 ? f : -1; }
    }
    return out;
  }

  // ---- (c) smoothness ------------------------------------------------------------------------------------------
  // Drawing times (ms) of the last 10 frames. 'live' draws every frame the thumb passes; 'snap' shows exact years while it
  // moves. A median over the budget -> snap, and it STAYS snapped (in snap mode the shown frames come from the cache, so their
  // times say nothing about how fast live drawing is). Live drawing is re-tried only when a drag ends and the frame then drawn in
  // full (probe) came in under 75% of the budget three times running. Heavy scenes can start in snap mode.
  const BUDGET_MS = { desktop: 16, phone: 33 };
  class FrameBudget {
    constructor({ device = 'desktop', startSnapped = false, window: size = 10 } = {}) {
      this.limit = BUDGET_MS[device] || BUDGET_MS.desktop;
      this.size = size;
      this.times = [];
      this.probes = [];
      this.mode = startSnapped ? 'snap' : 'live';
    }
    record(ms) {
      this.times.push(ms);
      if (this.times.length > this.size) this.times.shift();
      if (this.mode === 'live' && this.times.length >= this.size && this.median() > this.limit) { this.mode = 'snap'; this.times = []; this.probes = []; }
      return this.mode;
    }
    // The full draw of the frame left on when a drag ends.
    probe(ms) {
      if (this.mode !== 'snap') return this.mode;
      this.probes.push(ms);
      if (this.probes.length > 3) this.probes.shift();
      if (this.probes.length === 3 && this.probes.every(t => t < this.limit * 0.75)) { this.mode = 'live'; this.times = []; this.probes = []; }
      return this.mode;
    }
    median() {
      const s = this.times.slice().sort((a, b) => a - b);
      const mid = s.length >> 1;
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
  }
  // While dragging: the frame to SHOW now. In snap mode, the exact year nearest the thumb; the real frame is drawn on release.
  function frameWhileDragging(mode, marks, frame) { return mode === 'snap' ? nearestMark(marks, frame) : frame; }

  // The device class: iPhones and other small touch screens get the 33 ms budget.
  function deviceClass(env = {}) {
    const ua = String(env.userAgent || '');
    const touch = Number(env.maxTouchPoints || 0) > 0;
    const narrow = Number(env.width || 1024) < 700;
    return /iPhone|iPad|iPod|Android/i.test(ua) || (touch && narrow) ? 'phone' : 'desktop';
  }

  // ---- (d) the exact-year cache --------------------------------------------------------------------------------
  // Which exact-year frames to draw ahead of time, in what order: nearest the person's current position first, so the
  // frames they are most likely to reach are ready soonest. A memory cap bounds the number kept (oldest far ones go first).
  function cachePlan(marks, from) {
    const here = periodAt(marks, from);
    return marks.map((m, i) => ({ frame: m, d: Math.abs(i - here) })).sort((a, b) => a.d - b.d || a.frame - b.frame).map(x => x.frame);
  }
  class FrameCache {
    constructor(max = 80) { this.max = max; this.map = new Map(); }
    has(f) { return this.map.has(f); }
    get(f) { const v = this.map.get(f); if (v !== undefined) { this.map.delete(f); this.map.set(f, v); } return v; }
    set(f, v, keep) {
      if (this.map.has(f)) this.map.delete(f);
      this.map.set(f, v);
      while (this.map.size > this.max) {
        const old = [...this.map.keys()].find(k => k !== keep && k !== f);
        if (old === undefined) break;
        const dead = this.map.get(old);
        this.map.delete(old);
        if (dead && typeof dead.close === 'function') dead.close();
      }
    }
    clear() { for (const v of this.map.values()) if (v && typeof v.close === 'function') v.close(); this.map.clear(); }
    get size() { return this.map.size; }
  }

  // ---- (e) keyboard and speech ---------------------------------------------------------------------------------
  // Arrow keys move one frame, Page Up/Down one year, Home/End to the ends; Shift with an arrow moves ten frames.
  function keyTarget(scene, marks, frame, key, shift = false) {
    const last = scene.frames - 1;
    const i = periodAt(marks, frame);
    switch (key) {
      case 'ArrowRight': case 'ArrowUp': return clampFrame(scene, frame + (shift ? 10 : 1));
      case 'ArrowLeft': case 'ArrowDown': return clampFrame(scene, frame - (shift ? 10 : 1));
      case 'PageUp': return marks[Math.min(marks.length - 1, i + 1)];
      case 'PageDown': return frame > marks[i] ? marks[i] : marks[Math.max(0, i - 1)];
      case 'Home': return 0;
      case 'End': return last;
      default: return null;
    }
  }
  // "1965" or "1965, 3,148 miles built" when the drawer can describe the frame (describe is optional).
  function valueText(scene, marks, frame, describe) {
    const period = scene.clock.periods[periodAt(marks, frame)];
    let extra = '';
    if (typeof describe === 'function') {
      try { const d = describe(scene, frame); if (d && typeof d.readout === 'string') extra = d.readout; } catch { /* the year alone is enough */ }
    }
    const between = frame !== marks[periodAt(marks, frame)];
    return `${period}${between ? ', moving to the next year' : ''}${extra ? `, ${extra}` : ''}`;
  }
  const mmss = (frame, fps) => { const s = Math.floor(frame / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  window.ryagramPreviewCore = { SUPPORTED_MAJOR, SceneError, parseScene, marksOf, clampFrame, periodAt, nearestMark, stills,
    BUDGET_MS, FrameBudget, frameWhileDragging, deviceClass, cachePlan, FrameCache, keyTarget, valueText, mmss };
})();
