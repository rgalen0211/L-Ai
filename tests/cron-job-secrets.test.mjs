// Per-job secrets for the three pg_net cron jobs (Q91 follow-up, 2026-10-25). The scheduler sends its OWN secret, not the service-role key,
// because pg_net keeps each call (headers included) and its reply where every database login can read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle as tick } from '../supabase/functions/ops-tick/tick.ts';
import { handle as digest } from '../supabase/functions/ops-digest/digest.ts';
import { handle as sync } from '../supabase/functions/cost-sync/sync.ts';
import { dryRunSender, whoCalls, reply, JOB_SECRET_MIN } from '../supabase/functions/_shared/ops_mail.ts';

const SERVICE = 'sb_secret_service_role_key_value_0123456789';
const TICK = 'tick-job-secret-0123456789abcdef0123456789abcdef';
const DIGEST = 'digest-job-secret-0123456789abcdef0123456789abcdef';
const SYNC = 'sync-job-secret-0123456789abcdef0123456789abcdef';
const req = (auth, method = 'POST') => new Request('https://x/functions/v1/f', { method, headers: auth ? { Authorization: auth } : {} });
const sender = () => dryRunSender({ add: async () => true });
const tickDeps = (over = {}) => ({ serviceKey: SERVICE, jobSecret: TICK, sender: sender(), markNotified: async () => 0,
  tick: async () => ({ rendering: 'ok', reaped: 3, expired: 1, alert_mail_budget: 20, new_alerts: [] }), ...over });
const digestDeps = (over = {}) => ({ serviceKey: SERVICE, jobSecret: DIGEST, sender: sender(), data: async () => ({ actionable: false, items: [], recovered: [], support_open: 0, abuse_waiting: 0,
  rendering: 'ok', digest_sent_today: false, ai_day_spent: 0, ai_day_cap: 5, ai_month_spent: 0, ai_month_cap: 60 }), ...over });
const syncDeps = (over = {}) => ({ serviceKey: SERVICE, jobSecret: SYNC, stripeKey: undefined, fetch: async () => assert.fail('no stripe call'), getCursor: async () => null, setCursor: async () => {},
  record: async () => 0, tick: async () => ({ alarms: ['daily limit reached: 4.20 of 5'] }), now: () => 1000, ...over });

const JOBS = [
  ['ops-tick', tick, tickDeps, TICK],
  ['ops-digest', digest, digestDeps, DIGEST],
  ['cost-sync', sync, syncDeps, SYNC],
];

for (const [name, run, deps, secret] of JOBS) {
  test(`${name}: its own job secret runs it, and the reply is ok and nothing else`, async () => {
    const res = await run(req('Bearer ' + secret), deps());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  test(`${name}: the service-role key still runs it by hand, with the full reply`, async () => {
    const res = await run(req('Bearer ' + SERVICE), deps());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.notDeepEqual(body, { ok: true });
    assert.ok(Object.keys(body).length > 0 && !('ok' in body && Object.keys(body).length === 1));
  });

  test(`${name}: another job's secret, a near miss, a prefix, nothing and a short secret are all refused and nothing runs`, async () => {
    const other = JOBS.find((j) => j[0] !== name)[3];
    const d = deps({ tick: async () => assert.fail('ran'), data: async () => assert.fail('ran'), getCursor: async () => assert.fail('ran') });
    for (const auth of ['Bearer ' + other, 'Bearer ' + secret + 'x', 'Bearer ' + secret.slice(0, -1), 'Bearer ' + secret.toUpperCase(), secret, 'Bearer ', null]) {
      assert.equal((await run(req(auth), d)).status, 403, String(auth));
    }
  });

  test(`${name}: a secret that is empty, unset or shorter than ${JOB_SECRET_MIN} characters is never a way in`, async () => {
    for (const weak of [undefined, '', 'short', 'x'.repeat(JOB_SECRET_MIN - 1)]) {
      const d = deps({ jobSecret: weak, serviceKey: SERVICE, tick: async () => assert.fail('ran'), data: async () => assert.fail('ran'), getCursor: async () => assert.fail('ran') });
      for (const auth of ['Bearer ' + (weak ?? ''), 'Bearer undefined', 'Bearer ']) assert.equal((await run(req(auth), d)).status, 403, `${weak} / ${auth}`);
    }
  });

  test(`${name}: it still refuses GET, even with the right secret`, async () => {
    assert.equal((await run(req('Bearer ' + secret, 'GET'), deps())).status, 405);
  });
}

test('a failure seen by the scheduler is "failed" with no error text; the same failure seen by Ryan has it', async () => {
  const boom = () => { throw new Error('relation ops_secret_table does not exist'); };
  for (const [name, run, deps, secret] of [['ops-tick', tick, tickDeps({ tick: boom }), TICK], ['ops-digest', digest, digestDeps({ data: boom }), DIGEST], ['cost-sync', sync, syncDeps({ tick: boom }), SYNC]]) {
    const job = await run(req('Bearer ' + secret), deps);
    assert.equal(job.status, 500, name);
    assert.equal(JSON.stringify(await job.json()), '{"ok":false}', name);
    const hand = await run(req('Bearer ' + SERVICE), deps);
    assert.equal(hand.status, 500, name);
    assert.notEqual(JSON.stringify(await hand.json()), '{"ok":false}', name);
  }
});

test('cost-sync: the scheduler never sees the ledger figures or a Stripe error in the reply', async () => {
  const res = await sync(req('Bearer ' + SYNC), syncDeps({ stripeKey: 'rk_test_abc123', fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API Key provided: rk_test_abc123' } }) }) }));
  assert.equal(res.status, 200);
  assert.equal(JSON.stringify(await res.json()), '{"ok":true}');
});

test('ops-digest: "already sent" and "nothing needs action" are ok to the scheduler, and a failed send is failed', async () => {
  const sent = await digest(req('Bearer ' + DIGEST), digestDeps({ data: async () => ({ ...(await digestDeps().data()), actionable: true, items: ['x'], digest_sent_today: true }) }));
  assert.equal(JSON.stringify(await sent.json()), '{"ok":true}');
  const down = await digest(req('Bearer ' + DIGEST), digestDeps({ sender: { mode: 'live', send: async () => { throw new Error('mail down'); } },
    data: async () => ({ ...(await digestDeps().data()), actionable: true, items: ['x'] }) }));
  assert.equal(down.status, 502);
  assert.equal(JSON.stringify(await down.json()), '{"ok":false}');
});

test('whoCalls and reply: job, service, nobody; the reply shape follows the caller', async () => {
  assert.equal(whoCalls(req('Bearer ' + TICK), SERVICE, TICK), 'job');
  assert.equal(whoCalls(req('Bearer ' + SERVICE), SERVICE, TICK), 'service');
  assert.equal(whoCalls(req('Bearer nope'), SERVICE, TICK), null);
  assert.equal(whoCalls(req('Bearer ' + SERVICE), '', TICK), null);        // an unset service key is never a way in either
  assert.deepEqual(await reply('job', 502, { detail: 'x' }).json(), { ok: false });
  assert.deepEqual(await reply('service', 502, { detail: 'x' }).json(), { detail: 'x' });
});

test('MUST-FAIL: with the old service-key-only check, the job secret would be refused, so these tests could not pass against the old code', async () => {
  const old = (r, key) => key.length > 0 && (r.headers.get('authorization') ?? '') === `Bearer ${key}`;
  assert.equal(old(req('Bearer ' + TICK), SERVICE), false);
});

test('each function reads ONLY its own secret name, and none reads another job\'s', () => {
  const read = (f) => fs.readFileSync(new URL('../supabase/functions/' + f, import.meta.url), 'utf8');
  const names = { 'ops-tick/index.ts': 'OPS_TICK_SECRET', 'ops-digest/index.ts': 'OPS_DIGEST_SECRET', 'cost-sync/index.ts': 'COST_SYNC_SECRET' };
  for (const [file, mine] of Object.entries(names)) {
    const got = [...read(file).matchAll(/Deno\.env\.get\("([A-Z_]*SECRET[A-Z_]*)"\)/g)].map((m) => m[1]);
    assert.deepEqual(got, [mine], file);
  }
});

test('the README schedules all three jobs with their own Vault secret and no job reads the service-role key', () => {
  const md = fs.readFileSync(new URL('../supabase/README.md', import.meta.url), 'utf8');
  const jobs = [...md.matchAll(/cron\.schedule\('([a-z-]+)'[\s\S]*?\$\$\);/g)].filter((m) => /net\.http_post/.test(m[0]));
  assert.deepEqual(jobs.map((m) => m[1]).sort(), ['cost-sync', 'ops-digest', 'ops-tick']);
  for (const [, name] of jobs) {
    const block = jobs.find((j) => j[1] === name)[0];
    assert.match(block, new RegExp(`name = 'cron_${name.replace('-', '_')}'`), name);
    assert.doesNotMatch(block, /service_role_key/, name);
  }
});
