const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../assets/analytics.js'), 'utf8');
// This ID exists only in the isolated mock; no network requests are made.
function setup({ id = '123456789', pathname = '/', search = '', broken = false, stub = true, href = 'https://calendar.app.google/SrHAqNaF4DMTgo4EA' } = {}) {
  const events = [], scripts = [], listeners = {};
  const booking = { getAttribute: () => href, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const window = { laiAnalyticsConfig: { metaPixelId: id }, location: { pathname, search } };
  if (stub) window.fbq = (...args) => { if (broken) throw new Error('blocked'); events.push(args); };
  const context = vm.createContext({ window, document: {
    createElement: () => ({}), head: { appendChild: node => scripts.push(node) },
    getElementById: id => id === 'audit-booking' ? booking : null
  } });
  vm.runInContext(code, context);
  return { window, events, scripts, listeners, again: () => vm.runInContext(code, context) };
}
test('blank or invalid configuration sends nothing, even with an existing fbq', () => {
  for (const id of ['', undefined, 'YOUR_PIXEL_ID', 123, '0']) {
    const h = setup({ id: id === undefined ? null : id, pathname: '/workflow-audit/' });
    h.window.laiAnalytics.auditSubmitted();
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.scripts, []);
  }
});
test('baseline and audit content events are route-specific and initialized once', () => {
  for (const pathname of ['/', '/workflow-audit', '/workflow-audit/', '/workflow-audit/index.html', '/workflow-audit-thanks.html']) {
    const h = setup({ pathname });
    h.again();
    const names = h.events.filter(e => e[0] === 'track').map(e => e[1]);
    assert.deepEqual(names, pathname.startsWith('/workflow-audit') && !pathname.endsWith('thanks.html') ? ['PageView', 'ViewContent'] : ['PageView']);
  }
});
test('direct thank-you navigation including ref=fs never emits Lead', () => {
  for (const search of ['', '?ref=fs']) {
    const h = setup({ pathname: '/workflow-audit-thanks.html', search });
    assert.equal(h.events.some(e => e[1] === 'Lead'), false);
  }
});
test('ScheduleClicked attaches only to the exact booking CTA on the thank-you route', () => {
  const h = setup({ pathname: '/workflow-audit-thanks.html' });
  assert.equal(h.events.some(e => e[1] === 'ScheduleClicked'), false);
  h.listeners.click();
  assert.deepEqual(h.events.at(-1), ['trackCustom', 'ScheduleClicked']);
  for (const options of [{ pathname: '/' }, { pathname: '/workflow-audit-thanks.html', href: '/' }]) {
    assert.deepEqual(setup(options).listeners, {});
  }
});
test('blocked Pixel fails safely, and a missing SDK queues without form data', () => {
  const broken = setup({ broken: true });
  assert.doesNotThrow(() => broken.window.laiAnalytics.auditSubmitted());
  const h = setup({ stub: false });
  h.window.laiAnalytics.auditSubmitted();
  assert.equal(h.scripts[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  assert.deepEqual(Array.from(h.window.fbq.queue.at(-1)), ['track', 'Lead']);
});
