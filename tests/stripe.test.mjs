// Stripe in test mode: the webhook's signature check and field extraction against Stripe's own
// fixture objects (tests/fixtures/stripe/fixtures.json), and the checkout function against a
// scripted Stripe API. The extracted payloads are pinned in tests/fixtures/stripe/extracted.json,
// which supabase/tests/test_stripe.py replays through the real stripe_apply.
// Regenerate that file after a deliberate change: STRIPE_WRITE_GOLDEN=1 node --test tests/stripe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { extract, formEncode, verifySignature } from '../supabase/functions/_shared/stripe.ts';
import { handle as webhook } from '../supabase/functions/stripe-webhook/webhook.ts';
import { handle as checkout } from '../supabase/functions/stripe-checkout/checkout.ts';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/stripe/fixtures.json', import.meta.url), 'utf8'));
const GOLDEN = new URL('./fixtures/stripe/extracted.json', import.meta.url);
const SECRET = 'whsec_test_secret_for_unit_tests';
const NOW = 1790812800;                                  // 2026-10-01T00:00:00Z
const RYAN = '00000000-0000-0000-0000-000000000001';
const clone = x => JSON.parse(JSON.stringify(x));

// Deep merge: objects merge, everything else (arrays included) replaces. null deletes.
function merge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
const event = (id, type, object, extra = {}) =>
  ({ ...clone(FX.event), id, type, created: NOW, livemode: false, ...extra, data: { object } });
const sign = (payload, t = NOW, secret = SECRET) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

// ---- the scenario the database test replays --------------------------------------------------
const subLine = line => merge(FX.invoice.lines.data[0], line);
const SCENARIO = [
  ['plan created', 'applied', event('evt_Sub1', 'customer.subscription.created', merge(FX.subscription, {
    id: 'sub_A', customer: 'cus_Ryan', status: 'active', cancel_at_period_end: false,
    items: { data: [merge(FX.subscription.items.data[0], { price: { id: 'price_Creator1' }, current_period_end: 1793491200 })] } }))],
  ['plan checkout', 'applied', event('evt_Chk1', 'checkout.session.completed', merge(FX['checkout.session'], {
    id: 'cs_test_Plan', mode: 'subscription', payment_status: 'paid', status: 'complete', client_reference_id: RYAN,
    customer: 'cus_Ryan', subscription: 'sub_A', payment_intent: null, amount_total: 2400, currency: 'usd',
    metadata: { owner_id: RYAN, price_code: 'sub_creator' } }))],
  ['first month (current invoice layout)', 'applied', event('evt_Inv1', 'invoice.paid', merge(FX.invoice, {
    id: 'in_1', customer: 'cus_Ryan', status: 'paid', billing_reason: 'subscription_create', amount_paid: 2400, currency: 'usd',
    parent: { type: 'subscription_details', quote_details: null, subscription_details: { subscription: 'sub_A', metadata: {} } },
    lines: { data: [subLine({ period: { start: 1790812800, end: 1793491200 },
      parent: { type: 'subscription_item_details', invoice_item_details: null,
                subscription_item_details: { subscription: 'sub_A', subscription_item: 'si_1', proration: false } },
      pricing: { type: 'price_details', price_details: { price: 'price_Creator1', product: 'prod_1' } } })] } }))],
  ['first month again (Stripe retry)', 'replay', null],
  ['second month (older invoice layout)', 'applied', event('evt_Inv2', 'invoice.paid', merge(FX.invoice, {
    id: 'in_2', customer: 'cus_Ryan', status: 'paid', billing_reason: 'subscription_cycle', amount_paid: 2400, currency: 'usd',
    parent: null, subscription: 'sub_A',
    lines: { data: [{ id: 'il_2', object: 'line_item', type: 'subscription', subscription: 'sub_A', proration: false,
                      period: { start: 1793491200, end: 1796083200 }, price: { id: 'price_Creator1' } }] } }))],
  ['pack bought', 'applied', event('evt_Pack1', 'checkout.session.completed', merge(FX['checkout.session'], {
    id: 'cs_test_Pack', mode: 'payment', payment_status: 'paid', status: 'complete', client_reference_id: RYAN,
    customer: 'cus_Ryan', payment_intent: 'pi_Pack1', amount_total: 1200, currency: 'usd',
    metadata: { owner_id: RYAN, price_code: 'pack_starter' } }))],
  ['pack refunded in full', 'applied', event('evt_Ref1', 'charge.refunded', merge(FX.charge, {
    id: 'ch_Pack1', payment_intent: 'pi_Pack1', amount: 1200, amount_refunded: 1200, refunded: true }))],
  ['a live-mode event', 'refused_live', event('evt_Live1', 'checkout.session.completed', merge(FX['checkout.session'], {
    id: 'cs_live_X', mode: 'payment', payment_status: 'paid', client_reference_id: RYAN, customer: 'cus_Ryan',
    payment_intent: 'pi_Live1', amount_total: 1200, currency: 'usd', metadata: { price_code: 'pack_starter' } }), { livemode: true })],
  ['an event type not used', 'ignored', event('evt_Other1', 'payment_intent.succeeded', { id: 'pi_Pack1', object: 'payment_intent' })],
];
SCENARIO[3][2] = SCENARIO[2][2];

test('Stripe signatures: valid, tampered, stale, rolled secrets', async () => {
  const body = JSON.stringify(SCENARIO[0][2]);
  assert.equal(await verifySignature(body, sign(body), SECRET, NOW), true);
  assert.equal(await verifySignature(body + ' ', sign(body), SECRET, NOW), false);               // body changed
  assert.equal(await verifySignature(body, sign(body, NOW, 'whsec_other'), SECRET, NOW), false);   // wrong secret
  assert.equal(await verifySignature(body, sign(body, NOW - 301), SECRET, NOW), false);           // too old
  assert.equal(await verifySignature(body, sign(body, NOW + 301), SECRET, NOW), false);           // from the future
  assert.equal(await verifySignature(body, sign(body, NOW - 299), SECRET, NOW), true);
  const rolled = `${sign(body, NOW, 'whsec_old')},v1=${sign(body).split('v1=')[1]}`;              // two v1 while rolling
  assert.equal(await verifySignature(body, rolled, SECRET, NOW), true);
  const v0only = sign(body).replace('v1=', 'v0=');
  assert.equal(await verifySignature(body, v0only, SECRET, NOW), false);
  for (const h of [null, '', 't=abc,v1=00', `v1=${sign(body).split('v1=')[1]}`]) {
    assert.equal(await verifySignature(body, h, SECRET, NOW), false);
  }
  assert.equal(await verifySignature(body, sign(body), '', NOW), false);                         // unset secret
});

test('extraction from Stripe fixtures matches the pinned payloads the database test replays', () => {
  const got = SCENARIO.map(([name, expect, ev]) => ({ name, expect, ...extract(ev) }));
  if (process.env.STRIPE_WRITE_GOLDEN) fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
  assert.deepEqual(got, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  // Spot checks, so the golden file can't quietly pin a wrong reading.
  const by = n => got.find(g => g.name === n).data;
  assert.equal(by('first month (current invoice layout)').price_id, 'price_Creator1');
  assert.equal(by('first month (current invoice layout)').subscription, 'sub_A');
  assert.equal(by('second month (older invoice layout)').price_id, 'price_Creator1');
  assert.equal(by('second month (older invoice layout)').period_start, 1793491200);
  assert.equal(by('pack bought').owner_id, RYAN);
  assert.equal(by('pack bought').price_code, 'pack_starter');
  assert.equal(by('plan created').current_period_end, 1793491200);
  assert.equal(got[0].created, '2026-10-01T00:00:00.000Z');
  // The raw fixtures read without throwing, whatever their type.
  for (const [type, obj] of [['checkout.session.completed', FX['checkout.session']], ['invoice.paid', FX.invoice],
                             ['customer.subscription.updated', FX.subscription], ['charge.refunded', FX.charge]]) {
    assert.ok(extract(event('evt_Raw', type, obj)));
  }
  assert.equal(extract({ object: 'charge' }), null);
});

test('webhook: signed events are applied; bad signatures, methods and database failures answer correctly', async () => {
  const applied = [];
  const deps = { signingSecret: SECRET, now: () => NOW * 1000,
                 apply: async (id, type, created, livemode, data) => { applied.push({ id, type, data }); return 'applied'; } };
  const post = (body, headers = {}) => new Request('https://x.supabase.co/functions/v1/stripe-webhook',
                                                   { method: 'POST', body, headers });
  const body = JSON.stringify(SCENARIO[5][2]);
  let res = await webhook(post(body, { 'stripe-signature': sign(body) }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true, outcome: 'applied' });
  assert.equal(applied[0].data.payment_intent, 'pi_Pack1');

  assert.equal((await webhook(post(body, { 'stripe-signature': sign(body, NOW, 'whsec_x') }), deps)).status, 400);
  assert.equal((await webhook(post(body), deps)).status, 400);
  assert.equal((await webhook(new Request('https://x/', { method: 'GET' }), deps)).status, 405);
  const junk = 'not json';
  assert.equal((await webhook(post(junk, { 'stripe-signature': sign(junk) }), deps)).status, 400);
  const notEvent = JSON.stringify({ object: 'charge', id: 'ch_1' });
  assert.equal((await webhook(post(notEvent, { 'stripe-signature': sign(notEvent) }), deps)).status, 400);
  const big = ' '.repeat(600 * 1024);
  assert.equal((await webhook(post(big, { 'stripe-signature': sign(big) }), deps)).status, 413);
  assert.equal(applied.length, 1);                      // nothing unsigned or malformed got through

  const failing = { ...deps, apply: async () => { throw new Error('connection reset'); } };
  res = await webhook(post(body, { 'stripe-signature': sign(body) }), failing);
  assert.equal(res.status, 500);                        // Stripe retries
});

// ---- checkout -------------------------------------------------------------------------------
function fakeStripe() {
  const calls = [];
  let n = 0;
  return {
    calls,
    async stripe(path, params, key) {
      calls.push({ path, params: clone(params), key, form: formEncode(params) });
      if (path === '/v1/customers') return { id: 'cus_New' };
      if (path === '/v1/checkout/sessions') return { id: `cs_test_${++n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}` };
      if (path === '/v1/billing_portal/sessions') return { url: 'https://billing.stripe.com/p/session/test_1' };
      throw new Error('unexpected path');
    }
  };
}
function checkoutDeps(ctx = {}, over = {}) {
  const s = fakeStripe();
  const customers = [];
  return {
    s, customers,
    deps: {
      allowedOrigins: ['https://uselai.com'], siteUrl: 'https://uselai.com', keyIsTest: true,
      verifyUser: async jwt => (jwt === 'good' ? { id: RYAN } : null),
      context: async (owner, code) => ({ stripe_price_id: code === 'pack_starter' ? 'price_Starter1' : code === 'sub_creator' ? 'price_Creator1' : null,
                                         mode: code.startsWith('pack_') ? 'payment' : code.startsWith('sub_') ? 'subscription' : null,
                                         customer_id: null, email: 'ryan@example.test', has_plan: false, live_ok: false, ...ctx }),
      setCustomer: async (owner, id) => { customers.push([owner, id]); },
      stripe: s.stripe,
      ...over,
    }
  };
}
const call = (deps, body, { jwt = 'good', origin = 'https://uselai.com', method = 'POST' } = {}) =>
  checkout(new Request('https://x.supabase.co/functions/v1/stripe-checkout', {
    method, headers: { origin, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined }), deps);

test('checkout: a pack creates the customer once and a payment session tagged with the person', async () => {
  const { s, customers, deps } = checkoutDeps();
  const res = await call(deps, { price_code: 'pack_starter' });
  assert.equal(res.status, 200);
  assert.match((await res.json()).url, /^https:\/\/checkout\.stripe\.com\//);
  assert.deepEqual(s.calls.map(c => c.path), ['/v1/customers', '/v1/checkout/sessions']);
  assert.equal(s.calls[0].key, `customer-${RYAN}`);
  assert.deepEqual(customers, [[RYAN, 'cus_New']]);
  const p = s.calls[1].params;
  assert.equal(p.mode, 'payment');
  assert.equal(p.customer, 'cus_New');
  assert.equal(p.client_reference_id, RYAN);
  assert.deepEqual(p.line_items, [{ price: 'price_Starter1', quantity: 1 }]);
  assert.deepEqual(p.payment_intent_data.metadata, { owner_id: RYAN, price_code: 'pack_starter' });
  assert.equal(p.success_url, 'https://uselai.com/app/#/credits?paid=pack_starter');
  assert.equal(p.allow_promotion_codes, undefined);    // a discount would fail the amount check
  assert.match(s.calls[1].form, /line_items%5B0%5D%5Bprice%5D=price_Starter1/);
  assert.match(s.calls[1].form, /payment_intent_data%5Bmetadata%5D%5Bowner_id%5D=/);
});

test('checkout: plans, the one-plan rule, the portal, and refusals', async () => {
  let { s, deps } = checkoutDeps({ customer_id: 'cus_Ryan' });
  let res = await call(deps, { price_code: 'sub_creator' });
  assert.equal(res.status, 200);
  assert.deepEqual(s.calls.map(c => c.path), ['/v1/checkout/sessions']);     // existing customer reused
  assert.deepEqual(s.calls[0].params.subscription_data.metadata, { owner_id: RYAN, price_code: 'sub_creator' });

  ({ deps } = checkoutDeps({ customer_id: 'cus_Ryan', has_plan: true }));
  assert.equal((await call(deps, { price_code: 'sub_creator' })).status, 409);
  assert.equal((await call(deps, { price_code: 'pack_starter' })).status, 200);  // packs on top of a plan are fine

  ({ s, deps } = checkoutDeps({ customer_id: 'cus_Ryan' }));
  res = await call(deps, { action: 'portal' });
  assert.equal(res.status, 200);
  assert.deepEqual(s.calls[0].params, { customer: 'cus_Ryan', return_url: 'https://uselai.com/app/#/credits' });
  ({ deps } = checkoutDeps());
  assert.equal((await call(deps, { action: 'portal' })).status, 404);           // nothing bought yet

  ({ s, deps } = checkoutDeps());
  assert.equal((await call(deps, { price_code: 'pack_starter' }, { jwt: 'bad' })).status, 401);
  assert.equal((await call(deps, { price_code: 'pack_starter' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(deps, { price_code: 'final_map' })).status, 400);
  assert.equal((await call(deps, { price_code: 'pack_imaginary' })).status, 404);
  assert.equal((await call(deps, {}, { method: 'GET' })).status, 405);
  assert.equal(s.calls.length, 0);

  ({ s, deps } = checkoutDeps({}, { keyIsTest: false }));                        // a live key, not yet allowed
  assert.equal((await call(deps, { price_code: 'pack_starter' })).status, 503);
  assert.equal(s.calls.length, 0);

  ({ deps } = checkoutDeps({}, { stripe: async () => { throw new Error('Invalid API Key provided: sk_test_****1234'); } }));
  const orig = console.error; console.error = () => {};
  res = await call(deps, { price_code: 'pack_starter' });
  console.error = orig;
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /sk_test/);
});

test('form encoding follows Stripe\'s bracket style', () => {
  assert.equal(formEncode({ a: 1, b: { c: 'x y', d: [{ e: 2 }] }, skip: undefined, none: null }),
               'a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D%5Be%5D=2');
});
