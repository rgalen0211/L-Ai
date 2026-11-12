// NEXT-WEB 187: each tester's computers on #/admin/tester (behind adminTesterDevices, off; needs SQL 20261031000100_admin_tester_devices.sql). The rows come from admin_tester_devices(); the page turns them into
// words and says plainly what the database does NOT know (whether a computer can render, whether it paused under its disk floor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/app-device.js'), { window: win, setTimeout, clearTimeout });
const D = win.ryagramDevice, J = x => JSON.parse(JSON.stringify(x));
const NOW = Date.parse('2026-10-31T12:00:00Z'), ago = s => new Date(NOW - s * 1000).toISOString(), ahead = d => new Date(NOW + d * 86400000).toISOString();
const row = (email, name, usedSecs, extra = {}) => ({ user_email: email, computer_name: name, created_at: ago(5 * 86400), expires_at: ahead(20), last_used_at: usedSecs === null ? null : ago(usedSecs), waiting_films: 0, running_films: 0, ...extra });

test('one entry per tester, its computers in the order given, and a status for the tester as a whole', () => {
  const out = J(D.deviceRows([row('sam@x', 'PC-1', 20, { waiting_films: 1, running_films: 1 }), row('sam@x', 'PC-2', 2 * 86400, { waiting_films: 1 }), row('pat@x', 'LAPTOP', 50 * 3600),
    { user_email: 'lee@x', computer_name: null, created_at: null, expires_at: null, last_used_at: null, waiting_films: 2, running_films: 0 }], NOW));
  assert.deepEqual(out.map(t => [t.email, t.status, t.computers.length, t.waiting]), [['sam@x', 'seen', 2, 1], ['pat@x', 'quiet', 1, 0], ['lee@x', 'none', 0, 2]]);
  assert.deepEqual(out[0].computers.map(c => [c.name, c.state, c.holds]), [['PC-1', 'seen', 1], ['PC-2', 'quiet', 0]]);
});

test('seen means used in the last three minutes; the edge, a never-used computer and unreadable dates', () => {
  const s = (secs, extra) => J(D.deviceRows([row('a@x', 'C', secs, extra)], NOW))[0].computers[0];
  assert.equal(s(179).state, 'seen'); assert.equal(s(181).state, 'quiet'); assert.equal(D.SEEN_MS, 180000);
  assert.equal(s(null).state, 'quiet'); assert.equal(s(null).last, 'not seen yet');
  assert.equal(s(10, { last_used_at: 'garbage' }).state, 'quiet'); assert.equal(s(10, { expires_at: 'garbage' }).signedInUntil, '');
});

test('the words: a computer line says when it was seen, what it holds and when its sign-in ends; the note says what is NOT reported', () => {
  const c = J(D.deviceRows([row('a@x', 'PC-1', 20, { running_films: 2 })], NOW))[0].computers[0];
  assert.match(D.deviceLine(c), /^PC-1: seen in the last 3 minutes; holding 2 films now; its sign-in ends /);
  const q = J(D.deviceRows([row('a@x', 'PC-2', 2 * 86400)], NOW))[0].computers[0];
  assert.match(D.deviceLine(q), /^PC-2: not seen for a while \(last 2 days ago\); its sign-in ends /); assert.doesNotMatch(D.deviceLine(q), /holding/);
  assert.equal(D.deviceLine({ ...q, holds: 1 }).includes('holding 1 film now'), true);
  assert.match(D.deviceNote, /can render/); assert.match(D.deviceNote, /disk floor/); assert.match(D.deviceNote, /not reported/);
});

test('anything that is not a row is ignored and nothing throws; an email is cut to length', () => {
  assert.deepEqual(J(D.deviceRows(null, NOW)), []); assert.deepEqual(J(D.deviceRows([null, 5, {}, { user_email: 7 }], NOW)), []);
  assert.equal(D.deviceRows([row('x'.repeat(300) + '@x', 'C', 10)], NOW)[0].email.length, 120);
});

test('wiring: behind adminTesterDevices (off), one read through the admin function, the SQL is a new admin-only read-only function with its rollback and after-check', () => {
  assert.match(read('assets/ryagram-config.js'), /\n  adminTesterDevices: 'account',/);
  assert.match(read('assets/app-data.js'), /adminTesterDevices\(\) \{ return run\(client\.rpc\('admin_tester_devices'\)/);
  assert.match(read('assets/app-device.js'), /window\.ryagramSwitches\.featureOn\('adminTesterDevices'\) === true/);
  const sql = read('supabase/migrations/20261031000100_admin_tester_devices.sql');
  assert.match(sql, /ryagram_private\.require_admin\(\)/); assert.match(sql, /language plpgsql stable security definer set search_path = ''/);
  assert.match(sql, /revoke execute on function public\.admin_tester_devices\(\) from public, anon, node_runner;/); assert.match(sql, /grant execute on function public\.admin_tester_devices\(\) to authenticated;/);
  assert.ok(!/\b(insert|update|delete)\b\s+(into|from)?\s*public\./i.test(sql.replace(/--.*$/gm, '')), 'the function writes nothing');
  assert.match(read('supabase/rollbacks/20261031000100_admin_tester_devices_rollback.sql'), /drop function if exists public\.admin_tester_devices\(\);/);
  assert.ok(fs.existsSync(new URL('../supabase/live-steps/17_admin_tester_devices_after_check.sql', import.meta.url)));
});
