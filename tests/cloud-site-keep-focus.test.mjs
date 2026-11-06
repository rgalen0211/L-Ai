// CLOUD-SITE 11-02 round 2 (task 3): the live editor (#/editor/*, behind liveEditor) and the tester wizard (#/tester-start, behind testerWizard) rebuilt their panels after a button
// was pressed (the wizard also every 15 seconds), which dropped keyboard focus to the page body. Both now keep the keyboard's place. These tests prove the two helpers on a tiny
// stand-in DOM (no DOM library is installed), and that the pages are wired through them. The browser proof is tools/audit-a11y-switched.mjs ("drops focus" findings: 68 before, 0 after).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ------------------------------------------------------------------ a stand-in DOM: elements, simple selectors (tag, .class, #id, [attr], [attr="v"], [class~="v"], tag[attr]), focus
function matches(el, sel) {
  return sel.split(',').map(x => x.trim()).some(one => {
    const m = /^([a-z0-9]*)((?:[.#][\w-]+|\[[^\]]+\])*)$/i.exec(one); if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const part of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
      if (part[0] === '.') { if (!el.classes().includes(part.slice(1))) return false; continue; }
      if (part[0] === '#') { if (el.id !== part.slice(1)) return false; continue; }
      const a = /^\[([\w-]+)(~?=)?"?([^"\]]*)"?\]$/.exec(part);
      if (a[1] === 'class' && a[2] === '~=') { if (!el.classes().includes(a[3])) return false; continue; }
      if (!el.hasAttribute(a[1])) return false;
      if (a[2] === '=' && el.getAttribute(a[1]) !== a[3]) return false;
    }
    return true;
  });
}
function makeDoc() {
  const doc = { activeElement: null };
  class El {
    constructor(tag, attrs = {}, kids = []) { this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.kids = []; this.parent = null; this.disabled = !!attrs.disabled; delete this.attrs.disabled; for (const k of kids) this.append(k); }
    get id() { return this.attrs.id || ''; } get className() { return this.attrs.class || ''; } classes() { return this.className.split(/\s+/).filter(Boolean); }
    get textContent() { return (this.attrs.text || '') + this.kids.map(k => k.textContent).join(''); }
    get isConnected() { let e = this; while (e.parent) e = e.parent; return e === doc.body; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } hasAttribute(k) { return k in this.attrs; } setAttribute(k, v) { this.attrs[k] = String(v); }
    append(k) { k.parent = this; this.kids.push(k); }
    replaceChildren(...ks) { for (const k of this.kids) k.parent = null; this.kids = []; for (const k of ks) this.append(k); }
    all() { return this.kids.flatMap(k => [k, ...k.all()]); }
    querySelectorAll(s) { return this.all().filter(e => matches(e, s)); } querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    contains(e) { for (let x = e; x; x = x.parent) if (x === this) return true; return false; }
    closest(s) { for (let x = this; x; x = x.parent) if (x !== doc.body && matches(x, s)) return x; return null; }
    focus() { if (!this.disabled) doc.activeElement = this; }
  }
  doc.body = new El('body'); doc.activeElement = doc.body;
  return { doc, h: (tag, attrs, ...kids) => new El(tag, attrs, kids.flat()) };
}

const edWin = { ryagramEditor: {} }; vm.runInNewContext(read('assets/app-editor.js'), { window: edWin, document: {} });
const wzWin = {}; vm.runInNewContext(read('assets/app-tester-wizard.js'), { window: wzWin, setTimeout, setInterval, clearInterval });
const ED = edWin.ryagramEditorPage, WZ = wzWin.ryagramTesterWizard;

test('editor: after a rebuild, the same control (by label, preset or clip) gets focus back', () => {
  const { doc, h } = makeDoc();
  const panel = (on) => h('section', { class: 'le-panel' }, h('h2', { id: 'le-look-h', text: 'Look' }),
    h('button', { 'data-preset': 'white', text: 'White background', 'aria-pressed': String(on) }), h('button', { 'data-preset': 'cb', text: 'Colour-blind safe' }));
  const root = h('div', { class: 'le' }, panel(false)); doc.body.append(root);
  root.querySelector('[data-preset="white"]').focus();
  const got = ED.keepFocus(root, doc, () => root.replaceChildren(panel(true)));
  assert.equal(doc.activeElement, got); assert.equal(got.getAttribute('data-preset'), 'white'); assert.equal(got.getAttribute('aria-pressed'), 'true', 'the NEW button, not the thrown-away one');
  assert.ok(got.isConnected);
});

test('editor: a clip button whose words change (Longer) is found by its aria-label; a list item by its clip id', () => {
  const { doc, h } = makeDoc();
  const list = (len) => h('div', { class: 'le-list' }, h('div', { class: 'le-item' }, h('button', { class: 'le-itemtext', 'data-id': 'v1', text: `Video: hi · ${len} s` }),
    h('button', { 'aria-label': 'Make hi longer', text: 'Longer' })));
  const root = h('div', { class: 'le' }, list(2)); doc.body.append(root);
  root.querySelector('[aria-label]').focus();
  assert.equal(ED.keepFocus(root, doc, () => root.replaceChildren(list(2.1))).getAttribute('aria-label'), 'Make hi longer');
  root.querySelector('.le-itemtext').focus();
  const got = ED.keepFocus(root, doc, () => root.replaceChildren(list(2.2)));
  assert.equal(got.getAttribute('data-id'), 'v1'); assert.match(got.textContent, /2\.2 s/);
});

test('editor: if the same control is now disabled (Up on what became the first clip), its row\'s next control takes focus; with no row, the panel heading', () => {
  const { doc, h } = makeDoc();
  const row = (upOff) => h('div', { class: 'le-item' }, h('button', { 'aria-label': 'Move hi earlier', text: 'Up', disabled: upOff }), h('button', { 'aria-label': 'Move hi later', text: 'Down' }));
  const root = h('div', { class: 'le' }, h('div', { class: 'le-list' }, row(false))); doc.body.append(root);
  root.querySelector('[aria-label="Move hi earlier"]').focus();
  assert.equal(ED.keepFocus(root, doc, () => root.replaceChildren(h('div', { class: 'le-list' }, row(true)))).getAttribute('aria-label'), 'Move hi later');
  // a control that is gone: the heading of the panel it was in
  const sec = () => h('section', { class: 'le-panel' }, h('h2', { id: 'le-clip-h', text: 'Clip' }), h('button', { text: 'Remove this clip' }));
  root.replaceChildren(sec()); root.querySelector('button').focus();
  const got = ED.keepFocus(root, doc, () => root.replaceChildren(h('section', { class: 'le-panel' }, h('h2', { id: 'le-clip-h', text: 'Clip' }))));
  assert.equal(got.id, 'le-clip-h'); assert.equal(got.getAttribute('tabindex'), '-1'); assert.equal(doc.activeElement, got);
});

test('editor: focus outside the editor, or focus the rebuild moved on purpose, is left alone', () => {
  const { doc, h } = makeDoc();
  const outside = h('button', { text: 'Elsewhere' }); doc.body.append(outside);
  const root = h('div', { class: 'le' }, h('button', { text: 'A' })); doc.body.append(root);
  outside.focus(); assert.equal(ED.keepFocus(root, doc, () => root.replaceChildren(h('button', { text: 'A' }))), null); assert.equal(doc.activeElement, outside);
  root.querySelector('button').focus();
  const chosen = h('button', { text: 'B' });
  ED.keepFocus(root, doc, () => { root.replaceChildren(chosen); chosen.focus(); }); assert.equal(doc.activeElement, chosen);
});

test('wizard: the button or link that had focus has it again after a redraw (a press, or the 15-second refresh)', () => {
  const { doc, h } = makeDoc();
  const steps = (checked) => [h('ol', {}, h('li', {}, h('button', { 'data-wiz': 'disk', 'aria-pressed': String(checked), text: checked ? 'I need to check again' : 'I checked: the drive has room' }),
    h('a', { href: '#/account', 'data-wiz': 'go-computer', text: 'See my computers' }))), h('button', { 'data-wiz': 'again', text: 'Check again' })];
  const body = h('div', { class: 'wiz-body' }, ...steps(false)); doc.body.append(body);
  body.querySelector('[data-wiz="disk"]').focus();
  const got = WZ.keepFocus(body, doc, () => body.replaceChildren(...steps(true)));
  assert.equal(got.getAttribute('data-wiz'), 'disk'); assert.equal(got.getAttribute('aria-pressed'), 'true'); assert.equal(doc.activeElement, got);
  body.querySelector('[data-wiz="go-computer"]').focus();
  assert.equal(WZ.keepFocus(body, doc, () => body.replaceChildren(...steps(true))).getAttribute('data-wiz'), 'go-computer');
  body.querySelector('[data-wiz="again"]').focus();
  assert.equal(WZ.keepFocus(body, doc, () => body.replaceChildren(...steps(true))).getAttribute('data-wiz'), 'again');
});

test('wiring: the editor paints through keepFocus, the wizard draws through keepFocus, every wizard control carries data-wiz, the list text button carries its clip id; the versions are bumped', () => {
  const ed = read('assets/app-editor.js'), wz = read('assets/app-tester-wizard.js'), app = read('app/index.html');
  assert.match(ed, /function paint\(\) \{ const at = document\.querySelector\('\.le'\); if \(at\) keepFocus\(at, document, paintNow\); else paintNow\(\); \}/);
  assert.match(ed, /class: 'le-itemtext', 'data-id': c\.id/);
  assert.match(wz, /function draw\(r\) \{ keepFocus\(body, document, \(\) => drawNow\(r\)\); \}/);
  for (const k of ["'data-wiz': 'disk'", "'data-wiz': `go-${s.id}`", "'data-wiz': 'again'"]) assert.ok(wz.includes(k), k);
  assert.match(app, /app-editor\.js\?v=20261106f/); assert.match(app, /app-tester-wizard\.js\?v=20261103a/);
  assert.ok(read('tools/maker-live/live.js').includes('function keepFocus(root, doc, repaint)'), 'the maker\'s copy is rebuilt from the site\'s file');
});
