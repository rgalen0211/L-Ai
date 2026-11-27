// The signed-out walk (WEB 11-27): a visitor with no account must see only the Sign in page on every route, never a department page, a Save or a room-create control.
// The mock's ?signedout switch gives the fake client no session; the app mounts the library (and the department bar) only for a session (assets/app-auth.js showLibrary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const load = search => {
  const ctx = { location: { search }, structuredClone, setTimeout, console };
  ctx.globalThis = ctx;
  vm.runInNewContext(read('tests/fake-supabase.js'), ctx);
  return ctx.createFakeClient({}, { user: { id: 'u-x', email: 'x@example.com' } });
};
test('MOCK SWITCH: ?signedout means no session; without it the mock is signed in as before', async () => {
  assert.equal((await load('?mock&signedout').auth.getSession()).data.session, null);
  assert.equal((await load('?mock&signedout&gameson').auth.getSession()).data.session, null);
  assert.equal((await load('?mock').auth.getSession()).data.session.user.id, 'u-x');
  assert.equal((await load('?mock&signedoutish').auth.getSession()).data.session.user.id, 'u-x', 'only the exact word counts');
});
test('MOCK SWITCH: the auth listener hears INITIAL_SESSION with no session, so the Sign in page shows', async () => {
  const seen = [];
  load('?signedout').auth.onAuthStateChange((ev, s) => seen.push([ev, s]));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(seen, [['INITIAL_SESSION', null]]);
});
test('NO ACCOUNT, NO LIBRARY: the library and the department bar are mounted only from showLibrary(user), which only a session reaches', () => {
  const a = read('assets/app-auth.js');
  assert.match(a, /else if \(session\?\.user\) showLibrary\(session\.user\);/);
  assert.equal((a.match(/ryagramLibrary\.mount\(/g) || []).length, 1, 'one mount site, inside showLibrary');
  assert.match(a, /function showLibrary\(user\) \{[\s\S]*?ryagramLibrary\.mount\(library/);
});
test('TAP TARGETS: the footer links on the Sign in page are at least 44px high and wide at every width', () => {
  assert.match(read('assets/app.css'), /\.app-foot a\{display:inline-flex;align-items:center;min-height:44px;min-width:44px;box-sizing:border-box\}/);
  assert.match(read('app/index.html'), /app\.css\?v=20261127c6/);
});
