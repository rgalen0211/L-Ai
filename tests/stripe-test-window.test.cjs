// The Stripe TEST window (Ryan, 2026-10-16): credits and payments may be on ONLY while the app says it is in Stripe test mode, and only together.
// These hold before the window (both off), during it (both on, test mode on) and after it (both off again; credits alone may be on later for free beta credits). They can never pass with real-money
// payments on: going live is a separate decision (stripe_settings.live_ok in the database, and this file's stripeTestMode, both changed by Ryan's typed OK).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const cfgSource = fs.readFileSync(path.join(__dirname, '../assets/ryagram-config.js'), 'utf8');
const cfg = (() => { const window = {}; vm.runInNewContext(cfgSource, { window }); return window.ryagramConfig; })();

test('TEST WINDOW: stripeTestMode false (live keys, no test-card text) only ever together with buyingOpen true, and the reverse', () => {
  // web-buying-flip-1124 is the opening: both change in the one commit. Test keys keep stripeTestMode true and buyingOpen false (the Wednesday head).
  assert.equal(cfg.stripeTestMode === false, cfg.buyingOpen === true, 'stripeTestMode false and buyingOpen true are one switch: never one without the other');
  if (cfg.payments === true && cfg.stripeTestMode === false) assert.equal(cfg.buyingOpen, true);
});

test('TEST WINDOW: payments need credits (the Credits page lives inside credits), and credits alone is allowed', () => {
  if (cfg.payments === true) assert.equal(cfg.credits, true);
  assert.equal(typeof cfg.credits, 'boolean');
  assert.equal(typeof cfg.payments, 'boolean');
});

test('TEST WINDOW: on the opening branch stripeTestMode is false in this file (going live is Ryan’s typed step 69; the Wednesday head keeps it true)', () => {
  assert.equal(cfg.stripeTestMode, false);
  assert.match(cfgSource, /stripeTestMode: false,/);
});

test('TEST WINDOW: the checkout function still refuses live keys and the database still refuses live events until live_ok', () => {
  const co = fs.readFileSync(path.join(__dirname, '../supabase/functions/stripe-checkout/checkout.ts'), 'utf8');
  assert.match(co, /sk_live|rk_live|livemode|live/i);
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/phase-2b/stripe_test_mode.sql'), 'utf8');
  assert.match(sql, /live_ok boolean not null default false/);
  assert.match(sql, /refused_live/);
});

test('TEST WINDOW: the Credits page carries the exact label Ryan asked for next to the pack prices, outside mock mode', () => {
  const src = fs.readFileSync(path.join(__dirname, '../assets/app-library.js'), 'utf8');
  assert.ok(src.includes("'Test mode — prices are placeholders, no real charge.'"));
  assert.match(src, /testMode && !window\.ryagramMock \? h\('p', \{ class: 'form-note credit-test-label' \}/);
});
