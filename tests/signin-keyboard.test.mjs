// WEB night pass 11-06 (keyboard and screen reader, signed-out pages): going back from Create an account to Sign in must put focus on the Sign in heading (the way Create an account puts it on its own),
// or a keyboard or screen-reader person is left on nothing. Real-Chrome proof: tools/check-signin-keyboard.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the Sign in heading can take focus, and Sign in takes it only when coming back from Create an account', () => {
  assert.match(read('app/index.html'), /<h1 id="sign-in-title" tabindex="-1">Sign in<\/h1>/);
  const src = read('assets/app-auth.js');
  assert.match(src, /let cameFromCreate = false;/);
  assert.match(src, /function showCreateAccount\(\) \{\n      cameFromCreate = true;/);
  assert.match(src, /signIn\.hidden = false;\n      if \(cameFromCreate\) \{ cameFromCreate = false; \$\('sign-in-title'\)\.focus\(\); \}/);
  assert.equal((src.match(/\$\('sign-in-title'\)\.focus\(\)/g) || []).length, 1, 'only on the way back, never on a plain page load');
});
