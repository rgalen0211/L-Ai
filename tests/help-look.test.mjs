// WEB 11-18 (queue item 4, the help page and tutorial in the new look): the in-app Get help page's opening line is an intro like every other page's (class form-intro: the page's own size and the air
// before the card), not a bare form-note that sat flush against the form. The static help page and the tutorial already wear the look sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('Get help opens with a form-intro line, then the form', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /h\('h1', \{ tabindex: '-1' \}, 'Get help'\),\n\s+h\('p', \{ class: 'form-intro' \}, 'Common questions are answered below and in the '/);
});

test('the static help page, the app and the tutorial all wear the look sheet', () => {
  for (const f of ['help/index.html', 'app/index.html']) assert.match(read(f), /<body class="[a-z -]*ryagram-look/, f);
  assert.match(read('help/index.html'), /ryagram-look\.css\?v=20261117c/);
});
