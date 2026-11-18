// WEB 11-17 (Ryan's standing order, item 2): the Edit button on every project row and at the top of the project page, and a plain page (not the library) when the editor
// address is opened by an account without the editor. Source-level pins; the real-Chrome walk is tools/check-edit-button.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const lib = fs.readFileSync(path.join(root, 'assets/app-library.js'), 'utf8').replace(/\r\n/g, '\n');

test('the Edit link is shown only where the editor is released (true or account), strictly, and opens the data editor for that project', () => {
  assert.match(lib, /const liveEditorShown = \(\) => window\.ryagramConfig\?\.liveEditor === true \|\| window\.ryagramConfig\?\.liveEditor === 'account';/);
  assert.match(lib, /const editLink = \(id, cls\) => liveEditorShown\(\) \? h\('a', \{ class: cls, href: `#\/editor\/data\/\$\{id\}`/);
});

test('every project row and the top of the project page carry it', () => {
  assert.match(lib, /h\('a', \{ href: `#\/p\/\$\{p\.id\}` \}, p\.title\), ' ', editLink\(p\.id, 'button secondary small'\)/);
  assert.match(lib, /const actions = h\('div', \{ class: 'actions-row' \},\n\s+editLink\(project\.id, 'button primary'\),/);
});

test('an account without the editor opening its address gets the plain page with the way home, before the library fallback', () => {
  const off = lib.indexOf("else if (!liveEditorOn() && /^#");
  const fallback = lib.indexOf('else view = await libraryView();');
  assert.ok(off > 0 && off < fallback, 'the not-on route sits before the library fallback');
  assert.match(lib, /The live editor isn’t on for this account/);
  assert.match(lib, /id: 'editor-off-home', href: '#\/'/);
});
