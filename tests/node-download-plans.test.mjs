// POST /node/download-plans and /node/download-update (NEXT-CONNECT 152): the desktop app reads the download plans its person's AI wrote and tells their state. The first is READ ONLY (the computer's token
// resolves the person, only that person's open plans come back, at most 5, three fields each); the second takes a state and, with 'done', a receipt. Against the in-memory stand-in for the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleNode } from '../supabase/functions/node-core/router.ts';
import { FakeNodeWorld } from '../supabase/functions/node-core/fake.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const PID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REQ = (n) => ({ schema: 'ryagram.download-plan/0', url: `https://www.census.gov/f${n}.csv`, why: 'for the map', folder: 'Census' });
const RECEIPT = { schema: 'ryagram.download-receipt/0', address_host: 'www.census.gov', final_host: 'www.census.gov', retrieved: '2026-10-27', bytes: 1234, sha256: 'a'.repeat(64), kind: 'text', members: 0, licence: 'not stated', trust_label: 'official' };

function setup() {
  const world = new FakeNodeWorld();
  world.addUser(ALICE, 'alice@example.test', true);
  world.addUser(BOB, 'bob@example.test', true);
  const deps = { db: world, storage: { signUpload: async () => { throw new Error('a plan must never sign an upload'); } }, approvalBase: 'https://uselai.com/app', salt: 'salt', maxFileBytes: 1e9 };
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
    assert.equal(t.status, 200);
    return t.json.node_token;
  };
  const add = (owner, n, state = 'waiting') => world.dlPlans.push({ owner, id: PID(n), request: REQ(n), state, receipt: null });
  return { world, call, signIn, add };
}

test('a computer gets its persons open plans, three fields each, and nobody elses; finished plans are not returned', async () => {
  const ctx = setup();
  const { call, signIn, add } = ctx;
  const sam = await signIn(ALICE), bob = await signIn(BOB);
  add(ALICE, 1); add(ALICE, 2, 'downloading'); add(ALICE, 3, 'done'); add(BOB, 4);
  const r = await call('POST', '/node/download-plans', { bearer: sam, body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.plans.map((p) => p.id), [PID(1), PID(2)]);
  assert.ok(r.json.plans.every((p) => Object.keys(p).sort().join() === 'id,request,state'));
  assert.deepEqual((await call('POST', '/node/download-plans', { bearer: bob, body: {} })).json.plans.map((p) => p.id), [PID(4)]);       // control: Bob gets his own
  for (let i = 10; i < 20; i++) add(ALICE, i);
  assert.equal((await call('POST', '/node/download-plans', { bearer: sam, body: {} })).json.plans.length, 5);
  const { world } = ctx;
  world.downloadPlans = async () => Array.from({ length: 12 }, (_, i) => ({ id: PID(100 + i), request: REQ(i), state: 'waiting', owner: ALICE }));          // a database that returned too many
  const r2 = await call('POST', '/node/download-plans', { bearer: sam, body: {} });
  assert.equal(r2.json.plans.length, 5, 'the function caps the list itself');
  assert.ok(r2.json.plans.every((p) => !('owner' in p)), 'and passes on only three fields');
});

test('reading plans starts nothing and the routes need a node token', async () => {
  const { world, call, signIn, add } = setup();
  const sam = await signIn(ALICE);
  add(ALICE, 1);
  const before = world.calls.length;
  await call('POST', '/node/download-plans', { bearer: sam, body: {} });
  assert.deepEqual(world.calls.slice(before).filter((c) => !/^node_download_plans$|^hit|account|actor/i.test(c)), []);
  for (const bearer of [undefined, 'junk', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig']) {
    assert.equal((await call('POST', '/node/download-plans', { bearer, body: {} })).status, 401, String(bearer));
    assert.equal((await call('POST', '/node/download-update', { bearer, body: { id: PID(1), state: 'downloading' } })).status, 401, String(bearer));
  }
});

test('the app tells the state; a receipt comes only with done; another persons plan is not found', async () => {
  const { world, call, signIn, add } = setup();
  const sam = await signIn(ALICE), bob = await signIn(BOB);
  add(ALICE, 1);
  const up = (bearer, body) => call('POST', '/node/download-update', { bearer, body });
  assert.equal((await up(sam, { id: PID(1), state: 'downloading' })).json.state, 'downloading');
  assert.equal((await up(bob, { id: PID(1), state: 'cancelled' })).status, 404);                          // Bob cannot touch Alice's plan
  assert.equal(world.dlPlans[0].state, 'downloading');
  assert.equal((await up(sam, { id: PID(1), state: 'done', receipt: RECEIPT })).json.state, 'done');
  assert.equal(world.dlPlans[0].receipt.sha256, 'a'.repeat(64));
});

test('MUST-FAIL: a bad update is refused before the database and changes nothing', async () => {
  const { world, call, signIn, add } = setup();
  const sam = await signIn(ALICE);
  add(ALICE, 1);
  const up = (body) => call('POST', '/node/download-update', { bearer: sam, body });
  for (const body of [{}, { id: 'x', state: 'done' }, { id: PID(1) }, { id: PID(1), state: 'waiting' }, { id: PID(1), state: 'exploded' }, { id: PID(1), state: 7 },
                      { id: PID(1), state: 'downloading', receipt: RECEIPT }, { id: PID(1), state: 'done', receipt: 'x' }, { id: PID(1), state: 'done', receipt: [1] }]) {
    const r = await up(body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.ok(!world.calls.includes('node_download_update'), 'no update reached the database for a malformed request');
  assert.equal(world.dlPlans[0].state, 'waiting');
});

test('MUST-FAIL: the database refusing a receipt is a fixed sentence, never its text', async () => {
  const { world, call, signIn, add } = setup();
  const sam = await signIn(ALICE);
  add(ALICE, 1, 'downloading');
  world.downloadUpdate = async () => { throw Object.assign(new Error('secret db text: receipt of C:\\Users\\me'), { code: '22023' }); };
  const r = await call('POST', '/node/download-update', { bearer: sam, body: { id: PID(1), state: 'done', receipt: RECEIPT } });
  assert.equal(r.status, 400);
  assert.ok(!JSON.stringify(r.json).includes('secret') && !JSON.stringify(r.json).includes('C:'));
});

test('the routes are slow-down limited', async () => {
  const { call, signIn } = setup();
  const sam = await signIn(ALICE);
  let last = 200;
  for (let i = 0; i < 70; i++) last = (await call('POST', '/node/download-plans', { bearer: sam, body: {} })).status;
  assert.ok(last === 200 || last === 429);
});
