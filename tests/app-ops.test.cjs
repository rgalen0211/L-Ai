const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createFakeClient } = require('./fake-supabase.js');

function load(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), { window });
  return window;
}
const O = load('app-ops.js').ryagramOps;
const ryagramData = load('app-data.js').ryagramData;

test('the delayed notice shows only when rendering is delayed, says when it last checked in, and promises the refund', () => {
  assert.equal(O.bannerText(null), null);
  assert.equal(O.bannerText({ rendering: 'ok' }), null);
  assert.equal(O.bannerText({ rendering: 'unknown' }), null);
  const t = O.bannerText({ rendering: 'delayed', last_check_in: '2026-10-10T18:02:00Z' }, 'UTC');
  assert.match(t, /^Rendering is delayed\./);
  assert.match(t, /last checked in at 6:02 PM/);
  assert.match(t, /more than an hour we stop it and give your credits back/);
  assert.match(O.bannerText({ rendering: 'delayed', last_check_in: null }), /^Rendering is delayed\. Your film will start/);
});

test('only a real job id in #/help?job= is passed on', () => {
  const id = 'abcdef12-1111-4111-8111-11111111111a';
  assert.equal(O.jobFromHash(`#/help?job=${id}`), id);
  for (const bad of ['#/help', '#/help?job=', '#/help?job=1', `#/help?job=${id}&x=1`, `#/help?job=${id.toUpperCase()}`, '#/help?job=<script>']) assert.equal(O.jobFromHash(bad), null, bad);
});

test('the help form checks its fields', () => {
  const ok = { email: 'a@b.co', topic: 'render', message: 'My film is stuck' };
  assert.equal(O.checkSupport(ok), null);
  assert.match(O.checkSupport({ ...ok, email: 'nope' }), /email/);
  assert.match(O.checkSupport({ ...ok, topic: 'x' }), /Choose/);
  assert.match(O.checkSupport({ ...ok, message: 'hi' }), /more/);
  assert.match(O.checkSupport({ ...ok, message: 'x'.repeat(4001) }), /too long/);
});

test('service status never throws (no SQL yet = no notice); the help form sends the job and the honeypot to the RPC', async () => {
  const missing = ryagramData({ rpc: async () => ({ data: null, error: { message: 'function public.service_status() does not exist' } }) });
  assert.equal(await missing.serviceStatus(), null);
  const broken = ryagramData({ rpc: async () => { throw new Error('network'); } });
  assert.equal(await broken.serviceStatus(), null);
  const calls = [];
  const data = ryagramData({ rpc: async (name, args) => { calls.push([name, args]); return { data: 7, error: null }; } });
  assert.equal(await data.submitSupport({ email: 'a@b.co', topic: 'render', message: 'stuck', job: 'J' }), 7);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['submit_support', { p_email: 'a@b.co', p_topic: 'render', p_message: 'stuck', p_job: 'J', p_website: '' }]);
  const mock = ryagramData(createFakeClient());
  assert.equal((await mock.serviceStatus()).rendering, 'ok');
  assert.equal(await mock.submitSupport({ email: 'a@b.co', topic: 'other', message: 'hello there' }), 1);
  assert.equal(await mock.submitSupport({ email: 'a@b.co', topic: 'other', message: 'hello there', website: 'spam' }), 0);
});

test('the notice and help form are OFF in the shipped config until the SQL is applied', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ryagram-config.js'), 'utf8');
  assert.match(src, /opsTools: false/);
});

const C = load('app-credits.js').ryagramCredits;
const NOW = Date.parse('2026-10-10T20:00:00Z');
const iso = min => new Date(NOW - min * 60000).toISOString();

test('Operations wording: ages, rendering, queue, spend and backups', () => {
  assert.equal(O.ago(iso(0.2), NOW), 'just now');
  assert.equal(O.ago(iso(5), NOW), '5 minutes ago');
  assert.equal(O.ago(iso(61), NOW), '1 hour ago');
  assert.equal(O.ago(iso(3 * 1440), NOW), '3 days ago');
  assert.equal(O.ago(null, NOW), 'never');
  assert.match(O.renderingLine({ rendering: 'delayed', last_check_in: iso(10), free_gb: 212.4 }, NOW), /DELAYED.*10 minutes ago.*212 GB free/);
  assert.match(O.renderingLine({ rendering: 'unknown', last_check_in: null, free_gb: null }, NOW), /not reported in yet/);
  assert.equal(O.queueLine({ queued: 0, running: 1, oldest_queued_min: null }), '0 queued, 1 running.');
  assert.equal(O.queueLine({ queued: 2, running: 0, oldest_queued_min: 125 }), '2 queued, 0 running. The oldest has waited 2 hours.');
  const ai = { day_spent: 4.2, day_cap: 5, month_spent: 10, month_cap: 60, state: 'warn', enabled: true };
  assert.deepEqual(JSON.parse(JSON.stringify(O.spendLines(ai))), ['Spend is over 80% of a cap.', 'Today $4.20 of $5.00. This month $10.00 of $60.00.']);
  assert.match(O.spendLines({ ...ai, state: 'paused' })[0], /PAUSED/);
  assert.match(O.spendLines({ ...ai, enabled: false })[0], /switched off/);
  assert.equal(O.backupLine({ expected: false, last_daily_ok: null }, NOW), 'Backups are not set up yet.');
  assert.match(O.backupLine({ expected: true, last_daily_ok: iso(600), last_daily_bytes: 5242880, last_restore_test: iso(14400), last_restore_ok: false }, NOW), /10 hours ago, 5\.0 MB\. Restore test FAILED 10 days ago/);
});

test('"credits were returned" appears only when the ledger says released and nothing was spent', () => {
  assert.equal(C.returnedNote({ credits_quoted: 10, released: 10, captured: 0 }), 'Your 10 credits were returned.');
  assert.equal(C.returnedNote({ credits_quoted: 1, released: 1, captured: 0 }), 'Your credit was returned.');
  for (const a of [null, { free_preview: true, credits_quoted: 0 }, { credits_quoted: 0 }, { credits_quoted: 10, released: 0, captured: 10 },
                   { credits_quoted: 10, released: 4, captured: 6 }, { credits_quoted: 10, held: 10 }]) assert.equal(C.returnedNote(a), '', JSON.stringify(a));
});

test('the Operations screen says how many child-safety reports are open, which are NOT hidden, and the hourly hide cap', () => {
  assert.equal(O.childSafetyLine({ open: 0, open_not_hidden: 0, holds_this_hour: 0, holds_cap: 10 }), 'No open child-safety reports. Pages hidden automatically this hour: 0 of 10.');
  assert.equal(O.childSafetyLine({ open: 2, open_not_hidden: 0, holds_this_hour: 2, holds_cap: 10 }), '2 open child-safety reports, all hidden pending your review. Pages hidden automatically this hour: 2 of 10.');
  assert.match(O.childSafetyLine({ open: 3, open_not_hidden: 1, holds_this_hour: 10, holds_cap: 10 }), /3 open child-safety reports, 1 NOT hidden \(the hourly cap was reached\): review it first\. Pages hidden automatically this hour: 10 of 10\./);
  assert.match(O.childSafetyLine({ open: 2, open_not_hidden: 2, holds_this_hour: 10, holds_cap: 10 }), /2 NOT hidden .*review them first/);
  assert.equal(O.childSafetyLine(null), 'No child-safety information.');
});

test('the Operations screen words the payments that need review, and says nothing is wrong when there are none or payments are off', () => {
  assert.equal(O.stripeLine({ available: false, open: 0, items: [] }), 'Payments are not set up yet, so there is nothing to review.');
  assert.equal(O.stripeLine(null), 'Payments are not set up yet, so there is nothing to review.');
  assert.equal(O.stripeLine({ available: true, open: 0, items: [] }), 'No payment events need review.');
  assert.match(O.stripeLine({ available: true, open: 1, items: [] }), /^1 payment event needs your review: nothing was changed for it\. Fix by hand/);
  assert.match(O.stripeLine({ available: true, open: 3, items: [] }), /^3 payment events need your review: nothing was changed for them\./);
});
