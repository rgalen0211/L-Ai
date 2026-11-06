// The signed read link (supabase/functions/editor-bundle/core.ts; plan 5.3): CC1's six must-fails and CONNECT's two, offline, with a stand-in for the database and the object store.
//   1 expires (and a longer lifetime is capped at 10 minutes)      2 one project only (path, query, header, a forged payload)     3 no other account's project
//   4 never carries or accepts the site session                     5 fails closed, always the same plain 403                      6 refused once the project is gone, the grant revoked or the switch off, on EVERY read
//   7 read only, no redirect, no-store, never an attachment         8 nothing else is served: path tricks cannot name another object
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle, mintLink, verifyLink, ownerHash, LINK_MAX_SECONDS, REASONS } from '../supabase/functions/editor-bundle/core.ts';

const KEY = 'test-link-key-' + 'a1b2c3d4'.repeat(6);
const OLD_KEY = 'old-link-key--' + '9f8e7d6c'.repeat(6);
const PROJECT = '11111111-2222-4333-8444-555555555555';
const OTHER_PROJECT = '99999999-2222-4333-8444-555555555555';
const OWNER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_OWNER = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const T0 = 1_800_000_000;
const BYTES = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
const URLBASE = 'https://ref.functions.supabase.co';

/** a stand-in for the database and the store: projects with owners, a live-grant set, the connector switch, one bundle */
function world({ now = T0, switchOn = true, key = KEY } = {}) {
  const w = { now, switchOn, key, projects: new Map([[PROJECT, OWNER], [OTHER_PROJECT, OTHER_OWNER]]), grants: new Set([OWNER, OTHER_OWNER]), logs: [], asked: [], objects: [], source: 'ok', clock: undefined, allowedThrows: false };
  w.deps = {
    secret: () => w.key,
    now: () => (w.clock !== undefined ? w.clock : w.now),
    async allowed(projectId, hash) {
      w.asked.push([projectId, hash]);
      if (w.allowedThrows) throw new Error('database down');
      const owner = w.projects.get(projectId);
      return w.switchOn && owner !== undefined && w.grants.has(owner) && (await ownerHash(owner)) === hash;
    },
    async object(...args) {
      w.objects.push(args);
      if (w.source === 'throws') throw new Error('store down');
      if (w.source === 'none') return null;
      if (w.source === 'html') return { body: BYTES, contentType: 'text/html', bytes: BYTES.length };
      return { body: BYTES, contentType: 'application/zip', bytes: BYTES.length };
    },
    log: (e) => w.logs.push(e),
  };
  return w;
}
const mint = async (w, over = {}) => { const { owner_id = OWNER, ...rest } = over; return mintLink(KEY, { project_id: PROJECT, owner_hash: await ownerHash(owner_id), now: w.now, jti: 'jti-' + Math.random().toString(36).slice(2, 12), ...rest }); };
const req = (token, init = {}, path = '/editor-bundle/') => new Request(URLBASE + path + token, { method: 'GET', ...init });
const flat = async (res) => ({ status: res.status, body: await res.text(), headers: Object.fromEntries([...res.headers.entries()].sort()) });

// ---- helpers that forge a token with a VALID signature, to prove every other check stands on its own
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
async function forge(claims, key = KEY, raw = null) {
  const payload = b64u(new TextEncoder().encode(raw ?? JSON.stringify(claims)));
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload)));
  return payload + '.' + b64u(sig);
}
const goodClaims = (over = {}) => ({ v: 1, project_id: PROJECT, owner_hash: null, scope: 'bundle.read', iat: T0, exp: T0 + 300, jti: 'forged-jti-0001', ...over });
async function claimsWithHash(over = {}) { return goodClaims({ owner_hash: await ownerHash(OWNER), ...over }); }

test('a link is minted for one project with a lifetime of at most 10 minutes, whatever is asked for, and carries no account id', async () => {
  const w = world();
  const lt = async (ttl) => { const { token, expires_at } = await mint(w, { ttl_seconds: ttl }); const c = await verifyLink(KEY, token, T0); return { exp: expires_at, c, token }; };
  assert.equal((await lt(undefined)).exp - T0, LINK_MAX_SECONDS);
  assert.equal((await lt(3600)).exp - T0, 600, 'a caller asking for an hour gets 10 minutes');
  assert.equal((await lt(99999999)).exp - T0, 600);
  assert.equal((await lt(120)).exp - T0, 120);
  assert.equal((await lt(0)).exp - T0, 1, 'zero is a second, not unlimited');
  assert.equal((await lt(-5)).exp - T0, 1);
  assert.equal((await lt(Number.NaN)).exp - T0, 600);
  const { token, c } = await lt(300);
  assert.equal(c.project_id, PROJECT); assert.equal(c.scope, 'bundle.read'); assert.equal(c.v, 1);
  const payload = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
  assert.ok(!payload.includes(OWNER), 'the account id is not in the token');
  assert.equal(c.owner_hash, await ownerHash(OWNER)); assert.match(c.owner_hash, /^[0-9a-f]{32}$/);
  assert.equal(await ownerHash(OWNER), 'ec4e044c5e368c000219d38c19c11c1b', 'the known answer the SQL test (test_editor_link.py) pins too: the function and the database hash the owner the same way');
});

test('minting refuses what it cannot do well: no key, a short key, a bad project id, an unreadable clock', async () => {
  const base = { project_id: PROJECT, owner_hash: await ownerHash(OWNER), now: T0, jti: 'jti-abcdef12' };
  for (const [label, key, over] of [['no key', undefined, {}], ['a short key', 'short', {}], ['a bad project', KEY, { project_id: 'not-a-uuid' }], ['a bad clock', KEY, { now: Number.NaN }], ['a bad owner hash', KEY, { owner_hash: 'xyz' }], ['no owner hash', KEY, { owner_hash: undefined }], ['a bad jti', KEY, { jti: 'x' }]]) {
    await assert.rejects(mintLink(key, { ...base, ...over }), label);
  }
});

test('GET with a good link serves the one bundle with the safe headers; the database and the store are each asked once, with the project from the token', async () => {
  const w = world();
  const { token } = await mint(w);
  const res = await handle(req(token), w.deps);
  assert.equal(res.status, 200);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...BYTES]);
  assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(res.headers.get('x-content-type-options'), 'nosniff'); assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('content-type'), 'application/zip'); assert.equal(res.headers.get('content-length'), String(BYTES.length));
  assert.equal(res.headers.get('content-disposition'), null, 'never an attachment');
  assert.equal(res.headers.get('location'), null); assert.equal(res.headers.get('set-cookie'), null);
  assert.deepEqual(w.asked, [[PROJECT, await ownerHash(OWNER)]]);
  assert.deepEqual(w.objects, [[PROJECT]], 'the object is picked from the project id alone');
});

// ---------------------------------------------------------------------------------------------------------------- 1 expires
test('1 EXPIRES: good until the second before exp, refused at exp and after; a link the clock says is from the future is refused', async () => {
  const w = world();
  const { token, expires_at } = await mint(w, { ttl_seconds: 300 });
  for (const [t, want] of [[T0, 200], [expires_at - 1, 200], [expires_at, 403], [expires_at + 1, 403], [expires_at + 86400, 403], [T0 - 59, 200], [T0 - 61, 403]]) {
    w.now = t;
    assert.equal((await handle(req(token), w.deps)).status, want, 'at ' + (t - T0));
  }
  w.now = T0;
  const long = await forge(await claimsWithHash({ exp: T0 + 3600 }));
  assert.equal((await handle(req(long), w.deps)).status, 403, 'a signed link that lasts an hour is refused even though the key is right');
  const backwards = await forge(await claimsWithHash({ iat: T0 + 10, exp: T0 + 5 }));
  assert.equal((await handle(req(backwards), w.deps)).status, 403);
});

// ---------------------------------------------------------------------------------------------------------------- 2 one project only
test('2 ONE PROJECT ONLY: a project named in the query or a header, or swapped into a signed payload, is refused and its bundle is never asked for', async () => {
  const w = world();
  const { token } = await mint(w);
  for (const [label, r] of [
    ['query project', req(token + '?project=' + OTHER_PROJECT)], ['query project_id', req(token + '?project_id=' + OTHER_PROJECT)],
    ['query with the same project', req(token + '?project_id=' + PROJECT)], ['an empty-valued query', req(token + '?p=')],
    ['header x-project-id', req(token, { headers: { 'x-project-id': OTHER_PROJECT } })], ['header x-project', req(token, { headers: { 'x-project': OTHER_PROJECT } })],
  ]) assert.equal((await handle(r, w.deps)).status, 403, label);
  const [payload, sig] = token.split('.');
  const swapped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), project_id: OTHER_PROJECT })).toString('base64url') + '.' + sig;
  assert.equal((await handle(req(swapped), w.deps)).status, 403, 'a payload for another project under the old signature');
  assert.deepEqual(w.objects, [], 'no bundle was asked for in any of these');
  assert.equal((await handle(req(token), w.deps)).status, 200); assert.deepEqual(w.objects, [[PROJECT]]);
});

// ---------------------------------------------------------------------------------------------------------------- 3 no other account's project
test('3 NO OTHER ACCOUNT: a link for a project that now belongs to someone else, or minted with another account for it, is refused', async () => {
  const w = world();
  const mine = await mint(w);
  w.projects.set(PROJECT, OTHER_OWNER);                                                                                      // the project moved owner
  assert.equal((await handle(req(mine.token), w.deps)).status, 403);
  w.projects.set(PROJECT, OWNER);
  const forgedOwner = await mint(w, { owner_id: OTHER_OWNER });                                                              // someone else's name on my project
  assert.equal((await handle(req(forgedOwner.token), w.deps)).status, 403);
  const theirs = await mint(w, { project_id: OTHER_PROJECT, owner_id: OWNER });                                              // my name on their project
  assert.equal((await handle(req(theirs.token), w.deps)).status, 403);
  assert.equal((await handle(req(mine.token), w.deps)).status, 200, 'and the right pair still works');
  assert.equal(w.objects.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------- 4 no site session
test('4 NO SITE SESSION: a cookie or an Authorization header is refused even with a good link, a cookie with no link is refused, and the token is in no log line', async () => {
  const w = world();
  const { token } = await mint(w);
  for (const [label, init] of [['a site cookie', { headers: { cookie: 'sb-access-token=abc; session=1' } }], ['a bearer token', { headers: { authorization: 'Bearer eyJhbGciOi.fake.session' } }], ['a basic login', { headers: { authorization: 'Basic dTpw' } }]]) {
    assert.equal((await handle(req(token, init), w.deps)).status, 403, label);
  }
  assert.equal((await handle(new Request(URLBASE + '/editor-bundle/', { headers: { cookie: 'sb-access-token=abc' } }), w.deps)).status, 403, 'a cookie and no link');
  assert.equal((await handle(new Request(URLBASE + '/editor-bundle', { headers: { authorization: 'Bearer eyJ.x.y' } }), w.deps)).status, 403, 'a session token and no link');
  assert.equal(w.objects.length, 0);
  await handle(req(token), w.deps); await handle(req(token + 'x'), w.deps);
  assert.ok(w.logs.length >= 6);
  for (const line of w.logs) { assert.ok(REASONS.includes(line), 'only the fixed words are logged: ' + line); assert.ok(!String(line).includes(token.slice(0, 12))); }
});

// ---------------------------------------------------------------------------------------------------------------- 5 fails closed
test('5 FAILS CLOSED: a wrong, missing, truncated or old-key signature, a wrong version or scope, an extra field, an unreadable clock and a missing key all give the SAME plain 403', async () => {
  const w = world();
  const { token } = await mint(w);
  const [payload, sig] = token.split('.');
  const flip = (s) => s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA');
  const good = await claimsWithHash();
  const cases = [
    ['a wrong signature', payload + '.' + flip(sig)], ['no signature part', payload], ['an empty signature', payload + '.'], ['no payload', '.' + sig], ['a truncated token', token.slice(0, token.length - 20)],
    ['three parts', token + '.' + sig], ['a signature of the wrong length', payload + '.' + sig.slice(0, 20)], ['not base64', 'zz!!zz.yy!!yy'], ['a token far too long', 'A'.repeat(900)], ['empty', 'x'],
    ['signed with an old key', await forge(good, OLD_KEY)], ['a wrong version', await forge({ ...good, v: 2 })], ['version as text', await forge({ ...good, v: '1' })],
    ['a wrong scope', await forge({ ...good, scope: 'session' })], ['a scope for another thing', await forge({ ...good, scope: 'bundle.write' })], ['an extra field', await forge({ ...good, admin: true })],
    ['a missing field', await forge((({ jti, ...rest }) => rest)(good))], ['a bad project id', await forge({ ...good, project_id: 'not-a-uuid' })], ['a bad owner hash', await forge({ ...good, owner_hash: 'xyz' })],
    ['times as text', await forge({ ...good, exp: String(T0 + 300) })], ['fractional times', await forge({ ...good, exp: T0 + 300.5 })], ['not JSON', await forge(null, KEY, 'not json at all')], ['JSON null', await forge(null, KEY, 'null')], ['a JSON list', await forge(null, KEY, '[1,2,3]')],
  ];
  const plain = await flat(await handle(req(cases[0][1]), w.deps));
  assert.equal(plain.status, 403); assert.equal(plain.body, 'Forbidden');
  for (const [label, t] of cases) assert.deepEqual(await flat(await handle(req(t), w.deps)), plain, label + ': the same answer, byte for byte');
  assert.equal((await handle(req(await forge(good)), w.deps)).status, 200, 'the control: a forged token with the right key and right fields IS good');
  const refuse = async (label, fn) => { const v = world(); const t = (await mint(v)).token; fn(v); assert.deepEqual(await flat(await handle(req(t), v.deps)), plain, label); assert.equal(v.objects.length, 0, label); };
  await refuse('no key', (v) => { v.key = undefined; });
  await refuse('a short key', (v) => { v.key = 'short'; });
  await refuse('an empty key', (v) => { v.key = ''; });
  await refuse('a clock that is NaN', (v) => { v.clock = Number.NaN; });
  await refuse('a clock that is infinite', (v) => { v.clock = Infinity; });
  await refuse('a clock that is a string', (v) => { v.clock = '1800000000'; });
  await refuse('a database that cannot answer', (v) => { v.allowedThrows = true; });
  await refuse('a new key', (v) => { v.key = KEY + '-rotated'; });
  { const v = world(); v.key = '0123456789abcdef'; const t = await forge(await claimsWithHash(), v.key);                                  // signed with a key that is too short, and the function holds the same one
    assert.deepEqual(await flat(await handle(req(t), v.deps)), plain, 'a short key signs nothing, even when both sides hold it'); assert.equal(v.objects.length, 0); }
  { const v = world(); v.projects.set('not-a-uuid', OWNER); v.projects.set('x/../y', OWNER);                                                  // the database would say yes to these, so only the form check stops them
    for (const id of ['not-a-uuid', 'x/../y']) assert.deepEqual(await flat(await handle(req(await forge(await claimsWithHash({ project_id: id }))), v.deps)), plain, 'a project id that is not a uuid: ' + id);
    assert.equal(v.objects.length, 0); }
  assert.equal(await verifyLink(KEY, token, T0) !== null, true);
  assert.equal(await verifyLink(undefined, token, T0), null); assert.equal(await verifyLink(KEY, undefined, T0), null); assert.equal(await verifyLink(KEY, 12345, T0), null);
});

// ---------------------------------------------------------------------------------------------------------------- 6 every read asks
test('6 EVERY READ ASKS: a deleted project, a revoked grant or the connector switched off ends the link at once, and nothing is cached across reads', async () => {
  const w = world();
  const { token } = await mint(w);
  assert.equal((await handle(req(token), w.deps)).status, 200);
  assert.equal((await handle(req(token), w.deps)).status, 200);
  assert.equal(w.asked.length, 2, 'the database was asked on each read');
  w.switchOn = false; assert.equal((await handle(req(token), w.deps)).status, 403, 'the connector switch is off');
  w.switchOn = true; assert.equal((await handle(req(token), w.deps)).status, 200, 'and on again: the same link works (nothing was remembered as refused)');
  w.grants.delete(OWNER); assert.equal((await handle(req(token), w.deps)).status, 403, 'the grant was revoked');
  w.grants.add(OWNER); w.projects.delete(PROJECT); assert.equal((await handle(req(token), w.deps)).status, 403, 'the project was deleted');
  assert.equal(w.asked.length, 6);
  w.projects.set(PROJECT, OWNER); w.allowedThrows = true; assert.equal((await handle(req(token), w.deps)).status, 403, 'a database error refuses');
});

test('the type of the answer is one of three plain ones, whatever the store says (a page is never served as a page)', async () => {
  const w = world();
  const { token } = await mint(w);
  w.source = 'html';
  const r = await handle(req(token), w.deps);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/octet-stream'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('6b the store: no bundle yet is a plain 404 only AFTER the link was accepted; a store that fails is a plain 503 that says nothing of the link; neither follows a redirect', async () => {
  const w = world();
  const { token } = await mint(w);
  w.source = 'none'; let r = await handle(req(token), w.deps); assert.equal(r.status, 404); assert.equal(await r.text(), 'Not available yet.');
  w.source = 'throws'; r = await handle(req(token), w.deps); assert.equal(r.status, 503); assert.ok(!(await r.text()).includes('store down'));
  const bad = await handle(req(token.slice(0, -3) + 'AAA'), w.deps); assert.equal(bad.status, 403, 'a bad link never learns whether a bundle exists');
});

// ---------------------------------------------------------------------------------------------------------------- 7 read only
test('7 READ ONLY: every method but GET is refused with Allow: GET, nothing is a redirect, and the headers are the same safe set on every answer', async () => {
  const w = world();
  const { token } = await mint(w);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const r = await handle(new Request(URLBASE + '/editor-bundle/' + token, { method, ...(method === 'POST' || method === 'PUT' || method === 'PATCH' ? { body: 'x' } : {}) }), w.deps);
    assert.equal(r.status, 405, method); assert.equal(r.headers.get('allow'), 'GET', method); assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(w.objects.length, 0); assert.equal(w.asked.length, 0, 'the database was not even asked');
  for (const t of [token, token + 'x', 'junk']) {
    const r = await handle(req(t), w.deps);
    assert.ok(r.status < 300 || r.status >= 400, 'never a redirect'); assert.equal(r.headers.get('location'), null);
    assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('content-disposition'), null); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  }
});

// ---------------------------------------------------------------------------------------------------------------- 8 nothing else is served
test('8 NOTHING ELSE IS SERVED: path tricks cannot name another object, and the object comes from the token alone', async () => {
  const w = world();
  const { token } = await mint(w);
  const tricks = [
    ['/editor-bundle/../' + token], ['/editor-bundle/' + token + '/..'], ['/editor-bundle/%2e%2e/' + token], ['/editor-bundle/' + token + '%2Fother'], ['/editor-bundle/' + token + '%2f' + OTHER_PROJECT],
    ['/editor-bundle//' + token], ['/editor-bundle/' + token + '/'], ['/editor-bundle/' + token + '/extra'], ['/editor-bundle/' + OTHER_PROJECT + '/' + token], ['/editor-bundle/' + token + '..'],
    ['/' + token], ['/other/' + token], ['/editor-bundles/' + token], ['/editor-bundle/'], ['/editor-bundle'], ['/editor-bundle/%00' + token], ['/editor-bundle/' + token + '%5c..'],
  ];
  for (const [p] of tricks) {
    const res = await handle(new Request(URLBASE + p), w.deps);
    assert.equal(res.status, 403, p);
  }
  assert.equal(w.objects.length, 0, 'no object was asked for by any of them');
  assert.equal((await handle(req(token), w.deps)).status, 200); assert.deepEqual(w.objects, [[PROJECT]]);
});

test('the core stands alone: no network, no environment, no console, no import (only the Web Crypto API and the injected pieces)', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/editor-bundle/core.ts', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\s*\(|Deno\.|process\.|console\.|^import\s|require\(/m.test(src));
});
