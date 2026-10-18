// #/admin/renders: the full renders waiting for Ryan's approval (PIPE-1: admin_render_queue, admin_render_decide). The database half (who may decide, the cap, the hold and the refund)
// is the PIPE session's supabase/tests/test_pipe1_orders.py; this is the page and its data layer against the mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['app-ops.js', 'app-data.js', 'app-jobs.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout });
const O = win.ryagramOps;
const plain = x => JSON.parse(JSON.stringify(x));

function world(seed = {}) {
  const client = createFakeClient({ autoRender: false, ...seed });
  client.db.projects.push({ id: 'p1', title: 'Obesity film' }, { id: 'p2', title: 'Housing film' });
  for (const [v, p, n] of [['v1', 'p1', 1], ['v2', 'p2', 1]]) {
    client.db.versions.push({ id: v, project_id: p, number: n, state: 'draft', story_spec: { schema: 1, engine: 'sequence' }, story_sha256: `sha-${v}` });
    client.db.jobs.push({ id: `sheet-${v}`, version_id: v, job_type: 'contact_sheet', state: 'complete', story_sha256: `sha-${v}`, engine_commit: 'abc1234' },
                        { id: `prev-${v}`, version_id: v, job_type: 'preview', state: 'complete', story_sha256: `sha-${v}`, engine_commit: 'abc1234' });
  }
  return { client, data: win.ryagramData(client) };
}

test('QUEUE: the waiting full renders are listed oldest first with the film, who, the credits held and when it expires', async () => {
  const { data, client } = world();
  await data.requestFinalRender('prev-v1', 'app-key-0000001');
  await data.requestFinalRender('prev-v2', 'app-key-0000002');
  const rows = await data.adminRenderQueue();
  assert.deepEqual(plain(rows.map(r => r.film_title)), ['Obesity film', 'Housing film']);
  const r = rows[0];
  assert.deepEqual(plain([r.owner_email, r.credits_held, r.source]), ['creator@example.com', 10, 'app']);
  assert.ok(Date.parse(r.expires_at) > Date.parse(r.requested_at));
  assert.match(O.renderQueueLine(rows), /2 full renders waiting for your approval, oldest first\. Approving starts the render; declining returns the person.s credits\./);
  assert.equal(O.renderQueueLine([]), 'No full renders are waiting for approval.');
  assert.equal(O.RENDER_SOURCE_WORDS.connect, 'from a connected AI');
  assert.ok(client.log.some(l => l.rpc === 'admin_render_queue'));
});

test('DECIDE: approve starts the render and the request leaves the queue; decline returns the credits and it leaves too; a decided request cannot be decided again', async () => {
  const { data, client } = world();
  await data.requestFinalRender('prev-v1', 'app-key-0000001');
  await data.requestFinalRender('prev-v2', 'app-key-0000002');
  const [first, second] = await data.adminRenderQueue();
  await data.adminRenderDecide(first.stage_id, true, 'ok');
  assert.equal(client.db.render_orders[0].state, 'running');
  assert.deepEqual(plain((await data.adminRenderQueue()).map(r => r.film_title)), ['Housing film']);               // a decided request disappears
  await data.adminRenderDecide(second.stage_id, false, 'not this one');
  assert.equal(client.db.render_orders[1].state, 'declined');
  assert.equal(client.db.render_orders[1].admin_note, 'not this one');
  assert.deepEqual(plain(await data.adminRenderQueue()), []);
  await assert.rejects(data.adminRenderDecide(first.stage_id, false), /no longer waiting \(running\)/);
  await assert.rejects(data.adminRenderDecide('f0000000-0000-4000-8000-000000000999', true), /Request not found/);
  const call = client.log.filter(l => l.rpc === 'admin_render_decide').map(l => l.args)[0];
  assert.deepEqual(plain(call), { p_stage: first.stage_id, p_approve: true, p_note: 'ok' });
});

test('NOT AN ADMIN: the database refuses the queue and every decision (the page also never routes a non-admin here), and the daily cap sentence reaches Ryan unchanged', async () => {
  const { data } = world({ nonAdmin: true });
  await data.requestFinalRender('prev-v1', 'app-key-0000001');
  await assert.rejects(data.adminRenderQueue(), /Only an admin can do this/);
  await assert.rejects(data.adminRenderDecide('f0000000-0000-4000-8000-000000000001', true), /Only an admin can do this/);
  const capped = world({ capReached: true });
  await capped.data.requestFinalRender('prev-v1', 'app-key-0000001');
  const [row] = await capped.data.adminRenderQueue();
  await assert.rejects(capped.data.adminRenderDecide(row.stage_id, true), /daily_cap: this person has reached their daily credit cap; approve later or decline\./);
  assert.equal((await capped.data.adminRenderQueue()).length, 1, 'a refused approval leaves it waiting');
  await capped.data.adminRenderDecide(row.stage_id, false);                                                          // declining is still possible at the cap
  assert.equal((await capped.data.adminRenderQueue()).length, 0);
});

test('WORDS: when it was asked and when it expires, in plain hours or days', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.match(O.renderWhen({ requested_at: '2026-10-17T10:00:00Z', expires_at: '2026-10-24T10:00:00Z' }, now), /^Asked 2 hours ago\. Expires in 7 days if nobody decides\.$/);
  assert.match(O.renderWhen({ requested_at: '2026-10-17T11:30:00Z', expires_at: '2026-10-17T20:00:00Z' }, now), /Expires in 8 hours/);
  assert.match(O.renderWhen({ requested_at: '2026-10-10T11:30:00Z', expires_at: '2026-10-17T11:00:00Z' }, now), /has expired and will be cancelled and returned/);
});

test('PAGE SOURCE: admin only and behind renderOrders; Approve and Decline (with a confirm and an optional note) call the one decide function and redraw only after it returns; errors are shown', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /ordersOn\(\) && hash === '#\/admin\/renders' && await data\.isAppAdmin\(\)\) view = await rendersAdminView\(onStop\)/);
  assert.match(lib, /\.\.\.\(ordersOn\(\) \? \[' \\u00b7 ', h\('a', \{ href: '#\/admin\/renders' \}, 'Render approvals'\)\] : \[\]\)/);
  const view = lib.slice(lib.indexOf('async function rendersAdminView'), lib.indexOf('async function opsAdminView'));
  assert.equal([...view.matchAll(/data\.adminRenderDecide\(/g)].length, 1);
  assert.match(view, /try \{ await data\.adminRenderDecide\(r\.stage_id, approve, n\.value\.trim\(\)\); await load\(\); \} catch \(err\) \{ showError\(error, err\); \}/);
  assert.match(view, /if \(!approve && !confirm\(`Decline this full render\?/);
  assert.match(view, /placeholder: 'Note \(optional\)'/);
  assert.doesNotMatch(view, /innerHTML|\.from\('render_|insert\(|update\(/);                                       // only the two functions, never a table
  assert.match(read('assets/app-data.js'), /adminRenderDecide\(stage, approve, note\) \{ return run\(client\.rpc\('admin_render_decide', \{ p_stage: stage, p_approve: approve === true, p_note: note \? String\(note\)\.slice\(0, 500\) : null \}\)/);
});
