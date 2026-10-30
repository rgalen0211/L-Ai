// NEXT-WEB 162 (PUNCH P1): the consent page says which account it would connect and offers 'Not you? Switch account', which signs out and leaves the address alone. Real-browser walk: tools/check-consent-account.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../assets/app-connect.js', import.meta.url), 'utf8');
const code = src.replace(/\/\/.*$/gm, '');

test('the strip names the signed-in account as text, states the administrator rule, and the switch only signs out', () => {
  assert.match(code, /h\('strong', \{ 'data-key': 'consent-email' \}, email\)/);
  assert.match(code, /Approving connects THIS Ryagram account/);
  assert.match(code, /Administrator accounts cannot be connected to an AI/);
  assert.match(code, /'Not you\? Switch account'/);
  const handler = code.slice(code.indexOf("out.addEventListener('click'"), code.indexOf("return h('section', { class: 'consent-account'"));
  assert.match(handler, /auth\.signOut\(\)/);
  assert.doesNotMatch(handler, /location|hash|connectConsentDecide|decide\(/);                      // the address is left alone and nothing is approved or denied
});

test('the strip is on the allowed page, on a refusal and on an error, and the email never goes in as HTML', () => {
  assert.match(code, /'Connect an AI'\), strip, h\('p', \{ class: 'app-error', role: 'alert' \}, err\.message\)\]/);                    // an error
  assert.match(code, /'Connect an AI'\), strip, h\('p', \{ class: 'app-error', role: 'alert' \}, c && c\.reason/);                      // a refusal
  assert.match(code, /is asking to work with your Ryagram account\.`\), strip,/);                                                      // the consent page itself
  assert.match(code, /const strip = await accountStrip\(\);/);
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML/);
});
