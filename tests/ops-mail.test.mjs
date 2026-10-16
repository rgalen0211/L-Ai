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
  assert.deepEqual(await res.json(), { rendering: 'ok', reaped: 0, expired: 0, alerts: 0, urgent: 0, urgent_held: 0, notified: 0, held: 0, mode: 'dry_run' });
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

test('a child-safety (URGENT) alert is sent at once, in its own message, even when the daily alert-mail allowance is used up; ordinary alerts still wait', async () => {
  const o = outbox(); const marked = [];
  const res = await tick(req(), { serviceKey: 'secret', sender: dryRunSender(o), markNotified: async k => { marked.push(k); return k.length; },
    tick: async () => ({ rendering: 'ok', reaped: 0, expired: 0, alert_mail_budget: 0, new_alerts: [
      { key: 'urgent:child_safety:7', detail: 'URGENT: child-safety report #7 on a public film page. The page is HIDDEN pending your review.', urgent: true },
      { key: 'worker_stale', detail: 'Rendering has not checked in for over 3 minutes.', urgent: false }] }) });
  const b = await res.json();
  assert.deepEqual([b.alerts, b.urgent, b.notified, b.held], [2, 1, 1, 1]);
  assert.equal(o.rows.length, 1);
  assert.match(o.rows[0][3], /^URGENT: child-safety report #7/);
  assert.equal(o.rows[0][2], OPS_TO);
  assert.match(o.rows[0][4], /Review now: #\/admin\/ops/);
  assert.deepEqual(marked, [['urgent:child_safety:7']]);                      // only the urgent one is marked; the ordinary one waits
});

test('several urgent alerts make one URGENT message; a failed urgent send leaves them un-notified so the next tick sends them again', async () => {
  const o = outbox(); const marked = [];
  const alerts = [1, 2, 3].map(n => ({ key: `urgent:child_safety:${n}`, detail: `URGENT: child-safety report #${n}`, urgent: true }));
  const ok = await tick(req(), { serviceKey: 'secret', sender: dryRunSender(o), markNotified: async k => { marked.push(k); return k.length; },
    tick: async () => ({ rendering: 'ok', reaped: 0, expired: 0, alert_mail_budget: 20, new_alerts: alerts }) });
  assert.equal((await ok.json()).urgent, 3);
  assert.equal(o.rows.length, 1);
  assert.match(o.rows[0][3], /^URGENT: 3 child-safety reports/);
  const quiet = console.error; console.error = () => {};
  const bad = await tick(req(), { serviceKey: 'secret', sender: { mode: 'live', send: async () => { throw new Error('mail down'); } }, markNotified: async k => { marked.push(['BAD', k]); return 0; },
    tick: async () => ({ rendering: 'ok', reaped: 0, expired: 0, alert_mail_budget: 20, new_alerts: alerts }) });
  console.error = quiet;
  assert.equal((await bad.json()).urgent, 0);
  assert.equal(marked.some(m => m[0] === 'BAD'), false);
});

// ---- Ryan's answer (2026-10-14): the FIRST urgent mail at once, then ONE grouped mail every 15 minutes, nothing dropped, outside the daily allowance
const urgentAlerts = ids => ids.map(n => ({ key: `urgent:child_safety:${n}`, detail: `URGENT: child-safety report #${n} on a public film page.`, urgent: true }));
const tickWith = (o, marked, r) => tick(req(), { serviceKey: 'secret', sender: dryRunSender(o), markNotified: async k => { marked.push(k); return k.length; },
  tick: async () => ({ rendering: 'ok', reaped: 0, expired: 0, alert_mail_budget: 20, new_alerts: [], ...r }) });

test('URGENT cadence: while the 15-minute wait is running the urgent alerts are HELD (un-notified, unsent); when it is over they all go in ONE mail of kind urgent', async () => {
  const o = outbox(); const marked = [];
  let b = await (await tickWith(o, marked, { urgent_wait_s: 600, new_alerts: urgentAlerts([4, 5]) })).json();
  assert.deepEqual([b.urgent, b.urgent_held, b.notified], [0, 2, 0]);
  assert.deepEqual([o.rows.length, marked.length], [0, 0]);                       // nothing sent, nothing marked: they wait for the next mail
  b = await (await tickWith(o, marked, { urgent_wait_s: 0, new_alerts: urgentAlerts([4, 5, 6]) })).json();
  assert.deepEqual([b.urgent, b.urgent_held, b.notified], [3, 0, 3]);
  assert.equal(o.rows.length, 1);
  assert.equal(o.rows[0][0], 'urgent');                                           // its own kind: never counted in the ordinary allowance
  for (const n of [4, 5, 6]) assert.match(o.rows[0][4], new RegExp(`child-safety report #${n}\\b`));
  assert.deepEqual(marked, [['urgent:child_safety:4', 'urgent:child_safety:5', 'urgent:child_safety:6']]);
});

test('URGENT cadence: an older database without urgent_wait_s behaves as "send now" (the first one is never held)', async () => {
  const o = outbox(); const marked = [];
  const b = await (await tickWith(o, marked, { new_alerts: urgentAlerts([1]) })).json();
  assert.deepEqual([b.urgent, o.rows.length, o.rows[0][0]], [1, 1, 'urgent']);
});

test('URGENT cadence: the daily allowance never holds an urgent mail and an urgent mail is never an ordinary "alert" row', async () => {
  const o = outbox(); const marked = [];
  const b = await (await tickWith(o, marked, { alert_mail_budget: 0, urgent_wait_s: 0, new_alerts: [...urgentAlerts([9]), { key: 'worker_stale', detail: 'Rendering has not checked in.', urgent: false }] })).json();
  assert.deepEqual([b.urgent, b.held, o.rows.map(r => r[0])], [1, 1, ['urgent']]);
});

test('URGENT cadence: a held ordinary alert is not affected by the urgent wait, and a failed urgent send keeps the alerts for the next minute', async () => {
  const o = outbox(); const marked = [];
  const quiet = console.error; console.error = () => {};
  const bad = await tick(req(), { serviceKey: 'secret', sender: { mode: 'live', send: async () => { throw new Error('mail down'); } }, markNotified: async k => { marked.push(k); return k.length; },
    tick: async () => ({ rendering: 'ok', reaped: 0, expired: 0, alert_mail_budget: 20, urgent_wait_s: 0, new_alerts: urgentAlerts([1, 2]) }) });
  console.error = quiet;
  assert.deepEqual([(await bad.json()).urgent, marked.length], [0, 0]);
  const retry = await (await tickWith(o, marked, { urgent_wait_s: 0, new_alerts: urgentAlerts([1, 2]) })).json();
  assert.equal(retry.urgent, 2);                                                  // the next minute sends both
});

test('URGENT mail lists up to 100 reports and says how many more are on #/admin/ops (nothing is lost, the screen has every one)', async () => {
  const o = outbox(); const marked = [];
  const b = await (await tickWith(o, marked, { urgent_wait_s: 0, new_alerts: urgentAlerts(Array.from({ length: 130 }, (_, i) => i + 1)) })).json();
  assert.equal(b.urgent, 130);
  assert.equal((o.rows[0][4].match(/child-safety report #/g) || []).length, 100);
  assert.match(o.rows[0][4], /\.\.\.and 30 more: every one is listed in #\/admin\/ops/);
  assert.equal(marked[0].length, 130);                                            // all 130 are marked notified: the mail told Ryan about them
});

