// Claude 11-26 19:28: asking for the full film showed a full-page 'Something went wrong' although the request stood (credits held, version queued); a cold reload was fine.
// WEB's fix, source-pinned (the real cause is not reproduced on the mock): (1) once the request is made, a failure while the page re-reads itself rebuilds the page from the server instead of saying 'try again';
// (2) a page that fails to build is built once more, once per address, and the throw goes to the console.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const lib = fs.readFileSync(new URL('../assets/app-library.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('REQUEST STANDS: after requestFinalRender succeeds, a later throw rebuilds the page and never shows the error line', () => {
  const body = lib.slice(lib.indexOf('async function requestOrder('), lib.indexOf('async function loadOrders()'));
  assert.match(body, /let requested = false;/);
  assert.ok(body.indexOf('requested = true;') > body.indexOf('data.requestFinalRender(') && body.indexOf('requested = true;') < body.indexOf('await loadOrders();'));
  assert.ok(body.includes('if (requested) {') && body.includes('versionChanged(); } else showError(error, err);'));
});
test('ROUTE RETRY: a page that throws while it is built is built once more per address, and the throw is logged', () => {
  const fn = lib.slice(lib.indexOf('function retryOnce('), lib.indexOf('let stopView'));
  assert.match(fn, /err\.notAvailable\) return;/);
  assert.match(fn, /console\.error\('Ryagram: the page failed to build', err\)/);
  assert.match(fn, /retriedFor !== hash/);
  assert.match(lib, /\} catch \(err\) \{\n        retryOnce\(err, mine, hash\);/);
});
