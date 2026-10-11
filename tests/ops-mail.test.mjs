// ops-tick and ops-digest: scheduler-only, one alert per incident, silent digest, dry-run by default, live only when fully configured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle as tick } from '../supabase/functions/ops-tick/tick.ts';
import { handle as digest, compose } from '../supabase/functions/ops-digest/digest.ts';
import { chooseSender, dryRunSender, resendSender, OPS_TO } from '../supabase/functions/_shared/ops_mail.ts';

const req = (auth = 'Bearer secret', method = 'POST') => new Request('https://x/functions/v1/f', { method, headers: auth ? { Authorization: auth } : {} });
function outbox() { const rows = []; return { rows, add: async (...a) => { rows.push(a); return true; } }; }
const clean = { actionable: false, items: [], recovered: ['Rendering is back'], support_open: 0, abuse_waiting: 0, rendering: 'ok', digest_sent_today: false,
                ai_day_spent: 0, ai_day_cap: 5, ai_month_spent: 0, ai_month_cap: 60 };

test('only the scheduler (service key) can run either function', async () => {
  for (const auth of [null, 'Bearer nope', 'secret', 'Bearer ']) {
    const o = outbox();
    assert.equal((await tick(req(auth), { serviceKey: 'secret', tick: async () => assert.fail('ran'), markNotified: async () => 0, sender: dryRunSender(o) })).status, 403);
    assert.equal((await digest(req(auth), { serviceKey: 'secret', data: async () => assert.fail('ran'), sender: dryRunSender(o) })).status, 403);
  }
  assert.equal((await tick(req('Bearer '), { serviceKey: '', tick: async () => assert.fail('ran'), markNotified: async () => 0, sender: dryRunSender(outbox()) })).status, 403);
  assert.equal((await tick(req('Bearer secret', 'GET'), { serviceKey: 'secret', tick: async () => assert.fail('ran'), markNotified: async () => 0, sender: dryRunSender(outbox()) })).status, 405);
});

test('tick sends nothing when there are no new alerts, and one message for new ones, marking them notified', async () => {
  const o = outbox(); const marked = [];
  const base = { serviceKey: 'secret', markNotified: async k => { marked.push(k); return k.length; }, sender: dryRunSender(o) };
  let res = await tick(req(), { ...base, tick: async () => ({ rendering: 'ok', reaped: 0, expired: 0, alert_mail_budget: 20, new_alerts: [] }) });
  assert.deepEqual(await res.json(), { rendering: 'ok', reaped: 0, expired: 0, alerts: 0, notified: 0, held: 0, mode: 'dry_run' });
  assert.equal(o.rows.length, 0);
  res = await tick(req(), { ...base, tick: async () => ({ rendering: 'delayed', reaped: 1, expired: 0, alert_mail_budget: 20, new_alerts: [{ key: 'worker_stale', detail: 'Rendering has not checked in for over 3 minutes.' }] }) });
  assert.equal((await res.json()).notified, 1);
  assert.equal(o.rows.length, 1);
  assert.equal(o.rows[0][2], OPS_TO);
  assert.match(o.rows[0][3], /not checked in/);
  assert.deepEqual(marked, [['worker_stale']]);
});

test('a failed send leaves the alert un-notified so the next tick retries it (and the function still answers)', async () => {
  const quiet = console.error; console.error = () => {};
  const marked = [];
  const sender = { mode: 'live', send: async () => { throw new Error('mail down'); } };
  const res = await tick(req(), { serviceKey: 'secret', sender, markNotified: async k => marked.push(k),
    tick: async () => ({ rendering: 'delayed', reaped: 0, expired: 0, alert_mail_budget: 20, new_alerts: [{ key: 'a', detail: 'x' }] }) });
  console.error = quiet;
  assert.equal(res.status, 200);
  assert.equal((await res.json()).notified, 0);
  assert.deepEqual(marked, []);
});

test('the digest is SILENT when nothing needs action, and when it was already sent today', async () => {
  const o = outbox();
  let res = await digest(req(), { serviceKey: 'secret', data: async () => clean, sender: dryRunSender(o) });
  assert.deepEqual(await res.json(), { sent: false, reason: 'nothing needs action' });
  res = await digest(req(), { serviceKey: 'secret', data: async () => ({ ...clean, actionable: true, items: ['x'], digest_sent_today: true }), sender: dryRunSender(o) });
  assert.equal((await res.json()).reason, 'already sent today');
  assert.equal(o.rows.length, 0);
});

test('the digest lists only what needs action, with cost lines, and goes to ryagram@uselai.com', async () => {
  const o = outbox();
  const d = { ...clean, actionable: true, items: ['Rendering has not checked in for over 3 minutes.'], support_open: 2, abuse_waiting: 1, ai_day_spent: 4.2 };
  const res = await digest(req(), { serviceKey: 'secret', data: async () => d, sender: dryRunSender(o) });
  assert.deepEqual(await res.json(), { sent: true, mode: 'dry_run' });
  const [kind, mode, to, subject, body] = o.rows[0];
  assert.deepEqual([kind, mode, to], ['digest', 'dry_run', OPS_TO]);
  assert.match(subject, /3 things need you/);
  assert.match(body, /Rendering has not checked in/);
  assert.match(body, /2 support request/);
  assert.match(body, /1 abuse report/);
  assert.match(body, /\$4\.20 of \$5 today/);
  assert.equal(compose({ ...clean, actionable: true, items: ['one'] }).subject, 'Ryagram daily: 1 thing needs you');
});

test('the sender is dry-run unless EVERYTHING for live is set; live sends before recording and a refusal records nothing', async () => {
  const o = outbox();
  const env = e => k => e[k];
  assert.equal(chooseSender(env({}), o, null).mode, 'dry_run');
  assert.equal(chooseSender(env({ OPS_MAIL_MODE: 'resend' }), o, null).mode, 'dry_run');
  assert.equal(chooseSender(env({ OPS_MAIL_MODE: 'resend', RESEND_API_KEY: 'k' }), o, null).mode, 'dry_run');
  assert.equal(chooseSender(env({ RESEND_API_KEY: 'k', OPS_MAIL_FROM: 'a@b.co' }), o, null).mode, 'dry_run');          // key and from but no MODE: still dry-run
  assert.equal(chooseSender(env({ OPS_MAIL_MODE: 'live', RESEND_API_KEY: 'k', OPS_MAIL_FROM: 'a@b.co' }), o, null).mode, 'dry_run');
  const calls = [];
  const ok = async (url, init) => { calls.push([url, init.headers.Authorization, JSON.parse(init.body)]); return { ok: true, status: 200 }; };
  const live = chooseSender(env({ OPS_MAIL_MODE: 'resend', RESEND_API_KEY: 'k', OPS_MAIL_FROM: 'Ryagram <ops@uselai.com>' }), o, ok);
  assert.equal(live.mode, 'live');
  await live.send({ kind: 'alert', to: OPS_TO, subject: 's', body: 'b' });
  assert.deepEqual(calls[0][2], { from: 'Ryagram <ops@uselai.com>', to: [OPS_TO], subject: 's', text: 'b' });
  assert.equal(o.rows.length, 1);
  assert.equal(o.rows[0][1], 'live');
  const refuse = resendSender(o, 'k', 'f', async () => ({ ok: false, status: 422 }));
  await assert.rejects(refuse.send({ kind: 'alert', to: OPS_TO, subject: 's', body: 'b' }), /refused/);
  assert.equal(o.rows.length, 1);
});

test('when the daily alert-mail allowance is used up nothing is sent and the alerts stay un-notified for the next day and the digest', async () => {
  const o = outbox(); const marked = [];
  const res = await tick(req(), { serviceKey: 'secret', sender: dryRunSender(o), markNotified: async k => marked.push(k),
    tick: async () => ({ rendering: 'delayed', reaped: 0, expired: 0, alert_mail_budget: 0, new_alerts: [{ key: 'a', detail: 'x' }] }) });
  const b = await res.json();
  assert.deepEqual([b.alerts, b.notified, b.held], [1, 0, 1]);
  assert.equal(o.rows.length, 0);
  assert.deepEqual(marked, []);
});
