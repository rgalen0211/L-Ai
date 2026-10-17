// The launch-block switches (Ryan, 2026-10-17): opsTools, accountTools, inviteSignup and filmRequests ON (the SQL and functions behind them are applied and
// deployed: WEB-LAUNCH-CHECKLIST.md, Sections A-D and I); creatorBeta is its own commit because it goes live only after the Terms and Privacy pages are published.
// Everything else stays as it was: this file fails if another switch flips by accident.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ryagram-config.js'), 'utf8');
const w = {};
vm.runInNewContext(src, { window: w });
const cfg = w.ryagramConfig;

test('LAUNCH FLAGS: the four switches for the launch block are on', () => {
  for (const k of ['opsTools', 'accountTools', 'inviteSignup', 'filmRequests']) assert.equal(cfg[k], true, k);
});

test('LAUNCH FLAGS: the switches that are not part of the block stay off', () => {
  for (const k of ['aiEditor', 'uploads', 'filmPages', 'industryTemplate', 'catalog', 'catalogComingSoon']) assert.equal(cfg[k], false, k);
});

test('LAUNCH FLAGS: payments can only ever be on together with credits and Stripe TEST mode', () => {
  if (cfg.payments === true) { assert.equal(cfg.credits, true); assert.equal(cfg.stripeTestMode, true); }
  assert.equal(cfg.stripeTestMode, true);
});

test('LAUNCH FLAGS: the config is still public-safe (a publishable key, no secret)', () => {
  assert.match(cfg.supabaseKey, /^sb_publishable_/);
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}/);                       // (the comments may say the words; no VALUE may be one)
});
