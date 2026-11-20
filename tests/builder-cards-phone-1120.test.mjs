// The film builder's cards on a phone (GAMES 11-20 review of the stranger walk ceadbf4): each card is a GRID (the radio, the bold title,
// then its note, stacked). The phone rule that gives a radio's whole row 44 px made every such label a flex ROW, and its selector,
// label:has(>input[type=radio]) (0,1,2), beats .builder-card (0,1,0): at 375 px the title, the topic line and the source sat in three
// columns 54 to 177 px wide, one word a line. Source checks over the two stylesheets, each proved able to fail with the fault put back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SITE = read('assets/app-site.css'), APP = read('assets/app.css');
// every selector in the stylesheet that turns a radio or checkbox label into a flex row
const flexLabelSelectors = css => [...css.matchAll(/([^{}]+)\{([^}]*display:\s*flex[^}]*)\}/g)]
  .flatMap(m => m[1].split(',').map(s => s.trim()))
  .filter(s => /^label:has\(\s*>\s*input\[type=(radio|checkbox)\]\)/.test(s));
const spareCards = sels => sels.filter(s => !s.includes(':not(.builder-card)'));

test('the builder card itself is a grid (what the phone rule must leave alone)', () => {
  assert.match(APP, /\.builder-card\{display:grid;/);
});

test('no phone rule turns a builder card into a flex row', () => {
  const sels = flexLabelSelectors(SITE);
  assert.ok(sels.length >= 2, `found ${sels.length} radio/checkbox label rules`);
  assert.deepEqual(spareCards(sels), []);
});

test('the Get help radios (.choice) still get their 44 px row', () => {
  assert.ok(flexLabelSelectors(SITE).some(s => s.startsWith('label:has(>input[type=radio])')));
  assert.match(SITE, /label:has\(>input\[type=radio\]\):not\(\.builder-card\)[^{]*\{display:flex;align-items:center;gap:10px;min-height:44px\}/);
});

test('MUST-FAIL: the same check notices the builder cards caught again', () => {
  const broken = SITE.replaceAll(':not(.builder-card)', '');
  assert.notEqual(broken, SITE, 'the fault was planted');
  assert.equal(spareCards(flexLabelSelectors(broken)).length, 2);
});
