// PRO mode of the live editor, its BEHAVIOUR (WEB 11-20; assets/app-editor-pro.js; the pure parts and the "no new change" rule are in tests/pro-editor.test.mjs): Simple is the default and PRO is remembered,
// zoom clamps, frame step and J K L shuttle, markers (rounded, once each, kept per film), split of a text or picture clip as ONE grouped change, the history's undo back, and the keys (never while typing, never
// in Simple). Offline, in a tiny DOM with a fake transport. Must-fails: tests/pro_editor_behaviour_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SRC = read('assets/app-editor-pro.js');

class El {
  constructor(tag) { this.tag = tag; this.tagName = (tag || '').toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } }; this.hidden = false; this.parentNode = null; this._cls = new Set(); this.textContent = ''; this.type = '';
    const self = this; this.classList = { toggle(n, f) { const on = f === undefined ? !self._cls.has(n) : !!f; if (on) self._cls.add(n); else self._cls.delete(n); return on; }, contains: n => self._cls.has(n), add: n => self._cls.add(n) }; }
  _kid(k) { if (k instanceof El) { k.parentNode = this; } return k; }
  append(...ks) { for (const k of ks.flat(Infinity)) if (k != null && k !== false) this.children.push(this._kid(k)); }
  replaceChildren(...ks) { this.children = []; this.append(...ks); }
  insertBefore(n, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, this._kid(n)); }
  get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); } removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  click() { for (const f of this.listeners.click || []) f({}); }
  match(sel) { if (sel[0] === '.') return this._cls.has(sel.slice(1)); if (sel[0] === '#') return this.attrs.id === sel.slice(1); return this.tag === sel; }
  querySelector(sel) { for (const c of this.children) { if (!(c instanceof El)) continue; if (c.match(sel)) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
  all(pred, out = []) { for (const c of this.children) if (c instanceof El) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  get text() { return this.textContent + this.children.map(c => (c instanceof El ? c.text : String(c))).join(''); }
}
const h = (tag, attrs, ...kids) => {
  const e = new El(tag);
  if (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !(attrs instanceof El)) { for (const [k, v] of Object.entries(attrs)) { if (k === 'class') String(v).split(' ').filter(Boolean).forEach(c => e._cls.add(c)); else if (k === 'onclick') e.addEventListener('click', v); else if (k === 'disabled') e.disabled = v; else if (k === 'hidden') e.hidden = !!v; else e.attrs[k] = v; } }
  else if (attrs != null) kids.unshift(attrs);
  e.append(...kids); return e;
};

// the page, as PRO sees it
function page({ project = 'film-1', store = new Map(), fps = 30, total = 10, pos = 4, isData = false, clips = [], selected = null, transport = true, locked = false } = {}) {
  const intervals = [], applied = [], undone = [], keyHandlers = [], said = [];
  const win = { localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } };
  const ctx = { window: win, document: { hidden: false }, console, Math, Number, String, Array, JSON, Promise, Object, setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; }, clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].dead = true; } };
  vm.runInNewContext(SRC, ctx);
  const top = h('div', { class: 'le-top' }), cols = h('div', { class: 'le-cols' }), view = h('div', { class: 'le-view' });
  const root = h('div', { class: 'le' }, top, cols, view);
  root.addEventListener = (t, f, cap) => { (keyHandlers[t] = keyHandlers[t] || []).push(f); };
  root.removeEventListener = (t, f) => { keyHandlers[t] = (keyHandlers[t] || []).filter(x => x !== f); };
  const T = { p: pos, seeks: [], pos() { return this.p; }, total: () => total, fps, seek(s) { this.seeks.push(s); this.p = s; } };
  const ed = { state: { clips, duration: total }, log: [], undo() { this.log.pop(); } };
  const stops = [], paints = [];
  const c = { h, root, ed, project, isData, transport: transport ? () => T : () => null, stopPlay: () => {}, applyMany: async (ops, grouped) => { applied.push({ ops: JSON.parse(JSON.stringify(ops)), grouped }); return true; },
    selected: () => selected, locked: () => locked, markUnsaved: () => {}, paint: () => {}, onPaint: f => paints.push(f), onStop: f => stops.push(f), lanes: null, rulerHolder: null, filmEl: null, draft: null };
  const api0 = win.ryagramEditorPro.mount(c), api = { ...api0, state: () => JSON.parse(JSON.stringify(api0.state())) };      // (plain objects: the page runs in its own realm)
  const key = (k, o = {}) => { const ev = { key: k, ctrlKey: false, metaKey: false, altKey: false, target: o.target || new El('div'), prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...o }; for (const f of keyHandlers.keydown || []) f(ev); return ev; };
  const bar = () => root.all(e => e._cls.has('le-pro') && e.tag === 'section')[0];
  const note = () => root.all(e => e._cls.has('le-pro-note'))[0].textContent;
  return { api, root, T, ed, intervals, applied, key, bar, note, store, win, stops, keyHandlers, c, view, press: label => { const b = root.all(e => e.tag === 'button' && e.text === label)[0]; assert.ok(b, 'button ' + label); b.click(); return b; } };
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };

test('SIMPLE IS THE DEFAULT; the switch turns PRO on and off, shows or hides the tools, and the choice is kept for the next visit', async () => {
  const store = new Map(); const p = page({ store }); await flush();
  assert.equal(p.api.state().pro, false); assert.equal(p.bar().hidden, true); assert.equal(p.root._cls.has('le-is-pro'), false);
  p.api.setMode(true, true);
  assert.equal(p.api.state().pro, true); assert.equal(p.bar().hidden, false); assert.equal(p.root._cls.has('le-is-pro'), true);
  assert.equal(store.get('ryagram.editorMode.device'), 'pro');
  const again = page({ store }); await flush();
  assert.equal(again.api.state().pro, true, 'PRO again on the next visit');
  again.api.setMode(false, true); assert.equal(store.get('ryagram.editorMode.device'), 'simple');
  const third = page({ store }); await flush(); assert.equal(third.api.state().pro, false);
  const seg = p.root.all(e => e._cls.has('le-pro-seg')); assert.deepEqual(seg.map(e => e.text), ['Simple', 'Pro']); assert.equal(seg[1].attrs['aria-pressed'], 'true');
});

test('ZOOM: 1, 2, 4, 8 times, never beyond; the label says which; leaving PRO puts it back to 1', () => {
  const p = page(); p.api.setMode(true);
  for (const [n, want] of [[0, 1], [1, 2], [2, 4], [3, 8], [9, 8], [-4, 1]]) { p.api.setZoom(n); assert.equal(p.api.state().zoom, want, `set ${n}`); assert.equal(p.root.style.props['--le-zoom'], String(want)); }
  p.api.setZoom(2); assert.ok(p.root.all(e => e._cls.has('le-pro-zoomlabel'))[0].textContent.includes('4×'));
  p.api.setMode(false); assert.equal(p.api.state().zoom, 1);
  p.press('Zoom +'); // (still in Simple: the buttons exist but the tool bar is hidden)
});

test('FRAME STEP: one frame when the picture has real frames, a tenth of a second otherwise, held between the ends; no picture says so', () => {
  const p = page({ fps: 30, pos: 4 }); p.api.setMode(true);
  p.api.step(1); assert.ok(Math.abs(p.T.p - (4 + 1 / 30)) < 1e-9); p.api.step(-1); assert.ok(Math.abs(p.T.p - 4) < 1e-9);
  const q = page({ fps: 0, pos: 4 }); q.api.setMode(true); q.api.step(1); assert.ok(Math.abs(q.T.p - 4.1) < 1e-9);
  const lo = page({ fps: 30, pos: 0 }); lo.api.setMode(true); lo.api.step(-1); assert.equal(lo.T.p, 0);
  const hi = page({ fps: 30, pos: 10, total: 10 }); hi.api.setMode(true); hi.api.step(1); assert.equal(hi.T.p, 10);
  const none = page({ transport: false }); none.api.setMode(true); none.api.step(1); assert.match(none.note(), /no picture to step through/);
});

test('MARKERS: at the playhead to a tenth, once each (within 0.05 s), in order, kept for THIS film only, and bad stored values are dropped', async () => {
  const store = new Map(); const p = page({ store, project: 'film-A', pos: 4.04 }); p.api.setMode(true);
  p.api.addMarker(); p.T.p = 4.01; p.api.addMarker(); p.T.p = 1.26; p.api.addMarker();
  assert.deepEqual(p.api.state().markers, [1.3, 4]);
  assert.equal(store.get('ryagram.editorMarkers.film-A'), '[1.3,4]');
  assert.equal(page({ store, project: 'film-B' }).api.state().markers.length, 0, 'another film has its own');
  assert.deepEqual(page({ store, project: 'film-A' }).api.state().markers, [1.3, 4], 'and this one comes back');
  store.set('ryagram.editorMarkers.film-C', JSON.stringify([2, -1, 'x', null, 3.5]));
  assert.deepEqual(page({ store, project: 'film-C' }).api.state().markers, [2, 3.5]);
  store.set('ryagram.editorMarkers.film-D', 'not json'); assert.deepEqual(page({ store, project: 'film-D' }).api.state().markers, []);
  store.set('ryagram.editorMarkers.film-E', JSON.stringify(Array.from({ length: 500 }, (_, i) => i))); assert.equal(page({ store, project: 'film-E' }).api.state().markers.length, 200, 'at most 200');
});

test('MARKERS: the next and previous marker buttons go there, and say so when there is none that way', () => {
  const store = new Map([['ryagram.editorMarkers.film-1', '[2,6]']]); const p = page({ store, pos: 4 }); p.api.setMode(true);
  p.press('Marker ▶'); assert.equal(p.T.p, 6); p.press('Marker ▶'); assert.match(p.note(), /No marker that way/);
  p.press('◀ Marker'); assert.equal(p.T.p, 2); p.press('◀ Marker'); assert.match(p.note(), /No marker that way/);
  const none = page(); none.api.setMode(true); none.press('Marker ▶'); assert.match(none.note(), /No markers yet\. Press M/);
});

test('SHUTTLE (J K L): only in PRO; again the same way goes faster up to 4 times, the other way reverses at normal speed, K stops, the end stops it', () => {
  const off = page(); off.api.shuttleKey(1); assert.equal(off.intervals.filter(i => i.ms === 100).length, 0, 'nothing in Simple');
  const p = page({ pos: 5 }); p.api.setMode(true);
  const say = () => p.note();
  p.api.shuttleKey(1); assert.match(say(), /Forward 1×/);
  p.api.shuttleKey(1); assert.match(say(), /Forward 2×/);
  for (let i = 0; i < 5; i++) p.api.shuttleKey(1); assert.match(say(), /Forward 4×/, 'capped at four');
  p.api.shuttleKey(-1); assert.match(say(), /Backward 1×/, 'the other way restarts at one');
  const tick = p.intervals.find(i => i.ms === 100 && !i.dead); assert.ok(tick, 'the shuttle clock runs, every 100 ms');
  p.api.shuttleKey(0); assert.equal(say(), ''); assert.ok(p.intervals.filter(i => i.ms === 100).every(i => i.dead), 'K stops the clock');
  const q = page({ pos: 9.8, total: 10 }); q.api.setMode(true); q.api.shuttleKey(1);
  const run = q.intervals.find(i => i.ms === 100 && !i.dead); run.f(); run.f();
  assert.equal(q.T.p, 10, 'it runs to the end'); assert.ok(q.intervals.find(i => i.ms === 100).dead, 'and stops there');
  const none = page({ transport: false }); none.api.setMode(true); none.api.shuttleKey(1); assert.match(none.note(), /no picture to play through/);
});

test('KEYS: in PRO, M puts a marker, comma and period step, J K L shuttle, brackets jump; none of them with Ctrl, Alt or Meta, while typing in a field, or in Simple; the key is taken (the slider’s own J and L give way)', () => {
  const p = page({ pos: 4 });
  const simple = p.key('m'); assert.equal(simple.prevented, false); assert.deepEqual(p.api.state().markers, []);
  p.api.setMode(true);
  const k = p.key('m'); assert.equal(k.prevented, true); assert.deepEqual(p.api.state().markers, [4]);
  p.key('.'); assert.ok(p.T.p > 4); p.key(','); p.key('l'); assert.match(p.note(), /Forward 1×/); p.key('k'); assert.equal(p.note(), '');
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) { const e = p.key('m', { [mod]: true }); assert.equal(e.prevented, false, mod); }
  const text = new El('textarea'); text.tagName = 'TEXTAREA';
  assert.equal(p.key('m', { target: text }).prevented, false, 'a text box keeps its keys');
  const inp = new El('input'); inp.tagName = 'INPUT'; inp.type = 'text'; assert.equal(p.key('m', { target: inp }).prevented, false);
  const range = new El('input'); range.tagName = 'INPUT'; range.type = 'range'; assert.equal(p.key('m', { target: range }).prevented, true, 'the slider does not count as typing');
  assert.equal(p.key('q').prevented, false, 'a key PRO does not use is left alone');
  const before = p.api.state().markers.length; for (const f of p.stops) f(); assert.equal((p.keyHandlers.keydown || []).length, 0, 'the key handler is removed when the page stops'); void before;
});

const textClip = (o = {}) => ({ id: 'c1', track: 'text', start: 2, len: 4, text: 'Hello', ...o });
test('SPLIT: a text clip is cut at the playhead as ONE grouped change (shorten + add the rest); a picture clip keeps its picture', async () => {
  const p = page({ isData: false, clips: [textClip()], selected: 'c1', pos: 3.5 }); p.api.setMode(true);
  await p.api.split();
  assert.equal(p.applied.length, 1); assert.equal(p.applied[0].grouped, true, 'one undo step');
  assert.deepEqual(p.applied[0].ops, [{ op: 'trim_clip', id: 'c1', edge: 'end', to: 3.5 }, { op: 'add_clip', track: 'text', start: 3.5, len: 2.5, text: 'Hello' }]);
  assert.match(p.note(), /Split at 0:03\.5\. Undo takes it back in one step\./);
  const q = page({ clips: [{ id: 'p1', track: 'pictures', start: 1, len: 3, picture: 'pic-9' }], selected: 'p1', pos: 2 }); q.api.setMode(true); await q.api.split();
  assert.deepEqual(q.applied[0].ops[1], { op: 'add_clip', track: 'pictures', start: 2, len: 2, picture: 'pic-9' });
});

test('SPLIT: refused in words when nothing is picked, a video clip, a playhead too near an end or outside, and for a data film (no split button)', async () => {
  const none = page({ clips: [textClip()], selected: null, pos: 3 }); none.api.setMode(true); await none.api.split(); assert.match(none.note(), /Pick a text or picture clip first/); assert.equal(none.applied.length, 0);
  const video = page({ clips: [textClip({ track: 'video' })], selected: 'c1', pos: 3 }); video.api.setMode(true); await video.api.split(); assert.match(video.note(), /Splitting a video clip needs a new kind of change/); assert.equal(video.applied.length, 0);
  for (const at of [2.2, 5.8, 1, 9]) { const p = page({ clips: [textClip()], selected: 'c1', pos: at }); p.api.setMode(true); await p.api.split(); assert.match(p.note(), /Put the playhead inside the clip, at least 0\.5 s from each end/, String(at)); assert.equal(p.applied.length, 0, String(at)); }
  const pic = page({ clips: [{ id: 'p1', track: 'pictures', start: 1, len: 3, picture: 'x' }], selected: 'p1', pos: 1.2 }); pic.api.setMode(true); await pic.api.split(); assert.match(pic.note(), /at least 0\.3 s/);
  const data = page({ isData: true }); assert.equal(data.root.all(e => e.attrs.id === 'le-pro-split').length, 0, 'no Split button on a data film');
  const edge = page({ clips: [textClip()], selected: 'c1', pos: 2.5 }); edge.api.setMode(true); await edge.api.split(); assert.equal(edge.applied.length, 1, 'exactly the minimum is allowed');
  const keyS = page({ clips: [textClip()], selected: 'c1', pos: 3 }); keyS.api.setMode(true); keyS.key('s'); await flush(); assert.equal(keyS.applied.length, 1, 'S splits');
});

test('HISTORY: each change as a plain sentence with who made it; Undo back to here undoes that step and everything after it, and stops if an undo does nothing', async () => {
  const p = page(); p.api.setMode(true);
  p.ed.log.push({ op: { op: 'set_look', key: 'page.background', value: '#000000' }, by: 'you' }, { op: { op: 'move_clip', id: 'a', start: 2.25 }, by: 'ai' }, { op: { op: 'weird' }, by: 'you' });
  p.api.refresh();
  const items = p.root.all(e => e.tag === 'li' && e.text.includes('Undo back to here') || (e.tag === 'li' && e._cls.has('le-pro-ai')));
  const text = p.root.all(e => e.tag === 'ol')[0].text;
  assert.match(text, /Set page\.background to #000000 · you /); assert.match(text, /Moved clip a to 2\.3 s · your AI /); assert.match(text, /A change · you /);
  const btns = p.root.all(e => e.tag === 'button' && e.text === 'Undo back to here'); assert.equal(btns.length, 3);
  btns[1].click(); await flush();
  assert.equal(p.ed.log.length, 1, 'step 2 and 3 are gone, step 1 stays');
  const stuck = page(); stuck.api.setMode(true); stuck.ed.log.push({ op: { op: 'set_look', key: 'k', value: 1 }, by: 'you' }, { op: { op: 'set_look', key: 'k', value: 2 }, by: 'you' }); let undoCalls = 0; stuck.ed.undo = () => { undoCalls++; };
  stuck.api.refresh(); stuck.root.all(e => e.tag === 'button' && e.text === 'Undo back to here')[0].click(); await flush();
  assert.equal(stuck.ed.log.length, 2, 'an undo that changes nothing does not loop'); assert.equal(undoCalls, 1, 'and is tried once, not sixty times');
  const empty = page(); empty.api.setMode(true); assert.match(empty.root.all(e => e.tag === 'ol')[0].text, /No changes yet/);
  const locked = page({ locked: true }); locked.api.setMode(true); locked.ed.log.push({ op: { op: 'set_look', key: 'k', value: 1 }, by: 'you' }); locked.api.refresh();
  assert.equal(locked.root.all(e => e.tag === 'button' && e.text === 'Undo back to here')[0].disabled, true, 'locked while a change is being made');
  void items;
});

test('PLACEMENT: the switch sits in the top row, the tools right under it, the side panel after the columns; with no PRO script the page is exactly as before', () => {
  const p = page();
  assert.ok(p.root.children[0].children.some(e => e._cls.has('le-pro-switch')), 'switch in .le-top');
  const kids = p.root.children; assert.ok(kids.indexOf(p.bar()) === 1 && kids[2]._cls.has('le-cols') && kids[3]._cls.has('le-pro-side'), 'bar after the top row, panel after the columns');
  assert.match(read('assets/app-editor.js'), /window\.ryagramEditorPro/, 'the page asks for it only when it is loaded');
});
