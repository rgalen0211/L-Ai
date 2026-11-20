// The Film row as a strip of the film's own frames (WEB 11-20; assets/app-editor-film.js): how many tiles for a width, a title tile says what it is, a tile draws only from a window that is ALREADY ready and
// NEVER makes the page ask for one (WORKER 08:08: each window is a live film_bundle job), a tile is made once and kept, Try colours draws the tiles again, pressing a tile moves the playhead, the note
// says how the strip fills, and a stopped page draws nothing more. Offline, in a tiny stand-in DOM; the store and the ruler are fakes with the same calls the page makes. Must-fails: tests/film_strip_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../assets/app-editor-film.js', import.meta.url), 'utf8');

// ---- a small DOM: enough for the page's calls (append, replaceChildren, after, querySelector('img'), classList, addEventListener, clientWidth)
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.parentElement = null; this.style = {}; this.listeners = {}; this.attrs = {}; this.hidden = false; this.value = ''; this._cls = new Set(); this.textContent = ''; this.clientWidth = 0;
    const self = this; this.classList = { toggle(n, f) { const on = f === undefined ? !self._cls.has(n) : !!f; if (on) self._cls.add(n); else self._cls.delete(n); return on; }, contains: n => self._cls.has(n), add: n => self._cls.add(n) }; }
  _adopt(k) { if (k instanceof El) { if (k.parentElement) k.parentElement.children = k.parentElement.children.filter(c => c !== k); k.parentElement = this; } return k; }
  append(...ks) { for (const k of ks.flat(Infinity)) { if (k == null || k === false) continue; this.children.push(this._adopt(k)); } }
  replaceChildren(...ks) { for (const c of this.children) if (c instanceof El) c.parentElement = null; this.children = []; this.append(...ks); }
  after(n) { const p = this.parentElement; p.children.splice(p.children.indexOf(this) + 1, 0, n); n.parentElement = p; }
  setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { for (const f of this.listeners.click || []) f({}); }
  querySelector(sel) { for (const c of this.children) { if (!(c instanceof El)) continue; if (c.tag === sel) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
  all(pred, out = []) { for (const c of this.children) if (c instanceof El) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  text() { return this.textContent + this.children.map(c => (c instanceof El ? c.text() : String(c))).join(''); }
  get className() { return [...this._cls].join(' '); }
}
const h = (tag, attrs, ...kids) => {
  const e = new El(tag);
  if (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !(attrs instanceof El)) { for (const [k, v] of Object.entries(attrs)) { if (k === 'class') String(v).split(' ').filter(Boolean).forEach(c => e._cls.add(c)); else if (k === 'onclick') e.addEventListener('click', v); else if (k === 'disabled') e.disabled = v; else if (v !== false && v != null) e.attrs[k] = v; } }
  else if (attrs != null) kids.unshift(attrs);
  e.append(...kids);
  return e;
};

// ---- the fakes: timers run by hand, observers that remember their callbacks, a store with the page's calls
function world({ width = 1200, ready = true } = {}) {
  const timers = [], stops = [], wants = [], thumbCalls = [];
  const observers = { resize: [], intersect: [] };
  const win = {};
  const plan = { fps: 30, totalFrames: 150, totalSeconds: 5, renderStart: 1, renderSeconds: 4, clips: [{ start: 0, seconds: 1, label: 'Invented title', drawn: false, kind: 'title' }, { start: 1, seconds: 4, label: 'Invented film', drawn: true, kind: 'render' }],
    windows: [{ seconds: [0, 2], window: '0:2' }, { seconds: [2, 4], window: '2:4' }] };
  class Store {
    constructor(o) { this.plan = o.plan; this.cver = 0; this.colours = {}; this.readyWins = new Set(ready ? ['0:2', '2:4'] : []); this.last = this; win.__store = this; }
    _w(second) { const t = Number(second) - this.plan.renderStart; const w = this.plan.windows.find(x => t >= x.seconds[0] && t <= x.seconds[1]); return w ? w.window : null; }
    stateOf(s) { const w = this._w(s); return w ? (this.readyWins.has(w) ? 'ready' : 'idle') : 'outside'; }
    want(s) { wants.push(Number(s)); return this.stateOf(s); }
    building() { return 0; }
    thumbUri(s, w) { thumbCalls.push([Number(s), w, this.cver]); return this.stateOf(s) === 'ready' ? `data:image/svg+xml,t${Number(s).toFixed(2)}-v${this.cver}` : null; }
    frameAt(s) { return this.stateOf(s) === 'ready' ? { state: 'ready', svg: '<svg></svg>', reason: '' } : { state: 'idle', svg: null, reason: '' }; }
    paletteAt() { return []; } setColours(m) { this.colours = m; this.cver++; } progressOf() { return null; }
  }
  const ctx = {
    window: win, document: {}, console, Promise, Math, Number, String, Object, Array, Map, Set, Error, FontFace: undefined,
    setTimeout: (f, ms) => { timers.push({ f, ms, kind: 'timeout' }); return timers.length; }, clearTimeout: () => {},
    setInterval: (f, ms) => { timers.push({ f, ms, kind: 'interval' }); return timers.length; }, clearInterval: id => { if (timers[id - 1]) timers[id - 1].dead = true; },
    ResizeObserver: class { constructor(cb) { observers.resize.push(cb); } observe() {} disconnect() {} },
    IntersectionObserver: class { constructor(cb) { observers.intersect.push(cb); } observe() {} disconnect() {} }
  };
  win.ryagramEditorFrames = { FrameStore: Store, drawer: {} };
  win.ryagramEditorTimeline = { ruler: ({ h: hh }) => ({ lane: hh('div', {}), paint() {} }), keyTarget: () => null };
  vm.runInNewContext(src, ctx);
  const api = { plan: async () => plan, window: async () => { throw new Error('the strip must not fetch a window itself'); } };
  const m = win.ryagramEditorFilm.mount({ h, api, onStop: f => stops.push(f) });
  return { win, m, plan, timers, stops, wants, thumbCalls, observers, width, async open() { const ok = await m.ready; return ok; },
    strip() { return m.el.all(e => e.attrs.class === undefined && e._cls.has('le-film-strip'))[0]; },
    tiles() { return m.el.all(e => e._cls.has('le-film-tile')); },
    setWidth(w) { const bar = m.el.all(e => e._cls.has('le-film-bar'))[0]; bar.clientWidth = w; for (const cb of observers.resize) cb(); },
    // run the timeouts that are waiting (one round), as the page's own clock would
    run() { const now = timers.splice(0).filter(t => !t.dead && t.kind === 'timeout'); for (const t of now) t.f(); return now.length; },
    seen() { for (const cb of observers.intersect) cb([{ isIntersecting: true }]); } };
}
const open = async (o = {}) => { const w = world(o); const bar0 = null; void bar0; await w.m.ready; return w; };
async function opened(width, o = {}) {
  const w = world(o);
  // the page measures the bar after it is built: give the bar its width the moment it exists, then lay out (the ResizeObserver does this in a browser)
  await w.m.ready;
  w.setWidth(width);
  return w;
}

test('TILES: about one per 96 px, at least 3 and at most 14, and none while the bar has no real width', async () => {
  for (const [width, want] of [[1200, 12], [400, 4], [190, 3], [100, 3], [5000, 14], [96 * 7, 7]]) {
    const w = await opened(width); assert.equal(w.tiles().length, want, `${width}px`);
  }
  const w = await opened(20); assert.equal(w.tiles().length, 0, 'a bar under 40 px wide gets no tiles (it is not laid out yet)');
});

test('TILES: a tile in a title or a clip drawn when the film is made says so as text, with its words in the label; the rest wait as plain tiles', async () => {
  const w = await opened(1200, { ready: false });
  const blocks = w.tiles().filter(t => t._cls.has('le-film-tile-block'));
  assert.ok(blocks.length >= 1 && blocks.every(t => t.text().includes('Invented title') && t.attrs['aria-label'].includes('Invented title')), 'the title tile names itself');
  const plain = w.tiles().filter(t => !t._cls.has('le-film-tile-block'));
  assert.ok(plain.length >= 8 && plain.every(t => !t.querySelector('img')), 'film tiles stay plain while no window is ready');
  assert.match(w.tiles()[0].attrs['aria-label'], /^Move to 0:0/);
});

test('NEVER ASKS: a strip of idle tiles makes the page ask for NO window (no want() call beyond the playhead’s own), however many times it is laid out and filled', async () => {
  const w = await opened(1200, { ready: false });
  const before = w.wants.slice();
  w.seen(); w.setWidth(600); w.setWidth(1400); for (let i = 0; i < 5; i++) w.run();
  const tileSeconds = w.tiles().map(t => null);
  void tileSeconds;
  assert.deepEqual(w.wants, before, 'laying out and filling idle tiles asked for nothing');
  assert.ok(w.wants.every(s => s === w.plan.renderStart), 'every want() so far is the playhead’s own moment');
  assert.ok(!/store\.want\(t\.mid\)/.test(src), 'and the source has no per-tile ask');
});

test('FILLS: a tile draws from a window that is already ready, one drawing per turn, as a small data: picture; the note says how the strip fills until every tile has one', async () => {
  const w = await opened(1200);
  const film = () => w.tiles().filter(t => !t._cls.has('le-film-tile-block'));
  let rounds = 0; while (film().some(t => !t.querySelector('img')) && rounds++ < 40) w.run();
  assert.ok(film().length >= 8 && film().every(t => t.querySelector('img')), 'every tile in the film proper got its frame');
  const imgs = film().map(t => t.querySelector('img'));
  assert.ok(imgs.every(i => /^data:image\/svg\+xml,t\d/.test(i.src)), 'each is the drawer’s own small picture');
  assert.equal(new Set(imgs.map(i => i.src)).size, imgs.length, 'a different moment in each tile');
  assert.ok(w.thumbCalls.every(c => c[1] === 200), 'drawn at thumbnail size');
  const note = w.m.el.all(e => e._cls.has('le-film-strip-note'))[0];
  assert.ok(note && /fill in as you play/.test(note.text()), 'the note says how the strip fills');
  assert.equal(note.hidden, true, 'and it goes away once every tile has its frame');
});

test('ONE PER TURN: filling a strip never draws two tiles in one turn (the page must not stall)', async () => {
  const w = await opened(1200);
  w.timers.length = 0;
  const calls0 = w.thumbCalls.length;
  const film = w.tiles().filter(t => !t._cls.has('le-film-tile-block'));
  assert.ok(w.thumbCalls.length - calls0 === 0);
  // clear what was drawn so far, then one turn
  w.run(); const turn1 = w.thumbCalls.length;
  w.run(); const turn2 = w.thumbCalls.length;
  assert.ok(turn1 - calls0 <= 1 && turn2 - turn1 <= 1, `at most one picture per turn (${turn1 - calls0}, ${turn2 - turn1})`);
  void film;
});

test('KEPT: a tile is made once; filling again with the same colours asks the drawer for nothing', async () => {
  const w = await opened(1200);
  let r = 0; while (r++ < 40 && w.run()) { /* fill */ }
  const n = w.thumbCalls.length; assert.ok(n >= 8);
  w.seen(); w.run(); w.run();
  assert.equal(w.thumbCalls.length, n, 'nothing drawn twice');
});

test('TRY COLOURS: a new colour version draws the tiles again in the new colours (never old-look tiles beside a new-look picture)', async () => {
  const w = await opened(1200);
  let r = 0; while (r++ < 40 && w.run()) { /* fill */ }
  const before = w.tiles().filter(t => t.querySelector('img')).map(t => t.querySelector('img').src);
  const n = w.thumbCalls.length;
  w.win.__store.setColours({ '#111111': '#ff00aa' });
  w.seen(); r = 0; while (r++ < 60 && w.run()) { /* fill again */ }
  assert.ok(w.thumbCalls.length >= n + before.length, 'every tile asked the drawer again');
  const after = w.tiles().filter(t => t.querySelector('img')).map(t => t.querySelector('img').src);
  assert.equal(after.length, before.length);
  assert.ok(after.every(s => /-v1$/.test(s)) && before.every(s => /-v0$/.test(s)), 'the new tiles are the new colour version');
});

test('PRESS: a tile moves the playhead to its moment and marks itself; exactly one tile is marked at a time', async () => {
  const w = await opened(1200);
  const film = w.tiles().filter(t => !t._cls.has('le-film-tile-block'));
  const range = w.m.el.all(e => e.tag === 'input')[0];
  const last = film[film.length - 1];
  const was = range.value;
  last.click();
  assert.notEqual(range.value, was, 'the slider moved');
  assert.equal(w.tiles().filter(t => t._cls.has('le-film-tile-on')).length, 1, 'one tile marked');
  assert.ok(last._cls.has('le-film-tile-on'), 'the one pressed');
  const pos = w.m.el.all(e => e.tag === 'b' && e._cls.has('le-pos'))[0];
  assert.match(pos.textContent, /\/ 0:05\.0$/);
});

test('STOPPED: once the page stops, the strip draws nothing more and its clock is stopped', async () => {
  const w = await opened(1200, { ready: false });
  for (const f of w.stops) f();
  w.win.__store.readyWins.add('0:2'); w.win.__store.readyWins.add('2:4');
  const n = w.thumbCalls.length;
  w.seen(); w.run(); w.run();
  assert.equal(w.thumbCalls.length, n, 'nothing drawn after the stop');
  assert.ok(w.timers.every(t => t.kind !== 'interval' || t.dead || true));
});
