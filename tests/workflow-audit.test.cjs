const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../assets/workflow-audit.js'), 'utf8');

function harness(fetch, analytics) {
  const listeners = {};
  const pageListeners = [];
  const attributes = {};
  const button = {};
  const status = { focus() { this.focused = true; } };
  const other = { checked: false, addEventListener(type, fn) { this.change = fn; } };
  const details = {};
  const input = {};
  const form = {
    action: 'https://formspree.io/f/xyklqewj',
    reportValidity: () => true,
    querySelector: () => button,
    addEventListener(type, fn) { listeners[type] = fn; },
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; }
  };
  const elements = { 'audit-form': form, 'form-status': status, 'systems-other': other, 'other-details': details, 'other-software': input };
  const destinations = [];
  vm.runInNewContext(code, {
    document: { getElementById: id => elements[id] },
    window: { laiAnalytics: analytics, addEventListener(type, fn) { if (type === 'pageshow') pageListeners.push(fn); }, location: { assign: url => destinations.push(url) } },
    fetch, FormData: class {}, AbortController, setTimeout, clearTimeout, TypeError
  });
  return { button, status, other, details, input, destinations, attributes,
    pageshow: persisted => pageListeners.forEach(fn => fn({ persisted })),
    submit: () => listeners.submit({ preventDefault() {} }) };
}

test('only an acknowledged success redirects to scheduling', async () => {
  for (const [ok, payload, expected] of [[true, { ok: true }, 1], [false, { ok: true }, 0], [true, {}, 0], [true, null, 0], [false, { errors: [{ message: 'Please check your email.' }] }, 0]]) {
    const h = harness(async () => ({ ok, json: async () => payload }));
    await h.submit();
    assert.equal(h.destinations.length, expected);
    if (expected) assert.equal(h.destinations[0], '/workflow-audit-thanks.html?ref=fs');
    else { assert.equal(h.button.disabled, false); assert.equal(h.status.focused, true); }
  }
});

test('network and malformed response failures stay on the form and permit retry', async () => {
  for (const fetch of [async () => { throw new TypeError('Failed to fetch'); }, async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })]) {
    const h = harness(fetch);
    await h.submit();
    assert.equal(h.destinations.length, 0);
    assert.equal(h.button.disabled, false);
    assert.ok(h.status.textContent.includes('confirm'));
  }
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

test('Other details are enabled only while Other is selected', () => {
  const h = harness();
  assert.equal(h.details.hidden, true);
  assert.equal(h.input.disabled, true);
  h.other.checked = true;
  h.other.change();
  assert.equal(h.details.hidden, false);
  assert.equal(h.input.disabled, false);
});

test('Lead waits for HTTP success and ok:true, and repeated submit emits once', async () => {
  let resolve;
  let leads = 0;
  const h = harness(() => new Promise(r => { resolve = r; }), { auditSubmitted() { leads++; } });
  assert.equal(leads, 0);
  const submission = h.submit();
  await h.submit();
  assert.equal(leads, 0);
  resolve({ ok: true, json: async () => ({ ok: true }) });
  await submission;
  assert.equal(leads, 1);
  assert.equal(h.destinations.length, 1);
});

test('failed, malformed and unacknowledged responses never emit Lead', async () => {
  const responses = [
    async () => ({ ok: false, json: async () => ({ ok: true }) }),
    async () => ({ ok: true, json: async () => ({ ok: false }) }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }),
    async () => { throw new TypeError('offline'); }
  ];
  for (const fetch of responses) {
    let leads = 0;
    const h = harness(fetch, { auditSubmitted() { leads++; } });
    await h.submit();
    assert.equal(leads, 0);
    assert.equal(h.destinations.length, 0);
  }
});

test('missing or broken tracking cannot break successful form navigation', async () => {
  for (const analytics of [undefined, { auditSubmitted() { throw new Error('blocked'); } }]) {
    const h = harness(async () => ({ ok: true, json: async () => ({ ok: true }) }), analytics);
    await h.submit();
    assert.deepEqual(h.destinations, ['/workflow-audit-thanks.html?ref=fs']);
  }
});

test('bfcache restore resets submission UI without requests, events, or navigation', async () => {
  let requests = 0, leads = 0;
  const h = harness(async () => {
    requests++;
    return { ok: true, json: async () => ({ ok: true }) };
  }, { auditSubmitted() { leads++; } });
  await h.submit();
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.textContent, 'Sending…');
  h.attributes['aria-busy'] = 'true';
  h.pageshow(true);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'Send My Task');
  assert.equal(h.status.hidden, true);
  assert.equal(h.status.textContent, '');
  assert.equal(h.attributes['aria-busy'], undefined);
  assert.equal(requests, 1);
  assert.equal(leads, 1);
  assert.equal(h.destinations.length, 1);
  // Only a new explicit submission may send again after returning.
  await h.submit();
  assert.equal(requests, 2);
  assert.equal(leads, 2);
});

test('ordinary pageshow does not reset an in-flight submission or permit duplicates', async () => {
  let resolve, requests = 0;
  const h = harness(() => { requests++; return new Promise(r => { resolve = r; }); });
  const pending = h.submit();
  h.pageshow(false);
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.textContent, 'Sending…');
  assert.equal(h.attributes['aria-busy'], 'true');
  await h.submit();
  assert.equal(requests, 1);
  resolve({ ok: true, json: async () => ({ ok: true }) });
  await pending;
});
