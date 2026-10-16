// The launch smoke script (tools/launch-smoke.py): its own helpers are tested here (no browser, no network); the real run needs Chrome and is Ryan's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'tools/launch-smoke.py'), 'utf8');
const hasPython = spawnSync('python', ['--version']).status === 0;

test('SMOKE: the script\'s own helpers pass their self-test (key safety, balance parsing, payment-intent choice, redaction, page list)', { skip: !hasPython }, () => {
  const r = spawnSync('python', [path.join(root, 'tools/launch-smoke.py'), '--self-test'], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /self-test ok/);
});

test('SMOKE: a live Stripe key is refused outright, secrets come from the environment only and are redacted, and nothing is typed into Checkout unless it says test mode', () => {
  assert.match(src, /that is a LIVE Stripe key: this script only ever uses a test key/);
  for (const v of ['SMOKE_EMAIL', 'SMOKE_PASSWORD', 'STRIPE_TEST_KEY']) assert.match(src, new RegExp(`os\.environ\.get\('${v}'\)`));
  assert.match(src, /redact\(str\(detail\), self\.secrets\)/);
  assert.match(src, /a card is typed only if it does/);
  assert.match(src, /STOPPING before any card is typed/);
  assert.match(src, /STOPPING\./);                                                    // and the Credits page must say test mode first
  assert.doesNotMatch(src, /print\([^)]*(PASSWORD|STRIPE_TEST_KEY|SMOKE_EMAIL)/);     // never printed
});

test('SMOKE: it only changes things when asked (forms, app, purchase are separate switches), and the purchase refuses a local copy', () => {
  for (const flag of ['--submit-forms', '--app', '--purchase', '--manual-card', '--serve', '--self-test']) assert.ok(src.includes(`'${flag}'`), flag);
  assert.match(src, /if a\.purchase and not a\.app:/);
  assert.match(src, /--purchase is only for the real site/);
  assert.match(src, /D:\/Ryagram-scratch\/WEB\/smoke-out/);                           // output on D:, not C:
});
