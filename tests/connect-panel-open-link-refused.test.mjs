// A chat host that will not open a link must not leave the button dead (CONNECT audit 2026-11-20). The editor panel already gives the address in words when ui/open-link is refused; the Ryagram home panel's
// "Open on the site" and the account card's "Open Ryagram" ignored the host's answer, so a refusal looked like a button that does nothing. This runs the REAL page scripts against a tiny fake page and answers
// the link request the three ways a host can (an error, isError, and success) and reads what the page then shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { homeHtml } from '../supabase/functions/connect-core/home_panel.ts';
import { cardHtml } from '../supabase/functions/connect-core/mcp_app.ts';

const APP = 'https://uselai.com/app/';
class FE {
  constructor(tag) { this.tag = tag; this.kids = []; this.className = ''; this._t = ''; this.listeners = {}; this.attrs = {}; this.style = {}; this.offsetHeight = 100; this.offsetLeft = 0; this.scrollLeft = 0; }
  get firstChild() { return this.kids[0] || null; }
  removeAttribute(k) { delete this.attrs[k]; }
  get textContent() { return this.kids.length ? this.kids.map((c) => c.textContent).join('') : this._t; }
  set textContent(v) { this.kids = []; this._t = String(v); }
  get childNodes() { return this.kids; }
  appendChild(c) { this.kids.push(c); return c; }
  addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  all() { return [this, ...this.kids.flatMap((c) => c.all())]; }
  querySelector(sel) { const cls = sel.replace(/^\./, ''); return this.all().slice(1).find((n) => n.className.split(' ').includes(cls)) || null; }
  set innerHTML(_v) { throw new Error('innerHTML was used'); }
}
const scriptOf = (html) => html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
function load(html, rootId) {
  const sent = [], listeners = {};
  const host = { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) };
  const root = new FE('main'), body = new FE('body'); body.attrs['data-app-url'] = APP;
  const win = { parent: host, addEventListener: (n, f) => { (listeners[n] ||= []).push(f); } };
  const doc = { getElementById: (id) => (id === rootId ? root : null), body, createElement: (t) => new FE(t), documentElement: { getBoundingClientRect: () => ({ height: 200, width: 400 }) } };
  vm.runInNewContext(scriptOf(html), { window: win, document: doc, String, Math, Array, Object, Number, JSON, console }, { timeout: 2000 });
  const fire = (data) => (listeners.message || []).forEach((f) => f({ source: host, data }));
  return { root, sent, fire, openMsg: () => sent.filter((s) => s.method === 'ui/open-link').at(-1) };
}
const RESULT = (sc) => ({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: sc } });
const HOME = { departments: [{ id: 'data_films', label: 'Data films', status: 'working', line: 'Questions answered with public data.', rules: [], not_yet: [], starts: ['Make me a film.'], page: '#/d/data_films' }] };
const press = (p, label) => { const b = p.root.all().find((n) => n.tag === 'button' && n.textContent === label); assert.ok(b, `the ${label} button is there`); b.listeners.click[0](); return p.openMsg(); };

const ANSWERS = { 'an error': { error: { code: -32000, message: 'no' } }, 'isError': { result: { isError: true } } };
for (const [name, rest] of Object.entries(ANSWERS)) {
  test(`home panel: a host that answers the link with ${name} gets the address in words (a role=alert line, as text), once`, () => {
    const p = load(homeHtml(APP), 'home');
    p.fire(RESULT(HOME));
    const m = press(p, 'Open on the site');
    assert.deepEqual(m.params, { url: APP + '#/d/data_films' });
    assert.equal(p.root.querySelector('.openfail'), null, 'nothing is said before the host answers');
    p.fire({ jsonrpc: '2.0', id: m.id, ...rest });
    const n = p.root.querySelector('.openfail');
    assert.ok(n, 'the sentence is on the page');
    assert.equal(n.attrs.role, 'alert');
    assert.equal(n.textContent, 'Your chat app did not open it. Open this address in your browser: ' + APP + '#/d/data_films');
    const m2 = press(p, 'Open on the site');
    p.fire({ jsonrpc: '2.0', id: m2.id, ...rest });
    assert.equal(p.root.all().filter((x) => x.className.split(' ').includes('openfail')).length, 1, 'a second refusal does not add a second line');
  });

  test(`account card: a host that answers the link with ${name} gets the address in words`, () => {
    const p = load(cardHtml(APP), 'card');
    p.fire(RESULT({ account: 'a' }));
    const m = press(p, 'Open Ryagram');
    assert.deepEqual(m.params, { url: APP });
    p.fire({ jsonrpc: '2.0', id: m.id, ...rest });
    const n = p.root.querySelector('.openfail');
    assert.ok(n); assert.equal(n.attrs.role, 'alert');
    assert.equal(n.textContent, 'Your chat app did not open it. Open this address in your browser: ' + APP);
  });
}

test('a host that opens the link (an empty result) gets no extra words, on either page', () => {
  const h = load(homeHtml(APP), 'home'); h.fire(RESULT(HOME));
  const m = press(h, 'Open on the site'); h.fire({ jsonrpc: '2.0', id: m.id, result: {} });
  assert.equal(h.root.querySelector('.openfail'), null);
  const c = load(cardHtml(APP), 'card'); c.fire(RESULT({ account: 'a' }));
  const m2 = press(c, 'Open Ryagram'); c.fire({ jsonrpc: '2.0', id: m2.id, result: { isError: false } });
  assert.equal(c.root.querySelector('.openfail'), null);
});
