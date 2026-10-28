// The Connect-an-AI switch on #/admin/tester (NEXT-WEB 157): the data layer names the three SQL functions (supabase/tests/test_connect.py holds the database half), the mock mirrors their rules,
// and the page puts the section beside tester mode and shows nothing it is not told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function loadAssets(file) { const window = {}; vm.runInNewContext(read(`assets/${file}`), { window }); return window; }
const ryagramData = loadAssets('app-data.js').ryagramData;
const plain = x => JSON.parse(JSON.stringify(x));

test('the data layer calls the three functions with the email, the switch and the reason, trimmed', async () => {
  const calls = [];
  const real = createFakeClient();
  const data = ryagramData({ ...real, rpc: (name, args) => { calls.push([name, args]); return real.rpc(name, args); } });
  assert.equal(await data.adminSetConnectAccess('  nobody@example.com ', true, '  Testing with Maria '), true);
  assert.deepEqual(plain(calls[0]), ['admin_connect_access_set', { p_email: 'nobody@example.com', p_on: true, p_reason: 'Testing with Maria' }]);
  const now = plain(await data.adminConnectAccessList());
  assert.deepEqual(now.map(r => r.user_email), ['maya@example.com', 'nobody@example.com', 'sam@example.com']);
  const hist = plain(await data.adminConnectAccessAudit());
  assert.equal(hist.length, 1); assert.equal(hist[0].was_on, false); assert.equal(hist[0].turned_on, true); assert.equal(hist[0].reason, 'Testing with Maria');
  await data.adminSetConnectAccess('maya@example.com', false, 'She asked to stop');
  assert.ok(!plain(await data.adminConnectAccessList()).some(r => r.user_email === 'maya@example.com'));
  assert.equal(plain(await data.adminConnectAccessAudit())[0].reason, 'She asked to stop');                    // newest first
});

test('the mock refuses what the database refuses: no reason, an administrator, a worker, an unknown account, a non-admin', async () => {
  const data = ryagramData(createFakeClient());
  await assert.rejects(data.adminSetConnectAccess('sam@example.com', true, 'ab'), /Say why/);
  await assert.rejects(data.adminSetConnectAccess('ryan@example.com', true, 'testing'), /Administrator accounts cannot be connected/);
  await assert.rejects(data.adminSetConnectAccess('worker@example.com', true, 'testing'), /worker account is not a person/);
  await assert.rejects(data.adminSetConnectAccess('nobody-at-all@example.com', true, 'testing'), /No account with that email/);
  assert.deepEqual(plain(await data.adminConnectAccessAudit()), []);                                          // a refusal leaves no history
  const plainAccount = ryagramData(createFakeClient({ admin: false }));
  await assert.rejects(plainAccount.adminSetConnectAccess('sam@example.com', true, 'testing'), /Admins only/);
  await assert.rejects(plainAccount.adminConnectAccessList(), /Admins only/);
});

test('the page: the section sits on the admin tester page beside tester mode, uses only the three data calls, asks for a reason, and writes names as text', () => {
  const src = read('assets/app-device.js');
  const part = src.slice(src.indexOf('// ---- Connect an AI (NEXT-WEB 157)'), src.indexOf("return [back, h('h1', { tabindex: '-1' }, 'Tester computers')"));
  assert.ok(part.length > 1500);
  assert.match(part, /data\.adminConnectAccessList\(\), data\.adminConnectAccessAudit\(\)/);
  assert.match(part, /data\.adminSetConnectAccess\(cEmail\.value, on, cReason\.value\)/);
  assert.match(part, /checkTesterForm\(cEmail\.value, cReason\.value\)/);
  assert.doesNotMatch(part, /innerHTML|insertAdjacentHTML/);
  assert.match(src, /h\('h2', \{\}, 'History'\), history, connectSection\]/);
  assert.match(src, /hash === '#\/admin\/tester'|testerAdminView/);
});

test('the SQL: admin only, an app session only, a reason, no administrator or worker, off revokes the tokens, the history table is closed, and the old function is untouched', () => {
  const sql = read('supabase/migrations/20261027000900_connect_access_admin.sql');
  const code = sql.replace(/--.*$/gm, '');
  assert.match(code, /perform ryagram_private\.connect_app_session\(\)/);
  assert.match(code, /me := ryagram_private\.require_admin\(\)/);
  assert.match(code, /not between 3 and 300/);
  assert.match(code, /public\.app_admins/); assert.match(code, /public\.workers/);
  assert.match(code, /update public\.connect_tokens set revoked_at = now\(\)/);
  assert.match(code, /revoke all on public\.connect_access_audit from public, anon, authenticated, service_role/);
  assert.doesNotMatch(code, /admin_set_connect_access/);
  assert.doesNotMatch(read('supabase/migrations/20261018000100_connect_ai.sql').replace(/--.*$/gm, ''), /connect_access_audit/);
});
