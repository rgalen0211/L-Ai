// Creator beta applications: the creator-beta function, the form script on /ryagram/, and Ryan's Operations section.
// The database half (closed table, service-role-only writes, admin-only list and decisions) is supabase/tests/test_creator_beta.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { handle, callerAddress, callerKey } from '../supabase/functions/creator-beta/apply.ts';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const SECRET = 'test-secret-not-real-0123456789';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ORIGIN = 'https://uselai.com';
const GOOD = { name: 'Maya Ortiz', email: 'maya@example.com', kind: 'youtuber', makes: 'Weekly explainers on housing', link: 'https://www.youtube.com/@maya',
               question: 'Did cities that legalized duplexes build more homes?' };

function world({ fail } = {}) {
  const applied = [];
  const deps = { allowedOrigins: [ORIGIN, 'https://www.uselai.com'], hashSecret: SECRET, apply: async a => { if (fail) throw fail; applied.push(a); return applied.length; } };
  return { deps, applied };
}
const post = (deps, body, { origin = ORIGIN, method = 'POST', raw, extra = {} } = {}) =>
  handle(new Request('https://x.supabase.co/functions/v1/creator-beta', { method, headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json', ...extra },
                                                                         ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(body) }) }), deps);

// ---- the function --------------------------------------------------------------------------------------------------------------------------------------
test('FUNCTION: a good application from uselai.com is handed to the database once, trimmed, and answered with ok only', async () => {
  const { deps, applied } = world();
  const res = await post(deps, { ...GOOD, name: '  Maya Ortiz  ' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });                               // never an id or a "you already applied"
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(applied, [{ ...GOOD, website: '', caller: '' }]);                  // no address on the request: no per-caller key
});

test('FUNCTION: only uselai.com may post: no origin, a foreign origin, GET and a preflight from elsewhere all get nothing stored', async () => {
  const { deps, applied } = world();
  assert.equal((await post(deps, GOOD, { origin: null })).status, 403);
  assert.equal((await post(deps, GOOD, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(deps, GOOD, { method: 'GET' })).status, 405);
  const pre = await post(deps, null, { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  const ok = await post(deps, null, { method: 'OPTIONS' });
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(applied.length, 0);
});

test('FUNCTION: bad bodies are refused before the database: not JSON, not an object, a missing or non-text field, an oversize body', async () => {
  const { deps, applied } = world();
  assert.equal((await post(deps, null, { raw: '{nope' })).status, 400);
  assert.equal((await post(deps, null, { raw: '[1,2]' })).status, 400);
  assert.equal((await post(deps, null, { raw: 'null' })).status, 400);
  assert.equal((await post(deps, { ...GOOD, link: undefined })).status, 422);
  assert.equal((await post(deps, { ...GOOD, question: 42 })).status, 422);
  assert.equal((await post(deps, null, { raw: JSON.stringify({ ...GOOD, question: 'x'.repeat(9000) }) })).status, 413);
  assert.equal(applied.length, 0);
});

test('FUNCTION: each field is cut to a sane length before the database sees it; the honeypot value is passed on (the database drops it)', async () => {
  const { deps, applied } = world();
  await post(deps, { ...GOOD, question: 'q'.repeat(3000), website: 'http://spam.example' });
  assert.equal(applied[0].question.length, 1200);
  assert.equal(applied[0].website, 'http://spam.example');
});

test('FUNCTION: the database’s own sentences (invalid field 422, too many 429) reach the form; any other failure is a generic 500 with no detail', async () => {
  for (const [code, status] of [['PT422', 422], ['PT429', 429]]) {
    const { deps } = world({ fail: Object.assign(new Error('Enter your name.'), { code }) });
    const res = await post(deps, GOOD);
    assert.equal(res.status, status);
    assert.equal((await res.json()).error, 'Enter your name.');
  }
  for (const err of [Object.assign(new Error('duplicate key value violates unique constraint "x" DETAIL: Key (email)=(a@b.co)'), { code: '23505' }), new Error('connect ECONNREFUSED 10.0.0.1')]) {
    const { deps } = world({ fail: err });
    const res = await post(deps, GOOD);
    assert.equal(res.status, 500);
    const text = JSON.stringify(await res.json());
    assert.match(text, /Couldn.t send that just now/);
    assert.doesNotMatch(text, /duplicate|ECONNREFUSED|10\.0\.0\.1|a@b\.co/);
  }
});

test('PER-CALLER: the address comes from cf-connecting-ip, else the LAST x-forwarded-for hop (never the first, which the client writes); none gives nothing', () => {
  const h = o => new Headers(o);
  assert.equal(callerAddress(h({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), '203.0.113.7');
  assert.equal(callerAddress(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.9' })), '198.51.100.9');              // a client that writes its own first hop changes nothing
  assert.equal(callerAddress(h({ 'x-forwarded-for': '198.51.100.9' })), '198.51.100.9');
  assert.equal(callerAddress(h({})), '');
  assert.equal(callerAddress(h({ 'x-forwarded-for': ' , ' })), '');
});

test('PER-CALLER: the key is a 64-hex hash that never contains the address, differs by address and by (New York) day, and is empty with no address', async () => {
  const a = await callerKey(new Headers({ 'cf-connecting-ip': '203.0.113.7' }), SECRET, new Date('2026-10-14T16:00:00Z'));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('203'));
  assert.equal(a, await callerKey(new Headers({ 'cf-connecting-ip': '203.0.113.7' }), SECRET, new Date('2026-10-14T20:00:00Z')));        // same day, same key
  assert.notEqual(a, await callerKey(new Headers({ 'cf-connecting-ip': '203.0.113.8' }), SECRET, new Date('2026-10-14T16:00:00Z')));    // another address
  assert.notEqual(a, await callerKey(new Headers({ 'cf-connecting-ip': '203.0.113.7' }), SECRET, new Date('2026-10-15T16:00:00Z')));    // another day
  assert.equal(await callerKey(new Headers({}), SECRET, new Date()), '');
});

test('PER-CALLER: the key is a real HMAC under the secret: it equals an independent HMAC, differs with another secret, and no secret is refused, never unsalted', async () => {
  const h = new Headers({ 'cf-connecting-ip': '203.0.113.7' }); const at = new Date('2026-10-14T16:00:00Z');
  const key = await callerKey(h, SECRET, at);
  assert.equal(key, createHmac('sha256', SECRET).update('creator-beta|203.0.113.7|2026-10-14').digest('hex'));
  assert.notEqual(key, await callerKey(h, SECRET + 'x', at));                                  // another secret: another key (so a stolen table cannot be tried against all addresses)
  const bare = (await import('node:crypto')).createHash('sha256').update('creator-beta|203.0.113.7|2026-10-14').digest('hex');
  assert.notEqual(key, bare);                                                                    // no longer the bare hash CC1 showed to be reversible
  await assert.rejects(callerKey(h, '', at), /no hash secret/);
  assert.equal(await callerKey(new Headers({}), '', at), '');                                   // no address: nothing to hash, so no secret needed
  const { deps, applied } = world(); deps.hashSecret = '';
  const res = await post(deps, GOOD, { extra: { 'cf-connecting-ip': '203.0.113.7' } });
  assert.equal(res.status, 500); assert.deepEqual(applied, []);                                // an address with no secret: refused, nothing stored
});

test('PER-CALLER: the function passes the hashed key to the database, and the spammer\u2019s forged first hop does not change it', async () => {
  const { deps, applied } = world();
  await post(deps, GOOD, { extra: { 'x-forwarded-for': '9.9.9.9, 198.51.100.9' } });
  await post(deps, { ...GOOD, email: 'b@example.com' }, { extra: { 'x-forwarded-for': '7.7.7.7, 198.51.100.9' } });
  assert.match(applied[0].caller, /^[0-9a-f]{64}$/);
  assert.equal(applied[0].caller, applied[1].caller);
  assert.ok(!JSON.stringify(applied).includes('198.51.100.9'));
});

test('PER-CALLER: the database refusal (429) reaches the form as its own sentence', async () => {
  const { deps } = world({ fail: Object.assign(new Error('You have sent a few applications already. Please try again in an hour.'), { code: 'PT429' }) });
  const res = await post(deps, GOOD, { extra: { 'cf-connecting-ip': '203.0.113.7' } });
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /few applications already/);
});

test('FUNCTION: index.ts allows only uselai.com, uses the service role through the one database function, and needs no JWT', () => {
  const src = read('supabase/functions/creator-beta/index.ts');
  assert.match(src, /allowedOrigins: \["https:\/\/uselai\.com", "https:\/\/www\.uselai\.com"\]/);
  assert.match(src, /service\.rpc\("creator_beta_apply"/);
  assert.match(src, /--no-verify-jwt/);
  assert.match(src, /p_caller: a\.caller/);
  assert.doesNotMatch(src, /\.from\(/);                                           // it never touches the table directly
});

// ---- the form script -----------------------------------------------------------------------------------------------------------------------------------
function form({ config, fetchImpl, values = {}, website = '' } = {}) {
  const listeners = {};
  const fields = { hidden: false };
  const status = { hidden: true, textContent: '', focus() { this.focused = true; } };
  const button = { disabled: false, textContent: 'Apply for the creator beta' };
  const v = { name: ' Maya Ortiz ', email: 'maya@example.com', kind: 'youtuber', makes: 'Weekly explainers', link: 'https://www.youtube.com/@maya',
              question: 'Did cities that legalized duplexes build more homes?', ...values };
  const elements = Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value }]));
  elements.website = { value: website };
  const f = { elements, querySelector: s => (s === '.creator-fields' ? fields : button), addEventListener: (t, fn) => { listeners[t] = fn; }, setAttribute() {}, removeAttribute() {} };
  const requests = [];
  const window = { ryagramConfig: config };
  vm.runInNewContext(read('assets/creator-beta.js'), {
    window, document: { getElementById: id => ({ 'creator-form': f, 'creator-status': status })[id] },
    fetch: (url, opts) => { requests.push({ url, opts }); return (fetchImpl || (async () => ({ ok: true, status: 200 })))(url, opts); },
    AbortController, setTimeout, clearTimeout, Object, JSON, String, Promise
  });
  return { submit: () => listeners.submit({ preventDefault() {} }), requests, status, fields, button, window };
}
const ON = { supabaseUrl: 'https://proj.supabase.co/', supabaseKey: 'sb_publishable_test', creatorBeta: true };

test('FORM: the same rules as the database, with plain sentences', () => {
  const { checkCreator } = form({ config: ON }).window.ryagramCreator;
  assert.equal(checkCreator(GOOD), null);
  assert.match(checkCreator({ ...GOOD, name: 'M' }), /name/);
  assert.match(checkCreator({ ...GOOD, email: 'maya' }), /email/);
  assert.match(checkCreator({ ...GOOD, kind: '' }), /Choose/);
  assert.match(checkCreator({ ...GOOD, makes: 'ab' }), /what you make/);
  for (const link of ['http://x.example/a', 'youtube.com/@maya', 'javascript:alert(1)', 'https://a b.example']) assert.match(checkCreator({ ...GOOD, link }), /https:\/\//, link);
  assert.match(checkCreator({ ...GOOD, question: 'why?' }), /question/);
  assert.match(checkCreator({ ...GOOD, question: 'x'.repeat(1001) }), /question/);
});

test('FORM: a good submit posts trimmed JSON to the creator-beta function with the public key only, then thanks them and hides the fields', async () => {
  const f = form({ config: ON });
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'https://proj.supabase.co/functions/v1/creator-beta');
  assert.deepEqual(Object.keys(f.requests[0].opts.headers).sort(), ['Content-Type', 'apikey']);
  assert.equal(f.requests[0].opts.headers.apikey, 'sb_publishable_test');
  assert.deepEqual(JSON.parse(f.requests[0].opts.body), { name: 'Maya Ortiz', email: 'maya@example.com', kind: 'youtuber', makes: 'Weekly explainers',
    link: 'https://www.youtube.com/@maya', question: 'Did cities that legalized duplexes build more homes?', website: '' });
  assert.equal(f.fields.hidden, true);
  assert.match(f.status.textContent, /Thanks, we have your application/);
  assert.equal(f.status.focused, true);
  assert.equal(f.button.disabled, false);
});

test('FORM: until it is switched on (creatorBeta false, or no project) NOTHING is sent and the person is told to email', async () => {
  for (const config of [{ ...ON, creatorBeta: false }, { creatorBeta: true }, {}]) {
    const f = form({ config });
    await f.submit();
    assert.equal(f.requests.length, 0);
    assert.match(f.status.textContent, /ryagram@uselai\.com/);
    assert.equal(f.fields.hidden, false);
  }
});

test('FORM: a bad entry is caught before any request; a filled honeypot looks successful and sends nothing', async () => {
  const bad = form({ config: ON, values: { link: 'http://insecure.example' } });
  await bad.submit();
  assert.equal(bad.requests.length, 0);
  assert.match(bad.status.textContent, /https:\/\//);
  const bot = form({ config: ON, website: 'http://spam.example' });
  await bot.submit();
  assert.equal(bot.requests.length, 0);
  assert.match(bot.status.textContent, /Thanks/);
});

test('FORM: the function’s 422/429 sentence is shown; any other failure or a dropped connection keeps their answers and says to retry or email', async () => {
  const f422 = form({ config: ON, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: 'Too many applications right now. Please try again later.' }) }) });
  await f422.submit();
  assert.match(f422.status.textContent, /Too many applications/);
  assert.equal(f422.fields.hidden, false);
  const f500 = form({ config: ON, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: 'secret detail' }) }) });
  await f500.submit();
  assert.match(f500.status.textContent, /couldn.t send that just now.*ryagram@uselai\.com/);
  assert.doesNotMatch(f500.status.textContent, /secret detail/);
  const drop = form({ config: ON, fetchImpl: async () => { throw new Error('offline'); } });
  await drop.submit();
  assert.match(drop.status.textContent, /connection dropped.*still here/);
  assert.equal(drop.fields.hidden, false);
  assert.equal(drop.button.disabled, false);
});

test('FORM: creatorBeta ships OFF in the config (Ryan switches it on after the SQL and the function are live)', () => {
  assert.match(read('assets/ryagram-config.js'), /creatorBeta: false,/);
});

// ---- Ryan's Operations section -----------------------------------------------------------------------------------------------------------------------
function loadAssets(file) {
  const window = {};
  vm.runInNewContext(read(`assets/${file}`), { window });
  return window;
}
const O = loadAssets('app-ops.js').ryagramOps;
const ryagramData = loadAssets('app-data.js').ryagramData;

test('OPS: wording says what approving does NOT do, and handles "not set up yet"', () => {
  assert.match(O.creatorLine(null), /not set up yet/);
  assert.match(O.creatorLine({ waiting: 1, approved: 2, declined: 3 }), /^1 application waiting\. 2 approved, 3 declined/);
  assert.match(O.creatorLine({ waiting: 2, approved: 0, declined: 0 }), /^2 applications waiting/);
  assert.match(O.creatorLine({ waiting: 0, approved: 0, declined: 0 }), /Approving sends nothing and grants no credits/);
  assert.deepEqual(Object.keys(O.CREATOR_KIND_WORDS).sort(), ['journalist', 'newsletter', 'other', 'podcaster', 'researcher', 'teacher', 'youtuber']);
});

test('OPS: the data layer lists waiting applications and decisions go through admin_decide_creator only', async () => {
  const client = createFakeClient();
  const data = ryagramData(client);
  const first = await data.adminCreatorBeta();
  assert.equal(first.waiting, 2);
  assert.deepEqual(first.items.map(a => a.id), [1, 2]);                              // oldest first
  await data.adminDecideCreator(2, 'approved');
  await data.adminDecideCreator(1, 'declined');
  const after = await data.adminCreatorBeta();
  assert.deepEqual([after.waiting, after.approved, after.declined], [0, 1, 1]);
  assert.deepEqual(client.log.filter(l => /creator/.test(l.rpc)).map(l => l.rpc),
    ['admin_creator_beta', 'admin_decide_creator', 'admin_decide_creator', 'admin_creator_beta']);
});

test('OPS: #/admin/ops shows the section with Approve and Decline, and still loads when the creator SQL is not applied', () => {
  const src = read('assets/app-library.js');
  assert.match(src, /try \{ cb = await data\.adminCreatorBeta\(\); \} catch \{ cb = null; \}/);
  assert.match(src, /section\(`Creator beta applications \(\$\{cb \? cb\.waiting : 0\}\)`/);
  assert.match(src, /button\('Approve only', \(\) => data\.adminDecideCreator\(a\.id, 'approved'\)\)/);                   // (the invite button is tested in creator-flow.test.mjs)
  assert.match(src, /button\('Decline', \(\) => data\.adminDecideCreator\(a\.id, 'declined'\)\)/);
  assert.match(src, /rel: 'noopener noreferrer'/);                                    // their link is theirs: it opens without handing over this page
});
