// Owner-only test credits on #/admin/tester (BUILDER 11-27; behind adminTestTopup, off; SQL 20261127000100, live step 78; supabase/tests/test_owner_test_topup.py holds the database half).
// The data layer names the three SQL functions with trimmed arguments, the mock mirrors their rules, and the page section is behind its switch, checks the form, shows the server's words and writes text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function loadAssets(file) { const window = {}; vm.runInNewContext(read(`assets/${file}`), { window }); return window; }
const ryagramData = loadAssets('app-data.js').ryagramData;
const plain = x => JSON.parse(JSON.stringify(x));

test('the data layer calls the three functions with the address and the note trimmed and the numbers as numbers', async () => {
  const calls = [];
  const real = createFakeClient();
  const data = ryagramData({ ...real, rpc: (name, args) => { calls.push([name, args]); return real.rpc(name, args); } });
  const id = await data.adminTestTopup('  Sam@Example.com ', '40', '  film tests ');
  assert.equal(id, 1);
  assert.deepEqual(plain(calls[0]), ['admin_test_topup', { p_email: 'Sam@Example.com', p_credits: 40, p_note: 'film tests' }]);
  const rows = plain(await data.adminTestTopupList());
  assert.deepEqual(rows.map(r => [r.id, r.user_email, r.credits, r.note, r.undone_at]), [[1, 'sam@example.com', 40, 'film tests', null]]);
  assert.equal(await data.adminTestTopupUndo('1', '  typed the wrong number '), 40);
  assert.deepEqual(plain(calls.at(-1)), ['admin_test_topup_undo', { p_topup_id: 1, p_note: 'typed the wrong number' }]);
  assert.equal(plain(await data.adminTestTopupList())[0].taken_back, 40);
});

test('the mock refuses what the database refuses: an address not on the list, the amount, the note, the day, a second undo, a non-admin', async () => {
  const data = ryagramData(createFakeClient());
  await assert.rejects(data.adminTestTopup('stranger@example.com', 10, 'testing'), /not on the owner test-account list, so nothing was given/);
  for (const n of [0, 101, 2.5]) await assert.rejects(data.adminTestTopup('sam@example.com', n, 'testing'), /1 to 100 credits/);
  await assert.rejects(data.adminTestTopup('sam@example.com', 10, 'ab'), /Say what the credits are for/);
  assert.deepEqual(plain(await data.adminTestTopupList()), [], 'a refusal gives nothing and writes nothing');
  await data.adminTestTopup('lee@example.com', 100, 'big test');
  await data.adminTestTopup('lee@example.com', 100, 'big test');
  await assert.rejects(data.adminTestTopup('lee@example.com', 1, 'one more'), /at most 200 a day/);
  await data.adminTestTopupUndo(1, 'not needed');
  await assert.rejects(data.adminTestTopupUndo(1, 'again'), /already undone/);
  await assert.rejects(data.adminTestTopupUndo(99, 'nothing'), /No test top-up with that number/);
  const notAdmin = ryagramData(createFakeClient({ admin: false }));
  await assert.rejects(notAdmin.adminTestTopup('sam@example.com', 10, 'testing'), /Only an admin/);
  await assert.rejects(notAdmin.adminTestTopupList(), /Only an admin/);
});

test('the page: the section is on the admin tester page, behind adminTestTopup (account, off for everyone), checks the form, uses only the three calls, and writes text only', () => {
  const src = read('assets/app-device.js');
  const part = src.slice(src.indexOf('// ---- Test credits (BUILDER 11-27'), src.indexOf("return [back, h('h1', { tabindex: '-1' }, 'Tester computers')"));
  assert.ok(part.length > 2500, 'the section is there');
  assert.match(part, /if \(window\.ryagramSwitches && window\.ryagramSwitches\.featureOn\('adminTestTopup'\) === true\) \{/);
  assert.deepEqual([...part.matchAll(/data\.(\w+)\(/g)].map(m => m[1]).sort(), ['adminTestTopup', 'adminTestTopupList', 'adminTestTopupUndo']);
  assert.match(part, /Number\.isInteger\(n\) && n >= 1 && n <= 100/);
  assert.match(part, /note\.length < 3 \|\| note\.length > 200/);
  assert.match(part, /busy\(give, 'Giving\\u2026'/);
  assert.match(part, /all of it was already spent, so nothing was taken back|All of it was already spent, so nothing was taken back/);
  assert.doesNotMatch(part, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(src, /history, connectSection, \.\.\.\(topupSection \? \[topupSection\] : \[\]\)\]/);
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /\n  adminTestTopup: 'account',\n/, 'on only for accounts named in the per-account switch list');
  assert.match(cfg, /Needs SQL 20261127000100 \(live step 78\)/);
});

test('the section never names a stranger or a number it was not given, and the words make no public promise', () => {
  const src = read('assets/app-device.js');
  const part = src.slice(src.indexOf('// ---- Test credits (BUILDER 11-27'), src.indexOf("return [back, h('h1', { tabindex: '-1' }, 'Tester computers')"));
  assert.match(part, /String\(r\.user_email \|\| 'an account'\)\.slice\(0, 120\)/);
  assert.match(part, /rows\.slice\(0, 100\)/);
  assert.doesNotMatch(part, /free|forever|unlimited|guarantee/i);
});
