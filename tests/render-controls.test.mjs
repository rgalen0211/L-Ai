// #/admin/renders follow-up (queue item 3): the auto-render switch and the per-person daily caps. They call ONLY the existing admin functions
// (admin_set_auto_render, admin_user_caps, admin_set_user_cap, admin_ops for the current setting); no database change is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
for (const f of ['app-ops.js', 'app-data.js', 'app-jobs.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout });
const O = win.ryagramOps;
const plain = x => JSON.parse(JSON.stringify(x));
const world = (seed = {}) => { const client = createFakeClient(seed); return { client, data: win.ryagramData(client) }; };

test('SWITCH: the current setting is read from admin_ops, flipped with admin_set_auto_render, and read back; wording says what each state means', async () => {
  const { data, client } = world({ autoRender: false });
  assert.deepEqual(plain(await data.adminAutoRender()), { on: false, defaultCap: 20 });
  assert.match(O.autoRenderLine(false), /OFF: every full render waits here for your approval, with the credits held/);
  assert.match(O.autoRenderLine(true), /ON: full renders start at once, with no approval/);
  await data.adminSetAutoRender(true);
  assert.equal((await data.adminAutoRender()).on, true);
  await data.adminSetAutoRender(false);
  assert.equal((await data.adminAutoRender()).on, false);
  assert.deepEqual(plain(client.log.filter(l => l.rpc === 'admin_set_auto_render').map(l => l.args)), [{ p_on: true }, { p_on: false }]);
});

test('SWITCH: it really changes what a render request does (off holds it for approval, on starts it)', async () => {
  const { data, client } = world({ autoRender: false });
  client.db.projects.push({ id: 'p1', title: 'F' });
  client.db.versions.push({ id: 'v1', project_id: 'p1', number: 1, state: 'draft', story_spec: { schema: 1, engine: 'sequence' }, story_sha256: 's' });
  client.db.jobs.push({ id: 'sh', version_id: 'v1', job_type: 'contact_sheet', state: 'complete', story_sha256: 's', engine_commit: 'abc1234' },
                      { id: 'pv', version_id: 'v1', job_type: 'preview', state: 'complete', story_sha256: 's', engine_commit: 'abc1234' },
                      { id: 'pv2', version_id: 'v1', job_type: 'preview', state: 'complete', story_sha256: 's', engine_commit: 'abc1234' });
  await data.requestFinalRender('pv', 'app-key-0000001');
  assert.equal(client.db.render_orders[0].state, 'awaiting_approval');
  assert.equal((await data.adminRenderQueue()).length, 1);
  await data.adminSetAutoRender(true);
  await data.requestFinalRender('pv2', 'app-key-0000002');
  assert.notEqual(client.db.render_orders[1].state, 'awaiting_approval');
});

test('CAPS: the list, set for a person, change, and reset to the default (null) all go through the two caps functions', async () => {
  const { data, client } = world();
  assert.deepEqual(plain((await data.adminUserCaps()).map(c => [c.email, c.credits_per_day, c.used_last_24h])), [['sam@example.com', 30, 12]]);
  await data.adminSetUserCap('u-ryan', 5);
  assert.deepEqual(plain((await data.adminUserCaps()).map(c => [c.email, c.credits_per_day])), [['sam@example.com', 30], ['creator@example.com', 5]]);
  await data.adminSetUserCap('u-ryan', 0);
  assert.equal((await data.adminUserCaps()).find(c => c.owner_id === 'u-ryan').credits_per_day, 0);
  await data.adminSetUserCap('u-ryan', null);
  assert.equal((await data.adminUserCaps()).some(c => c.owner_id === 'u-ryan'), false, 'empty puts the person back on the default');
  assert.deepEqual(plain(client.log.filter(l => l.rpc === 'admin_set_user_cap').map(l => l.args)),
    [{ p_owner: 'u-ryan', p_credits_per_day: 5 }, { p_owner: 'u-ryan', p_credits_per_day: 0 }, { p_owner: 'u-ryan', p_credits_per_day: null }]);
});

test('CAPS: what is typed is checked in words before sending, and a non-admin is refused by the database', async () => {
  assert.deepEqual(plain(O.checkCap('')), { value: null });
  assert.deepEqual(plain(O.checkCap(' 25 ')), { value: 25 });
  assert.deepEqual(plain(O.checkCap('0')), { value: 0 });
  for (const bad of ['-1', '2.5', 'ten', '1e3', '9999999']) assert.match(O.checkCap(bad).error, /whole number of credits a day, 0 or more/, bad);
  assert.equal(O.capLine({ email: 'a@b.co', credits_per_day: 1, used_last_24h: 0 }), 'a@b.co: 0 of 1 credit used in the last 24 hours');
  const { data } = world({ nonAdmin: true });
  await assert.rejects(data.adminSetAutoRender(true), /Only an admin/);
  await assert.rejects(data.adminUserCaps(), /Only an admin/);
  await assert.rejects(data.adminSetUserCap('u-x', 1), /Only an admin/);
});

test('PAGE: the switch, the caps list and a per-request cap are wired on #/admin/renders; only existing functions are named; turning ON asks first; no null children', () => {
  const lib = read('assets/app-library.js');
  const view = lib.slice(lib.indexOf('async function rendersAdminView'), lib.indexOf('async function opsAdminView'));
  assert.match(view, /id: 'auto-render-toggle'/);
  assert.match(view, /if \(turningOn && !confirm\(/);
  assert.match(view, /data\.adminSetAutoRender\(turningOn\)/);
  assert.match(view, /data\.adminUserCaps\(\)/);
  assert.match(view, /data\.adminSetUserCap\(/);
  assert.match(view, /r\.owner_id \? capRow\(r\) : null/);
  assert.doesNotMatch(view, /replaceChildren\([^;]*\? [^;]*: null\)/, 'a null passed to replaceChildren prints the word null');
  assert.doesNotMatch(view, /replaceChildren\([^;]*\? null :/, 'neither does the other way round: ? null : x'); 
  assert.match(view, /s\.defaultCap == null \? '' : h\(/);
  assert.ok(view.includes('Set one from a waiting request above.') && !view.includes('waiting request below'));
  assert.ok(view.includes('Requests already waiting stay waiting and still need your decision.'));
  assert.match(view, /if \(!input\.value\.trim\(\)\) \{ showError\(error, new Error\('Type how many credits a day first\.'\)\); return; \}/);
  const dataSrc = read('assets/app-data.js');
  const rpcs = [...dataSrc.matchAll(/rpc\('(admin_[a-z_]+)'/g)].map(m => m[1]);
  const sql = read('supabase/migrations/20261017000600_pipe1_orders.sql');
  for (const name of ['admin_set_auto_render', 'admin_user_caps', 'admin_set_user_cap']) {
    assert.ok(rpcs.includes(name), name);
    assert.ok(sql.includes(`create function public.${name}(`), `${name} exists in the PIPE-1 migration`);
  }
});
