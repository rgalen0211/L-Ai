// WEB buying-path walk 11-22 (mock mode, 390 wide): two snags, each with a test that FAILS on the old code.
//  1. #/account?connect=claude landed on the HELP panel: the connect step's scrollIntoView scrolls the overflow:hidden flip viewport sideways, so the track showed the wrong panel (and the Connected AIs tab was off the strip).
//  (snag 2, the latest-job card words, is in walk-latest-job-1122.test.mjs.) The Version page's "Latest job" card said "Preview: running" / "Final render: claimed" / "Final render: cancelled" (raw state words) while the Jobs list said Rendering / Starting / Cancelled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// A tiny stand-in for the DOM: enough for ryagramFlip.create. Nodes remember their listeners so a test can fire a "scroll" the way the browser does.
class Node {
  constructor(tag, attrs, kids) {
    this.tag = tag; this.attrs = { ...(attrs || {}) }; this.kids = []; this.listeners = {}; this.style = {}; this.scrollLeft = 0; this.parentElement = null; this.dataset = {};
    for (const k of [].concat(kids || []).flat(Infinity)) if (k != null && k !== false) { const n = typeof k === 'object' ? k : { tag: '#text', text: String(k), kids: [], listeners: {} }; if (n.parentElement !== undefined) n.parentElement = this; this.kids.push(n); }
  }
  get className() { return this.attrs.class || ''; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  getBoundingClientRect() { return { left: 0, width: 10 }; }
  isConnected = true;
  querySelector(sel) { const c = sel.replace('.', ''); const walk = n => { for (const k of n.kids) { if ((k.className || '').split(' ').includes(c)) return k; const r = k.kids && walk(k); if (r) return r; } return null; }; return walk(this); }
  fire(t, e = {}) { for (const f of this.listeners[t] || []) f(e); }
}
const h = (tag, attrs, ...kids) => new Node(tag, attrs, kids);

function makeFlip() {
  const doc = new Node('document'); doc.addEventListener = () => {};
  const ctx = { window: {}, document: doc, location: { hash: '#/account' }, history: { replaceState() {} }, matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(read('assets/app-flip.js'), ctx);
  const sections = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id, el: h('div') }));
  const flip = ctx.window.ryagramFlip.create({ h, sections, initial: 'd', address: false });
  const viewport = flip.el.querySelector('.flip-viewport');
  return { flip, viewport };
}

test('FLIP: when the browser scrolls the overflow:hidden viewport sideways (scrollIntoView / focus inside a panel), it is put back at once', () => {
  const { flip, viewport } = makeFlip();
  assert.equal(flip.current(), 'd');
  assert.ok((viewport.listeners.scroll || []).length >= 1, 'the viewport listens for its own scroll');
  viewport.scrollLeft = 1012;                                // what the connect step did at 390 wide: the Help panel shows while Connected AIs is "selected"
  viewport.fire('scroll');
  assert.equal(viewport.scrollLeft, 0);
  assert.equal(flip.current(), 'd', 'the chosen section does not change');
});

test('FLIP: a viewport already at zero is left alone (no scroll write that could loop)', () => {
  const { viewport } = makeFlip();
  let writes = 0; let v = 0;
  Object.defineProperty(viewport, 'scrollLeft', { get: () => v, set: x => { writes++; v = x; } });
  viewport.fire('scroll');
  assert.equal(writes, 0);
});
