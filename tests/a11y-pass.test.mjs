// The accessibility pass on the guided builder and "Your look" (2026-10-19, found by tools/audit-a11y.py in real Chrome): tap targets, readable swatch labels, and a refusal that is announced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('TAP TARGETS: small buttons and links are 40 px high, and every folded section\'s summary is at least 40 px', () => {
  const css = read('assets/app.css');
  assert.match(css, /\.button\.small\{min-height:40px;/);
  assert.match(css, /\.ryagram-app details>summary\{min-height:40px;/);
});

test('SWATCH LABELS: a label inside a colour swatch is black or white, whichever reads better, and is no longer faded', () => {
  const js = read('assets/app-looks.js');
  assert.match(js, /function readableOn\(colour\)/);
  assert.match(js, /else if \(label\) \{ el\.style\.color = readableOn\(colour\); \}/);
  assert.doesNotMatch(read('assets/app.css'), /\.look-swatch-label\{[^}]*opacity/);
  // the same rule, run: dark swatches get white, light ones black, anything that is not #rrggbb is left alone
  const src = js.match(/function readableOn\(colour\) \{[\s\S]*?\n      \}/)[0];
  const readableOn = new Function(`${src}; return readableOn;`)();
  assert.equal(readableOn('#101018'), '#ffffff');
  assert.equal(readableOn('#ffd23f'), '#000000');
  assert.equal(readableOn('red'), '');
});

test('REFUSAL IS ANNOUNCED: the builder\'s "can\'t be made yet" sentence and its reasons sit together in one alert region', () => {
  const js = read('assets/app-builder.js');
  assert.match(js, /h\('div', \{ role: 'alert' \}, h\('p', \{ class: 'app-error' \}, 'This film can’t be made yet:'\),\n\s+h\('ul', \{ class: 'builder-problems' \}/);
});

test('CACHE-BUST: the three changed assets carry a new version', () => {
  const html = read('app/index.html');
  for (const f of ['app.css', 'app-builder.js', 'app-looks.js']) assert.match(html, new RegExp(`${f.replace('.', '\\.')}\\?v=20261019a`));
});
