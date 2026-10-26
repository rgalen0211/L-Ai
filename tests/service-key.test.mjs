// Which secret key the functions use: FUNCTIONS_KEY_NAME picks one BY NAME from SUPABASE_SECRET_KEYS; unset = SUPABASE_SERVICE_ROLE_KEY as before;
// set but not found = a plain 503 and NO fall back to the old key (CC1 22:51).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveServiceKey, guardedServe, NOT_SET_UP } from '../supabase/functions/_shared/service_key.ts';
import { whoCalls } from '../supabase/functions/_shared/ops_mail.ts';
import { handle as tick } from '../supabase/functions/ops-tick/tick.ts';
import { dryRunSender } from '../supabase/functions/_shared/ops_mail.ts';

const OLD = 'sb_secret_OLD_default_key_value_0123456789abcdef';
const NEW = 'sb_secret_NEW_functions_key_value_0123456789abcdef';
const NAME = 'functions_2026_10_25';
const env = (vars) => (name) => vars[name];
const dict = (o) => JSON.stringify(o);

test('FUNCTIONS_KEY_NAME not set: SUPABASE_SERVICE_ROLE_KEY exactly as today, whatever else is in the dictionary', () => {
  const sk = resolveServiceKey(env({ SUPABASE_SERVICE_ROLE_KEY: OLD, SUPABASE_SECRET_KEYS: dict({ default: OLD, [NAME]: NEW }) }));
  assert.deepEqual(sk, { key: OLD, forClient: OLD, problem: '' });
  assert.equal(resolveServiceKey(env({ SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: '   ' })).key, OLD);        // blank counts as not set
});

test('not set and no old key either: a problem, never an empty key quietly used', () => {
  const sk = resolveServiceKey(env({}));
  assert.equal(sk.key, '');
  assert.notEqual(sk.problem, '');
  assert.notEqual(sk.forClient, '');                                       // createClient needs something; a guarded function never uses it
});

test('FUNCTIONS_KEY_NAME set and present: that key, not the old one', () => {
  const sk = resolveServiceKey(env({ SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: dict({ default: OLD, [NAME]: NEW }) }));
  assert.deepEqual(sk, { key: NEW, forClient: NEW, problem: '' });
  assert.equal(resolveServiceKey(env({ FUNCTIONS_KEY_NAME: ` ${NAME} `, SUPABASE_SECRET_KEYS: dict({ [NAME]: NEW }) })).key, NEW);       // works with no old variable at all
});

test('FUNCTIONS_KEY_NAME set but nothing usable: refused, and NEVER the old key (the hand test shows the mistake before anything is deleted)', () => {
  const cases = {
    'no dictionary': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME },
    'unreadable JSON': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: '{not json' },
    'a list, not a dictionary': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: dict([OLD, NEW]) },
    'null': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: 'null' },
    'no entry of that name': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: dict({ default: OLD }) },
    'an empty entry': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: dict({ [NAME]: '' }) },
    'an entry that is not text': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: dict({ [NAME]: { key: NEW } }) },
    'an inherited name (constructor)': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: 'constructor', SUPABASE_SECRET_KEYS: dict({ default: OLD }) },
    'the name __proto__': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: '__proto__', SUPABASE_SECRET_KEYS: dict({ default: OLD }) },
    'a name with a dash': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: 'functions-2026', SUPABASE_SECRET_KEYS: dict({ 'functions-2026': NEW }) },
    'a capital letter': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: 'Functions', SUPABASE_SECRET_KEYS: dict({ Functions: NEW }) },
    'a name over 64 characters': { SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: 'a'.repeat(65), SUPABASE_SECRET_KEYS: dict({ ['a'.repeat(65)]: NEW }) },
  };
  for (const [what, vars] of Object.entries(cases)) {
    const sk = resolveServiceKey(env(vars));
    assert.equal(sk.key, '', what);
    assert.notEqual(sk.problem, '', what);
    assert.ok(![sk.key, sk.forClient, sk.problem].some((v) => v.includes(OLD) || v.includes(NEW)), `${what}: no key value in the result`);
  }
});

test('with a problem every request gets the same plain 503 and the handler never runs; the log names the key, never a value', async () => {
  const logged = [];
  const real = console.error; console.error = (...a) => logged.push(a.join(' '));
  try {
    let installed;
    const sk = resolveServiceKey(env({ SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: dict({ default: OLD }) }));
    guardedServe(sk, (h) => { installed = h; })(() => assert.fail('the handler ran'));
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const res = await installed(new Request('https://x/functions/v1/f', { method, headers: { Authorization: 'Bearer ' + OLD } }));
      assert.equal(res.status, 503, method);
      assert.deepEqual(await res.json(), { error: NOT_SET_UP });
    }
  } finally { console.error = real; }
  assert.equal(logged.length, 1);
  assert.match(logged[0], new RegExp(NAME));
  assert.ok(!logged[0].includes(OLD) && !logged[0].includes(NEW));
});

test('with no problem the handler is installed untouched', async () => {
  let installed; const handler = () => new Response('ok');
  guardedServe(resolveServiceKey(env({ SUPABASE_SERVICE_ROLE_KEY: OLD })), (h) => { installed = h; })(handler);
  assert.equal(installed, handler);
});

test('once the name points at the new key, the OLD key is not accepted by the bearer check, the NEW one is', async () => {
  const sk = resolveServiceKey(env({ SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: dict({ default: OLD, [NAME]: NEW }) }));
  const req = (k) => new Request('https://x/functions/v1/ops-tick', { method: 'POST', headers: { Authorization: 'Bearer ' + k } });
  assert.equal(whoCalls(req(OLD), sk.key), null);
  assert.equal(whoCalls(req(NEW), sk.key), 'service');
  const deps = { serviceKey: sk.key, sender: dryRunSender({ add: async () => true }), markNotified: async () => 0,
    tick: async () => ({ rendering: 'ok', reaped: 0, expired: 0, alert_mail_budget: 20, new_alerts: [] }) };
  assert.equal((await tick(req(OLD), deps)).status, 403);                  // the hand test: OLD key 403
  const res = await tick(req(NEW), deps);                                  // NEW key 200 and the full reply
  assert.equal(res.status, 200);
  assert.ok('rendering' in await res.json());
});

test('MUST-FAIL: a fall back to the old key would pass the "refused" cases above, so this proves the check can fail', () => {
  const fallingBack = (vars) => { const sk = resolveServiceKey(env(vars)); return sk.key || vars.SUPABASE_SERVICE_ROLE_KEY; };
  assert.equal(fallingBack({ SUPABASE_SERVICE_ROLE_KEY: OLD, FUNCTIONS_KEY_NAME: NAME, SUPABASE_SECRET_KEYS: dict({ default: OLD }) }), OLD);
});

const FUNCS = path.resolve(import.meta.dirname, '../supabase/functions');
const tsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? tsFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);

test('no function reads SUPABASE_SERVICE_ROLE_KEY directly any more: only the shared helper does', () => {
  const readers = tsFiles(FUNCS).filter((f) => /\b(?:Deno\.env\.get|env)\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(FUNCS, f).replace(/\\/g, '/'));
  assert.deepEqual(readers, ['_shared/service_key.ts']);
});

test('every function that uses the service key resolves it through the helper and serves through the guard', () => {
  const users = ['ai-editor', 'cost-sync', 'creator-beta', 'delete-account', 'film-page', 'get-delivery-url', 'guided-builder', 'ops-digest', 'ops-tick',
                 'purge-partial-uploads', 'purge-uploads', 'redeem-invite', 'stripe-checkout', 'stripe-webhook'];
  for (const f of users) {
    const src = fs.readFileSync(path.join(FUNCS, f, 'index.ts'), 'utf8');
    assert.match(src, /import \{ guardedServe, resolveServiceKey \} from "\.\.\/_shared\/service_key\.ts";/, f);
    assert.match(src, /const sk = resolveServiceKey\(\);/, f);
    assert.match(src, /const serve = guardedServe\(sk\);/, f);
    assert.doesNotMatch(src, /Deno\.serve\(/, f);
    assert.match(src, /\bserve\(/, f);
    assert.match(src, /sk\.(key|forClient)/, f);
  }
  // and the list is complete: no other function folder reads the service key by any route
  const others = fs.readdirSync(FUNCS, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_') && !users.includes(e.name)).map((e) => e.name);
  for (const f of others) for (const file of tsFiles(path.join(FUNCS, f))) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /SERVICE_ROLE|sk\.key|resolveServiceKey/, `${f} uses the key but is not in the list`);
});

test('the per-job cron secrets are untouched: ops-tick, ops-digest and cost-sync still read their own secret names (purge-uploads gets its own with Q218)', () => {
  const names = { 'ops-tick': 'OPS_TICK_SECRET', 'ops-digest': 'OPS_DIGEST_SECRET', 'cost-sync': 'COST_SYNC_SECRET' };
  for (const [f, n] of Object.entries(names)) assert.ok(fs.readFileSync(path.join(FUNCS, f, 'index.ts'), 'utf8').includes(`Deno.env.get("${n}")`), f);
});

test('a problem must give the plain 503, not a boot error: no function builds its database client from the bare key at module level (createClient refuses an empty key)', () => {
  const users = ['ai-editor', 'cost-sync', 'creator-beta', 'delete-account', 'film-page', 'get-delivery-url', 'guided-builder', 'ops-digest', 'ops-tick',
                 'purge-partial-uploads', 'purge-uploads', 'redeem-invite', 'stripe-checkout', 'stripe-webhook'];
  for (const f of users) {
    const src = fs.readFileSync(path.join(FUNCS, f, 'index.ts'), 'utf8');
    if (f === 'purge-partial-uploads') continue;                       // built inside the handler, after the guard and the caller check: the key is real there
    assert.doesNotMatch(src, /createClient\([^;]*?,\s*(?:serviceKey|sk\.key)\s*[,)]/s, `${f}: createClient gets the bare key`);
  }
});
