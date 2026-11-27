// Editor poll round 2 (WEB 11-27, reviewer): Pro undo-back sets its busy flags inside the try and speaks when the guard turns a press away; an undo with nothing left on screen says so. Helpers copied from editor-poll-1127.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SRC = read('assets/app-editor-pro.js');
const win0 = {}; vm.runInNewContext(SRC, { window: win0 });

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

const here = path.dirname(fileURLToPath(import.meta.url));
const readRaw = f => fs.readFileSync(path.join(here, '..', f), 'utf8');
const dwin = {};
const dctx = { window: dwin, Error, Math, Number, Array, Object, String, JSON, Set, Map, RegExp, Promise };
for (const f of ['assets/app-editor-core.js', 'assets/app-editor-draft.js']) vm.runInNewContext(readRaw(f), dctx);
const E = dwin.ryagramEditor, D = dwin.ryagramEditorDraft;
const { createEditorRpcs } = createRequire(import.meta.url)('./fake-editor-rpcs.js');
const P = '00000000-0000-4000-8000-0000000000a1';
const setC = v => ({ op: 'set_look', key: 'network.color', value: v });
const setT = v => ({ op: 'set_look', key: 'sequence.theme', value: v });
async function world(rpcWrap) {
  const m = createEditorRpcs({ projects: [P] });
  const rpc = async (name, args) => (rpcWrap ? await rpcWrap(name, args, m) : null) || (m.rpcs[name] ? m.rpcs[name](args) : { data: null, error: { code: 'PT404', message: 'x' } });
  const editor = new E.Editor({ look: { 'network.color': '#6fd1bd' } });
  const draft = D.createDraft({ rpc, project: P, mode: 'data', editor, onChange: () => {}, onSummary: () => {} });
  await draft.open();
  return { m, draft, editor };
}
const colours = e => JSON.stringify(e.log.map(x => x.op.value));

test('POLL RACE: an AI op that lands while an Undo waits on the server stays; the undone entry is the one that goes', async () => {
  let w, landed = false;
  w = await world(async (name) => {
    if (name === 'editor_undo' && !landed) { landed = true; w.m.ai.apply(P, 'data', w.draft.revision, [setT('dark')]); await w.draft.poll(); }      // the AI's op arrives and the poll reads it, mid-undo
    return null;
  });
  await w.draft.send([setC('#ff0000')]);
  const r = await w.draft.undo();
  assert.equal(r.ok, true);
  assert.equal(colours(w.editor), '["dark"]', 'the AI entry stays on screen');
  assert.equal(w.editor.log[0].by, 'ai');
  assert.equal(w.editor.redo.length, 1); assert.equal(w.editor.redo[0].op.value, '#ff0000', 'the person\u2019s undone entry is what Redo holds');
  assert.equal(w.m.ops.filter(o => o.project === P && o.status === 'undone').length, 1);
});
test('POLL RACE: a group undo with an AI op landing mid-way drops exactly the group', async () => {
  let w, landed = false;
  w = await world(async (name) => {
    if (name === 'editor_undo' && !landed) { landed = true; w.m.ai.apply(P, 'data', w.draft.revision, [{ op: 'set_look', key: 'page.background', value: '#99ccff' }]); await w.draft.poll(); }
    return null;
  });
  await w.draft.send([setC('#ff0000'), setT('dark')], 'g1');
  const r = await w.draft.undo();
  assert.equal(r.ok, true);
  assert.equal(colours(w.editor), '["#99ccff"]');
  assert.equal(w.editor.redo.length, 2);
});

function proPage(over = {}) {
  const p = page(); p.api.setMode(true);
  p.ed.log.push({ op: { op: 'set_look', key: 'k', value: 1 }, by: 'you' }, { op: { op: 'set_look', key: 'k', value: 2 }, by: 'you' }, { op: { op: 'set_look', key: 'k', value: 3 }, by: 'you' });
  p.api.refresh(); Object.assign(p.c, over);
  const back = n => p.root.all(e => e.tag === 'button' && e.text === 'Undo back to here')[n];
  return { p, back };
}
test('UNDO BACK: a thrown busy-flag helper never leaves it stuck (the next press still runs)', async () => {
  let throwOnce = true;
  const { p, back } = proPage({ setHistBusy: v => { if (throwOnce) { throwOnce = false; throw new Error('paint failed'); } } });
  p.c.draft = { undo: async () => { p.ed.log.pop(); return { ok: true }; } };
  back(1).click(); await flush();
  assert.match(p.note(), /Could not undo/);
  back(1).click(); await flush();
  assert.equal(p.ed.log.length, 1, 'the second press ran: the flag was not stuck');
});
test('UNDO BACK: a press the guard turns away says why, on the status line', async () => {
  for (const [over, re] of [[{ histBusy: () => true }, /Wait for the last change to finish/], [{ commitOpen: () => true }, /What will render/], [{ locked: () => true }, /locked/]]) {
    const { p, back } = proPage(over); back(0).click(); await flush();
    assert.equal(p.ed.log.length, 3); assert.match(p.note(), re);
  }
});

test('UNDO: if every entry of the step already left the screen meanwhile, it says so instead of plain ok', async () => {
  let w;
  w = await world(async (name) => { if (name === 'editor_undo') { w.editor.log.length = 0; } return null; });
  await w.draft.send([setC('#ff0000')]);
  const r = await w.draft.undo();
  assert.equal(r.ok, true); assert.equal(r.note, 'Nothing to undo here.');
});
test('UNDO: a normal undo still carries no note', async () => {
  const w = await world();
  await w.draft.send([setC('#ff0000')]);
  const r = await w.draft.undo();
  assert.equal(r.ok, true); assert.equal(r.note, undefined);
});
