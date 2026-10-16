// The cost ledger: the cost-sync function (Stripe's own balance transactions -> ledger events, then the ledger pass), Ryan's wording and input checks,
// the data layer, and the #/admin/ops screen wiring. The database half (closed tables, idempotence, rollup, alarms) is supabase/tests/test_cost_ledger.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { handle, feeEvent, stripeMode } from '../supabase/functions/cost-sync/sync.ts';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const KEY = 'service-role-key-for-tests';
const NOW = 1760620800;                                   // 2026-10-16T12:00:00Z

// Shape from Stripe's API reference (List balance transactions): id, object, amount, created, currency, fee, fee_details, net, reporting_category, source, type.
const txn = (id, over = {}) => ({ id, object: 'balance_transaction', amount: 1200, created: NOW - 3600, currency: 'usd', fee: 35, fee_details: [{ amount: 35, currency: 'usd', description: 'Stripe processing fees', type: 'stripe_fee' }],
                                   net: 1165, reporting_category: 'charge', source: 'ch_1', status: 'available', type: 'charge', ...over });

function world({ pages = [{ data: [txn('txn_1')], has_more: false }], stripeKey = 'rk_test_abc123', cursor = null, recordFails = false, tickFails = false } = {}) {
  const w = { calls: [], recorded: [], cursors: {}, ticks: 0, pages: pages.slice() };
  const deps = {
    serviceKey: KEY, stripeKey,
    fetch: async (url, init) => {
      w.calls.push({ url, auth: init.headers.Authorization });
      const next = w.pages.shift();
      if (next instanceof Error) throw next;
      if (next && next.status) return { ok: false, status: next.status, json: async () => ({ error: { message: 'secret detail ' + stripeKey } }) };
      return { ok: true, status: 200, json: async () => next || { data: [], has_more: false } };
    },
    getCursor: async key => w.cursors[key] ?? cursor,
    setCursor: async (key, value) => { w.cursors[key] = value; },
    record: async events => { if (recordFails) throw new Error('db down'); w.recorded.push(...events); return events.length; },
    tick: async () => { if (tickFails) throw new Error('tick broke'); w.ticks++; return { alarms_raised: 0 }; },
    now: () => NOW,
  };
  return { w, deps };
}
const post = (deps, { method = 'POST', auth = `Bearer ${KEY}` } = {}) =>
  handle(new Request('https://x.supabase.co/functions/v1/cost-sync', { method, headers: auth ? { authorization: auth } : {} }), deps);

// ---- the function ------------------------------------------------------------------------------------------------------------------------------------
test('SYNC: only the scheduler (the service key) may run it, and only with POST', async () => {
  const { deps, w } = world();
  assert.equal((await post(deps, { auth: null })).status, 403);
  assert.equal((await post(deps, { auth: 'Bearer wrong' })).status, 403);
  assert.equal((await post(deps, { method: 'GET' })).status, 405);
  assert.deepEqual([w.calls.length, w.ticks, w.recorded.length], [0, 0, 0]);
});

test('SYNC: a charge’s fee comes from Stripe’s own balance transaction, in dollars, once per transaction id', async () => {
  const { deps, w } = world();
  const res = await post(deps);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual([out.stripe.mode, out.stripe.fetched, out.stripe.fee_events, out.stripe.recorded], ['test', 1, 1, 1]);
  assert.equal(w.ticks, 1);
  const e = w.recorded[0];
  assert.deepEqual([e.vendor, e.kind, e.amount_usd, e.quantity, e.unit, e.ref, e.livemode], ['stripe', 'stripe_fee', 0.35, 12, 'gross_usd', 'txn_1', false]);
  assert.equal(e.occurred_at, new Date((NOW - 3600) * 1000).toISOString());
  assert.deepEqual(e.detail.fee_details, [{ type: 'stripe_fee', description: 'Stripe processing fees', amount: 35 }]);
  assert.equal(w.calls[0].auth, 'Bearer rk_test_abc123');
  assert.match(w.calls[0].url, /^https:\/\/api\.stripe\.com\/v1\/balance_transactions\?limit=100&created\[gte\]=\d+$/);
});

test('SYNC: test keys record test-mode events, live keys live ones, anything else is refused (the mode is never guessed), and each mode keeps its own bookmark', async () => {
  assert.equal(stripeMode('sk_test_x'), false);
  assert.equal(stripeMode('rk_test_x'), false);
  assert.equal(stripeMode('sk_live_x'), true);
  assert.equal(stripeMode('rk_live_x'), true);
  for (const bad of [undefined, '', 'whsec_x', 'pk_live_x', 'sk_x']) assert.equal(stripeMode(bad), null, String(bad));
  const live = world({ stripeKey: 'rk_live_abc' });
  await post(live.deps);
  assert.equal(live.w.recorded[0].livemode, true);
  assert.deepEqual(Object.keys(live.w.cursors), ['stripe_created_live']);
  const test = world({ stripeKey: 'sk_test_abc' });
  await post(test.deps);
  assert.deepEqual(Object.keys(test.w.cursors), ['stripe_created_test']);
  const bad = world({ stripeKey: 'whsec_nope' });
  const out = await (await post(bad.deps)).json();
  assert.match(out.stripe.error, /not a Stripe key/);
  assert.equal(bad.w.calls.length, 0);
  assert.equal(bad.w.ticks, 1);                                  // the ledger pass still runs
});

test('SYNC: refunds and fee-free transactions add nothing; a non-USD fee is recorded as UNKNOWN, never converted by guess', () => {
  assert.equal(feeEvent(txn('txn_r', { type: 'refund', amount: -1200, fee: 0, net: -1200, reporting_category: 'refund' }), true), null);
  assert.equal(feeEvent(txn('txn_p', { type: 'payout', amount: -5000, fee: 0 }), true), null);
  assert.equal(feeEvent({ id: 5, fee: 10 }, true), null);        // malformed rows are skipped, not trusted
  const eur = feeEvent(txn('txn_e', { currency: 'eur', fee: 50, amount: 1000 }), true);
  assert.equal(eur.amount_usd, null);
  assert.equal(eur.unit, 'gross_eur');
  assert.equal(eur.detail.currency, 'eur');
  const dispute = feeEvent(txn('txn_d', { type: 'adjustment', reporting_category: 'dispute', amount: -1200, fee: 1500, fee_details: [{ type: 'stripe_fee', description: 'Dispute fee', amount: 1500 }] }), true);
  assert.equal(dispute.amount_usd, 15);                         // a dispute fee is real money and is recorded
  assert.equal(dispute.quantity, 12);
});

test('SYNC: pages are followed, the bookmark moves to the newest transaction minus a day, and a repeat run asks from there', async () => {
  const p1 = { data: [txn('txn_3', { created: NOW - 100 }), txn('txn_2', { created: NOW - 200 })], has_more: true };
  const p2 = { data: [txn('txn_1', { created: NOW - 300 })], has_more: false };
  const { deps, w } = world({ pages: [p1, p2] });
  const out = await (await post(deps)).json();
  assert.equal(out.stripe.fetched, 3);
  assert.deepEqual(w.recorded.map(e => e.ref), ['txn_3', 'txn_2', 'txn_1']);
  assert.match(w.calls[1].url, /&starting_after=txn_2$/);
  assert.equal(w.cursors.stripe_created_test, String(NOW - 100 - 86400));
  w.pages.push({ data: [], has_more: false });
  await post(deps);
  assert.match(w.calls[2].url, new RegExp(`created\\[gte\\]=${NOW - 100 - 86400}$`));
});

test('SYNC: the first run looks back 35 days only', async () => {
  const { deps, w } = world();
  await post(deps);
  assert.match(w.calls[0].url, new RegExp(`created\\[gte\\]=${NOW - 35 * 86400}`));
});

test('SYNC: a Stripe error never leaks the key or Stripe’s body, leaves the bookmark alone, and does not stop the ledger pass', async () => {
  const { deps, w } = world({ pages: [{ status: 401 }] });
  const res = await post(deps);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Stripe answered 401/);
  assert.doesNotMatch(text, /rk_test_abc123|secret detail/);
  assert.deepEqual([Object.keys(w.cursors).length, w.recorded.length, w.ticks], [0, 0, 1]);
  const thrown = world({ pages: [new Error('socket hang up')] });
  assert.equal((await post(thrown.deps)).status, 200);
  assert.equal(thrown.w.ticks, 1);
});

test('SYNC: no Stripe key is fine (the ledger pass still runs); a failing record keeps the bookmark back; a failing tick is a 500', async () => {
  const none = world({ stripeKey: '' });
  const out = await (await post(none.deps)).json();
  assert.match(out.stripe.skipped, /not set/);
  assert.deepEqual([none.w.calls.length, none.w.ticks], [0, 1]);
  const failing = world({ recordFails: true });
  const o2 = await (await post(failing.deps)).json();
  assert.match(o2.stripe.error, /db down/);
  assert.equal(Object.keys(failing.w.cursors).length, 0);       // not recorded, so the same transactions are fetched again next run
  const tick = world({ tickFails: true });
  const res = await post(tick.deps);
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /tick broke/);
});

test('SYNC: more than 5,000 transactions since the bookmark is an error that leaves the bookmark where it was (nothing is skipped)', async () => {
  const pages = Array.from({ length: 50 }, (_, i) => ({ data: [txn(`txn_${i}`, { created: NOW - i })], has_more: true }));
  const { deps, w } = world({ pages });
  const out = await (await post(deps)).json();
  assert.match(out.stripe.error, /More than 5,000/);
  assert.equal(Object.keys(w.cursors).length, 0);
});

test('SYNC: index.ts is read-only toward Stripe and uses the service role only through the ledger functions', () => {
  const src = read('supabase/functions/cost-sync/index.ts') + read('supabase/functions/cost-sync/sync.ts');
  assert.match(src, /--no-verify-jwt/);
  assert.doesNotMatch(src, /method: ["']?(POST|DELETE|PUT)/);     // it only ever GETs from Stripe
  assert.doesNotMatch(src, /\.from\(/);
  for (const rpc of ['cost_sync_get', 'cost_sync_set', 'cost_record_events', 'cost_tick']) assert.match(src, new RegExp(rpc));
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*(stripeKey|STRIPE_SECRET_KEY)/);
});

// ---- the screen -----------------------------------------------------------------------------------------------------------------------------------------
function loadAssets(file) {
  const window = {};
  vm.runInNewContext(read(`assets/${file}`), { window });
  return window;
}
const O = loadAssets('app-ops.js').ryagramOps;
const ryagramData = loadAssets('app-data.js').ryagramData;

test('SCREEN: money is shown with cents, tiny amounts with four places, and unknown is never $0', () => {
  assert.equal(O.usd2(8.5), '$8.50');
  assert.equal(O.usd2(0.00123), '$0.0012');
  assert.equal(O.usd2(0), '$0.00');
  const c = { days: [{ total_usd: 8.5, unknown_events: 2 }], month: { total_usd: 22.27, unknown_events: 2 }, test: { events: 4, total_usd: 3.4 } };
  assert.equal(O.costLine(c), 'Today $8.50 known, plus 2 events with an unknown cost (not counted). This month $22.27 known, plus 2 events with an unknown cost (not counted). Stripe test mode: 4 events (no real money, not counted).');
  assert.match(O.costLine({ days: [{ total_usd: 1, unknown_events: 0 }], month: { total_usd: 1, unknown_events: 1 }, test: { events: 0 } }), /^Today \$1\.00 known\. This month \$1\.00 known, plus 1 event with an unknown cost/);
  assert.match(O.costLine(null), /not set up yet/);
  assert.match(O.usageLine({ emails_today: 3, storage_bytes: 5242880 }), /today by our own alerts and digests: 3 .*sign-up emails are not counted.* 5\.0 MB/);
  assert.match(O.usageLine({ emails_today: null, storage_bytes: null }), /: unknown .* unknown\./);
});

test('SCREEN: a limit line says where you stand and what the status is', () => {
  assert.equal(O.thresholdLine({ vendor: 'stripe', period: 'day', limit_usd: 10, warn_pct: 80, spent_usd: 8.5, status: 'warn' }), 'Stripe, per day: $8.50 of $10.00 (85%), warns at 80%: WARNING');
  assert.match(O.thresholdLine({ vendor: null, period: 'month', limit_usd: 100, warn_pct: 50, spent_usd: 120, status: 'over' }), /^All vendors, per month: \$120\.00 of \$100\.00 \(120%\).*OVER THE LIMIT$/);
});

test('SCREEN: the forms check their input before asking the database, with plain sentences', () => {
  assert.equal(O.checkThreshold({ vendor: 'stripe', period: 'day', limit: '10', warnPct: '80' }), null);
  assert.equal(O.checkThreshold({ vendor: '', period: 'month', limit: '5', warnPct: '50' }), null);       // all vendors
  for (const bad of [{ vendor: 'paypal' }, { period: 'week' }, { limit: '0' }, { limit: '-1' }, { limit: 'abc' }, { warnPct: '100' }, { warnPct: '0' }, { warnPct: '8.5' }]) {
    assert.ok(O.checkThreshold({ vendor: 'stripe', period: 'day', limit: '10', warnPct: '80', ...bad }), JSON.stringify(bad));
  }
  assert.equal(O.checkPlan({ vendor: 'supabase', plan: 'Pro', monthly: '25', startsOn: '2026-10-01' }), null);
  assert.equal(O.checkPlan({ vendor: 'resend', plan: 'Free', monthly: '0', startsOn: '2026-10-01' }), null);       // a free plan is a real entry
  for (const bad of [{ vendor: 'x' }, { plan: ' ' }, { monthly: '' }, { monthly: '-3' }, { startsOn: '10/01/2026' }]) assert.ok(O.checkPlan({ vendor: 'supabase', plan: 'Pro', monthly: '25', startsOn: '2026-10-01', ...bad }), JSON.stringify(bad));
  assert.equal(O.checkManualCost({ vendor: 'domain', amount: '14.99', on: '2026-10-16' }), null);
  for (const bad of [{ vendor: 'x' }, { amount: '' }, { amount: '-1' }, { on: 'tomorrow' }]) assert.ok(O.checkManualCost({ vendor: 'domain', amount: '14.99', on: '2026-10-16', ...bad }), JSON.stringify(bad));
});

test('SCREEN: the data layer reads the rollup and every setting goes through its own admin function', async () => {
  const client = createFakeClient();
  const data = ryagramData(client);
  const first = await data.adminCostRollup(14);
  assert.equal(first.days.length, 14);
  assert.equal(first.thresholds[0].status, 'warn');                  // 8.50 of 10.00 at 80%
  await data.adminCostSetThreshold('stripe', 'day', 6, 80);
  assert.equal((await data.adminCostRollup(1)).thresholds[0].status, 'over');
  await data.adminCostSetThreshold(null, 'month', 100, 50);
  assert.equal((await data.adminCostRollup(1)).thresholds.length, 2);
  await data.adminCostDeleteThreshold(1);
  assert.equal((await data.adminCostRollup(1)).thresholds.length, 1);
  await data.adminCostSetPlan('resend', 'Pro', 20, '2026-10-16', {});
  await data.adminCostSetRate('render', 'cpu_hour', 0.04, 'x');
  await data.adminCostRecord('domain', 14.99, '2026-10-16', 'uselai.com renewal');
  const after = await data.adminCostRollup(1);
  assert.deepEqual(after.plans.map(p => p.vendor).sort(), ['resend', 'supabase']);
  assert.equal(after.rates[0].unit_usd, 0.04);
  assert.equal(after.month.by_vendor.domain, 14.99);
  assert.deepEqual(client.log.filter(l => /cost/.test(l.rpc)).map(l => l.rpc).filter((v, i, a) => a.indexOf(v) === i).sort(),
    ['admin_cost_delete_threshold', 'admin_cost_record', 'admin_cost_rollup', 'admin_cost_set_plan', 'admin_cost_set_rate', 'admin_cost_set_threshold']);
  const bad = ryagramData({ rpc: async () => ({ data: null, error: { message: 'function public.admin_cost_rollup does not exist' } }) });
  await assert.rejects(bad.adminCostRollup(14));
});

test('SCREEN: #/admin/ops shows the Costs section, still loads when the cost SQL is not applied, and every change is a button or form that reloads', () => {
  const src = read('assets/app-library.js');
  assert.match(src, /try \{ cost = await data\.adminCostRollup\(14\); \} catch \{ cost = null; \}/);
  assert.match(src, /costSection\(cost, now\),/);
  for (const call of ['adminCostDeleteThreshold', 'adminCostSetThreshold', 'adminCostSetPlan', 'adminCostSetRate', 'adminCostRecord']) assert.match(src, new RegExp(`data\\.${call}\\(`));
  for (const check of ['O.checkThreshold', 'O.checkPlan', 'O.checkManualCost']) assert.match(src, new RegExp(check.replace('.', '\\.')));
  assert.match(src, /if \(!c\) return section\('Costs', h\('p', \{\}, O\.costLine\(null\)\)\);/);
  assert.match(src, /Unknown is shown as unknown, never as \$0/);
});

test('SCREEN: only the config-free admin path reaches the ledger (no public page or script mentions it)', () => {
  for (const f of ['ryagram/index.html', 'assets/ryagram.js', 'assets/ryagram-config.js', 'assets/film.js', 'film/index.html', 'assets/creator-beta.js']) {
    assert.doesNotMatch(read(f), /cost_ledger|cost_events|admin_cost|cost-sync/, f);
  }
});
