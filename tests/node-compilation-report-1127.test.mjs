// POST /node/compilation-report (BUILDER 11-27, migrations/20261127000300_compilations_for_everyone.sql): the person's own computer reports how a compilation build goes. COUNTS ONLY: a state,
// matches, clips, film seconds, an error code; never a file, a path, a transcript or a video. Always on (not behind the private-link switch). Against the in-memory stand-in for the database;
// supabase/tests/test_compilations_for_everyone.py holds the database half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleNode } from '../supabase/functions/node-core/router.ts';
import { FakeNodeWorld } from '../supabase/functions/node-core/fake.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const P = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'a'.repeat(64);
const REQ = { schema: 'ryagram.compilation-request/0', phrase: 'here we go' };

function setup(extra = {}) {
  const world = new FakeNodeWorld();
  world.addUser(ALICE, 'alice@example.test', false);                    // NOT a tester: compilations are for every account with the switch
  world.addUser(BOB, 'bob@example.test', false);
  world.compilationsOn.add(ALICE);
  const deps = { db: world, storage: { signUpload: async () => { throw new Error('a report must never sign an upload'); } }, approvalBase: 'https://uselai.com/app', salt: 'salt', maxFileBytes: 1e9, ...extra };
  let n = 0;
  const call = async (method, route, { bearer, body } = {}) => {
    const h = { 'x-forwarded-for': `10.0.1.${++n % 250}` };
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
  const report = (bearer, body) => call('POST', '/node/compilation-report', { bearer, body });
  return { world, call, signIn, report };
}
const R = (state, more = {}) => ({ project_id: P(1), request_sha256: SHA, state, ...more });

test('happy path: planning, matching, building, done on one run; the counts pass through as numbers; no upload, no other database call', async () => {
  const { world, signIn, report } = setup();
  world.addRequest(ALICE, P(1), 'film', REQ);
  const a = await signIn(ALICE);
  world.calls.length = 0;
  const r1 = await report(a, R('planning'));
  assert.equal(r1.status, 200);
  assert.deepEqual(Object.keys(r1.json), ['run_id']);
  for (const s of [R('matching', { clips: 12 }), R('building', { matches: 7 }), R('done', { film_seconds: 42.5 })]) {
    const r = await report(a, s);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.run_id, r1.json.run_id, 'one run');
  }
  assert.deepEqual({ ...world.runs[0], started: 0 }, { id: 1, owner: ALICE, project_id: P(1), sha: SHA, state: 'done', matches: 7, clips: 12, film_seconds: 42.5, error_code: null, started: 0 });
  assert.deepEqual(world.calls.filter((c) => c !== 'hit'), Array(4).fill('node_compilation_report'));
  const again = await report(a, R('planning'));
  assert.equal(again.json.run_id, 2, 'after done, a new build is a new run');
});

test('each refusal of the database is a fixed sentence with its own status', async () => {
  const { world, signIn, report } = setup();
  world.addRequest(ALICE, P(1), 'film', REQ);
  world.addRequest(ALICE, P(2), 'film 2', REQ);
  world.addRequest(BOB, P(3), 'bobs', REQ);
  const a = await signIn(ALICE), b = await signIn(BOB);
  const off = await report(b, { ...R('planning'), project_id: P(3) });
  assert.deepEqual([off.status, off.json], [403, { error: 'not_open', message: 'Compilations are not open for this account yet.' }]);
  const old = await report(a, { ...R('planning'), request_sha256: 'b'.repeat(64) });
  assert.deepEqual([old.status, old.json.error], [404, 'not_current']);
  assert.equal(old.json.message, "That request is not the project's current one. Load it again.");
  assert.equal((await report(a, R('planning'))).status, 200);
  const busy = await report(a, { ...R('planning'), project_id: P(2) });
  assert.deepEqual([busy.status, busy.json.error], [409, 'busy']);
  const notStarted = await report(a, { ...R('done'), project_id: P(2) });
  assert.deepEqual([notStarted.status, notStarted.json.error], [409, 'busy'], 'another run is active, so the busy refusal comes first');
  assert.equal((await report(a, R('cancelled'))).status, 200);
  const never = await report(a, { ...R('done'), project_id: P(2) });
  assert.deepEqual([never.status, never.json], [400, { error: 'invalid_request', message: 'That compilation report was not valid.' }]);
  for (let i = 0; i < 29; i++) { assert.equal((await report(a, R('planning'))).status, 200); assert.equal((await report(a, R('done'))).status, 200); }
  const many = await report(a, R('planning'));
  assert.deepEqual([many.status, many.json.error], [429, 'too_many']);
  assert.equal(many.json.message, 'You have started 30 compilations in the last 24 hours. Try again later.');
  const db = JSON.stringify([off.json, old.json, busy.json, never.json, many.json]);
  assert.doesNotMatch(db, /sqlstate|PT4|55000|42501|22023/, 'no database code reaches the computer');
});

test('bad shapes are refused BEFORE any database call', async () => {
  const { world, signIn, report } = setup();
  world.addRequest(ALICE, P(1), 'film', REQ);
  const a = await signIn(ALICE);
  const bad = [
    {}, { ...R('planning'), project_id: 'not-a-uuid' }, { ...R('planning'), request_sha256: 'abc' }, { ...R('planning'), request_sha256: 'A'.repeat(64) },
    R('queued'), R('running'), R(''), { ...R('planning'), state: 3 },
    R('planning', { matches: -1 }), R('planning', { matches: 100001 }), R('planning', { matches: 1.5 }), R('planning', { clips: '3' }),
    R('done', { film_seconds: -1 }), R('done', { film_seconds: 86401 }), R('done', { film_seconds: 'long' }),
    R('failed', { error_code: 'Bad Code' }), R('failed', { error_code: 'x'.repeat(41) }), R('failed', { error_code: 7 }),
    R('planning', { note: 'hello' }), R('planning', { owner_id: ALICE }),
  ];
  world.calls.length = 0;
  for (const body of bad) assert.equal((await report(a, body)).status, 400, JSON.stringify(body));
  assert.deepEqual(world.calls, [], 'not one database call (not even the rate limit) for a malformed report');
  assert.equal((await report(a, R('planning', { matches: 0, clips: 100000, error_code: null }))).status, 200, 'control: the edges are accepted');
});

test('a body naming a file, a path, a link, a video or a sound is refused in words, before the database', async () => {
  const { world, signIn, report } = setup();
  world.addRequest(ALICE, P(1), 'film', REQ);
  const a = await signIn(ALICE);
  world.calls.length = 0;
  for (const k of ['path', 'Path', 'paths', 'url', 'file', 'files', 'filename', 'video', 'audio']) {
    const r = await report(a, { ...R('done'), [k]: 'C:/Users/sam/film.mp4' });
    assert.deepEqual([r.status, r.json.message], [400, 'A compilation report holds counts only, never a file, a path or a link.'], k);
  }
  assert.deepEqual(world.calls, []);
});

test('the route is always on: it exists without NODE_COMPILATION_LINKS, while the private-link routes do not', async () => {
  const { world, signIn, report, call } = setup({ compilationLinksOn: false });
  world.addRequest(ALICE, P(1), 'film', REQ);
  const a = await signIn(ALICE);
  assert.equal((await report(a, R('planning'))).status, 200);
  assert.equal((await call('POST', '/node/compilation/status', { bearer: a, body: {} })).status, 404, 'control: the switched-off routes are still absent');
});

test('it needs a computer token and POST: none, junk, a JWT or GET are refused before the database', async () => {
  const { world, signIn, report, call } = setup();
  world.addRequest(ALICE, P(1), 'film', REQ);
  const a = await signIn(ALICE);
  world.calls.length = 0;
  for (const bearer of [undefined, 'junk', 'eyJhbGciOi.eyJzdWIi.sig']) assert.equal((await report(bearer, R('planning'))).status, 401);
  assert.equal((await call('GET', '/node/compilation-report', { bearer: a })).status, 405);
  assert.deepEqual(world.calls, []);
});

test('the real database layer calls node_compilation_report with the exact argument types', async () => {
  const { NodeSql } = await import('../supabase/functions/node/db.ts');
  const seen = [];
  const sql = new NodeSql(async (text, params) => { seen.push([text, params]); return [{ r: 9 }]; });
  assert.equal(await sql.compilationReport('h'.repeat(64), P(1), SHA, 'done', 3, 4, 12.5, null), 9);
  assert.deepEqual(seen, [['select public.node_compilation_report($1::text, $2::uuid, $3::text, $4::text, $5::int, $6::int, $7::numeric, $8::text) as r', ['h'.repeat(64), P(1), SHA, 'done', 3, 4, 12.5, null]]]);
});

test('the report route never signs or names an upload (finished compilations stay on the person\'s own PC)', () => {
  const src = fs.readFileSync('supabase/functions/node-core/router.ts', 'utf8');
  const start = src.indexOf('if (route === REPORT_ROUTE) {');
  const block = src.slice(start, src.indexOf('if (route === "/node/download-update")', start));
  assert.ok(block.length > 500);
  assert.doesNotMatch(block, /signUpload|storage|upload_url/);
});
