// The chat panel's own words are read out, and no state of it is a dead end (CONNECT audit 2026-11-20, tools/chat-editor/live-host.js + the first script of tools/build-chat-editor.mjs).
// Every sentence that REPLACES the page (a refusal, "your chat has not told me which film", "could not start") used to be a bare paragraph: drawn, never announced to a screen reader. The box that
// holds the "your chat app did not open it" address was a bare div too, so the address appeared silently. And when the editor's own script was missing, the placeholder "Opening your film..." stayed
// for good. This runs the REAL host file against a tiny fake page (no browser) and reads what it puts on the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { early } from '../tools/build-chat-editor.mjs';

const HOST_SRC = fs.readFileSync(new URL('../tools/chat-editor/live-host.js', import.meta.url), 'utf8');
const PROJECT = '00000000-0000-4000-8000-0000000000a1';

class FE {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; this.className = ''; this.hidden = false; this.classList = { add() {}, contains: () => false, toggle() {} }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener() {}
  append(...c) { this.kids.push(...c); }
  replaceChildren(...c) { this.kids = c; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get textContent() { return this.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(''); }
  set textContent(v) { this.kids = [String(v)]; }
}
const find = (el, cls) => (typeof el === 'string' ? null : (el.className.split(' ').includes(cls) ? el : el.kids.map((k) => find(k, cls)).find(Boolean) || null));

function load({ withEditor = false, appUrl = '' } = {}) {
  const sent = [], listeners = {}, timers = [];
  const root = new FE('main'); if (appUrl) root.attrs['data-app-url'] = appUrl;
  const parent = { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) };
  const win = { parent };
  if (withEditor) win.ryagramEditorPage = { create: () => ({ editorView: () => new FE('div') }) };
  const de = new FE('html'); de.style = { setProperty() {} }; de.getBoundingClientRect = () => ({ height: 300, width: 500 });
  const ctx = { Date, window: win, addEventListener: (n, f) => { (listeners[n] ||= []).push(f); }, clearTimeout: () => {}, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, Promise, Error, JSON, Number, Math, Map, String, Array, Object, RegExp, isFinite,
    document: { getElementById: (id) => (id === 'live-root' ? root : null), createElement: (t) => new FE(t), body: new FE('body'), documentElement: de } };
  vm.runInNewContext(HOST_SRC, ctx, { timeout: 2000 });
  const fire = (data) => (listeners.message || []).forEach((f) => f({ source: parent, data }));
  const init = sent.find((s) => s.method === 'ui/initialize');
  return { root, sent, timers, fire, init, win, answerInit: () => { fire({ jsonrpc: '2.0', id: init.id, result: { hostContext: {} } }); return new Promise((r) => setTimeout(r, 5)); } };
}
const TOOL_RESULT = (params) => ({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params });

test('a refused open puts the server\'s sentence on the page as a ROLE=ALERT paragraph, as text', () => {
  const p = load({ withEditor: true });
  p.fire(TOOL_RESULT({ isError: true, content: [{ type: 'text', text: 'That film is <b>not found</b>.' }] }));
  assert.equal(p.root.kids.length, 1);
  assert.equal(p.root.kids[0].attrs.role, 'alert');
  assert.equal(p.root.kids[0].textContent, 'That film is <b>not found</b>.', 'set as text, never parsed as markup');
});

test('a host that never answers the handshake leaves a role=alert sentence, not the placeholder', async () => {
  const p = load({ withEditor: true });
  p.fire({ jsonrpc: '2.0', id: p.init.id, error: { code: -32000, message: 'nope' } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(p.root.kids[0].attrs.role, 'alert');
  assert.match(p.root.kids[0].textContent, /could not start here/);
});

test('after the handshake, a chat that never names a film gets a role=status sentence from the 12-second watch', async () => {
  const p = load({ withEditor: true });
  await p.answerInit();
  const watch = p.timers.find((t) => t.ms === 12000);
  assert.ok(watch, 'the watch is set once the host has answered');
  watch.f();
  assert.equal(p.root.kids[0].attrs.role, 'status');
  assert.match(p.root.kids[0].textContent, /has not told it which film/);
});

test('when the editor\'s own script is missing, the film opens to words and not to "Opening your film..." for good', () => {
  const p = load({ withEditor: false });
  p.fire(TOOL_RESULT({ structuredContent: { project_id: PROJECT, mode: 'data', title: 'T' } }));
  assert.equal(p.root.kids.length, 1);
  assert.equal(p.root.kids[0].attrs.role, 'alert');
  assert.match(p.root.kids[0].textContent, /could not start here/);
});

test('an open film has an (empty) status box ready for the "did not open it" address, so the address is read out when it appears', () => {
  const p = load({ withEditor: true, appUrl: 'https://uselai.com/app/' });
  p.fire(TOOL_RESULT({ structuredContent: { project_id: PROJECT, mode: 'data', title: 'T' } }));
  const note = p.root.kids.map((k) => find(k, 'le-sitenote')).find(Boolean);
  assert.ok(note, 'the box is on the page');
  assert.equal(note.attrs.role, 'status');
  assert.equal(note.kids.length, 0, 'and empty until a link is refused');
});

test('the first script (a load error) writes its sentence as a role=alert paragraph, as text, ending with the build id', () => {
  const root = new FE('main');
  root.appendChild = (c) => { root.kids.push(c); };
  const listeners = {};
  vm.runInNewContext(early('abc123'), { document: { getElementById: () => root, createElement: (t) => new FE(t) }, addEventListener: (n, f) => { (listeners[n] ||= []).push(f); }, console: { error() {} }, String });
  const stack = ['Error', ' at a', ' at b'].join(String.fromCharCode(10));
  listeners.error[0]({ message: 'boom <img>', filename: 'x.js', lineno: 3, colno: 4, error: { stack } });
  const p = root.kids.find((k) => typeof k !== 'string');
  assert.ok(p, 'a paragraph was added');
  assert.equal(p.attrs.role, 'alert');
  assert.match(p.textContent, /could not draw/);
  assert.ok(p.textContent.endsWith('Panel build abc123.'));
});
