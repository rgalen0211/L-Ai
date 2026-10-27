// POST /node/edit-pending and POST /node/edit-summary (NEXT-CONNECT 142): the desktop app's two calls for the live editor. The computer's token resolves the person; only that person's waiting changes
// come back (at most 100, five fields each); the app mirrors its track summary (names and times) for ITS person's projects only. Against the in-memory stand-in for the database; the SQL
// (supabase/tests/test_node_live_editor.py) is the authority for the rules behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleNode } from '../supabase/functions/node-core/router.ts';
import { FakeNodeWorld } from '../supabase/functions/node-core/fake.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const P = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUMMARY = { schema: 'ryagram.edit-tracks/0', duration: 9, clips: [{ id: 'v1', track: 'video', start: 0, len: 4, source: 'a.mp4', source_start: 0 }] };

function setup() {
  const world = new FakeNodeWorld();
  world.addUser(ALICE, 'alice@example.test', true);
  world.addUser(BOB, 'bob@example.test', true);
  world.editProjects.set(P(1), ALICE); world.editProjects.set(P(2), BOB);
  const deps = { db: world, storage: { signUpload: async () => { throw new Error('the live editor must never sign an upload'); } }, approvalBase: 'https://uselai.com/app', salt: 'salt', maxFileBytes: 1e6 };
  let n = 0;
  const call = async (method, route, { bearer, body } = {}) => {
    const h = { 'x-forwarded-for': `10.0.0.${++n % 250}` };
    if (bearer) h.authorization = `Bearer ${bearer}`;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await handleNode(new Request('https://x.test/functions/v1/node' + route, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), route, deps);
    let j = null; try { j = await res.clone().json(); } catch { /* not json */ }
    return { status: res.status, json: j };
  };
  const signIn = async (who) => {
    const c = await call('POST', '/device/code', { body: { computer_name: 'Sam-PC', app: 'ryagram-desktop' } });
    world.approve(c.json.user_code, who);
    const t = await call('POST', '/device/token', { body: { device_code: c.json.device_code } });
    return t.json.node_token;
  };
  return { world, call, signIn };
}
const queue = (world, owner, project, id, op = { op: 'delete_clip', id: 'v1' }, client = 'Claude') => world.editQueue.push({ owner, id, project_id: project, revision: 2, client, op });

test('edit-pending: a computer gets its own persons waiting changes, five fields each, and nobody elses', async () => {
  const { world, call, signIn } = setup();
  queue(world, ALICE, P(1), 11); queue(world, ALICE, P(1), 12, { op: 'move_clip', id: 't1', start: 5 }); queue(world, BOB, P(2), 13);
  const a = await signIn(ALICE), b = await signIn(BOB);
  const r = await call('POST', '/node/edit-pending', { bearer: a });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.changes.map((x) => x.id), [11, 12]);
  assert.ok(r.json.changes.every((x) => Object.keys(x).sort().join() === 'client,id,op,project_id,revision'));
  assert.deepEqual((await call('POST', '/node/edit-pending', { bearer: b })).json.changes.map((x) => x.id), [13]);               // control
});

test('edit-pending: at most a hundred come back, and a read changes nothing', async () => {
  const { world, call, signIn } = setup();
  for (let i = 1; i <= 130; i++) queue(world, ALICE, P(1), i);
  const a = await signIn(ALICE);
  assert.equal((await call('POST', '/node/edit-pending', { bearer: a })).json.changes.length, 100);
  assert.equal(world.editQueue.length, 130);
  assert.equal(world.editPosts.length, 0);
});

test('both routes need a computer token: none, junk, a Supabase-looking JWT or the wrong method is refused before the database', async () => {
  const { world, call, signIn } = setup();
  const a = await signIn(ALICE);
  const before = world.calls.length;
  for (const route of ['/node/edit-pending', '/node/edit-summary']) {
    for (const bearer of [undefined, 'junk', 'eyJhbGciOi.eyJzdWIi.sig']) assert.equal((await call('POST', route, { bearer, body: {} })).status, 401, route);
    assert.equal((await call('GET', route, { bearer: a })).status, 405, route);
  }
  assert.equal(world.calls.length, before, 'no database call was made for a refused request');
  assert.equal((await call('POST', '/node/edit-pending', { bearer: a })).status, 200);                                                // control
});

test('edit-summary: the app mirrors its summary for its own project and acknowledges changes; the database sees exactly what was sent', async () => {
  const { world, call, signIn } = setup();
  queue(world, ALICE, P(1), 11); queue(world, ALICE, P(1), 12);
  const a = await signIn(ALICE);
  const r = await call('POST', '/node/edit-summary', { bearer: a, body: { project_id: P(1), mirror: true, ai_visible: true, summary: SUMMARY, applied: [{ op_id: 11, ok: true }, { op_id: 12, ok: false }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['ai_visible', 'mirrored', 'revision']);
  assert.deepEqual(world.editPosts[0], { owner: ALICE, project_id: P(1), mirror: true, ai_visible: true, summary: SUMMARY, applied: [{ op_id: 11, ok: true }, { op_id: 12, ok: false }] });
  assert.equal(world.editQueue.length, 0);
});

test('edit-summary: another persons project looks absent (404) and nothing is recorded', async () => {
  const { world, call, signIn } = setup();
  const a = await signIn(ALICE);
  const r = await call('POST', '/node/edit-summary', { bearer: a, body: { project_id: P(2), mirror: true, summary: SUMMARY } });
  assert.equal(r.status, 404); assert.equal(r.json.error, 'not_found'); assert.match(r.json.message, /not found among your projects/);
  assert.equal(world.editPosts.length, 0);
});

test('edit-summary: stopping the mirror needs no summary and the tick cannot outlive it; wrong shapes are refused before the database', async () => {
  const { world, call, signIn } = setup();
  const a = await signIn(ALICE);
  const off = await call('POST', '/node/edit-summary', { bearer: a, body: { project_id: P(1), mirror: false, ai_visible: true } });
  assert.equal(off.status, 200); assert.equal(off.json.ai_visible, false); assert.equal(world.editPosts[0].summary, null);
  const work = () => world.calls.filter((c) => c !== 'hit').length;                 // the rate-limit counter is asked first, on purpose; only the live editor calls matter here
  const before = work();
  const bad = [{ mirror: true, summary: SUMMARY }, { project_id: 'nope', mirror: true, summary: SUMMARY }, { project_id: P(1), summary: SUMMARY }, { project_id: P(1), mirror: 'yes', summary: SUMMARY },
               { project_id: P(1), mirror: true }, { project_id: P(1), mirror: true, summary: [1] }, { project_id: P(1), mirror: true, summary: 'x' }, { project_id: P(1), mirror: true, summary: SUMMARY, ai_visible: 'yes' },
               { project_id: P(1), mirror: true, summary: SUMMARY, applied: 'all' }, { project_id: P(1), mirror: true, summary: SUMMARY, applied: [{ op_id: 0, ok: true }] },
               { project_id: P(1), mirror: true, summary: SUMMARY, applied: [{ op_id: 1.5, ok: true }] }, { project_id: P(1), mirror: true, summary: SUMMARY, applied: [{ op_id: 1, ok: 'yes' }] },
               { project_id: P(1), mirror: true, summary: SUMMARY, applied: [{ op_id: 1, ok: true, extra: 1 }] },
               { project_id: P(1), mirror: true, summary: SUMMARY, applied: Array.from({ length: 101 }, (_, i) => ({ op_id: i + 1, ok: true })) }];
  for (const body of bad) assert.equal((await call('POST', '/node/edit-summary', { bearer: a, body })).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal(work(), before, 'no live-editor call was made for a malformed request');
});

test('edit-summary: a summary the database refuses is a plain 400 and the database text is never sent on', async () => {
  const { world, call, signIn } = setup();
  const a = await signIn(ALICE);
  world.editPostSummary = async () => { throw Object.assign(new Error('A picture is a NAME, never a place on the computer. secret detail'), { code: '22023' }); };
  const r = await call('POST', '/node/edit-summary', { bearer: a, body: { project_id: P(1), mirror: true, summary: SUMMARY } });
  assert.equal(r.status, 400); assert.doesNotMatch(JSON.stringify(r.json), /secret detail/);
});

test('the live editor routes never sign an upload or start a job', async () => {
  const { world, call, signIn } = setup();
  const a = await signIn(ALICE);
  await call('POST', '/node/edit-pending', { bearer: a });
  await call('POST', '/node/edit-summary', { bearer: a, body: { project_id: P(1), mirror: true, summary: SUMMARY } });
  assert.deepEqual(world.calls.filter((c) => !['node_edit_pending', 'node_edit_post_summary', 'node_device_begin', 'node_device_exchange', 'node_hit'].includes(c) && !c.startsWith('device') && !c.startsWith('node_device') && c !== 'node_account' && c !== 'hit'), []);
});
