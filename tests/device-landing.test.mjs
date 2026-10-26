// The #/device landing fix (live ride, Ryan 2026-10-26 12:37): signing in never lands on the computer-approval page unless a code rides in the link; the page with no code says what it is for
// and has a way back; the 'You have signed out.' note is cleared once signed in. The page in real Chrome is tools/check-device-landing.py (needs Chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
vm.runInNewContext(read('assets/app-device.js'), { window: win, setTimeout, clearTimeout });
const D = win.ryagramDevice;

test('WHICH HASH IS A STRAY: #/device with no code, or a bad one, is told apart from a link that carries a real code', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(D.codeFromHash('#/device'))), { page: true, code: null, bad: false });
  assert.equal(D.codeFromHash('#/device?code=ABCD-2345').code, 'ABCD2345');
  assert.equal(D.codeFromHash('#/device?code=abcd2345').code, 'ABCD2345');
  assert.equal(D.codeFromHash('#/device?code=nope').bad, true);
  assert.equal(D.codeFromHash('#/account').page, false);
  assert.equal(D.codeFromHash('').page, false);
});

test('SIGN-IN LANDING: the first mount after sign-in sends a code-less #/device to home, leaves a link with a code (or a bad one, which says so) alone, and clears the signed-out note', () => {
  const auth = read('assets/app-auth.js');
  const m = auth.slice(auth.indexOf('function showLibrary(user)'), auth.indexOf('function showSignIn()'));
  assert.match(m, /const d = window\.ryagramDevice && window\.ryagramDevice\.codeFromHash \? window\.ryagramDevice\.codeFromHash\(location\.hash\) : null;/);
  assert.match(m, /if \(d && d\.page && !d\.code && !d\.bad\) history\.replaceState\(null, '', location\.pathname \+ location\.search \+ '#\/'\);/);
  assert.match(m, /if \(status\.textContent === 'You have signed out\.'\) say\(''\);/);
  assert.ok(m.indexOf('history.replaceState') < m.indexOf('window.ryagramLibrary.mount('), 'the address is fixed BEFORE the library mounts and reads it');
  assert.ok(m.indexOf('if (!unmount)') < m.indexOf('history.replaceState'), 'only on the first mount of a sign-in, never on a token refresh');
  assert.match(auth, /await client\.auth\.signOut\(\);\n\s+sayOnce\('You have signed out\.'\);/);                // the sign-out side is as it was (tests/consumer-basics.test.mjs pins it too)
});

test('NO-CODE PAGE: one line says what it is for, with a Back to my films button; with a code (or a bad one) the old sentence stays', () => {
  const dev = read('assets/app-device.js');
  assert.match(dev, /\(prefill \|\| bad \? h\('p', \{ class: 'form-intro' \}, 'The Ryagram app on a computer is asking to sign in to your account\.'\)/);
  assert.match(dev, /h\('p', \{ class: 'form-intro' \}, 'Only needed if the Ryagram desktop app showed you a code\.'\)/);
  assert.match(dev, /h\('a', \{ class: 'button primary', id: 'device-back', href: '#\/' \}, 'Back to my films'\)/);
});

test('WIRING: the stamps moved so a returning visitor gets the fix', () => {
  const html = read('app/index.html');
  assert.match(html, /app-device\.js\?v=20261026c/);
  assert.match(html, /app-auth\.js\?v=20261026e/);                    // (app-auth moved again with the sign-in landing fix; tests/signin-landing.test.mjs pins it too)
});
