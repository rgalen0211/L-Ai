// The sign-in landing fix (live ride, Ryan 2026-10-26 17:32): signing in as a DIFFERENT account from a tab left on the last account's page lands on home; a page that is not there says
// "This page isn't available on this account" with a way home, never the database's own 'Cannot coerce the result to a single JSON object'; the 'You have signed out.' note never stays on a
// signed-in screen. The page in real Chrome, two accounts in one tab, is tools/check-signin-landing.py (needs Chrome; it FAILS on main before this change).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
vm.runInNewContext(read('assets/app-data.js'), { window: win, setTimeout, clearTimeout });
const D = win.ryagramData;
const PLAIN = 'This page isn’t available on this account.';

test('NO ROW: both of PostgREST\'s sentences, and its code, are "not available"; any other error keeps its own words', () => {
  assert.equal(D.NOT_AVAILABLE, PLAIN);
  assert.equal(D.noRow({ message: 'Cannot coerce the result to a single JSON object' }), true);                    // what Ryan saw
  assert.equal(D.noRow({ message: 'JSON object requested, multiple (or no) rows returned' }), true);                // the newer wording
  assert.equal(D.noRow({ code: 'PGRST116', message: 'anything' }), true);
  for (const e of [{ message: 'new row violates row-level security policy', code: '42501' }, { message: 'Network request failed' }, { message: '' }, null, undefined]) assert.equal(D.noRow(e), false, JSON.stringify(e));
});

test('RUN: a query that finds no row throws the plain sentence, flagged for the view; every other error is unchanged', async () => {
  // A query builder where every call chains and awaiting it gives `result` (getProject also orders and lists versions; only the answer matters here).
  const chain = result => new Proxy(function () {}, { get: (t, p) => (p === 'then' ? resolve => resolve(result) : () => chain(result)), apply: () => chain(result) });
  const mk = result => D({ from: () => chain(result) });
  const get = d => d.getProject('00000000-0000-4000-8000-000000000001');
  for (const message of ['Cannot coerce the result to a single JSON object', 'JSON object requested, multiple (or no) rows returned']) {
    await assert.rejects(get(mk({ data: null, error: { message } })), e => e.message === PLAIN && e.notAvailable === true, message);
  }
  await assert.rejects(get(mk({ data: null, error: { code: 'PGRST116', message: 'x' } })), e => e.message === PLAIN && e.notAvailable === true);
  await assert.rejects(get(mk({ data: null, error: { message: 'permission denied for table projects', code: '42501' } })), e => e.message === 'permission denied for table projects' && !e.notAvailable);
  await assert.rejects(get(mk({ data: null, error: { message: '' } })), e => e.message === 'Project not found.' && !e.notAvailable);          // the page's own fallback still applies
  assert.equal((await get(mk({ data: { id: 'p1', title: 'T' }, error: null }))).project.title, 'T');                // a found row comes through as before
});

test('THE PAGE: a not-available error shows the plain heading, why, and a button home; any other error still shows its own message; the raw sentence is never printed', () => {
  const lib = read('assets/app-library.js');
  const c = lib.slice(lib.indexOf('} catch (err) {', lib.indexOf('async function route()')), lib.indexOf('if (mine !== token) { stops.forEach'));
  assert.match(c, /view = err && err\.notAvailable/);
  assert.match(c, /'This page isn’t available on this account'/);
  assert.match(c, /'It may belong to a different account, or it may have been removed\.'/);
  assert.match(c, /id: 'not-available-home', href: '#\/' \}, 'Back to your projects'/);
  assert.match(c, /'Something went wrong'/);                                                  // everything else is as it was
  assert.doesNotMatch(lib, /Cannot coerce|JSON object requested/);                           // the database's own sentence is never in the page code
});

test('SIGN-IN LANDING: a DIFFERENT account from a tab left on the last account\'s project, version, delivery page or look goes home; the same account keeps its page; the note is cleared on every call', () => {
  const auth = read('assets/app-auth.js');
  const m = auth.slice(auth.indexOf('function showLibrary(user)'), auth.indexOf('function showSignIn()'));
  assert.match(auth, /let lastUserId = null;/);
  assert.match(m, /if \(lastUserId && user\.id && lastUserId !== user\.id && \/\^#\\\/\(p\|v\|delivery\|looks\\\/edit\)\\\/\/\.test\(location\.hash\)\) history\.replaceState\(null, '', location\.pathname \+ location\.search \+ '#\/'\);/);
  assert.match(m, /lastUserId = user\.id \|\| lastUserId;/);
  assert.ok(m.indexOf('lastUserId !== user.id') < m.indexOf('lastUserId = user.id'), 'compare with the PREVIOUS account before remembering this one');
  assert.ok(m.indexOf('history.replaceState') < m.indexOf('window.ryagramLibrary.mount('), 'the address is fixed BEFORE the library mounts and reads it');
  // the signed-out note: cleared on EVERY showLibrary call (first mount, refresh, any sign-in path), not only inside the first-mount block
  const note = m.indexOf("if (status.textContent === 'You have signed out.') say('');");
  assert.ok(note > 0 && note < m.indexOf('if (!unmount)'), 'the note is cleared outside the first-mount block');
  assert.equal((auth.match(/sayOnce\('You have signed out\.'\)/g) || []).length, 1);          // the sign-out side is as it was (tests/consumer-basics.test.mjs pins it too)
});

test('WIRING: the stamps moved so a returning visitor gets the fix', () => {
  const html = read('app/index.html');
  for (const [f, v] of [['app-data.js', '20261027d'], ['app-library.js', '20261027c'], ['app-auth.js', '20261027a']]) assert.match(html, new RegExp(`${f.replace('.', '\\.')}\\?v=${v}`), f);        // (app-data moved again with the Windows download button)
});
