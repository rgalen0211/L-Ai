// A stranger's three small needs on every signed-in page (WEB 11-20, the stranger walk; assets/app-library.js polishPage): the tab title says where you are, an admin page goes back to the Admin page
// (not to the user's home), a page with no way back gets one, and signing out puts the old title back. polishPage is cut out of the library's source and run against a tiny DOM, so the behaviour is tested.
// The pages in real Chrome: tools/check-stranger-fixes.py. Must-fails: tests/site_titles_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LIB = read('assets/app-library.js');
const i = LIB.indexOf('function polishPage(hash) {'), j = LIB.indexOf('async function delayedNotice()', i);
assert.ok(i > 0 && j > i, 'polishPage found');
const SRC = LIB.slice(i, j);

class El {
  constructor(tag, attrs = {}, text = '') { this.tag = tag; this.attrs = { ...attrs }; this.children = []; this.parent = null; this.textContent = text; }
  setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
  add(...ks) { for (const k of ks) { k.parent = this; this.children.push(k); } return this; }
  before(n) { const p = this.parent, at = p.children.indexOf(this); n.parent = p; p.children.splice(at, 0, n); }
  all(out = []) { for (const c of this.children) { out.push(c); c.all(out); } return out; }
  querySelector(sel) {
    const all = this.all();
    if (sel === 'h1') return all.find(e => e.tag === 'h1') || null;
    if (sel === 'a.back') return all.find(e => e.tag === 'a' && String(e.attrs.class || '').split(' ').includes('back')) || null;
    if (sel === 'a[href="#/"]') return all.find(e => e.tag === 'a' && e.attrs.href === '#/') || null;
    throw new Error('selector not supported by the stand-in: ' + sel);
  }
}
const h = (tag, attrs, ...kids) => { const e = new El(tag, attrs || {}); const text = kids.filter(k => typeof k === 'string').join(''); e.textContent = text; return e; };
function run(hash, build) {
  const root = new El('main'); build(root);
  const document = { title: 'Before' };
  const fn = vm.runInNewContext(`(function (root, document, h) { ${SRC} return polishPage; })`, { String, RegExp })(root, document, h);
  fn(hash);
  return { root, document };
}
const page = (title, ...more) => root => { if (title !== null) root.add(new El('h1', {}, title)); for (const m of more) root.add(m); };

test('TAB TITLE: the page’s own heading and the product, or the product alone when there is no heading; the heading is trimmed', () => {
  assert.equal(run('#/films', page('My films')).document.title, 'My films | Ryagram');
  assert.equal(run('#/account', page('  Your account  ')).document.title, 'Your account | Ryagram');
  assert.equal(run('#/', page('Your projects')).document.title, 'Your projects | Ryagram');
  assert.equal(run('#/x', page(null)).document.title, 'Ryagram | L’Ai');
  assert.equal(run('#/x', page('   ')).document.title, 'Ryagram | L’Ai', 'a blank heading is no heading');
});

test('ADMIN PAGES: the back link goes to the Admin page and says so; an admin page with no back link gets none from here; the Admin page itself is not an admin sub-page', () => {
  const back = () => new El('a', { class: 'back', href: '#/' }, '← All projects');
  const r = run('#/admin/visits', page('Visits and signups', back()));
  const a = r.root.querySelector('a.back'); assert.equal(a.attrs.href, '#/admin'); assert.equal(a.textContent, '← Admin');
  const none = run('#/admin/ops', page('Operations')); assert.equal(none.root.querySelector('a.back'), null, 'nothing is added on an admin sub-page');
  const hub = run('#/admin', page('Admin', back())); assert.equal(hub.root.querySelector('a.back').attrs.href, '#/', 'the Admin page itself keeps its own back link');
  assert.equal(run('#/admin/', page('x', back())).root.querySelector('a.back').attrs.href, '#/', 'a bare slash is not a sub-page');
});

test('A WAY BACK: a page with none gets "← All projects" before its heading; not the home page, not a page that already has a back link or any link home', () => {
  const r = run('#/films', page('My films'));
  const added = r.root.children[0]; assert.equal(added.tag, 'a'); assert.equal(added.attrs.href, '#/'); assert.equal(added.attrs.class, 'back'); assert.equal(added.textContent, '← All projects');
  assert.equal(r.root.children[1].tag, 'h1', 'before the heading');
  for (const home of ['', '#/', '#']) assert.equal(run(home, page('Your projects')).root.children.length, 1, `home ${JSON.stringify(home)}`);
  const has = run('#/films', page('My films', new El('a', { class: 'back', href: '#/p/1' }, '← Film')));
  assert.equal(has.root.all().filter(e => e.tag === 'a').length, 1, 'a page with its own back link is left alone');
  assert.equal(has.root.querySelector('a.back').attrs.href, '#/p/1');
  const link = run('#/credits', page('Credits', new El('a', { href: '#/' }, 'Back to your projects')));
  assert.equal(link.root.all().filter(e => e.tag === 'a').length, 1, 'a page with a link home needs no second one');
  assert.equal(run('#/x', page(null)).root.children.length, 0, 'no heading, nothing to put it before');
});

test('SIGN-OUT: the title the page had is put back; the polish runs on every page the library draws, after it is ready and before focus moves', () => {
  assert.match(LIB, /const titleWas = document\.title;/);
  assert.match(LIB, /return \(\) => \{ token\+\+; stopAdminNav\(\); if \(window\.ryagramDs\) window\.ryagramDs\.unmount\(\); document\.title = titleWas;/);
  const k = LIB.indexOf('polishPage(hash);'); assert.ok(k > 0);
  const around = LIB.slice(k - 400, k + 160);
  assert.ok(around.indexOf('root.replaceChildren') > -1 && around.indexOf('polishPage(hash)') < around.indexOf("root.querySelector('h1')?.focus({ preventScroll: true })"), 'after the page is in place, before the heading takes focus');
});
