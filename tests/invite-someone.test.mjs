// "Invite someone" on #/admin/ops: Ryan names a friend, the database makes a single-use code with welcome credits (SQL 20261017000200, tested in
// supabase/tests/test_invite_someone.py), the panel shows it ONCE with a mailto: link. The address never goes to the database.
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

test('INVITE SOMEONE: the mailto: link carries the code, the welcome credits when Ryan typed them, and the free-credits disclosure; the address stays in the link', () => {
  const link = O.inviteMailto({ name: 'Maya Ortiz', email: 'maya@example.com', code: 'RYA-K7M2-9QPX', credits: 35 });
  assert.match(link, /^mailto:maya%40example\.com\?subject=/);
  const body = decodeURIComponent(link.split('&body=')[1]);
  assert.match(body, /Your invite code is RYA-K7M2-9QPX\./);
  assert.match(body, /35 beta credits will be waiting/);
  assert.match(body, /Beta credits are free, in exchange for your feedback/);
});

test('INVITE SOMEONE: the panel form is in the Creator beta section, the email goes to the mailto only, and the code panel is the existing shown-once one', () => {
  const src = read('assets/app-library.js');
  assert.match(src, /h\('p', \{\}, O\.creatorLine\(cb\)\), invitePanel\(\), invitePersonForm\(\),/);
  const form = src.slice(src.indexOf('function invitePersonForm()'), src.indexOf('// --- the film request queue'));
  assert.match(form, /data\.adminInvitePerson\(name\.value, c\)/);
  assert.match(form, /type: 'email'/);
  assert.doesNotMatch(form.replace(/invited = \{[^}]*\};/, ''), /email\.value/);                          // the address is read only to build the mailto link
  assert.match(src, /\(shown once; copy it now\)/);
  const data = read('assets/app-data.js');
  assert.match(data, /adminInvitePerson\(name, credits\) \{ return run\(client\.rpc\('admin_invite_person', \{ p_name: name, p_credits: credits == null \? null : credits \}\)/);
});

test('INVITE SOMEONE: the SQL never takes or stores an address, and the retention rule is the one the privacy draft states', () => {
  const sql = read('supabase/migrations/20261017000200_invite_someone.sql');
  assert.match(sql, /create function public\.admin_invite_person\(p_name text, p_credits int default null\)/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /email/i);
  assert.match(sql, /like 'invite: %'/);
  assert.match(sql, /< now\(\) - interval '12 months'/);
});
