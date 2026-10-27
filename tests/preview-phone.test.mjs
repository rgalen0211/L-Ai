// The live preview on a phone (assets/preview/preview-demo.css): the end card fits its box and the theme choices are tappable. Found by FACES (NEXT-FACES 71, 16:53) at 428, 390, 375 and 360 px; the real-Chrome
// check is tools/check-preview-phone.py. These source checks pin the rules and that the stylesheet carries a new ?v= so a returning visitor gets it. The service worker's cache name is NOT changed (that would
// re-download the 2.8 MB film bundle); its stale-while-revalidate copy of the stylesheet refreshes on the next visit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('PHONE END CARD: under 640 px the card is compact (smaller gap, padding, heading, line and buttons) so the heading and both buttons stay inside a 200 px box', () => {
  const css = read('assets/preview/preview-demo.css');
  const m = css.match(/@media \(max-width:640px\)\{([^@]*?)\}\.pv-theme/);
  assert.ok(m, 'a max-width:640px block for the end card');
  for (const rule of ['.pv-endcard{gap:6px;padding:10px 12px}', '.pv-endcard-mark{font-size:1.3rem}', '.pv-endcard-line{font-size:.72rem;line-height:1.25}', '.pv-endcard-actions{gap:8px;margin-top:2px}',
                      '.pv-endcard .button{padding:6px 12px;min-height:36px;font-size:.85rem}']) assert.ok(m[1].includes(rule), rule);
  assert.match(css, /\.pv-endcard\[hidden\]\{display:none\}/);                                          // the existing rule is untouched
});

test('THEME CHOICES: a 44 px row and a 22 px control, so a thumb finds them', () => {
  const css = read('assets/preview/preview-demo.css');
  assert.match(css, /\.pv-theme \.choice\{min-height:44px;padding:0 8px;margin-right:10px\}/);
  assert.match(css, /\.pv-theme \.choice input\{width:22px;height:22px\}/);
});

test('CACHE: the page links the stylesheet with a new ?v=, and the service worker cache name and file list are untouched', () => {
  const html = read('preview-demo/index.html');
  assert.match(html, /preview-demo\.css\?v=20261020a/);
  assert.doesNotMatch(html, /preview-demo\.css\?v=20261011a/);
  assert.match(read('preview-demo/sw.js'), /const VERSION = 'ryagram-preview-demo-v1';/);
});
