// The admin-only tester switch (assets/app-device.js testerAdminView, NEXT-WEB 114; DRAFT against a MOCK; behind desktopApp, off). An admin turns an account's tester flag on or off with a reason;
// every change is written to an audit row (who, when, old, new, why). The server is the gate: a non-admin and the account owner are refused whatever the page does; the form's own pre-check is a courtesy.
// The real function is WORKER's admin_set_local_compute(p_user uuid, ...) in r9-node-draft; the email variant and the audit read used here are PROPOSED names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['app-device.js', 'app-data.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, URL, setTimeout, clearTimeout, setInterval, clearInterval });
const D = win.ryagramDevice;
const plain = x => JSON.parse(JSON.stringify(x));
const NOT_ADMIN = { admin: false };

test('FORM PRE-CHECK: an email and a reason of 3 to 300 characters; everything else is said in words (a courtesy: the server checks again)', () => {
  assert.equal(D.checkTesterForm('sam@example.com', 'Sam tests r9'), null);
  assert.match(D.checkTesterForm('', 'Sam tests r9'), /Type the account email/);
  assert.match(D.checkTesterForm('not an email', 'Sam tests r9'), /Type the account email/);
  assert.match(D.checkTesterForm('sam@example.com', ''), /Say why/);
  assert.match(D.checkTesterForm('sam@example.com', 'ab'), /Say why/);
  assert.match(D.checkTesterForm('sam@example.com', 'x'.repeat(301)), /under 301 characters/);
  assert.equal(D.checkTesterForm('sam@example.com', 'x'.repeat(300)), null);
  assert.equal(D.REASON_MIN, 3);
  assert.equal(D.REASON_MAX, 300);
});

test('AUDIT: every change writes a row with who, when, old, new and why; the history lists newest first', async () => {
  const data = win.ryagramData(createFakeClient());
  assert.deepEqual(plain(await data.adminLocalComputeAudit()), []);
  assert.equal(await data.adminSetLocalCompute('sam@example.com', true, 'Sam tests r9'), true);
  assert.equal(await data.adminSetLocalCompute('sam@example.com', false, 'Done testing'), false);
  const rows = plain(await data.adminLocalComputeAudit());
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].was_on, rows[0].turned_on, rows[0].reason], [true, false, 'Done testing']);        // newest first
  assert.deepEqual([rows[1].was_on, rows[1].turned_on, rows[1].reason], [false, true, 'Sam tests r9']);
  for (const r of rows) { assert.equal(r.user_email, 'sam@example.com'); assert.ok(r.set_by_email && r.at, 'who and when'); }
});

test('MUST-FAIL: a non-admin and the account owner are refused by the server, for the change and for the history; nothing is recorded', async () => {
  const owner = win.ryagramData(createFakeClient(NOT_ADMIN));                                                  // the tester's own account, or anyone who is not an admin
  await assert.rejects(owner.adminSetLocalCompute('sam@example.com', true, 'let me in'), /Admins only/);
  await assert.rejects(owner.adminLocalComputeAudit(), /Admins only/);
  assert.equal(await owner.isAppAdmin(), false, 'the page gate reads the same answer');
  const asAdmin = win.ryagramData(createFakeClient());
  assert.deepEqual(plain(await asAdmin.adminLocalComputeAudit()), []);
});

test('MUST-FAIL: the server refuses what the form would also refuse, so the pre-check is not the gate (no reason, a short reason, an unknown account, a worker account)', async () => {
  const data = win.ryagramData(createFakeClient());
  await assert.rejects(data.adminSetLocalCompute('sam@example.com', true, ''), /Say why/);
  await assert.rejects(data.adminSetLocalCompute('sam@example.com', true, 'ab'), /Say why/);
  await assert.rejects(data.adminSetLocalCompute('nobody@example.com', true, 'Sam tests r9'), /No such account/);
  await assert.rejects(data.adminSetLocalCompute('worker@example.com', true, 'Sam tests r9'), /worker account is not a person/);
  assert.deepEqual(plain(await data.adminLocalComputeAudit()), [], 'a refused change writes no row');
});

test('PAGE SOURCE: the route needs the flag AND an admin answer, the link needs the flag, the change is made only inside the button handler, the form pre-checks first, and everything goes in as text', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /else if \(desktopOn\(\) && hash === '#\/admin\/tester' && await data\.isAppAdmin\(\)\) view = await deviceUi\(\)\.testerAdminView\(\);/);
  assert.match(lib, /\.\.\.\(desktopOn\(\) \? \[' \\u00b7 ', h\('a', \{ href: '#\/admin\/tester' \}, 'Tester computers'\)\] : \[\]\)/);
  const src = read('assets/app-device.js');
  const view = src.slice(src.indexOf('async function testerAdminView'), src.indexOf('return { deviceView, computersSection, testerAdminView }'));
  assert.equal([...view.matchAll(/data\.adminSetLocalCompute\(/g)].length, 1);
  assert.match(view, /const change = async \(button, on\) => \{[\s\S]*checkTesterForm\(email\.value, reason\.value\)[\s\S]*data\.adminSetLocalCompute\(email\.value, on, reason\.value\)[\s\S]*\};\s*const onBtn/);
  assert.match(view, /'Turn on'/);
  assert.match(view, /'Turn off'/);
  assert.match(view, /'Why: ', String\(r\.reason \|\| ''\)\.slice\(0, REASON_MAX\)/);                          // the reason is shown as text
  const code = src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|\bstyle:|setAttribute\('style'|localStorage|sessionStorage|document\.cookie|access_token|refresh_token|fetch\(/);
  assert.match(read('assets/ryagram-config.js'), /desktopApp: false,/);                                           // still off
});
