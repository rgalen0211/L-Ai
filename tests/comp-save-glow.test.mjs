// Ryan 11-27 22:41: the Compilations 'Save my request' button (#comp-save, class 'button primary') must carry exactly the house primary glow
// (ryagram-ds.css), never its own box-shadow, and its Start panel must leave room so the flip viewport's overflow:hidden does not cut the glow square.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = ['app.css', 'app-pages-ds.css', 'app-site.css', 'app-games.css', 'app-editor.css'].map(f => read(`assets/${f}`)).join('\n');

test('GLOW: no rule targets #comp-save or .comp-start .button with a box-shadow or filter', () => {
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (/comp-save|\.comp-[a-z-]+[^{]*\.(button|btn)\b/.test(m[1])) assert.doesNotMatch(m[2], /box-shadow|filter/, m[1]);
  }
});

test('GLOW: the house primary rule is the one glow (0 10px 30px var(--glow))', () => {
  assert.match(read('assets/ryagram-ds.css'), /\.button\.primary[^{]*\{[^}]*box-shadow:0 1px 0 rgba\(255,255,255,\.4\) inset,0 10px 30px var\(--glow\)/);
});

test('GLOW: the Start panel has padding on its sides and bottom so the viewport does not clip the glow', () => {
  assert.match(css, /\.flip-panel>\.comp-start\{padding:0 32px 44px\}/);
  assert.match(read('assets/app-compilations.js'), /id: 'comp-save'/);
});
