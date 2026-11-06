// WEB hostile-server sweep 11-06 (real-Chrome proof: tools/check-hostile-server.py, 42 scenarios): a server answer is data. Three things the sweep found: an access check that never answers stalled the
// page on "Loading…" for ever (now it fails closed to the waiting page after 12 s); an invite refusal of 5,000 unbroken characters pushed the waiting page sideways (now cut to 300 and wrapped);
// admin list rows that were not objects with an id (or a list that was not a list) crashed the admin page (now ignored).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the access check gives up after 12 seconds and fails closed, like an error', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /Promise\.race\(\[data\.myAccess\(\), new Promise\(\(_, no\) => setTimeout\(\(\) => no\(new Error\('no answer'\)\), 12000\)\)\]\)/);
  assert.match(lib, /let access = 'waiting';/); assert.match(lib, /catch \{ \/\* fail closed: the waiting page \*\/ \}/);
});

test('an invite refusal is shown as a plain string cut to 300 characters, wrapped anywhere', () => {
  const src = read('assets/app-waiting.js'), css = read('assets/app.css');
  assert.match(src, /typeof r\.message === 'string' && r\.message\.slice\(0, 300\)/);
  assert.match(css, /\.contact-form \.form-note,\.account-section \.form-note,\.wl-list\{overflow-wrap:anywhere\}/);
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), 'server text is still only ever a text node');
});

test('the admin list ignores anything that is not an object with a user id, and a list that is not a list', async () => {
  const src = read('assets/app-waiting.js');
  assert.match(src, /const rows = \(Array\.isArray\(asked\) \? asked : \[\]\)\.filter\(r => r && typeof r === 'object' && typeof r\.user_id === 'string'\)/);
  // run adminView's row handling with a minimal DOM: junk in, only the real row drawn
  const mk = tag => { const el = { tag, children: [], attrs: {}, style: {}, textContent: '', append(...c) { this.children.push(...c.flat()); }, replaceChildren(...c) { this.children = c.flat(); }, addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; } }; return el; };
  const h = (tag, attrs = {}, ...kids) => { const el = mk(tag); Object.assign(el.attrs, attrs); for (const k of kids.flat()) if (k != null && k !== false) el.children.push(k); return el; };
  const win = {}; vm.runInNewContext(src, { window: win, location: { origin: 'https://uselai.com' }, document: {}, confirm: () => false });
  for (const asked of [null, undefined, 'rows', { a: 1 }, [null, 1, 'x', [], {}, { user_id: 5 }]]) {
    const ui = win.ryagramWaiting.create({ h, data: { adminWaitingList: async () => asked, adminApproveWaiting: async () => ({}) }, busy: async (b, w, f) => f(), showError() {}, errorLine: () => mk('p') });
    const view = await ui.adminView(); const list = view.find(x => x && x.attrs && x.attrs.class === 'wl-list');
    assert.equal(list.children.length, 1, 'only the "Nobody is waiting." row'); assert.match(JSON.stringify(list.children[0].children), /Nobody is waiting\./);
  }
  const ui = win.ryagramWaiting.create({ h, data: { adminWaitingList: async () => [null, { user_id: 'a', email: 'a@e.co', created_at: '2026-11-01' }, 7], adminApproveWaiting: async () => ({}) }, busy: async (b, w, f) => f(), showError() {}, errorLine: () => mk('p') });
  const list = (await ui.adminView()).find(x => x && x.attrs && x.attrs.class === 'wl-list'); assert.equal(list.children.length, 1); assert.match(JSON.stringify(list.children[0].children), /a@e\.co/);
});
