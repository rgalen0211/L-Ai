// GAMES 21:16 (keyboard + screen-reader pass): after 'Yes, render it' the page rebuilds and the Render button is gone, so focus fell to the page; it must land on the new 'Waiting for approval' line.
// Proved in Chrome on the live-shaped mock (activeElement = the order's LI); this pins the code, the back link target size and the audit fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('FOCUS: a request sets an 8 second window and loadOrders moves focus to the first order line when focus fell to the page', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /focusOrderUntil = Date\.now\(\) \+ 8000;/);
  assert.match(lib, /Date\.now\(\) < focusOrderUntil && firstOrder && \(!here \|\| here === document\.body \|\| here\.tagName === 'H1' \|\| !here\.isConnected\)\) \{ firstOrder\.setAttribute\('tabindex', '-1'\); firstOrder\.focus\(\); \}/);
});
test('BACK LINK: on the film page it is at least 44 px tall', () => assert.match(read('assets/app-pages-ds.css'), /\.make-it\) \.page-hero \.back\{min-height:44px\}/));
test('AUDIT: audit-a11y.py opens the data step before it clicks a dataset card', () => assert.ok(read('tools/audit-a11y.py').indexOf('Choose a dataset"') < read('tools/audit-a11y.py').indexOf(".builder-card').filter")));
