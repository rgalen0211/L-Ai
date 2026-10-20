// The accessibility pass on the guided builder and "Your look" (2026-10-19, found by tools/audit-a11y.py in real Chrome): tap targets, readable swatch labels, and a refusal that is announced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('TAP TARGETS: small buttons and links are 40 px high, and every folded section\'s summary is at least 40 px', () => {
  const css = read('assets/app.css');
  assert.match(css, /\.button\.small\{min-height:40px;/);
  assert.match(css, /:where\(\.ryagram-app details\)>summary\{min-height:40px;/, 'no extra specificity, so the 44 px summaries (.advanced-panel, .ops-details) keep their own size');
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
  // a later bump is fine (the dark-default change bumped app-looks.js again; the device page bumped app.css): the version is dated 2026-10-19 or later, never older
  for (const f of ['app.css', 'app-builder.js', 'app-looks.js']) {
    const v = html.match(new RegExp(`${f.replace('.', '\\.')}\\?v=(\\d{8})[a-z]`));
    assert.ok(v && v[1] >= '20261019', `${f} carries a version dated 20261019 or later`);
  }
});

test('WHOLE-APP PASS (tools/audit-app-pass.py): phone text fields are 16 px, the version link and help questions are 40 px, the footer and admin links do not wrap oddly', () => {
  const css = read('assets/app.css');
  assert.ok(css.includes('@media(max-width:520px){.ryagram-app :is(input,select,textarea){font-size:16px}}'));
  assert.ok(css.includes('.version-link{display:inline-flex;align-items:center;justify-content:center;'));
  assert.ok(css.includes('min-width:40px;min-height:40px}'));
  assert.ok(css.includes('.app-foot{align-items:center}.admin-links a{white-space:nowrap}'));
  assert.ok(read('assets/help.css').includes('.faq summary{min-height:40px;padding:8px 0;box-sizing:border-box}'));
  for (const f of ['help', 'terms', 'ai-content', 'report', 'connect-ai']) assert.ok(read(`${f}/index.html`).includes('help.css?v=20261019a'), f);
});
