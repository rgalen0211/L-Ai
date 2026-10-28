// "Invite someone" on #/admin/ops: Ryan names a friend, the database makes a single-use code with welcome credits (SQL 20261017000200, tested in
// supabase/tests/test_invite_someone.py), the panel shows it ONCE. Ryagram sends the email itself (NEXT-WEB 155; send-invite, tests/send-invite.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function loadAssets(file) { const window = {}; vm.runInNewContext(read(`assets/${file}`), { window }); return window; }
const O = loadAssets('app-ops.js').ryagramOps;
const ryagramData = loadAssets('app-data.js').ryagramData;

test('INVITE SOMEONE: the data layer asks only for a name and credits, and the code comes back once', async () => {
  const calls = [];
  const real = createFakeClient();
  const client = { ...real, rpc: (name, args) => { calls.push([name, args]); return real.rpc(name, args); } };
  const data = ryagramData(client);
  const code = await data.adminInvitePerson('Maya Ortiz', null);
  assert.match(code, /^RYA-[A-Z0-9]{4,}-[A-Z0-9]{4}$/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['admin_invite_person', { p_name: 'Maya Ortiz', p_credits: null }]);          // no email, nothing else
  assert.notEqual(await data.adminInvitePerson('Sam Lee', 35), code);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), { p_name: 'Sam Lee', p_credits: 35 });
  await assert.rejects(data.adminInvitePerson('   ', null), /name/);
  await assert.rejects(data.adminInvitePerson('Maya', 1001), /0 to 1,000/);
});

test('INVITE SOMEONE: Ryagram sends the email: the data layer asks send-invite for the code and the address, and says SENT only when mail went out', async () => {
  const client = createFakeClient();
  const data = ryagramData(client);
  const code = await data.adminInvitePerson('Maya Ortiz', null);
  const res = await data.sendInvite(code, 'Maya@Example.com');
  assert.equal(res.status, 'sent'); assert.equal(res.to, 'maya@example.com'); assert.equal(res.sends, 1);
  assert.match(O.inviteSendLine(res, 'maya@example.com'), /^Sent to maya@example\.com at /);
  assert.match(O.inviteSendLine({ ...res, sends: 2 }, 'maya@example.com'), /\(send 2 of 3\)/);
  const saved = O.inviteSendLine({ status: 'saved', to: 'maya@example.com', at: res.at }, 'maya@example.com');
  assert.match(saved, /^Not sent: mail is not switched on yet/); assert.doesNotMatch(saved, /^Sent/);
  assert.match(O.inviteSendLine(null, 'maya@example.com'), /^Not sent to maya@example\.com/);
  await assert.rejects(data.sendInvite(code, 'stranger@example.com'), /made for another address/);       // the mock mirrors the database's binding
  await assert.rejects(data.sendInvite(code, 'not an address'), /one email address/);
  await data.sendInvite(code, 'maya@example.com'); await data.sendInvite(code, 'maya@example.com');
  await assert.rejects(data.sendInvite(code, 'maya@example.com'), /3 times/);
});

test('INVITE SOMEONE: the panel form sends the invite in one press, the card says what happened, and the address goes only to send-invite', () => {
  const src = read('assets/app-library.js');
  assert.match(src, /h\('p', \{\}, O\.creatorLine\(cb\)\), invitePanel\(\), invitePersonForm\(\),/);
  const form = src.slice(src.indexOf('function invitePersonForm()'), src.indexOf('// --- the film request queue'));
  assert.match(form, /data\.adminInvitePerson\(name\.value, c\)/);
  assert.match(form, /data\.sendInvite\(code, invited\.email\)/);
  assert.match(form, /type: 'email'/);
  assert.match(form, /'Send the invite'/);
  assert.doesNotMatch(src, /mailto:/);                                                                    // no mail program is opened any more
  assert.match(src, /\(shown once; copy it now\)/);
  assert.match(src, /'Copy code'/);                                                                       // the fallback stays
  assert.match(src, /data-key': 'invite-resend'/);
  assert.match(src, /After they sign up, turn on Connect an AI/);                                         // the two switches need an account, which exists only after sign-up (NEXT-WEB 157)
  const data = read('assets/app-data.js');
  assert.match(data, /functions\.invoke\('send-invite', \{ body: \{ code, email \} \}\)/);
  assert.match(data, /adminInvitePerson\(name, credits\) \{ return run\(client\.rpc\('admin_invite_person', \{ p_name: name, p_credits: credits == null \? null : credits \}\)/);
});

test('INVITE SOMEONE: the SQL never takes or stores an address, and the retention rule is the one the privacy draft states', () => {
  const sql = read('supabase/migrations/20261017000200_invite_someone.sql');
  assert.match(sql, /create function public\.admin_invite_person\(p_name text, p_credits int default null\)/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /email/i);
  assert.match(sql, /like 'invite: %'/);
  assert.match(sql, /< now\(\) - interval '12 months'/);
});
