// POST /node/compilation-requests (NEXT-CONNECT 131b): the desktop app reads the requests its person's AI wrote. READ ONLY: the computer's token resolves the person, only that person's
// rows come back (at most 20, newest first), five fields each, and reading starts nothing (no job, no claim, no upload). Against the in-memory stand-in for the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleNode } from '../supabase/functions/node-core/router.ts';
import { FakeNodeWorld } from '../supabase/functions/node-core/fake.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const P = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REQ = (phrase) => ({ schema: 'ryagram.compilation-request/0', phrase, search: 'every', mode: 'phrase', note: 'short ones first' });

function setup(extra = {}) {
  const world = new FakeNodeWorld();
  world.addUser(ALICE, 'alice@example.test', true);
  world.addUser(BOB, 'bob@example.test', true);
  const deps = { db: world, storage: { signUpload: async () => { throw new Error('a request read must never sign an upload'); } }, approvalBase: 'https://uselai.com/app', salt: 'salt', maxFileBytes: 1e9, ...extra };
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
  return { world, call, signIn };
}

test('a computer gets its own persons requests, newest first, five fields each, and nobody elses', async () => {
  const { world, call, signIn } = setup();
  world.addRequest(ALICE, P(1), 'old film', REQ('old one'), '2026-10-01T10:00:00.000Z');
  world.addRequest(ALICE, P(2), 'new film', REQ('new one'), '2026-10-02T10:00:00.000Z');
  world.addRequest(BOB, P(3), 'bobs film', REQ('bobs phrase'));
  const a = await signIn(ALICE), b = await signIn(BOB);
  const r = await call('POST', '/node/compilation-requests', { bearer: a });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.requests.map((x) => x.request.phrase), ['new one', 'old one']);
  assert.deepEqual(r.json.requests.map((x) => x.title), ['new film', 'old film']);
  assert.ok(r.json.requests.every((x) => Object.keys(x).sort().join() === 'project_id,request,sha256,title,updated_at'));
  assert.deepEqual((await call('POST', '/node/compilation-requests', { bearer: b })).json.requests.map((x) => x.request.phrase), ['bobs phrase']);   // control
});

test('it needs a computer token: none, junk, a Supabase-looking JWT or the wrong method is refused before the database', async () => {
  const { world, call, signIn } = setup();
  world.addRequest(ALICE, P(1), 'film', REQ('x'));
  const a = await signIn(ALICE);
  const before = world.calls.length;
  for (const bearer of [undefined, 'junk', 'eyJhbGciOi.eyJzdWIi.sig']) assert.equal((await call('POST', '/node/compilation-requests', { bearer })).status, 401);
  assert.equal((await call('GET', '/node/compilation-requests', { bearer: a })).status, 405);
  assert.equal(world.calls.length, before, 'no database call was made for a refused request');
  assert.equal((await call('POST', '/node/compilation-requests', { bearer: a })).status, 200);                                                      // control
});

test('it is always on (not behind the private-link switch) and reading starts nothing', async () => {
  const { world, call, signIn } = setup({ compilationLinksOn: false });
  world.addRequest(ALICE, P(1), 'film', REQ('x'));
  const a = await signIn(ALICE);
  world.calls.length = 0;
  assert.equal((await call('POST', '/node/compilation-requests', { bearer: a })).status, 200);
  assert.deepEqual(world.calls.filter((c) => c !== 'hit'), ['node_compilation_requests'], 'the only database function called is the read');
});

test('at most 20 come back, and a database row with extra fields (an owner id) is cut down to the five', async () => {
  const { world, call, signIn } = setup();
  for (let i = 0; i < 23; i++) world.addRequest(ALICE, P(100 + i), `film ${i}`, REQ(`p${i}`), `2026-10-01T10:${String(i).padStart(2, '0')}:00.000Z`);
  const a = await signIn(ALICE);
  const r = await call('POST', '/node/compilation-requests', { bearer: a });
  assert.equal(r.json.requests.length, 20);
  assert.equal(r.json.requests[0].request.phrase, 'p22');
  const leaky = async () => Array.from({ length: 3 }, (_, i) => ({ project_id: P(i), title: 't', request: REQ('x'), sha256: 'a'.repeat(64), updated_at: 'now', owner_id: ALICE, email: 'alice@example.test' }));
  world.compilationRequests = leaky;                                                                                                                  // a database that returned too much
  const r2 = await call('POST', '/node/compilation-requests', { bearer: a });
  assert.ok(r2.json.requests.every((x) => !('owner_id' in x) && !('email' in x)), 'MUST-FAIL guard: the router passes on only the five fields');
});

test('the app side of this path has no upload in it (Ryan: finished compilations stay on the person\'s own PC)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('supabase/functions/node-core/router.ts', 'utf8');
  const start = src.indexOf('if (route === "/node/compilation-requests")');
  const block = src.slice(start, src.indexOf('const b = await body(req)', start));
  assert.ok(block.length > 100 && !/signUpload|upload|storage/i.test(block), 'the read route never signs or names an upload');
});
