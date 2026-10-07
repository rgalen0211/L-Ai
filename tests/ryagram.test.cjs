const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../assets/ryagram.js'), 'utf8');

// A minimal stand-in for a DOM element: enough to build the film facade and click it.
function element(tag) {
  return {
    tag, children: [], attrs: {}, listeners: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, fn, options) { (this.listeners[type] = this.listeners[type] || []).push({ fn, once: Boolean(options && options.once) }); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    focus() { this.focused = true; },
    // Like a browser: handlers added with { once: true } are removed after they run.
    fire(type) {
      const handlers = this.listeners[type] || [];
      this.listeners[type] = handlers.filter(handler => !handler.once);
      handlers.forEach(handler => handler.fn({ target: this }));
    }
  };
}

function slot(youtube, title = 'Test film') {
  const frame = element('div');
  return { dataset: { youtube, title }, classList: { add(name) { this.added = name; } }, querySelector: () => frame, frame };
}

function walk(node, visit) {
  visit(node);
  (node.children || []).forEach(child => walk(child, visit));
}

function harness({ fetch = async () => ({ ok: true, status: 201 }), config = { supabaseUrl: 'https://proj.supabase.co/', supabaseKey: 'sb_publishable_test' }, slots = [], website = '', useCase = '  ', search, pathname, navigator } = {}) {
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
  const created = [];
  vm.runInNewContext(code, {
    document: {
      getElementById: id => ({ 'waitlist-form': form, 'waitlist-status': status })[id],
      querySelectorAll: () => slots,
      createElement: tag => { const node = element(tag); created.push(node); return node; }
    },
    window: { ryagramConfig: config },
    fetch: (url, options) => { requests.push({ url, options }); return fetch(url, options); },
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    ...(search === undefined && pathname === undefined ? {} : { location: { search: search || '', pathname: pathname || '/ryagram/' } }),
    ...(navigator === undefined ? {} : { navigator })
  });
  return { button, fields, status, requests, created, submit: () => listeners.submit({ preventDefault() {} }) };
}

// The film slots exactly as shipped in ryagram/index.html, so these tests cover the real page.
const pageHtml = fs.readFileSync(path.join(__dirname, '../ryagram/index.html'), 'utf8');
const shippedSlots = [...pageHtml.matchAll(/<article class="film-slot" data-youtube="([^"]*)" data-title="([^"]*)"/g)]
  .map(([, youtube, title]) => ({ youtube, title }));

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
    const holder = slots[i].frame;
    if (id) {
      // A valid slot becomes a facade (button + thumbnail), never an iframe, until clicked.
      assert.equal(holder.children.length, 1);
      assert.equal(holder.children[0].tag, 'button');
      assert.match(holder.children[0].children[0].src, new RegExp(`^https://i\\.ytimg\\.com/vi/${id}/`));
      assert.equal(slots[i].classList.added, 'is-live');
    } else assert.equal(holder.children.length, 0);
  });
});

test('the shipped page has films 1 and 2 filled and film 3 still coming soon', () => {
  assert.equal(shippedSlots.length, 3);
  assert.equal(shippedSlots[0].youtube, 'https://youtu.be/6Vgfp4WzHh4');
  assert.equal(shippedSlots[1].youtube, 'https://youtu.be/h32_9Gd8cOg');
  assert.equal(shippedSlots[2].youtube, '');
  assert.match(pageHtml, /<article class="film-slot" data-youtube="" data-title="Ryagram film 3"><div class="film-frame"><span>Coming soon<\/span><\/div><h3>Film 3<\/h3><\/article>/);
});

test('before a click there is no YouTube iframe or script, in the markup or in the DOM the script builds', () => {
  // Static markup: nothing but our own scripts, and no iframe at all.
  assert.doesNotMatch(pageHtml, /<iframe/i);
  const scripts = [...pageHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  for (const src of scripts) assert.doesNotMatch(src, /youtube|ytimg|google/i);
  assert.doesNotMatch(pageHtml, /iframe_api|youtube\.com\/embed/i);

  // After ryagram.js has run over the real slots: facades only.
  const slots = shippedSlots.map(s => slot(s.youtube, s.title));
  const h = harness({ slots });
  assert.ok(!h.created.some(node => node.tag === 'iframe' || node.tag === 'script'));
  slots.forEach(s => walk(s.frame, node => assert.ok(node.tag !== 'iframe' && node.tag !== 'script')));
  assert.equal(slots[0].frame.children[0].tag, 'button');
  assert.equal(slots[1].frame.children[0].tag, 'button');
  assert.equal(slots[2].frame.children.length, 0);
});

test('the play control is a real button with an accessible name and a decorative thumbnail', () => {
  const slots = [slot('https://youtu.be/6Vgfp4WzHh4', 'America Never Started Building Again')];
  harness({ slots });
  const button = slots[0].frame.children[0];
  assert.equal(button.tag, 'button');
  assert.equal(button.type, 'button');
  assert.equal(button.attrs['aria-label'], 'Play video: America Never Started Building Again');
  const [poster, icon] = button.children;
  assert.equal(poster.tag, 'img');
  assert.equal(poster.alt, '');
  assert.equal(icon.attrs['aria-hidden'], 'true');
});

test('a click loads the right video in a youtube-nocookie iframe, with sound left on', () => {
  for (const [link, id] of [['https://youtu.be/6Vgfp4WzHh4', '6Vgfp4WzHh4'], ['https://youtu.be/h32_9Gd8cOg', 'h32_9Gd8cOg']]) {
    const s = slot(link, 'A film');
    const h = harness({ slots: [s] });
    assert.ok(!h.created.some(node => node.tag === 'iframe'));
    s.frame.children[0].fire('click');
    const frames = h.created.filter(node => node.tag === 'iframe');
    assert.equal(frames.length, 1);
    const [frame] = frames;
    assert.equal(frame.src, `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1`);
    assert.doesNotMatch(frame.src, /mute/);
    assert.equal(frame.title, 'A film');
    assert.match(frame.allow, /autoplay/);
    assert.equal(frame.allowFullscreen, true);
    assert.deepEqual(s.frame.children, [frame]);
    assert.equal(frame.focused, true);
  }
});

test('clicking twice never creates a second iframe', () => {
  const s = slot('https://youtu.be/6Vgfp4WzHh4');
  const h = harness({ slots: [s] });
  const button = s.frame.children[0];
  button.fire('click');
  button.fire('click');
  assert.equal(h.created.filter(node => node.tag === 'iframe').length, 1);
});

test('the thumbnail is YouTube’s maxres image and falls back to hqdefault once', () => {
  const s = slot('https://youtu.be/h32_9Gd8cOg');
  harness({ slots: [s] });
  const poster = s.frame.children[0].children[0];
  assert.equal(poster.src, 'https://i.ytimg.com/vi/h32_9Gd8cOg/maxresdefault.jpg');
  poster.fire('error');
  assert.equal(poster.src, 'https://i.ytimg.com/vi/h32_9Gd8cOg/hqdefault.jpg');
  poster.src = 'sentinel';
  poster.fire('error');
  assert.equal(poster.src, 'sentinel');

  // A missing maxres can also arrive as a tiny placeholder image that loads "successfully".
  const t = slot('https://youtu.be/h32_9Gd8cOg');
  harness({ slots: [t] });
  const tiny = t.frame.children[0].children[0];
  tiny.naturalWidth = 120;
  tiny.fire('load');
  assert.equal(tiny.src, 'https://i.ytimg.com/vi/h32_9Gd8cOg/hqdefault.jpg');
  const good = slot('https://youtu.be/h32_9Gd8cOg');
  harness({ slots: [good] });
  const real = good.frame.children[0].children[0];
  real.naturalWidth = 1280;
  real.fire('load');
  assert.equal(real.src, 'https://i.ytimg.com/vi/h32_9Gd8cOg/maxresdefault.jpg');
});

test('the page policy lets YouTube thumbnails and the nocookie frame through, and no YouTube script', () => {
  const csp = Object.fromEntries(pageHtml.match(/Content-Security-Policy" content="([^"]+)"/)[1]
    .split(';').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...sources]) => [name, sources]));
  assert.ok(csp['img-src'].includes('https://i.ytimg.com'));
  assert.deepEqual(csp['frame-src'], ['https://www.youtube-nocookie.com']);
  // Cloudflare Web Analytics (cookieless visit count, 2026-10-06): its beacon script and its report endpoint, nothing else new.
  assert.deepEqual(csp['script-src'], ["'self'", 'https://connect.facebook.net', 'https://static.cloudflareinsights.com']);
  assert.ok(csp['connect-src'].includes('https://cloudflareinsights.com'));
  assert.ok(!csp['connect-src'].some(source => /youtube|ytimg/.test(source)));
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

test('a signup records which film link brought the visitor (utm tags), cleaned and within 100 characters', async () => {
  const sourceFor = async search => { const h = harness({ search }); await h.submit(); return JSON.parse(h.requests[0].options.body).source; };
  assert.equal(await sourceFor('?utm_source=youtube&utm_campaign=r002-industry-story'),
               'uselai.com/ryagram?utm_source=youtube&utm_campaign=r002-industry-story');
  assert.equal(await sourceFor('?utm_source=film_page&utm_medium=referral&utm_campaign=AbCdEfGhIjKlMnOpQrStUv'),
               'uselai.com/ryagram?utm_source=film_page&utm_medium=referral&utm_campaign=AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(await sourceFor(''), 'uselai.com/ryagram');
  assert.equal(await sourceFor('?fbclid=abc&gclid=x'), 'uselai.com/ryagram');                 // other tracking ignored
  assert.equal(await sourceFor('?utm_source=<script>alert(1)</script>'), 'uselai.com/ryagram?utm_source=scriptalert1script');
  const long = await sourceFor(`?utm_source=${'a'.repeat(80)}&utm_medium=${'b'.repeat(80)}&utm_campaign=${'c'.repeat(80)}`);
  assert.ok(long.length <= 100);
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

// ---- ?ref= and the cookieless visit tally (2026-10-06) --------------------------------------------------
test('?ref= is kept with the signup, last, cleaned and short', async () => {
  const h = harness({ search: '?utm_source=youtube&utm_campaign=r002&ref=YouTube%20Desc!' });
  await h.submit();
  assert.equal(JSON.parse(h.requests[0].options.body).source, 'uselai.com/ryagram?utm_source=youtube&utm_campaign=r002&ref=YouTubeDesc');
  const only = harness({ search: '?ref=' + 'z'.repeat(40) });
  await only.submit();
  assert.equal(JSON.parse(only.requests[0].options.body).source, 'uselai.com/ryagram?ref=' + 'z'.repeat(24));
  const none = harness({ search: '?other=1' });
  await none.submit();
  assert.equal(JSON.parse(none.requests[0].options.body).source, 'uselai.com/ryagram');
});

const COUNTING = { supabaseUrl: 'https://proj.supabase.co/', supabaseKey: 'sb_publishable_test', visitCounting: true };
const visitCalls = h => h.requests.filter(r => r.url.endsWith('/rest/v1/rpc/record_visit'));

test('a visit is counted once per load with only the path and the source, when the switch is on', () => {
  const h = harness({ config: COUNTING, search: '?ref=YouTube&utm_source=other', navigator: { userAgent: 'Mozilla/5.0' } });
  const calls = visitCalls(h);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/record_visit');
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_path: '/ryagram/', p_source: 'youtube' });         // ref wins, lower case
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['Content-Type', 'apikey']);               // no cookie, no credentials, no id
  assert.equal(calls[0].options.credentials, undefined);
  assert.equal(visitCalls(harness({ config: COUNTING, search: '?utm_source=youtube', navigator: {} }))[0].options.body.includes('"youtube"'), true);
  assert.deepEqual(JSON.parse(visitCalls(harness({ config: COUNTING, search: '', navigator: {} }))[0].options.body), { p_path: '/ryagram/', p_source: '' });
  assert.equal(JSON.parse(visitCalls(harness({ config: COUNTING, search: '?ref=' + 'Q'.repeat(40), navigator: {} }))[0].options.body).p_source, 'q'.repeat(24));
});

test('nothing is counted when the switch is off, off the ryagram page, or for Do Not Track, GPC, automation and crawlers', () => {
  const off = { supabaseUrl: 'https://proj.supabase.co/', supabaseKey: 'sb_publishable_test' };
  assert.equal(visitCalls(harness({ config: off, navigator: {} })).length, 0);                                   // switch off by default
  assert.equal(visitCalls(harness({ config: { ...COUNTING, visitCounting: 'true' }, navigator: {} })).length, 0); // only the boolean true
  assert.equal(visitCalls(harness({ config: { visitCounting: true }, navigator: {} })).length, 0);              // not connected
  assert.equal(visitCalls(harness({ config: COUNTING, pathname: '/app/', navigator: {} })).length, 0);
  assert.equal(visitCalls(harness({ config: COUNTING, pathname: '/ryagram/index.html', navigator: {} })).length, 1);
  for (const nav of [{ doNotTrack: '1' }, { globalPrivacyControl: true }, { webdriver: true }, { userAgent: 'Googlebot/2.1' }, { userAgent: 'HeadlessChrome' }, { userAgent: 'Mozilla Lighthouse' }]) {
    assert.equal(visitCalls(harness({ config: COUNTING, navigator: nav })).length, 0, JSON.stringify(nav));
  }
  assert.equal(visitCalls(harness({ config: COUNTING })).length, 0);                                            // no navigator at all: do nothing
});

test('a failing or throwing count never breaks the page or the waitlist form', async () => {
  const h = harness({ config: COUNTING, navigator: {}, fetch: async (url) => { if (url.endsWith('record_visit')) throw new Error('offline'); return { ok: true, status: 201 }; } });
  await new Promise(r => setTimeout(r, 5));
  await h.submit();
  assert.match(h.status.textContent, /on the list/);
});

// ---- Cloudflare Web Analytics beacon (analytics.js) ---------------------------------------------------
const analyticsCode = fs.readFileSync(path.join(__dirname, '../assets/analytics.js'), 'utf8');
function beaconRun(pathname, token) {
  const appended = [];
  vm.runInNewContext(analyticsCode, {
    window: { location: { pathname }, laiAnalyticsConfig: { metaPixelId: '', cloudflareBeaconToken: token } },
    document: { head: { appendChild: n => appended.push(n) }, createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }) }
  });
  return appended;
}
test('the Cloudflare beacon loads only on /ryagram/, only with a 32-hex token, and carries nothing else', () => {
  const token = 'a'.repeat(32);
  const one = beaconRun('/ryagram/', token);
  assert.equal(one.length, 1);
  assert.equal(one[0].src, 'https://static.cloudflareinsights.com/beacon.min.js');
  assert.equal(one[0].defer, true);
  assert.deepEqual(JSON.parse(one[0].attrs['data-cf-beacon']), { token });
  assert.equal(beaconRun('/ryagram/index.html', token).length, 1);
  for (const [p, t] of [['/', token], ['/workflow-audit/', token], ['/app/', token], ['/ryagram/', ''], ['/ryagram/', 'xyz'], ['/ryagram/', 'A'.repeat(32)], ['/ryagram/', undefined]]) {
    assert.equal(beaconRun(p, t).length, 0, `${p} ${t}`);
  }
});

test('the shipped config has counting off: no visitor is counted and no script is added until Ryan turns it on', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '../assets/ryagram-config.js'), 'utf8');
  assert.match(cfg, /visitCounting: false/);
  assert.match(fs.readFileSync(path.join(__dirname, '../assets/analytics-config.js'), 'utf8'), /cloudflareBeaconToken: ''/);
  const privacy = fs.readFileSync(path.join(__dirname, '../privacy-policy.html'), 'utf8');
  assert.match(privacy, /Cloudflare Web Analytics[^<]*cookieless[^<]*no personal profiles/);
});
