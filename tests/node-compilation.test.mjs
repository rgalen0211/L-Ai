// The `node` function's PRIVATE LINK routes for a film made on the person's own computer (NEXT-CONNECT 120): /node/compilation/status | start | finish | cancel, against the in-memory stand-in
// that keeps the same rules as supabase/connect-drafts/compilation_delivery_draft.sql (the SQL has its own check). Every refusal here has a case that FAILS if the check is removed
// (the broken-on-purpose runs are in tests/node_compilation_mutants.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleNode } from '../supabase/functions/node-core/router.ts';
import { FakeNodeWorld } from '../supabase/functions/node-core/fake.ts';
import { NodeSql } from '../supabase/functions/node/db.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const MB = 1048576;
const SHA = 'c'.repeat(64);

function setup({ on = true, plan = 'sub_creator' } = {}) {
  const world = new FakeNodeWorld();
  world.addUser(ALICE, 'alice@example.test', false);          // NOT a tester: local_compute is false for everyone here
  world.addUser(BOB, 'bob@example.test', false);
  world.compilationSwitchOn = true;
  world.planLimits.set('sub_creator', { enabled: true, max_film_bytes: 150 * MB, max_kept_bytes: 600 * MB, starts_per_hour: 5 });
  world.planLimits.set('sub_off', { enabled: false, max_film_bytes: 1, max_kept_bytes: 1, starts_per_hour: 1 });
  if (plan) world.plans.set(ALICE, plan);
  const signed = [];
  const deps = { db: world, storage: { signUpload: async p => { signed.push(p); return `https://storage.test/upload/${p}?token=signed`; } }, approvalBase: 'https://uselai.com/app', salt: 'salt', maxFileBytes: 1e9,
    compilationLinksOn: on, maxCompilationBytes: 400 * MB };
  let n = 0;
  const call = async (method, route, { bearer, body, ip, headers = {}, raw } = {}) => {
    const h = { 'x-forwarded-for': ip ?? `10.0.0.${++n % 250}`, ...headers };
    if (bearer) h.authorization = `Bearer ${bearer}`;
    if (body !== undefined || raw !== undefined) h['content-type'] = h['content-type'] ?? 'application/json';
    const res = await handleNode(new Request('https://x.test/functions/v1/node' + route, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) }), route, deps);
    let j = null; try { j = await res.clone().json(); } catch { /* not json */ }
    return { status: res.status, json: j };
  };
  const signIn = async who => {
    const c = await call('POST', '/device/code', { body: { computer_name: 'Sam-PC', app: 'ryagram-desktop' } });
    assert.ok(world.approve(c.json.user_code, who));
    return (await call('POST', '/device/token', { body: { device_code: c.json.device_code } })).json.node_token;
  };
  const START = { title: 'My compilation', bytes: 1000, sha256: SHA, rights: true };
  const start = (tok, extra = {}) => call('POST', '/node/compilation/start', { bearer: tok, body: { ...START, ...extra } });
  return { world, deps, call, signIn, signed, START, start };
}

test('OFF: with the function switched off the four routes do not exist (404, for a signed-in person and for a stranger alike) and the database is never asked', async () => {
  const { world, call, signIn } = setup({ on: false });
  const tok = await signIn(ALICE);
  const before = world.calls.length;
  for (const r of ['status', 'start', 'finish', 'cancel']) {
    for (const bearer of [tok, undefined, 'junk']) {
      const res = await call('POST', `/node/compilation/${r}`, { bearer, body: {} });
      assert.equal(res.status, 404, `${r} ${bearer ? 'with a token' : 'without'}`);
      assert.equal(res.json.error, 'not_found');
    }
  }
  assert.deepEqual(world.calls.slice(before), [], 'nothing reached the database');
});

test('ON: the routes need a node token (none, a junk bearer, a Supabase-looking JWT: 401 before the database), POST only', async () => {
  const { world, call, signIn } = setup();
  const tok = await signIn(ALICE);
  const before = world.calls.length;
  for (const bearer of [undefined, 'junk', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig']) {
    const res = await call('POST', '/node/compilation/status', { bearer, body: {} });
    assert.equal(res.status, 401);
  }
  assert.deepEqual(world.calls.slice(before), [], 'a bad bearer never reaches the database');
  assert.equal((await call('GET', '/node/compilation/status', { bearer: tok })).status, 405);
  assert.equal((await call('POST', '/node/compilation/status', { bearer: tok, raw: '{', headers: { 'content-type': 'application/json' } })).status, 400);
});

test('STATUS: the launch check tells the app the plan, the limits and whether it is allowed; nothing is created', async () => {
  const { world, call, signIn } = setup();
  const tok = await signIn(ALICE);
  const s = await call('POST', '/node/compilation/status', { bearer: tok, body: {} });
  assert.equal(s.status, 200);
  assert.deepEqual([s.json.status.plan, s.json.status.allowed, s.json.status.max_film_bytes, s.json.status.max_kept_bytes], ['sub_creator', true, 150 * MB, 600 * MB]);
  assert.equal(world.compilations.size, 0);
  world.plans.delete(ALICE);
  const none = (await call('POST', '/node/compilation/status', { bearer: tok, body: {} })).json.status;
  assert.deepEqual([none.active, none.allowed, none.max_film_bytes], [false, false, null], 'no plan: not allowed, no limits');
  world.plans.set(ALICE, 'sub_creator'); world.compilationSwitchOn = false;
  assert.equal((await call('POST', '/node/compilation/status', { bearer: tok, body: {} })).json.status.allowed, false, 'switch off: not allowed');
});

test('START: the database chooses the path, the function signs exactly that one path, and nothing the request names changes it', async () => {
  const { world, call, signIn, signed, start } = setup();
  const tok = await signIn(ALICE);
  const r = await start(tok, { path: '../../victim/x.mp4', owner_id: BOB, url: 'https://evil.test', bucket: 'other' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.path, new RegExp(`^${ALICE}/compilations/${r.json.id}\\.mp4$`));
  assert.deepEqual(signed, [r.json.path], 'exactly one path was signed, the database\'s');
  assert.equal(r.json.upload_url, `https://storage.test/upload/${r.json.path}?token=signed`);
  assert.equal(world.compilations.get(r.json.id).rights, true);
});

test('MUST FAIL: START refuses in fixed plain sentences (never the database\'s text) and signs NOTHING', async () => {
  const { world, call, signIn, signed, start } = setup();
  const tok = await signIn(ALICE);
  const cases = [
    ['no plan', () => world.plans.delete(ALICE), {}, 403, 'plan_required', /part of a Ryagram plan/],
    ['a plan without links', () => world.plans.set(ALICE, 'sub_off'), {}, 403, 'plan_excludes', /does not include/],
    ['the switch off', () => { world.plans.set(ALICE, 'sub_creator'); world.compilationSwitchOn = false; }, {}, 403, 'not_available', /not switched on/],
    ['a film over the plan', () => { world.compilationSwitchOn = true; }, { bytes: 151 * MB }, 400, 'too_large', /larger than your plan/],
    ['the rights tick missing', () => {}, { rights: undefined }, 400, 'rights_required', /right to share/],
    ['the rights tick false', () => {}, { rights: false }, 400, 'rights_required', /right to share/],
    ['the rights tick as the word "true"', () => {}, { rights: 'true' }, 400, 'rights_required', /right to share/],
    ['a fraction of a byte', () => {}, { bytes: 10.5 }, 400, 'invalid_request', /not valid/],
    ['zero bytes', () => {}, { bytes: 0 }, 400, 'invalid_request', /not valid/],
    ['bytes as text', () => {}, { bytes: '1000' }, 400, 'invalid_request', /not valid/],
    ['a bad fingerprint', () => {}, { sha256: 'xyz' }, 400, 'invalid_request', /not valid/],
    ['no title', () => {}, { title: '' }, 400, 'invalid_request', /title/],
    ['a blank title', () => {}, { title: '   ' }, 400, 'invalid_request', /title/],
    ['a title of 201 letters', () => {}, { title: 'x'.repeat(201) }, 400, 'invalid_request', /title/],
  ];
  for (const [what, arrange, extra, status, error, text] of cases) {
    arrange();
    const r = await start(tok, extra);
    assert.equal(r.status, status, `${what}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error, error, what);
    assert.match(r.json.message, text, what);
    assert.doesNotMatch(JSON.stringify(r.json), /42501|22023|PT\d|node_compilation|stripe|plan_compilation_limits/i, `${what}: no database text`);
  }
  assert.deepEqual(signed, [], 'not one upload was signed');
  assert.equal(world.compilations.size, 0, 'not one row was made');
});

test('MUST FAIL: the function\'s own size cap (413) comes before the database, and one upload at a time / the kept total are refused with their own sentences', async () => {
  const { world, call, signIn, signed, start } = setup();
  const tok = await signIn(ALICE);
  const before = world.calls.filter(c => c === 'node_compilation_begin').length;
  const big = await start(tok, { bytes: 401 * MB });
  assert.equal(big.status, 413);
  assert.equal(world.calls.filter(c => c === 'node_compilation_begin').length, before, 'the database was not asked');
  const one = await start(tok);
  assert.equal(one.status, 200);
  const two = await start(tok);
  assert.equal([two.status, two.json.error].join(), '409,in_progress');
  assert.equal(signed.length, 1, 'the second start signed nothing');
  world.stored.set(one.json.path, 1000);
  assert.equal((await call('POST', '/node/compilation/finish', { bearer: tok, body: { id: one.json.id } })).status, 200);
  for (let i = 0; i < 3; i++) {                            // 3 x 150 MB + the 1000 byte film
    const x = await start(tok, { bytes: 150 * MB });
    assert.equal(x.status, 200, `film ${i}: ${JSON.stringify(x.json)}`);
    world.stored.set(x.json.path, 150 * MB);
    assert.equal((await call('POST', '/node/compilation/finish', { bearer: tok, body: { id: x.json.id } })).status, 200);
  }
  const full = await start(tok, { bytes: 150 * MB });
  assert.equal([full.status, full.json.error].join(), '403,quota_full');
});

test('FINISH: ready only when the stored size is what was said; the plan is checked again; another person\'s upload is "not found"', async () => {
  const { world, call, signIn, start } = setup();
  const tok = await signIn(ALICE);
  world.addUser(BOB, 'bob@example.test', false);
  world.plans.set(BOB, 'sub_creator');
  const bobTok = await signIn(BOB);
  const s = await start(tok);
  const fin = (t, id) => call('POST', '/node/compilation/finish', { bearer: t, body: { id } });
  assert.equal((await fin(tok, s.json.id)).json.error, 'size_mismatch', 'nothing stored yet');
  world.stored.set(s.json.path, 999);
  assert.equal((await fin(tok, s.json.id)).status, 409, 'a file of another size');
  world.stored.set(s.json.path, 1000);
  const other = await fin(bobTok, s.json.id);
  assert.equal([other.status, other.json.error].join(), '404,not_found', 'another person');
  world.plans.delete(ALICE);
  assert.equal((await fin(tok, s.json.id)).json.error, 'plan_required', 'a plan that lapsed during the upload');
  world.plans.set(ALICE, 'sub_creator');
  const ok = await fin(tok, s.json.id);
  assert.equal(ok.status, 200);
  assert.match(ok.json.expires_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal((await fin(tok, s.json.id)).status, 200, 'finishing twice is harmless');
  assert.equal((await fin(tok, 'not-a-uuid')).status, 400);
  assert.equal((await call('POST', '/node/compilation/finish', { bearer: tok, body: {} })).status, 400);
});

test('CANCEL: the owner can cancel an unfinished upload, another person cannot', async () => {
  const { world, call, signIn, start } = setup();
  const tok = await signIn(ALICE);
  world.plans.set(BOB, 'sub_creator');
  const bobTok = await signIn(BOB);
  const s = await start(tok);
  const cancel = (t, id) => call('POST', '/node/compilation/cancel', { bearer: t, body: { id } });
  assert.equal((await cancel(bobTok, s.json.id)).json.cancelled, false);
  assert.equal((await cancel(tok, s.json.id)).json.cancelled, true);
  assert.equal(world.compilations.get(s.json.id).state, 'failed');
  assert.equal((await cancel(tok, s.json.id)).json.cancelled, false, 'already over');
  assert.equal((await start(tok)).status, 200, 'and a new upload can start');
});

test('MUST FAIL: a path from the database that is not <person>/compilations/<this film>.mp4 is NEVER signed (500)', async () => {
  const { world, call, signIn, signed, start } = setup();
  const tok = await signIn(ALICE);
  const real = world.compilationBegin.bind(world);
  for (const bad of [(r) => '../../x.mp4', (r) => `${ALICE}/compilations/${'1'.repeat(8)}-1111-1111-1111-${'1'.repeat(12)}.mp4`, (r) => `${ALICE}/${r.id}.mp4`, (r) => r.path + '/../..',
    (r) => `${ALICE}/uploads/${r.id}.mp4`, (r) => `${ALICE}\\compilations\\${r.id}.mp4`, (r) => '/' + r.path, (r) => r.path.replace('.mp4', '.exe')]) {
    world.compilationBegin = async (...a) => { const r = await real(...a); world.compilations.get(r.id).state = 'failed'; return { id: r.id, path: bad(r) }; };
    const r = await start(tok);
    assert.equal(r.status, 500, String(r.json?.path));
    assert.deepEqual(signed, [], 'nothing was signed');
  }
});

test('MUST FAIL: a database error the function does not know is never shown (fixed sentence, no text), and the app gets nothing to act on', async () => {
  const { world, call, signIn, start } = setup();
  const tok = await signIn(ALICE);
  world.compilationBegin = async () => { throw Object.assign(new Error('SECRET C:\\Users\\Ryan\\db password=hunter2 stack'), { code: '42501' }); };
  const r = await start(tok);
  assert.equal(r.status, 403);
  assert.doesNotMatch(JSON.stringify(r.json), /SECRET|hunter2|Users|password/);
  world.compilationBegin = async () => { throw Object.assign(new Error('boom SECRET'), { code: 'XX000' }); };
  const r2 = await start(tok);
  assert.equal(r2.status, 500);
  assert.doesNotMatch(JSON.stringify(r2.json), /SECRET|boom/);
});

test('RATE: more than 60 calls a minute from one address is slowed down before the database', async () => {
  const { world, call, signIn } = setup();
  const tok = await signIn(ALICE);
  let last;
  for (let i = 0; i < 61; i++) last = await call('POST', '/node/compilation/status', { bearer: tok, body: {}, ip: '9.9.9.9' });
  assert.equal([last.status, last.json.error].join(), '429,slow_down');
});

test('the real database layer names the SQL functions and passes the typed arguments in order (the person is the token hash only: no owner id anywhere)', async () => {
  const seen = [];
  const db = new NodeSql(async (text, params) => { seen.push([text, params]); return [{ r: text.includes('compilation_status') ? { allowed: true } : text.includes('compilation_cancel') ? true : { id: 'x', path: 'p', expires_at: 'e' } }]; });
  const H = 'a'.repeat(64);
  await db.compilationStatus(H);
  await db.compilationBegin(H, 'Title', 1234, SHA, true, 2.5, 640, 360);
  await db.compilationFinish(H, '11111111-2222-4333-8444-555555555555');
  assert.equal(await db.compilationCancel(H, '11111111-2222-4333-8444-555555555555'), true);
  assert.deepEqual(seen.map(x => x[0]), [
    'select public.node_compilation_status($1::text) as r',
    'select public.node_compilation_begin($1::text, $2::text, $3::bigint, $4::text, $5::boolean, $6::numeric, $7::int, $8::int) as r',
    'select public.node_compilation_finish($1::text, $2::uuid) as r',
    'select public.node_compilation_cancel($1::text, $2::uuid) as r',
  ]);
  assert.deepEqual(seen[1][1], [H, 'Title', 1234, SHA, true, 2.5, 640, 360]);
  for (const [text, params] of seen) assert.ok(!/owner/i.test(text) && !params.some(p => typeof p === 'string' && /^0000/.test(p)), 'no owner id');
});
