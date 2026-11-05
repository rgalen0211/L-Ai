// WAITING accounts, the Edge Function side (supabase/functions/_shared/oauth_guard.ts verifyActiveUser, claim-invite, approve-waiting). The database side is
// supabase/tests/test_waiting_accounts.py. Plan: proposals\CONNECT-WAITING-GATE-PLAN-1104.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verifyActiveUser, verifyAppUser, activeGate } from '../supabase/functions/_shared/oauth_guard.ts';
import { handle as claim, OPENED, ALREADY } from '../supabase/functions/claim-invite/claim.ts';
import { handle as approve, compose } from '../supabase/functions/approve-waiting/approve.ts';
import { handle as join, SENT as JOINED } from '../supabase/functions/join/join.ts';
import { handle as deleteAccount } from '../supabase/functions/delete-account/remove.ts';
import { handle as stripeCheckout } from '../supabase/functions/stripe-checkout/checkout.ts';
import { handle as aiEditor } from '../supabase/functions/ai-editor/editor.ts';
import { handle as deliveryUrl } from '../supabase/functions/get-delivery-url/deliver.ts';

const ORIGIN = 'https://uselai.com';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(claims)}.sig`;
const APP = jwt({ sub: 'u-1', role: 'authenticated', session_id: 's-1' });
const OAUTH = jwt({ sub: 'u-1', role: 'authenticated', client_id: 'c-1' });
const UID = '11111111-1111-4111-8111-111111111111';
const auth = () => ({ getUser: async (t) => (String(t).split('.').length === 3 ? { data: { user: { id: 'u-1', email: 'a@example.test' } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }) });
const gate = (open) => ({ isActive: async () => open });
const post = (body, token = APP, extra = {}) => new Request('https://x.test/fn', { method: 'POST',
  headers: { origin: ORIGIN, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });

test('verifyActiveUser: an open account passes, a WAITING one is refused, an AI token is refused first', async () => {
  assert.deepEqual(await verifyActiveUser(auth(), APP, gate(true)), { id: 'u-1', email: 'a@example.test' });
  assert.equal(await verifyActiveUser(auth(), APP, gate(false)), null);
  let asked = 0;
  assert.equal(await verifyActiveUser(auth(), OAUTH, { isActive: async () => { asked++; return true; } }), null);
  assert.equal(asked, 0, 'the gate is not even asked for an AI token');
  assert.equal(await verifyActiveUser(auth(), APP, { isActive: async () => { throw new Error('db down'); } }), null, 'a failed check is NOT open');
  // control: verifyAppUser (the two functions a WAITING person may reach) still lets a WAITING person through
  assert.ok(await verifyAppUser(auth(), APP));
});

test('activeGate fails closed: an error or an odd answer is not open; only a literal true is', async () => {
  const mk = (r) => activeGate({ rpc: async () => r });
  assert.equal(await mk({ data: true, error: null }).isActive('u'), true);
  for (const r of [{ data: false, error: null }, { data: null, error: null }, { data: 'true', error: null }, { data: 1, error: null }, { data: true, error: { message: 'x' } }, { data: undefined, error: null }]) {
    assert.equal(await mk(r).isActive('u'), false, JSON.stringify(r));
  }
  let args;
  await activeGate({ rpc: async (n, a) => { args = [n, a]; return { data: true, error: null }; } }).isActive('abc');
  assert.deepEqual(args, ['account_is_active', { p_user: 'abc' }]);
});

// Each function a WAITING person must not reach, wired the way its index.ts wires it, answers 401 and touches nothing else.
const strict = (extra) => new Proxy({ allowedOrigins: [ORIGIN, 'https://www.uselai.com'], siteUrl: ORIGIN, ...extra }, {
  get(t, k) { if (k in t) return t[k]; throw new Error(`touched ${String(k)} before the person was verified`); },
});
const GATED = [
  ['stripe-checkout', stripeCheckout, { price_code: 'x' }],
  ['ai-editor', aiEditor, { version_id: UID, message: 'hi' }],
  ['get-delivery-url', deliveryUrl, { delivery_id: UID }],
  ['approve-waiting', approve, { user_id: UID, reason: 'fine' }],
];
for (const [name, handle, body] of GATED) {
  test(`${name}: a WAITING person gets 401 and nothing else is touched`, async () => {
    const deps = strict({ verifyUser: (t) => verifyActiveUser(auth(), t, gate(false)) });
    const res = await handle(post(body), deps);
    assert.equal(res.status, 401, name);
  });
  test(`${name}: control - an open person IS verified (so the 401 above is the gate, not a broken test)`, async () => {
    let verified = 0;
    const deps = strict({ verifyUser: async (t) => { verified++; return verifyActiveUser(auth(), t, gate(true)); } });
    await Promise.resolve(handle(post(body), deps)).catch(() => {});
    assert.equal(verified, 1, name);
  });
}

test('delete-account: a WAITING person may delete their own account (wired with verifyAppUser, not the gate)', async () => {
  const src = fs.readFileSync(path.resolve('supabase/functions/delete-account/index.ts'), 'utf8');
  assert.match(src, /verifyAppUser\(service\.auth, jwt\)/);
  assert.doesNotMatch(src, /verifyActiveUser/);
  let verified = 0;
  const deps = strict({ verifyUser: async (t) => { verified++; return verifyAppUser(auth(), t); } });
  await Promise.resolve(deleteAccount(post({ confirm_email: 'a@example.test' }), deps)).catch(() => {});
  assert.equal(verified, 1);
});

// ---------------------------------------------------------------------------------------------------- claim-invite
const claimDeps = (over = {}) => ({ allowedOrigins: [ORIGIN], verifyUser: async (t) => verifyAppUser(auth(), t), claim: async () => ({ ok: true, activated: true }), ...over });

test('claim-invite: a good code opens the account; the words are plain', async () => {
  const res = await claim(post({ code: 'RYA-ABCD-EFGH' }), claimDeps());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { message: OPENED, status: 'active' });
});

test('claim-invite: already open says so, bad and throttled codes are refused, no sign-in is 401, an AI token is 401', async () => {
  assert.equal((await (await claim(post({ code: 'x' }), claimDeps({ claim: async () => ({ ok: true, already: true }) }))).json()).message, ALREADY);
  const bad = await claim(post({ code: 'nope' }), claimDeps({ claim: async () => ({ ok: false, reason: 'invalid' }) }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /isn’t valid, has expired or has been used up/);
  assert.equal((await claim(post({ code: 'x' }), claimDeps({ claim: async () => ({ ok: false, reason: 'throttled' }) }))).status, 429);
  assert.equal((await claim(post({ code: 'x' }, ''), claimDeps())).status, 401);
  assert.equal((await claim(post({ code: 'x' }, OAUTH), claimDeps())).status, 401);
  assert.equal((await claim(post({}), claimDeps())).status, 400);
  assert.equal((await claim(post({ code: 'x' }), claimDeps({ claim: async () => { throw new Error('db'); } }))).status, 500);
});

test('claim-invite: the user id comes from the verified token, never from the body; the caller address is hashed from cf-connecting-ip else the LAST forwarded hop', async () => {
  const seen = [];
  const deps = claimDeps({ claim: async (uid, code, ip) => { seen.push([uid, code, ip]); return { ok: true, activated: true }; } });
  await claim(post({ code: 'C', user_id: 'someone-else' }, APP, { 'cf-connecting-ip': '1.1.1.1' }), deps);
  await claim(post({ code: 'C' }, APP, { 'x-forwarded-for': '9.9.9.9, 2.2.2.2' }), deps);
  await claim(post({ code: 'C' }, APP, { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9, 2.2.2.2' }), deps);
  assert.equal(seen[0][0], 'u-1');
  assert.equal(seen[0][2], seen[2][2], 'cf-connecting-ip wins over the forwarded header');
  assert.notEqual(seen[0][2], seen[1][2]);
  assert.match(seen[1][2], /^[0-9a-f]{64}$/);
});

test('claim-invite: other origins are refused (CORS), only POST', async () => {
  const r = await claim(new Request('https://x.test/fn', { method: 'POST', headers: { origin: 'https://evil.test', authorization: `Bearer ${APP}` }, body: '{"code":"x"}' }), claimDeps());
  assert.equal(r.status, 403);
  assert.equal((await claim(new Request('https://x.test/fn', { method: 'GET', headers: { origin: ORIGIN } }), claimDeps())).status, 405);
});

// ---------------------------------------------------------------------------------------------------- approve-waiting
const apprDeps = (over = {}) => ({ allowedOrigins: [ORIGIN], siteUrl: ORIGIN, verifyUser: async (t) => verifyActiveUser(auth(), t, gate(true)),
  approve: async () => ({ flipped: true, email: 'p@example.test', credits: 20 }), send: async () => ({ mode: 'live' }), ...over });

test('approve-waiting: approve + email; the words say what happened; dry-run says nothing was sent', async () => {
  const sent = [];
  const live = await approve(post({ user_id: UID, reason: 'looks fine' }), apprDeps({ send: async (m) => { sent.push(m); return { mode: 'live' }; } }));
  const j = await live.json();
  assert.equal(live.status, 200);
  assert.equal(j.status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'p@example.test');
  assert.equal(sent[0].subject, 'Your Ryagram access is open');
  assert.match(sent[0].body, /20 welcome credits are waiting for you\./);
  assert.match(sent[0].body, /The Ryagram Team/);
  const dry = await (await approve(post({ user_id: UID, reason: 'looks fine' }), apprDeps({ send: async () => ({ mode: 'dry_run' }) }))).json();
  assert.equal(dry.status, 'saved');
  assert.match(dry.message, /nothing was sent/);
});

test('approve-waiting: nobody is emailed twice, and a failed email never undoes an approval', async () => {
  let sends = 0;
  const again = await approve(post({ user_id: UID, reason: 'again' }), apprDeps({ approve: async () => ({ flipped: false, email: 'p@example.test', credits: 0 }), send: async () => { sends++; return { mode: 'live' }; } }));
  assert.equal((await again.json()).status, 'already_open');
  assert.equal(sends, 0);
  const failed = await approve(post({ user_id: UID, reason: 'fine' }), apprDeps({ send: async () => { throw new Error('smtp'); } }));
  assert.equal(failed.status, 200);
  const j = await failed.json();
  assert.equal(j.status, 'approved_not_emailed');
  assert.match(j.message, /Write to them yourself/);
});

test('approve-waiting: only an admin (the database says), a real id, a reason; 401 for no sign-in and an AI token', async () => {
  assert.equal((await approve(post({ user_id: UID, reason: 'fine' }), apprDeps({ approve: async () => { throw new Error('Only an admin can do this.'); } }))).status, 403);
  assert.equal((await approve(post({ user_id: UID, reason: 'fine' }), apprDeps({ approve: async () => { throw new Error('No such account.'); } }))).status, 404);
  assert.equal((await approve(post({ user_id: 'not-an-id', reason: 'fine' }), apprDeps())).status, 400);
  assert.equal((await approve(post({ user_id: UID, reason: 'x' }), apprDeps())).status, 400);
  assert.equal((await approve(post({ user_id: UID, reason: 'fine' }, ''), apprDeps())).status, 401);
  assert.equal((await approve(post({ user_id: UID, reason: 'fine' }, OAUTH), apprDeps())).status, 401);
});

test('approve-waiting: the email words are the draft Ryan approves (one credit reads right too, none says no credits line)', () => {
  assert.match(compose({ flipped: true, email: 'e', credits: 1 }, ORIGIN).body, /1 welcome credit is waiting for you\./);
  assert.doesNotMatch(compose({ flipped: true, email: 'e', credits: 0 }, ORIGIN).body, /welcome credit/);
  assert.match(compose({ flipped: true, email: 'e', credits: 5 }, 'https://uselai.com/').body, /https:\/\/uselai\.com\/app\//);
});

// ---------------------------------------------------------------------------------------------------- join (Create an account, no code)
const joinDeps = (over = {}) => ({ allowedOrigins: [ORIGIN], siteUrl: ORIGIN, reserve: async () => ({ ok: true }), invite: async () => {}, ...over });
const anon = (body, extra = {}) => new Request('https://x.test/fn', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });

test('join: a mail failure (the Auth services own hourly email allowance run out) gives the SAME answer as a known and an unknown address, so it tells a stranger nothing', async () => {
  const bodies = [];
  for (const invite of [async () => {}, async () => { throw Object.assign(new Error('registered'), { code: 'email_exists' }); },
                        async () => { throw Object.assign(new Error('rate limit'), { code: 'over_email_send_rate_limit' }); }, async () => { throw new Error('smtp'); }]) {
    const r = await join(anon({ email: 'a@example.test' }), joinDeps({ invite }));
    assert.equal(r.status, 200);
    bodies.push(await r.json());
  }
  for (const b of bodies) assert.deepEqual(b, bodies[0]);
  assert.match(bodies[0].message, /try again later/);
});

test('join: the answer is the same whether or not the address already has an account', async () => {
  const fresh = await join(anon({ email: 'new@example.test' }), joinDeps());
  const known = await join(anon({ email: 'old@example.test' }), joinDeps({ invite: async () => { throw Object.assign(new Error('registered'), { code: 'email_exists' }); } }));
  assert.equal(fresh.status, 200); assert.equal(known.status, 200);
  assert.deepEqual(await fresh.json(), await known.json());
  assert.equal((await (await join(anon({ email: 'x@example.test' }), joinDeps())).json()).message, JOINED);
});

test('join: closed, throttled and bad email each say so in plain words; nothing is invited when reserve says no', async () => {
  let invited = 0;
  const invite = async () => { invited++; };
  for (const [reason, status] of [['off', 409], ['throttled', 429], ['email', 400]]) {
    const r = await join(anon({ email: 'a@example.test' }), joinDeps({ reserve: async () => ({ ok: false, reason }), invite }));
    assert.equal(r.status, status, reason);
  }
  assert.equal(invited, 0);
  assert.equal((await join(anon({ email: 'a@example.test' }), joinDeps({ reserve: async () => { throw new Error('db'); } }))).status, 500);
  assert.equal((await join(anon({}), joinDeps())).status, 400);
});

test('join: the caller address is hashed from cf-connecting-ip, else the LAST forwarded hop (never what the client wrote first); email is lower-cased', async () => {
  const seen = [];
  const deps = joinDeps({ reserve: async (e, ip) => { seen.push([e, ip]); return { ok: true }; } });
  await join(anon({ email: 'A@Example.Test' }, { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }), deps);
  await join(anon({ email: 'a@example.test' }, { 'x-forwarded-for': '1.1.1.1, 7.7.7.7' }), deps);
  await join(anon({ email: 'a@example.test' }, { 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1, 7.7.7.7' }), deps);
  assert.equal(seen[0][0], 'a@example.test');
  assert.equal(seen[0][1], seen[1][1], "the first forwarded entry is the client's to forge: only the last hop counts");
  assert.notEqual(seen[0][1], seen[2][1]);
  assert.match(seen[2][1], /^[0-9a-f]{64}$/);
});

test('join: other origins are refused, only POST, and the redirect after the email is the app page', async () => {
  assert.equal((await join(new Request('https://x.test/fn', { method: 'POST', headers: { origin: 'https://evil.test' }, body: '{"email":"a@b.co"}' }), joinDeps())).status, 403);
  assert.equal((await join(new Request('https://x.test/fn', { method: 'GET', headers: { origin: ORIGIN } }), joinDeps())).status, 405);
  let to;
  await join(anon({ email: 'a@example.test' }), joinDeps({ invite: async (_e, redirect) => { to = redirect; } }));
  assert.equal(to, 'https://uselai.com/app/');
});

// ---------------------------------------------------------------------------------------------------- the gate is STICKY
test('every migration after the waiting-accounts file ends with select ryagram_private.gate_apply() before its commit, so a later function or table can never be left open', () => {
  const dir = path.resolve('supabase/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const gate = files.find((f) => f.startsWith('20261104000100_waiting_accounts'));
  assert.ok(gate);
  const later = files.filter((f) => f > gate);
  for (const f of later) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    const body = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).map((l) => l.replace(/\s*--.*$/, '').trim());
    const commit = body.lastIndexOf('commit;');
    assert.ok(commit > 0, f + ' has a commit');
    assert.equal(body[commit - 1], 'select ryagram_private.gate_apply();', f + ' must end with select ryagram_private.gate_apply(); right before commit;');
  }
});

// ---------------------------------------------------------------------------------------------------- no function reaches the database as a person without the gate
test('every Edge Function that signs a person in uses the gate or is on the named WAITING-ok list', () => {
  const FUNCS = path.resolve('supabase/functions');
  const WAITING_OK = ['claim-invite', 'delete-account'];
  const found = [];
  for (const d of fs.readdirSync(FUNCS, { withFileTypes: true }).filter((x) => x.isDirectory() && !x.name.startsWith('_'))) {
    const f = path.join(FUNCS, d.name, 'index.ts');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/verifyAppUser\(/.test(src) && !WAITING_OK.includes(d.name)) found.push(d.name + ': verifyAppUser without the gate');
  }
  assert.deepEqual(found, []);
});
