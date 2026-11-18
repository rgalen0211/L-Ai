// WEB 11-18 (CLAUDE for Ryan 23:13): the Claude app's pane and chat panels auto-answer window.confirm with No, so a spending click did nothing there. The final-film order, the costed preview and the
// cancel of a full render ask IN the page (askConfirm in app-library.js): a box with two plain buttons, Escape closes it, and nothing here calls window.confirm. Source pins; the real-Chrome run is tools/check-inpage-confirm.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lib = fs.readFileSync(new URL('../assets/app-library.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => { const i = lib.indexOf(a); assert.ok(i >= 0, a); const j = lib.indexOf(b, i); assert.ok(j > i, b); return lib.slice(i, j); };

test('the final-film click, the costed preview and the cancel of a full render use askConfirm, not window.confirm', () => {
  const finalHandler = between("finalButton.addEventListener('click'", 'async function requestOrder');
  assert.doesNotMatch(finalHandler, /\bconfirm\(/);
  assert.match(finalHandler, /askConfirm\(finalButton, `Render the final film of version \$\{v\.number\}\?/);
  const previewHandler = between("previewButton.addEventListener('click'", "finalButton.addEventListener('click'");
  assert.doesNotMatch(previewHandler, /\bconfirm\(/);
  assert.match(previewHandler, /askConfirm\(previewButton, /);
  const cancel = between("if (J.orderOpen(st.state)) actions.push(", "if (st.state === 'delivered'");
  assert.doesNotMatch(cancel, /\bconfirm\(/);
  assert.match(cancel, /askConfirm\(/);
});

test('askConfirm: one box at a time, an alertdialog with Yes and No, No is where focus starts, Escape answers No, nothing is spent by opening it', () => {
  const fn = between('function askConfirm(', '// The guided builder');
  assert.match(fn, /document\.querySelectorAll\('\.inpage-confirm'\)\.forEach\(n => n\.remove\(\)\)/);
  assert.match(fn, /role: 'alertdialog'/);
  assert.match(fn, /e\.key === 'Escape'/);
  assert.match(fn, /no\.focus\(\)/);
  assert.match(fn, /closeOpenAsk\(false\)/);
  assert.doesNotMatch(fn, /\bconfirm\(/);
});

test('the Cancel box is placed after the order box, outside the list loadOrders rebuilds every poll (FACES 11:26)', () => {
  const cancel = between("if (J.orderOpen(st.state)) actions.push(", "if (st.state === 'delivered'");
  assert.match(cancel, /'Yes, cancel it', 'No, go back', orderBox\)/);
  const fn = between('function askConfirm(', '// The guided builder');
  assert.match(fn, /host = null/); assert.match(fn, /if \(host\) host\.insertAdjacentElement\('afterend', box\)/);
});
