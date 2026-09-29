const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../assets/ryagram.js'), 'utf8');

function slot(youtube) {
  const frame = { replaceChildren(child) { this.child = child; } };
  return { dataset: { youtube, title: 'Test film' }, classList: { add(name) { this.added = name; } }, querySelector: () => frame, frame };
}

function harness({ fetch = async () => ({ ok: true, status: 201 }), config = { supabaseUrl: 'https://proj.supabase.co/', supabaseKey: 'sb_publishable_test' }, slots = [], website = '', useCase = '  ' } = {}) {
  const listeners = {};
  const button = {};
  const fields = {};
  const status = { focus() { this.focused = true; } };
  const form = {
    elements: { email: { value: ' person@example.com ' }, use_case: { value: useCase }, website: { value: website } },
    reportValidity: () => true,
    querySelector: selector => (selector === '.waitlist-fields' ? fields : button),
    addEventListener(type, fn) { listeners[type] = fn; },
    setAttribute() {}, removeAttribute() {}
  };
  const requests = [];
  vm.runInNewContext(code, {
    document: {
      getElementById: id => ({ 'waitlist-form': form, 'waitlist-status': status })[id],
      querySelectorAll: () => slots,
      createElement: () => ({})
    },
    window: { ryagramConfig: config },
    fetch: (url, options) => { requests.push({ url, options }); return fetch(url, options); },
    URL, AbortController, setTimeout, clearTimeout
  });
  return { button, fields, status, requests, submit: () => listeners.submit({ preventDefault() {} }) };
}

test('film slots accept YouTube links or IDs and ignore anything else', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['', null], ['https://vimeo.com/123', null], ['https://evil.example/watch?v=dQw4w9WgXcQ', null], ['javascript:alert(1)', null]
  ];
  const slots = cases.map(([value]) => slot(value));
  harness({ slots });
  cases.forEach(([, id], i) => {
    const child = slots[i].frame.child;
    if (id) {
      assert.equal(child.src, `https://www.youtube-nocookie.com/embed/${id}`);
      assert.equal(slots[i].classList.added, 'is-live');
    } else assert.equal(child, undefined);
  });
});

test('a signup posts insert-only JSON to the waitlist table and shows success', async () => {
  const h = harness();
  await h.submit();
  assert.equal(h.requests.length, 1);
  const { url, options } = h.requests[0];
  assert.equal(url, 'https://proj.supabase.co/rest/v1/ryagram_waitlist');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.apikey, 'sb_publishable_test');
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers.Prefer, 'return=minimal');
  assert.deepEqual(JSON.parse(options.body), { email: 'person@example.com', use_case: null, source: 'uselai.com/ryagram' });
  assert.equal(h.fields.hidden, true);
  assert.match(h.status.textContent, /on the list/);
});

test('a legacy anon JWT key is also sent as a bearer token', async () => {
  const h = harness({ config: { supabaseUrl: 'https://proj.supabase.co', supabaseKey: 'eyJhbGciOi.test' } });
  await h.submit();
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer eyJhbGciOi.test');
});

test('an email already on the list looks the same as a new signup', async () => {
  const h = harness({ fetch: async () => ({ ok: false, status: 409 }) });
  await h.submit();
  assert.equal(h.fields.hidden, true);
  assert.match(h.status.textContent, /on the list/);
});

test('failures keep the form and allow retry', async () => {
  for (const fetch of [async () => ({ ok: false, status: 500 }), async () => { throw new TypeError('Failed to fetch'); }]) {
    const h = harness({ fetch });
    await h.submit();
    assert.notEqual(h.fields.hidden, true);
    assert.equal(h.button.disabled, false);
    assert.equal(h.status.focused, true);
    assert.match(h.status.textContent, /ryan\.galen@uselai\.com/);
  }
});

test('an unconfigured site or a filled honeypot sends nothing', async () => {
  const unconfigured = harness({ config: { supabaseUrl: '', supabaseKey: '' } });
  await unconfigured.submit();
  assert.equal(unconfigured.requests.length, 0);
  assert.match(unconfigured.status.textContent, /isn’t connected yet/);

  const bot = harness({ website: 'spam.example' });
  await bot.submit();
  assert.equal(bot.requests.length, 0);
  assert.equal(bot.fields.hidden, true);
});

test('repeated submits while waiting create only one request', async () => {
  let resolve;
  const h = harness({ fetch: () => new Promise(r => { resolve = r; }) });
  const first = h.submit();
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.button.disabled, true);
  resolve({ ok: true, status: 201 });
  await first;
  assert.equal(h.button.disabled, false);
});
