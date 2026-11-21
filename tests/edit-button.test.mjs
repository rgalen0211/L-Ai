// WEB 11-17 (Ryan's standing order, item 2): the Edit button on every project row and at the top of the project page, and a plain page (not the library) when the editor
// address is opened by an account without the editor. Source-level pins; the real-Chrome walk is tools/check-edit-button.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const lib = fs.readFileSync(path.join(root, 'assets/app-library.js'), 'utf8').replace(/\r\n/g, '\n');

test('the Edit link follows the SAME test as the editor route (liveEditorOn: true, or account AND on the list), so an account that is not on the list is never offered a link into the not-on page', () => {
  assert.doesNotMatch(lib, /liveEditorShown/, 'the config-only test is gone');
  assert.match(lib, /const liveEditorOn = \(\) => window\.ryagramSwitches\?\.featureOn\('liveEditor'\) === true;/);
  assert.match(lib, /const editLink = \(id, cls\) => liveEditorOn\(\) \? h\('a', \{ class: cls, href: `#\/editor\/data\/\$\{id\}`/);
  const uses = lib.split('\n').filter(l => /Edit/.test(l) && /href: `#\/editor\//.test(l));
  assert.ok(uses.length >= 2 && uses.every(l => /liveEditorOn\(\)/.test(l)), 'every place that links into the editor is gated by liveEditorOn');
});

test('behaviour: editLink is null for an account off the list and a link for one on it (config account, switch list decides)', () => {
  const m = lib.match(/const liveEditorOn = [^\n]+\n/)[0] + lib.match(/const editLink = [^\n]+\n/)[0];
  const run = (cfg, list) => {
    const feature = (n) => cfg[n] === true || (cfg[n] === 'account' && list.includes(n));
    const win = { ryagramConfig: cfg, ryagramSwitches: { featureOn: feature } };
    const h = (tag, attrs, ...kids) => ({ tag, attrs, kids });
    return new Function('window', 'h', m + 'return editLink;')(win, h);
  };
  assert.equal(run({ liveEditor: 'account' }, ['myFilms'])('x', 'c'), null, 'off account: no Edit link');
  assert.equal(run({ liveEditor: 'account' }, [])('x', 'c'), null, 'empty list: no Edit link');
  assert.equal(run({ liveEditor: false }, ['liveEditor'])('x', 'c'), null, 'flag off: no Edit link');
  const on = run({ liveEditor: 'account' }, ['liveEditor'])('x', 'c');
  assert.equal(on.attrs.href, '#/editor/data/x', 'on account: the link opens that project');
  assert.equal(run({ liveEditor: true }, [])('x', 'c').attrs['data-edit-project'], 'x', 'everyone: the link');
});

test('every project row and the top of the project page carry it', () => {
  assert.match(lib, /edit: editLink\(p\.id, 'button secondary small'\)/);
  assert.match(lib, /const actions = h\('div', \{ class: 'actions-row' \},\n\s+editLink\(project\.id, 'button primary'\),/);
});

test('an account without the editor opening its address gets the plain page with the way home, before the library fallback', () => {
  const off = lib.indexOf("else if (!liveEditorOn() && /^#");
  const fallback = lib.indexOf('else view = await libraryView();');
  assert.ok(off > 0 && off < fallback, 'the not-on route sits before the library fallback');
  assert.match(lib, /The live editor isn’t on for this account/);
  assert.match(lib, /id: 'editor-off-home', href: '#\/'/);
});

// GEO 18:58 points 2-4 (the first edit moves the page; a phone's two-row sticky header; the blank band above a card heading). The real-Chrome measurements are in tools/check-edit-button.py.
const css = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
test('the editor title has a row of its own and the pill keeps one width, so the first edit cannot re-wrap the title', () => {
  const c = css('assets/app-editor.css');
  assert.match(c, /\.le-top h1\{min-width:0;overflow-wrap:anywhere;flex:1 1 100%\}/);
  assert.match(c, /\.le-top \.le-pill\{min-width:9em;/);
  assert.match(c, /\.le-status\{min-height:1\.6em\}/);
});
test('the app\'s #library h2 margin no longer puts a blank band over the editor card headings', () => {
  assert.match(css('assets/app-editor.css'), /#library \.le-panel h2,#library \.le-ai h2\{margin-top:0\}/);
});
test('on a phone the look header scrolls away instead of staying over the page', () => {
  assert.match(css('assets/ryagram-look.css'), /@media\(max-width:560px\)\{body\.ryagram-look>header\{position:static\}\}/);
});
