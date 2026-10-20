// The `node` function (NEXT-CONNECT 100, r9 M4): the desktop app's sign-in by device code and the five calls a signed-in computer makes on its OWN owner_local
// jobs, against the in-memory stand-in for WORKER's r9_node_draft.sql. Every check that must hold when the caller is hostile has a case here that FAILS if the
// check is removed (the mutants are in tests/node-function-mutants.mjs). Plan section 9 items 4 and 5, CC1 13:20 / 13:34 / 13:48 / 13:51.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleNode, sha256hex, POLL_INTERVAL } from '../supabase/functions/node-core/router.ts';
import { FakeNodeWorld } from '../supabase/functions/node-core/fake.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const WORKERU = '00000000-0000-4000-8000-0000000000c0';
const J = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup() {
  const world = new FakeNodeWorld();
  world.addUser(ALICE, 'alice@example.test', true);
  world.addUser(BOB, 'bob@example.test', true);
  world.addUser(WORKERU, 'worker@example.test', true, true);
  const signed = [];
  const deps = { db: world, storage: { signUpload: async p => { signed.push(p); return `https://storage.test/upload/${p}?token=signed`; } }, approvalBase: 'https://uselai.com/app', salt: 'salt', maxFileBytes: 100_000_000 };
  let n = 0;
  const call = async (method, route, { bearer, body, ip, headers = {}, raw } = {}) => {
    const h = { 'x-forwarded-for': ip ?? `10.0.0.${++n % 250}`, ...headers };
    if (bearer) h.authorization = `Bearer ${bearer}`;
    if (body !== undefined || raw !== undefined) h['content-type'] = h['content-type'] ?? 'application/json';
    const res = await handleNode(new Request('https://x.test/functions/v1/node' + route, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) }), route.split('?')[0], deps);
    let j = null; try { j = await res.clone().json(); } catch { /* not json */ }
    return { status: res.status, json: j, headers: res.headers };
  };
  // a full device sign-in for one person; returns the token
  const signIn = async (who, name = 'Sam-PC') => {
    const c = await call('POST', '/device/code', { body: { computer_name: name, app: 'ryagram-desktop' } });
    assert.equal(c.status, 200);
    assert.ok(world.approve(c.json.user_code, who));
    const t = await call('POST', '/device/token', { body: { device_code: c.json.device_code } });
    assert.equal(t.status, 200, JSON.stringify(t.json));
    return t.json.node_token;
  };
  return { world, deps, call, signIn, signed };
}

test('SIGN-IN: a code in the right shape, an approval page on the trusted host, a token only after the person approves, and the app is told who it is', async () => {
  const { world, call } = setup();
  const c = await call('POST', '/device/code', { body: { computer_name: 'Sam-PC', app: 'ryagram-desktop' } });
  assert.equal(c.status, 200);
  assert.match(c.json.user_code, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/);
  assert.match(c.json.device_code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(c.json.verification_uri, 'https://uselai.com/app/#/device');
  assert.equal(c.json.verification_uri_complete, `https://uselai.com/app/#/device?code=${c.json.user_code}`);
  assert.equal(c.json.interval, POLL_INTERVAL);
  assert.ok(c.json.expires_in > 0 && c.json.expires_in <= 600);
  const pending = await call('POST', '/device/token', { body: { device_code: c.json.device_code } });
  assert.deepEqual([pending.status, pending.json.error], [400, 'authorization_pending']);
  world.approve(c.json.user_code, ALICE);
  world.now = () => Date.now() + 6000;
  const t = await call('POST', '/device/token', { body: { device_code: c.json.device_code } });
  assert.equal(t.status, 200);
  assert.match(t.json.node_token, /^rgn_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(t.json.account, { email: 'alice@example.test', computer_name: 'Sam-PC', local_compute: true });
  assert.ok(t.json.expires_in > 29 * 86400);
});

test('THE ALPHABET: forty codes, none with a 0, O, 1, I or L, all of the shape 4-4', async () => {
  const { call } = setup();
  for (let i = 0; i < 40; i++) {
    const c = await call('POST', '/device/code', { body: {}, ip: `7.7.7.${i}` });
    assert.match(c.json.user_code, /^[^01OIL]{4}-[^01OIL]{4}$/, c.json.user_code);
  }
});

test('SECRETS AT REST: the database receives only SHA-256 of the device secret and of the token, never the secrets', async () => {
  const { world, call } = setup();
  const c = await call('POST', '/device/code', { body: { computer_name: 'x' } });
  assert.ok(world.devices.has(await sha256hex(c.json.device_code)));
  assert.ok(![...world.devices.keys()].includes(c.json.device_code));
  world.approve(c.json.user_code, ALICE);
  world.now = () => Date.now() + 6000;
  const t = await call('POST', '/device/token', { body: { device_code: c.json.device_code } });
  assert.ok(world.tokens.has(await sha256hex(t.json.node_token)));
  assert.ok(![...world.tokens.keys()].includes(t.json.node_token));
});

test('SINGLE USE: the token is handed over once; asking again, or a code never issued, is expired_token', async () => {
  const { world, call } = setup();
  const c = await call('POST', '/device/code', { body: {} });
  world.approve(c.json.user_code, ALICE);
  world.now = () => Date.now() + 6000;
  assert.equal((await call('POST', '/device/token', { body: { device_code: c.json.device_code } })).status, 200);
  world.now = () => Date.now() + 12000;
  const again = await call('POST', '/device/token', { body: { device_code: c.json.device_code } });
  assert.deepEqual([again.status, again.json.error], [400, 'expired_token']);
  assert.equal(world.tokens.size, 1);
  assert.equal(world.approve(c.json.user_code, BOB), false, 'a used code cannot be approved again');
  const dh = await sha256hex(c.json.device_code);
  await assert.rejects(() => world.deviceExchange(dh, 'f'.repeat(64)), { code: 'PT401' }, 'MUST-FAIL (database rule): even asked directly, a used code is not exchanged twice');
  for (const dc of ['x'.repeat(43), 'short', '', 5, null]) {
    const r = await call('POST', '/device/token', { body: { device_code: dc } });
    assert.equal(r.status, 400); assert.equal(r.json.error, 'expired_token');
  }
});

test('EXPIRY AND DENIAL: an ended code cannot be approved or exchanged; a denied code says access_denied and issues nothing', async () => {
  const { world, call } = setup();
  const c = await call('POST', '/device/code', { body: {} });
  world.now = () => Date.now() + 601_000;
  assert.equal(world.approve(c.json.user_code, ALICE), false);
  const r = await call('POST', '/device/token', { body: { device_code: c.json.device_code } });
  assert.deepEqual([r.status, r.json.error], [400, 'expired_token']);
  world.now = () => Date.now();
  const d = await call('POST', '/device/code', { body: {} });
  assert.ok(world.deny(d.json.user_code));
  world.now = () => Date.now() + 6000;
  const r2 = await call('POST', '/device/token', { body: { device_code: d.json.device_code } });
  assert.deepEqual([r2.status, r2.json.error], [400, 'access_denied']);
  assert.equal(world.tokens.size, 0);
});

test('RATE LIMITS: the seventh code in a minute is 429; polling faster than the interval is slow_down with a longer interval', async () => {
  const { call } = setup();
  let last;
  for (let i = 0; i < 7; i++) last = await call('POST', '/device/code', { body: {}, ip: '9.9.9.9' });
  assert.deepEqual([last.status, last.json.error], [429, 'slow_down']);
  const other = await call('POST', '/device/code', { body: {}, ip: '8.8.8.8' });
  assert.equal(other.status, 200, 'another caller is not limited by the first');
  const { json } = other;
  const a = await call('POST', '/device/token', { body: { device_code: json.device_code } });
  const b = await call('POST', '/device/token', { body: { device_code: json.device_code } });
  assert.equal(a.json.error, 'authorization_pending');
  assert.deepEqual([b.status, b.json.error], [400, 'slow_down']);
  assert.ok(b.json.interval > POLL_INTERVAL);
});

test('THE BEARER: anything that is not an rgn_ token is refused BEFORE the database is asked; a token in a URL is not read', async () => {
  const { world, call, signIn } = setup();
  const tok = await (async () => { const s = setup(); return s.signIn(ALICE); })();       // a well-formed token that this world does not know
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.' + 'a'.repeat(43);
  const cases = [undefined, '', 'junk', jwt, 'rga_' + 'A'.repeat(43), 'rgr_' + 'A'.repeat(43), 'rgn_short', 'rgn_' + 'A'.repeat(44), 'rgn_' + 'A'.repeat(42) + '!'];
  for (const b of cases) {
    for (const [m, r] of [['GET', '/account'], ['POST', '/node/claim'], ['POST', '/signout']]) {
      const x = await call(m, r, { bearer: b, body: m === 'POST' ? {} : undefined });
      assert.equal(x.status, 401, `${m} ${r} with ${String(b).slice(0, 12)}`);
    }
  }
  assert.ok(!world.calls.some(c => c.startsWith('node_')), `no database call was made for a bad bearer (${world.calls.filter(c => c.startsWith('node_'))})`);
  const good = await signIn(ALICE);
  const viaUrl = await call('GET', `/account?token=${good}&access_token=${good}`, {});
  assert.equal(viaUrl.status, 401, 'MUST-FAIL: even a VALID token in the query string is never read');
  assert.equal((await call('GET', '/account', { bearer: good })).status, 200, '(control) the same token in the header works');
  const unknown = await call('GET', '/account', { bearer: tok });
  assert.equal(unknown.status, 401, 'a well-formed token the database does not know is refused');
});

test('AUDIENCE: a node token is nothing to the connector, and the connector\'s tokens are nothing to the node', async () => {
  const { world, call, signIn } = setup();
  const tok = await signIn(ALICE);
  assert.equal(world.connectVerify(await sha256hex(tok)), null);
  const asConnector = await call('GET', '/account', { bearer: 'rga_' + 'A'.repeat(43) });
  assert.equal(asConnector.status, 401);
});

test('ACCOUNT, SIGN-OUT AND REMOVE: the account is the token\'s owner; Remove is immediate; a 30-day token ends', async () => {
  const { world, call, signIn } = setup();
  const tok = await signIn(ALICE, 'Alice-PC');
  const a = await call('GET', '/account', { bearer: tok });
  assert.deepEqual([a.status, a.json.account.email, a.json.account.computer_name, a.json.account.local_compute], [200, 'alice@example.test', 'Alice-PC', true]);
  assert.match(a.json.account.approved_until, /^\d{4}-\d{2}-\d{2}$/);
  const bobTok = await signIn(BOB, 'Bob-PC');
  assert.equal((await call('GET', '/account', { bearer: bobTok })).json.account.email, 'bob@example.test', 'each token is its own person');
  world.removeAll();                                                                                       // the website's Remove
  assert.equal((await call('GET', '/account', { bearer: tok })).status, 401, 'the removed computer\'s very next call is refused');
  assert.equal((await call('POST', '/node/claim', { bearer: tok, body: {} })).status, 401);
  const s = setup(); const t2 = await s.signIn(ALICE);
  assert.equal((await s.call('POST', '/signout', { bearer: t2, body: {} })).status, 200);
  assert.equal((await s.call('GET', '/account', { bearer: t2 })).status, 401, 'signed out = refused');
  const s2 = setup(); const t3 = await s2.signIn(ALICE);
  s2.world.now = () => Date.now() + 31 * 86400_000;
  assert.equal((await s2.call('GET', '/account', { bearer: t3 })).status, 401, 'MUST-FAIL: the token is refused after 30 days');
});

test('A WORKER ACCOUNT IS NOT A PERSON: a node token that belongs to a worker login is refused', async () => {
  const { world, call } = setup();
  const c = await call('POST', '/device/code', { body: {} });
  world.approve(c.json.user_code, WORKERU);
  world.now = () => Date.now() + 6000;
  const t = await call('POST', '/device/token', { body: { device_code: c.json.device_code } });
  if (t.status === 200) {
    const r = await call('POST', '/node/claim', { bearer: t.json.node_token, body: {} });
    assert.equal(r.status, 403);
  } else assert.ok([401, 403].includes(t.status));
});

test('CLAIM: only the owner\'s own queued owner_local job; never a house job, never another person\'s; one at a time; only the fields a node needs', async () => {
  const { world, call, signIn } = setup();
  world.addJob({ id: J(1), owner_id: ALICE, run_on: 'house' });
  world.addJob({ id: J(2), owner_id: BOB, run_on: 'owner_local' });
  const tok = await signIn(ALICE);
  const none = await call('POST', '/node/claim', { bearer: tok, body: {} });
  assert.deepEqual([none.status, none.json], [200, { job: null }]);
  world.addJob({ id: J(3), owner_id: ALICE, run_on: 'owner_local' });
  world.addJob({ id: J(4), owner_id: ALICE, run_on: 'owner_local' });
  const got = await call('POST', '/node/claim', { bearer: tok, body: {} });
  assert.equal(got.json.job.id, J(3));
  for (const hidden of ['worker_user_id', 'lease_expires_at', 'worker_id', 'run_on']) assert.ok(!(hidden in got.json.job), `${hidden} never leaves the function`);
  assert.equal(world.jobs.get(J(1)).state, 'queued'); assert.equal(world.jobs.get(J(2)).state, 'queued');
  const second = await call('POST', '/node/claim', { bearer: tok, body: {} });
  assert.equal(second.json.job, null, 'one job at a time');
  const bobTok = await signIn(BOB);
  assert.equal((await call('POST', '/node/claim', { bearer: bobTok, body: {} })).json.job.id, J(2), 'Bob gets his own');
  world.claimsEnabled = false; world.jobs.get(J(3)).state = 'complete';
  assert.equal((await call('POST', '/node/claim', { bearer: tok, body: {} })).json.job, null, 'claims switched off = nothing');
});

test('CLAIM NEEDS THE FLAG: an account that is not set to render on its own computer is refused (403), and the message is fixed words', async () => {
  const { world, call, signIn } = setup();
  world.users.get(ALICE).local_compute = false;
  const tok = await signIn(ALICE);
  world.addJob({ id: J(5), owner_id: ALICE, run_on: 'owner_local' });
  const r = await call('POST', '/node/claim', { bearer: tok, body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.json.message, 'This account or this computer is not allowed to do that.');
  assert.equal(world.jobs.get(J(5)).state, 'queued');
});

test('THE JOB MUST BE HELD: heartbeat, state, retry and artifact on a job this computer does not hold are refused; a body that names another owner changes nothing', async () => {
  const { world, call, signIn } = setup();
  world.addJob({ id: J(10), owner_id: BOB, run_on: 'owner_local', state: 'claimed' }); world.jobs.get(J(10)).worker_user_id = BOB;
  world.addJob({ id: J(11), owner_id: ALICE, run_on: 'house', state: 'claimed' }); world.jobs.get(J(11)).worker_user_id = ALICE;
  world.addJob({ id: J(12), owner_id: ALICE, run_on: 'owner_local', state: 'queued' });
  const tok = await signIn(ALICE);
  const art = { kind: 'preview', bytes: 10, sha256: 'a'.repeat(64) };
  world.addJob({ id: J(13), owner_id: BOB, run_on: 'owner_local', state: 'claimed' }); world.jobs.get(J(13)).worker_user_id = ALICE;       // owner and holder disagree
  for (const id of [J(10), J(11), J(12), J(13), J(99)]) {
    for (const [r, b] of [['/node/heartbeat', {}], ['/node/state', { state: 'running' }], ['/node/retry', { error_code: 'x' }], ['/node/artifact', art]]) {
      const x = await call('POST', r, { bearer: tok, body: { job_id: id, owner_id: BOB, user_id: BOB, ...b } });
      assert.equal(x.status, 403, `${r} on ${id}`);
    }
  }
  assert.equal(world.jobs.get(J(10)).state, 'claimed'); assert.equal(world.artifacts.length, 0);
  for (const bad of ['', 'nope', J(10).toUpperCase().replace(/8000/, 'ZZZZ'), 5, null]) {
    assert.equal((await call('POST', '/node/heartbeat', { bearer: tok, body: { job_id: bad } })).status, 400);
  }
});

test('THE STATES A NODE MAY SET: running, validating, uploading, complete, failed; nothing else', async () => {
  const { world, call, signIn } = setup();
  const tok = await signIn(ALICE);
  world.addJob({ id: J(20), owner_id: ALICE, run_on: 'owner_local' });
  await call('POST', '/node/claim', { bearer: tok, body: {} });
  for (const s of ['queued', 'claimed', 'cancelled', 'editorial_action_required', 'bogus', '', 7]) {
    assert.equal((await call('POST', '/node/state', { bearer: tok, body: { job_id: J(20), state: s } })).status, 400, String(s));
  }
  for (const s of ['running', 'validating', 'uploading']) {
    const r = await call('POST', '/node/state', { bearer: tok, body: { job_id: J(20), state: s } });
    assert.equal(r.status, 200); assert.equal(r.json.job.state, s); assert.ok(!('worker_user_id' in r.json.job));
  }
  assert.equal((await call('POST', '/node/heartbeat', { bearer: tok, body: { job_id: J(20), progress: 0.4, note: 'cutting', detail: { clip: 2 } } })).json.ok, true);
  assert.equal((await call('POST', '/node/retry', { bearer: tok, body: { job_id: J(20), error_code: 'engine' } })).status, 200);
  assert.equal((await call('POST', '/node/retry', { bearer: tok, body: { job_id: J(20) } })).status, 400, 'retry needs an error code');
});

test('UPLOADS: the path comes from the job, the request never names one; a signed URL covers that one path; the per-file cap is enforced before the database', async () => {
  const { world, call, signIn, signed } = setup();
  const tok = await signIn(ALICE);
  world.addJob({ id: J(30), owner_id: ALICE, run_on: 'owner_local', job_type: 'final_render' });
  await call('POST', '/node/claim', { bearer: tok, body: {} });
  const sha = 'b'.repeat(64);
  const early = await call('POST', '/node/artifact', { bearer: tok, body: { job_id: J(30), kind: 'final_video', bytes: 1000, sha256: sha } });
  assert.equal(early.status, 403, 'not in the uploading state yet');
  await call('POST', '/node/state', { bearer: tok, body: { job_id: J(30), state: 'uploading' } });
  const ok = await call('POST', '/node/artifact', { bearer: tok, body: { job_id: J(30), kind: 'final_video', bytes: 50_000_000, sha256: sha, path: '../../other/film.mp4', storage_path: 'x', bucket: 'evil' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.path, `${ALICE}/00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000b1/${J(30)}/film.mp4`);
  assert.deepEqual(signed, [ok.json.path], 'MUST-FAIL: exactly one URL was signed, for exactly the path the database returned');
  assert.ok(ok.json.upload_url.includes(ok.json.path) && !ok.json.upload_url.includes('other'));
  const callsBefore = world.calls.length;
  const big = await call('POST', '/node/artifact', { bearer: tok, body: { job_id: J(30), kind: 'final_video', bytes: 150_000_000, sha256: sha } });
  assert.equal(big.status, 413);
  assert.ok(!world.calls.slice(callsBefore).includes('node_register_artifact'), 'MUST-FAIL: over the per-file cap is refused before the database is asked');
  assert.equal(signed.length, 1);
  assert.equal((await call('POST', '/node/artifact', { bearer: tok, body: { job_id: J(30), kind: 'thumbnail', bytes: 9_000_000, sha256: sha } })).status, 400, 'the database\'s own per-kind limit still applies');
  for (const bad of [{ kind: 'nope' }, { bytes: -1 }, { bytes: 1.5 }, { bytes: '5' }, { sha256: 'xyz' }, { kind: 5 }]) {
    assert.equal((await call('POST', '/node/artifact', { bearer: tok, body: { job_id: J(30), kind: 'thumbnail', bytes: 100, sha256: sha, ...bad } })).status, 400, JSON.stringify(bad));
  }
  assert.equal(world.artifacts.length, 1);
});

test('ONE NODE CANNOT UPLOAD TO ANOTHER JOB\'S PATH: the path is a function of the held job alone', async () => {
  const { world, call, signIn, signed } = setup();
  const a = await signIn(ALICE), b = await signIn(BOB);
  world.addJob({ id: J(40), owner_id: ALICE, run_on: 'owner_local', job_type: 'preview' }); world.addJob({ id: J(41), owner_id: BOB, run_on: 'owner_local', job_type: 'preview' });
  await call('POST', '/node/claim', { bearer: a, body: {} }); await call('POST', '/node/claim', { bearer: b, body: {} });
  await call('POST', '/node/state', { bearer: a, body: { job_id: J(40), state: 'uploading' } }); await call('POST', '/node/state', { bearer: b, body: { job_id: J(41), state: 'uploading' } });
  const sha = 'c'.repeat(64);
  assert.equal((await call('POST', '/node/artifact', { bearer: a, body: { job_id: J(41), kind: 'preview', bytes: 10, sha256: sha } })).status, 403);
  assert.equal(signed.length, 0, 'nothing was signed for a job the caller does not hold');
  const mine = await call('POST', '/node/artifact', { bearer: a, body: { job_id: J(40), kind: 'preview', bytes: 10, sha256: sha } });
  assert.ok(mine.json.path.startsWith(ALICE + '/') && mine.json.path.includes(J(40)) && !mine.json.path.includes(J(41)));
});

test('ERRORS ARE FIXED SENTENCES, AND NOTHING IS LOGGED: a database error with a secret in its text never reaches the app or the console', async () => {
  const { world, call, signIn } = setup();
  const tok = await signIn(ALICE);
  const logged = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
  try {
    world.claim = async () => { throw Object.assign(new Error('password=hunter2 postgres://u:p@h/db ' + tok), { code: 'XX000' }); };
    const r = await call('POST', '/node/claim', { bearer: tok, body: {} });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'server_error', message: 'Something went wrong. Try again in a moment.' });
    assert.ok(!JSON.stringify(r.json).includes('hunter2'));
    world.heartbeat = async () => { throw Object.assign(new Error('secret ' + tok), { code: '42501' }); };
    const h = await call('POST', '/node/heartbeat', { bearer: tok, body: { job_id: J(1) } });
    assert.equal(h.status, 403); assert.ok(!JSON.stringify(h.json).includes('secret'));
  } finally { Object.assign(console, orig); }
  assert.deepEqual(logged.filter(l => l.includes(tok) || l.includes('hunter2')), [], 'no log line holds the token or a database message');
});

test('THE REQUEST ITSELF: methods, content type, size and JSON are checked; there are no CORS headers (a browser page cannot call it)', async () => {
  const { call, signIn } = setup();
  const tok = await signIn(ALICE);
  assert.equal((await call('GET', '/node/claim', { bearer: tok })).status, 405);
  assert.equal((await call('POST', '/account', { bearer: tok, body: {} })).status, 405);
  assert.equal((await call('POST', '/device/code', { raw: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call('POST', '/device/code', { raw: '{not json' })).status, 400);
  assert.equal((await call('POST', '/device/code', { raw: '[1,2]' })).status, 400);
  assert.equal((await call('POST', '/device/code', { raw: JSON.stringify({ computer_name: 'x'.repeat(70_000) }) })).status, 413);
  assert.equal((await call('GET', '/nothing')).status, 404);
  const r = await call('POST', '/device/code', { body: {} });
  assert.ok(![...r.headers.keys()].some(k => k.startsWith('access-control-')), 'no CORS headers');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const name = await call('POST', '/device/code', { body: { computer_name: 'Sam<script>alert(1)</script>\r\n PC' } });
  assert.equal(name.status, 200);
});

test('THE FIVE CALLS ONLY: a signed-in computer has no route to the job list, credits, orders, projects or anyone else', async () => {
  const { call, signIn } = setup();
  const tok = await signIn(ALICE);
  for (const r of ['/node/jobs', '/node/credits', '/node/orders', '/node/projects', '/node/admin', '/jobs', '/credits', '/rest/v1/jobs', '/node/claim/../jobs']) {
    assert.equal((await call('POST', r, { bearer: tok, body: {} })).status, 404, r);
  }
});
