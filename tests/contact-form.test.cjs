const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../assets/contact-form.js'), 'utf8');

function harness(fetch, analytics, redirectValue = 'https://uselai.com/thank-you.html') {
  const listeners = {};
  const button = {};
  const status = { focus() { this.focused = true; } };
  const redirectInput = { value: redirectValue };
  const form = {
    action: 'https://formspree.io/f/xyklqewj',
    reportValidity: () => true,
    querySelector: (sel) => sel === 'button[type="submit"]' ? button : redirectInput,
    addEventListener(type, fn) { listeners[type] = fn; },
    setAttribute() {}, removeAttribute() {}
  };
  const elements = { 'contact-form': form, 'contact-form-status': status };
  const destinations = [];
  vm.runInNewContext(code, {
    document: { getElementById: id => elements[id] },
    window: { laiAnalytics: analytics, location: { assign: url => destinations.push(url) } },
    fetch, FormData: class {}, AbortController, setTimeout, clearTimeout, TypeError
  });
  return { button, status, destinations, submit: () => listeners.submit({ preventDefault() {} }) };
}

test('only an acknowledged success redirects to the configured thank-you page', async () => {
  for (const [ok, payload, expected] of [[true, { ok: true }, 1], [false, { ok: true }, 0], [true, {}, 0], [true, null, 0]]) {
    const h = harness(async () => ({ ok, json: async () => payload }));
    await h.submit();
    assert.equal(h.destinations.length, expected);
    if (expected) assert.equal(h.destinations[0], 'https://uselai.com/thank-you.html');
    else { assert.equal(h.button.disabled, false); assert.equal(h.status.focused, true); }
  }
});

test('network failure stays on the form, keeps details, and permits retry', async () => {
  const h = harness(async () => { throw new TypeError('Failed to fetch'); });
  await h.submit();
  assert.equal(h.destinations.length, 0);
  assert.equal(h.button.disabled, false);
  assert.ok(h.status.textContent.includes('confirm'));
});

test('repeated submits while waiting create only one request', async () => {
  let resolve, requests = 0;
  const h = harness(() => { requests++; return new Promise(r => { resolve = r; }); });
  const first = h.submit();
  await h.submit();
  assert.equal(requests, 1);
  assert.equal(h.button.disabled, true);
  resolve({ ok: true, json: async () => ({ ok: true }) });
  await first;
});

test('Lead only fires after an acknowledged success, and repeated submit emits once', async () => {
  let resolve, leads = 0;
  const h = harness(() => new Promise(r => { resolve = r; }), { contactSubmitted() { leads++; } });
  const submission = h.submit();
  await h.submit();
  assert.equal(leads, 0);
  resolve({ ok: true, json: async () => ({ ok: true }) });
  await submission;
  assert.equal(leads, 1);
});

test('missing or broken tracking cannot break successful form navigation', async () => {
  for (const analytics of [undefined, { contactSubmitted() { throw new Error('blocked'); } }]) {
    const h = harness(async () => ({ ok: true, json: async () => ({ ok: true }) }), analytics);
    await h.submit();
    assert.deepEqual(h.destinations, ['https://uselai.com/thank-you.html']);
  }
});
