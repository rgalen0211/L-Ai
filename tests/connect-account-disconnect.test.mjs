// Account page, Connected AIs, and the consent page's buttons (assets/app-connect.js), run for real against a tiny fake page (CONNECT audit 2026-11-20). Three faults, each found by reading the page's own source:
//  1. Disconnect asked with window.confirm. The Claude app's pane and chat panels answer window.confirm with No before a person sees it (app-library.js askConfirm, 11-18), so Disconnect did nothing there.
//     It now asks IN the page: a two-button box under the button, focus on No, Escape answers No, and window.confirm is never called.
//  2. busy() gives the pressed button back when its work ends. If the sign-in request had ended while the answer was out, Approve came back enabled under the words "has expired" (and after a good answer the pressed
//     button was briefly live again before the page left). Now an ended request leaves Approve closed and an answer already sent leaves both buttons closed.
//  3. A last-used time the page cannot read said "NaN days ago".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../assets/app-connect.js', import.meta.url), 'utf8');

class FE {
  constructor(tag) { this.tag = tag; this.kids = []; this.className = ''; this.attrs = {}; this.listeners = {}; this.parent = null; this.disabled = false; this.checked = false; this.hidden = false; this._t = null; }
  get textContent() { return this._t !== null && !this.kids.length ? this._t : this.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(''); }
  set textContent(v) { this.kids = []; this._t = String(v); }
  get isConnected() { return this.tag === 'ROOT' || (!!this.parent && this.parent.isConnected); }
  get parentElement() { return this.parent; }
  adopt(c) { if (typeof c !== 'string') { c.parent = this; } return c; }
  append(...c) { for (const k of c) this.kids.push(this.adopt(k)); }
  prepend(...c) { this.kids.unshift(...c.map((k) => this.adopt(k))); }
  replaceChildren(...c) { this.kids.forEach((k) => { if (typeof k !== 'string') k.parent = null; }); this.kids = []; this.append(...c); }
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }
  removeEventListener(n, f) { this.listeners[n] = (this.listeners[n] || []).filter((x) => x !== f); }
  focus() { ctrl.active = this; }
  all() { return [this, ...this.kids.flatMap((k) => (typeof k === 'string' ? [] : k.all()))]; }
  click() { return (this.onclick || this.listeners.click?.[0] || (() => {}))({ currentTarget: this }); }
}
const ctrl = { active: null };
function h(tag, attrs = {}, ...children) {
  const el = new FE(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'onclick') el.onclick = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'checked') el.checked = true;
    else if (key === 'hidden') el.hidden = true;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child);
  return el;
}
const byText = (root, text) => root.all().find((n) => n.tag === 'button' && n.textContent === text);
const byClass = (root, cls) => root.all().find((n) => n.className.split(' ').includes(cls));
async function busy(button, label, work) {
  const was = button.textContent; button.disabled = true; button.textContent = label;
  try { await work(); } finally { button.disabled = false; button.textContent = was; }
}

function world(extra = {}) {
  const clock = { now: Date.parse('2026-11-20T12:00:00Z') };
  class FakeDate extends Date { static now() { return clock.now; } }
  const win = { ryagramConfig: { supabaseUrl: 'https://abc.supabase.co' }, addEventListener() {}, removeEventListener() {} };
  const confirmed = [], intervals = [];
  const ctx = { window: win, URL, Date: FakeDate, setTimeout, clearTimeout, setInterval: (f) => { intervals.push(f); return intervals.length; }, clearInterval: (id) => { intervals[id - 1] = null; },
    document: { addEventListener() {}, removeEventListener() {}, hidden: false }, confirm: (m) => { confirmed.push(m); return false; }, navigator: {} };
  vm.runInNewContext(SRC, ctx);
  return { C: win.ryagramConnect, clock, confirmed, intervals, ...extra };
}
const errorLine = () => h('p', { class: 'form-note app-error', role: 'alert', hidden: true });
const showError = (el, err) => { el.textContent = err.message; el.hidden = false; };

// ------------------------------------------------------------------------------------------------ 1. Disconnect
async function accountPage(rowsNow) {
  const w = world();
  const disconnected = [];
  const data = { myConnectedAis: async () => rowsNow(), disconnectAi: async (id) => { disconnected.push(id); } };
  const sec = await w.C.create({ h, data, busy, showError, errorLine, date: (s) => s }).connectedSection();
  const top = new FE('ROOT'); top.append(sec);
  return { ...w, sec, top, disconnected };
}
const ROW = { client_id: 'client-claude', client_name: 'Claude', redirect_label: 'Claude', connected_at: '2026-11-01', last_used_at: '2026-11-19T10:00:00Z', calls_30d: 3, scopes: ['read'] };

test('Disconnect asks in the page, never with window.confirm: No leaves it connected and puts focus back on the button', async () => {
  let rows = [ROW];
  const p = await accountPage(() => rows);
  const btn = byText(p.sec, 'Disconnect');
  const pending = btn.click();
  const box = byClass(p.sec, 'inpage-confirm');
  assert.ok(box, 'a box is on the page under the button');
  assert.equal(box.attrs.role, 'alertdialog');
  assert.match(box.textContent, /Disconnect Claude\? It stops working with your account straight away\./);
  assert.equal(ctrl.active, byText(box, 'No, go back'), 'focus starts on No, the safe answer');
  assert.equal(p.confirmed.length, 0, 'window.confirm is never called');
  byText(box, 'No, go back').click();
  await pending;
  assert.equal(byClass(p.sec, 'inpage-confirm'), undefined, 'the box is gone');
  assert.deepEqual(p.disconnected, [], 'nothing was disconnected');
  assert.equal(ctrl.active, btn, 'focus is back on the Disconnect button');
});

test('Escape answers No; Yes disconnects once, re-lists, says so, and puts focus on that sentence (the button it was on is gone)', async () => {
  let rows = [ROW];
  const p = await accountPage(() => rows);
  let btn = byText(p.sec, 'Disconnect');
  let pending = btn.click();
  const esc = byClass(p.sec, 'inpage-confirm');
  esc.listeners.keydown[0]({ key: 'Escape', stopPropagation() {} });
  await pending;
  assert.deepEqual(p.disconnected, []);
  btn = byText(p.sec, 'Disconnect');
  pending = btn.click();
  byText(byClass(p.sec, 'inpage-confirm'), 'Yes, disconnect').click();
  rows = [];                                                         // the server's list after the disconnect
  await pending;
  assert.deepEqual(p.disconnected, ['client-claude']);
  assert.equal(p.confirmed.length, 0);
  const said = p.sec.all().find((n) => n.attrs.role === 'status' && /Claude is disconnected\./.test(n.textContent));
  assert.ok(said, 'the page says it');
  assert.equal(ctrl.active, said, 'focus is on the sentence, not lost with the removed button');
  assert.equal(byText(p.sec, 'Disconnect'), undefined, 'the row is gone');
});

test('a second Disconnect press answers the first box No: only one box is open', async () => {
  const p = await accountPage(() => [ROW, { ...ROW, client_id: 'client-gpt', client_name: 'ChatGPT' }]);
  const [b1, b2] = p.sec.all().filter((n) => n.tag === 'button' && n.textContent === 'Disconnect');
  const first = b1.click();
  b2.click();
  await first;
  assert.equal(p.sec.all().filter((n) => n.className.split(' ').includes('inpage-confirm')).length, 1);
  assert.match(byClass(p.sec, 'inpage-confirm').textContent, /Disconnect ChatGPT\?/);
});

// ------------------------------------------------------------------------------------------------ 2. the consent buttons
const CHECK = (minutes, w) => ({ allowed: true, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', redirect_label: 'Claude', redirect_host: 'claude.ai', offered_scopes: ['read'], requested_scopes: ['read'],
  expires_at: new Date(w.clock.now + minutes * 60000).toISOString(), client_name: 'Claude' });
async function consentPage(minutes, decide) {
  const w = world();
  const nav = [];
  const data = { connectConsentCheck: async () => CHECK(minutes, w), connectConsentDecide: decide };
  const nodes = await w.C.create({ h, data, busy, showError, errorLine, date: (s) => s, navigate: (u) => nav.push(u) }).consentView('00000000-0000-4000-8000-0000000000aa');
  const top = new FE('ROOT'); top.append(...nodes.filter(Boolean));
  return { ...w, top, nav, approve: byText(top, 'Approve'), deny: byText(top, 'Deny') };
}

test('an Approve answer that comes back after the request ended leaves Approve CLOSED (busy() used to give it back under the words "has expired")', async () => {
  let fail; const answer = new Promise((_, rej) => { fail = rej; });
  const p = await consentPage(1, () => answer);
  assert.equal(p.approve.disabled, false, 'a minute left: open');
  const pending = p.approve.click();
  p.clock.now += 120000;                                            // the request ends while the answer is out
  p.intervals.find(Boolean)();                                      // the page's 15-second check runs
  assert.equal(p.approve.disabled, true);
  fail(new Error('That request has expired.'));
  await pending;
  assert.match(p.top.all().find((n) => n.className.includes('consent-expiry')).textContent, /has expired/);
  assert.equal(p.approve.disabled, true, 'Approve stays closed');
  assert.equal(p.deny.disabled, false, 'Deny still works');
  assert.deepEqual(p.nav, []);
});

test('an Approve that was answered leaves BOTH buttons closed while the page leaves (the pressed one was given back by busy())', async () => {
  const p = await consentPage(20, async () => ({ redirect_to: 'https://claude.ai/api/mcp/auth_callback?code=c&state=s' }));
  await p.approve.click();
  assert.deepEqual(p.nav, ['https://claude.ai/api/mcp/auth_callback?code=c&state=s']);
  assert.equal(p.approve.disabled, true); assert.equal(p.deny.disabled, true);
});

test('a refused Approve (not an expiry) gives the button back so the person can try again, and shows the words', async () => {
  const p = await consentPage(20, async () => { throw new Error('Try again in a moment.'); });
  await p.approve.click();
  assert.equal(p.approve.disabled, false);
  assert.match(p.top.all().find((n) => n.attrs.role === 'alert').textContent, /Try again in a moment\./);
});

// ------------------------------------------------------------------------------------------------ 3. dates
test('a last-used time the page cannot read is said in words, never "NaN days ago"', () => {
  const { C } = world();
  assert.equal(C.ago('garbage', Date.parse('2026-11-20T12:00:00Z')), 'at a time Ryagram could not read');
  assert.equal(C.ago('2026-11-19T10:00:00Z', Date.parse('2026-11-20T12:00:00Z')), 'yesterday');
  assert.equal(C.ago(null), 'never');
});
