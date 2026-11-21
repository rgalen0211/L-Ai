// The departments bar's mount and unmount (WEB 11-20, audit finding 9; assets/app-departments.js): mountBar is async, so a bar that was asked for and then unmounted (sign-out), or asked for again, while it
// was still loading must not appear afterwards and must not leave listeners behind; the phone media-query listener goes with the bar; an account that is not "invited" (an administrator) still gets the bar,
// without Start, from the page's own list when the server's fails. Offline, in a tiny DOM with hand-resolved promises. Must-fails: tests/departments_mount_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this._cls = new Set(); const self = this;
    this.classList = { toggle(n, f) { const on = f === undefined ? !self._cls.has(n) : !!f; if (on) self._cls.add(n); else self._cls.delete(n); return on; }, add: n => self._cls.add(n), remove: n => self._cls.delete(n), contains: n => self._cls.has(n) }; }
  append(...ks) { for (const k of ks.flat(Infinity)) if (k != null && k !== false) this.children.push(k); }
  replaceChildren(...ks) { this.children = []; this.append(...ks); }
  setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  contains() { return false; }
  all(pred, out = []) { for (const c of this.children) if (c instanceof El) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  querySelector(sel) { const [tag, cls] = sel.split('.'); return this.all(e => (!tag || e.tag === tag) && (!cls || e._cls.has(cls)))[0] || null; }
  querySelectorAll(sel) { return this.all(e => e.tag === sel); }
  get text() { return this.children.map(c => (c instanceof El ? c.text : String(c))).join(''); }
}
const h = (tag, attrs, ...kids) => {
  const e = new El(tag);
  if (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !(attrs instanceof El)) { for (const [k, v] of Object.entries(attrs)) { if (k === 'class') String(v).split(' ').filter(Boolean).forEach(c => e._cls.add(c)); else if (v !== false && v != null) e.attrs[k] = v; } }
  else if (attrs != null) kids.unshift(attrs);
  e.append(...kids); return e;
};
const gate = () => { let go; const p = new Promise(r => { go = r; }); return { p, go }; };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

function world({ invited = true, rows = null, listFails = false } = {}) {
  const log = { win: new Map(), doc: new Map(), media: new Map() }, count = (m, t) => (m.get(t) || 0);
  const add = (m, t) => m.set(t, count(m, t) + 1), del = (m, t) => m.set(t, count(m, t) - 1);
  const body = new El('body');
  const win = { ryagramConfig: { departments: true, aiFirst: true, connectAi: true },
    addEventListener: t => add(log.win, t), removeEventListener: t => del(log.win, t),
    matchMedia: () => ({ matches: false, addEventListener: t => add(log.media, t), removeEventListener: t => del(log.media, t) }) };
  const ctx = { window: win, document: { body, addEventListener: t => add(log.doc, t), removeEventListener: t => del(log.doc, t) }, location: { hash: '#/' }, console, Promise, Object, Array, Set, Map, String, setTimeout, clearTimeout };
  vm.runInNewContext(read('assets/app-start.js'), ctx);
  vm.runInNewContext(read('assets/app-departments.js'), ctx);
  const gates = { access: [], list: [] }, asks = { list: 0 };
  const data = { connectAccess: () => { const g = gate(); gates.access.push(g); return g.p.then(() => invited); }, myDepartments: () => { asks.list++; const g = gate(); gates.list.push(g); return g.p.then(() => { if (listFails) throw new Error('down'); return rows || [{ id: 'data_films', status: 'working' }, { id: 'games', status: 'soon' }]; }); } };
  const ui = win.ryagramDepartments.create({ h, data, startUi: () => null });
  const slot = new El('div'); slot.hidden = true;
  return { ui, slot, body, log, gates, asks, count, win, release: async () => { for (const g of gates.access.splice(0)) g.go(); await flush(); for (const g of gates.list.splice(0)) g.go(); await flush(); } };
}

test('MOUNT: the bar fills the slot, shows it, marks the page, and listens for address changes and outside clicks; UNMOUNT takes every one of those back, the phone media-query listener too', async () => {
  const w = world(); const p = w.ui.mountBar(w.slot); await w.release();
  assert.equal(await p, true);
  assert.equal(w.slot.children.length, 1); assert.equal(w.slot.hidden, false); assert.ok(w.body._cls.has('has-departments'));
  assert.equal(w.count(w.log.win, 'hashchange'), 1); assert.equal(w.count(w.log.doc, 'click'), 1); assert.equal(w.count(w.log.media, 'change'), 1);
  w.ui.unmountBar();
  assert.equal(w.slot.children.length, 0); assert.equal(w.slot.hidden, true); assert.equal(w.body._cls.has('has-departments'), false);
  assert.equal(w.count(w.log.win, 'hashchange'), 0); assert.equal(w.count(w.log.doc, 'click'), 0); assert.equal(w.count(w.log.media, 'change'), 0, 'the media-query listener goes with the bar');
});

test('RACE: a bar unmounted while it is still loading never appears afterwards, at either wait, and leaves no listener', async () => {
  for (const stage of ['access', 'list']) {
    const w = world(); const p = w.ui.mountBar(w.slot); await flush();
    if (stage === 'list') { for (const g of w.gates.access.splice(0)) g.go(); await flush(); }
    w.ui.unmountBar();
    await w.release();
    assert.equal(await p, false, stage);
    if (stage === 'access') assert.equal(w.asks.list, 0, 'a bar cancelled in the first wait does not even ask for the list');
    assert.equal(w.slot.children.length, 0, stage); assert.equal(w.slot.hidden, true, stage); assert.equal(w.body._cls.has('has-departments'), false, stage);
    assert.equal(w.count(w.log.win, 'hashchange'), 0, stage); assert.equal(w.count(w.log.doc, 'click'), 0, stage); assert.equal(w.count(w.log.media, 'change'), 0, stage);
  }
});

test('RACE: a bar asked for again while the first is loading gives ONE bar and one set of listeners (the later ask wins)', async () => {
  const w = world(); const first = w.ui.mountBar(w.slot); await flush(); const second = w.ui.mountBar(w.slot);
  await w.release(); await w.release();
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(w.slot.children.length, 1, 'one bar, not two');
  assert.equal(w.count(w.log.win, 'hashchange'), 1); assert.equal(w.count(w.log.doc, 'click'), 1); assert.equal(w.count(w.log.media, 'change'), 1);
  w.ui.unmountBar(); assert.equal(w.count(w.log.win, 'hashchange'), 0);
});

test('EVERY ACCOUNT: an account that is not invited (an administrator) still gets the bar, without Start; a failing list falls back to the page’s own (Data films works, the rest Coming soon)', async () => {
  const w = world({ invited: false, listFails: true }); const p = w.ui.mountBar(w.slot); await w.release();
  assert.equal(await p, true);
  const bar = w.slot.children[0]; const links = bar.all(e => e.tag === 'a').map(a => a.text);
  assert.ok(!links.includes('Start'), 'no Start for a non-invited account'); assert.ok(links.includes('Data films') && links.includes('My films'));
  assert.ok(bar.all(e => e._cls.has('soon-tag')).length >= 4, 'the rest are Coming soon');
  const inv = world({ invited: true }); const q = inv.ui.mountBar(inv.slot); await inv.release(); await q;
  assert.ok(inv.slot.children[0].all(e => e.tag === 'a').map(a => a.text).includes('Start'), 'an invited account has Start');
});

// A bar that mounts when it must not waits on gates nobody opens, so a plain await would hang: the gates are opened and the answer must come within a deadline, or the test FAILS fast (WEB 11-21, GAMES M3).
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer within ${ms} ms (a bar that should not mount is waiting to mount)`)), ms).unref())]);
test('NO MOUNT: without the flag, or with no slot, nothing is drawn and nothing is listened to', { timeout: 15000 }, async () => {
  const off = world(); off.win.ryagramConfig = { departments: false }; const offP = off.ui.mountBar(off.slot); await off.release();
  assert.equal(await within(offP, 5000, 'flag off'), false);
  assert.equal(off.slot.children.length, 0); assert.equal(off.count(off.log.win, 'hashchange'), 0);
  const none = world(); const noneP = none.ui.mountBar(null); await none.release(); assert.equal(await within(noneP, 5000, 'no slot'), false);
});
