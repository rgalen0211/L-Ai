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

test('the shipped page shows four films, newest first: two still-image entries (Interstate: watch link; Construction Mix: Coming soon, NO link) and the two finished-film loops (no film slots any more)', () => {
  assert.equal(shippedSlots.length, 0);
  const films = [...pageHtml.matchAll(/<article class="rg-film">([\s\S]*?)<\/article>/g)].map(m => m[1]);
  assert.equal(films.length, 4);
  // Interstate: the published film (youtu.be/UC4j77KYVQ8). Its title, line and credit are the film's own card and licence text.
  assert.match(films[0], /<h3>Rise of the Interstate Highway, 1956&ndash;1993<\/h3>/);
  assert.match(films[0], /href="https:\/\/youtu\.be\/UC4j77KYVQ8"[^>]*rel="noopener"/);
  assert.match(films[0], /39,279 miles constructed, 1956&ndash;1993/);
  assert.match(films[0], /Brooks &amp; Liscow \(2023\), CC BY 4\.0/);
  // Construction Mix: not out yet, so a plain "Coming soon" and no link of any kind to a film that does not exist.
  assert.match(films[1], /<p class="rg-tag">Coming soon<\/p>/);
  assert.match(films[1], /<h3>America's Housing Permits: The Construction Mix \(1990&ndash;2024\)<\/h3>/);
  assert.match(films[1], /23\.5% of the new homes America authorized were in buildings with 5 or more units\. By 2024 it was 29\.9%\./);
  assert.doesNotMatch(films[1], /<a\s|href=/);
  for (const f of films.slice(0, 2)) {
    assert.match(f, /<img class="rg-loop" src="\/assets\/ryagram-film-[a-z-]+\.jpg" width="960" height="540" loading="lazy" alt="[^"]{40,}"/);
    assert.doesNotMatch(f, /<video|autoplay/);
  }
  assert.match(films[2], /href="https:\/\/youtu\.be\/6Vgfp4WzHh4"[^>]*rel="noopener"/);
  assert.match(films[3], /href="https:\/\/youtu\.be\/h32_9Gd8cOg"[^>]*rel="noopener"/);
  for (const f of films.slice(2)) {
    assert.match(f, /<video class="rg-loop" muted loop playsinline preload="none" poster="\/assets\/ryagram-loop-[a-z]+\.jpg"/);
    assert.match(f, /aria-label="[^"]{20,}"/);                                  // a described, silent loop
    assert.doesNotMatch(f, /\sautoplay[\s>]/);                                 // started by ryagram-loops.js, only while visible
  }
});

test('the two new film images exist, are real JPEGs, and are small enough for a phone', () => {
  for (const name of ['interstate', 'construction-mix']) {
    const bytes = fs.readFileSync(path.join(__dirname, `../assets/ryagram-film-${name}.jpg`));
    assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xff, 0xd8, 0xff], name);
    assert.ok(bytes.length > 20000 && bytes.length < 150000, `${name}: ${bytes.length} bytes`);
  }
});

test('before a click there is no YouTube iframe or script in the page', () => {
  assert.doesNotMatch(pageHtml, /<iframe/i);
  const scripts = [...pageHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  for (const src of scripts) assert.doesNotMatch(src, /youtube|ytimg|google/i);
  assert.doesNotMatch(pageHtml, /iframe_api|youtube\.com\/embed/i);
  // The facade code in ryagram.js still works for any slot a later page adds.
  const slots = [slot('https://youtu.be/6Vgfp4WzHh4', 'A film'), slot('', 'Soon')];
  const h = harness({ slots });
  assert.ok(!h.created.some(node => node.tag === 'iframe' || node.tag === 'script'));
  assert.equal(slots[0].frame.children[0].tag, 'button');
  assert.equal(slots[1].frame.children.length, 0);
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
    assert.match(h.status.textContent, /ryagram@uselai\.com/);
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

test('the shipped config: the tally is on, the Cloudflare beacon stays off until Ryan gives a token, and the privacy page says what is live', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '../assets/ryagram-config.js'), 'utf8');
  assert.match(cfg, /visitCounting: true/);   // live since 2026-10-06 (SQL 20261006000100 applied)
  assert.match(fs.readFileSync(path.join(__dirname, '../assets/analytics-config.js'), 'utf8'), /cloudflareBeaconToken: ''/);
  const privacy = fs.readFileSync(path.join(__dirname, '../privacy-policy.html'), 'utf8');
  assert.match(privacy, /simple tally of page loads[^<]*cookieless[^<]*no personal profiles/);
  assert.doesNotMatch(privacy, /Cloudflare Web Analytics/);       // add the Cloudflare words in the same commit that adds the token
});

// ---- the pitch page (2026-10-06): structure, honesty, weight -------------------------------------------------------
const visibleText = pageHtml.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const assetSize = rel => fs.statSync(path.join(__dirname, '..', rel.replace(/^\//, ''))).size;

test('LANDING: the hero is the headline, one sentence, a short muted loop of the Interstate film, and ONE call to action to the creator beta (phone order: words, film, button)', () => {
  assert.match(pageHtml, /<h1 id="hero-title">You have a question\. Ryagram makes the data answer it\.<\/h1>/);
  assert.equal([...pageHtml.matchAll(/<h1[ >]/g)].length, 1);
  const hero = pageHtml.match(/<section class="rg-wrap rg-hero"[\s\S]*?<\/section>/)[0];
  assert.deepEqual([...hero.matchAll(/class="rg-btn"[^>]*>([^<]*)</g)].map(m => m[1]), ['Join the creator beta']);        // exactly ONE button
  assert.match(hero, /<a class="rg-btn" href="#creators">Join the creator beta<\/a>/);
  const order = ['rg-hero-copy', 'rg-hero-film', 'rg-hero-cta'].map(c => hero.indexOf(`class="${c}"`));
  assert.ok(order[0] > -1 && order[0] < order[1] && order[1] < order[2], 'words, then the film, then the button');
  const v = hero.match(/<video class="rg-loop rg-hero-loop"[^>]*>/)[0];
  for (const attr of ['muted', 'loop', 'playsinline', 'poster="/assets/ryagram-hero-interstate.jpg"', 'width="960"', 'height="540"']) assert.ok(v.includes(attr), attr);
  assert.doesNotMatch(v, /autoplay/);                                           // ryagram-loops.js starts it while visible, and never for reduced motion
  assert.match(v, /aria-label="[^"]{40,}"/);
  assert.match(hero, /<source src="\/assets\/ryagram-hero-interstate\.mp4" type="video\/mp4">/);
  assert.match(hero, /href="https:\/\/youtu\.be\/UC4j77KYVQ8"[^>]*rel="noopener"/);
  assert.ok(assetSize('/assets/ryagram-hero-interstate.mp4') < 1.5e6, 'the hero loop stays small enough for a phone');
  assert.ok(assetSize('/assets/ryagram-hero-interstate.jpg') < 120e3);
  const bytes = fs.readFileSync(path.join(__dirname, '../assets/ryagram-hero-interstate.mp4'));
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');                         // a real MP4
  assert.match(pageHtml, /<link rel="preload" as="image" href="\/assets\/ryagram-hero-interstate\.jpg">/);
});

test('LANDING: the app tour is not on the page (it shows features that are not live yet); its files and their checks stay for later', () => {
  assert.doesNotMatch(pageHtml, /ryagram-walkthrough|class="rg-walk"|walk-words/);
  for (const f of ['ryagram-walkthrough.mp4', 'ryagram-walkthrough-poster.jpg']) assert.ok(assetSize(`/assets/${f}`) > 1000, f);
});

test('every showcase loop is small, and every file the page names exists', () => {
  for (const f of ['/assets/ryagram-loop-housing.mp4', '/assets/ryagram-loop-obesity.mp4']) assert.ok(assetSize(f) < 450e3, f);
  for (const m of pageHtml.matchAll(/(?:src|href|poster)="(\/assets\/[^"]+)"/g)) assert.ok(assetSize(m[1]) > 0, m[1]);
});

test('the Compilation Maker section is an illustration with public-domain words, with no video of anyone else footage', () => {
  const sec = pageHtml.match(/<section id="compilation"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(sec, /<video|<iframe|<img/);
  assert.match(sec, /Coming soon/);
  assert.match(sec, /every time it is said in your own footage/);
  assert.match(sec, /turn your clips into songs/);
  assert.match(sec, /public-domain words \(Lincoln, 1863\)/);
});

test('LANDING: how it works is three steps of what the beta really does, one checks line (no strip), and the private-beta line with both ways in', () => {
  const how = pageHtml.match(/<section id="how"[\s\S]*?<\/section>/)[0];
  assert.deepEqual([...how.matchAll(/<h3>([^<]*)<\/h3>/g)].map(m => m[1]), ['Ask', 'We draw it', 'You get it, checked']);
  assert.match(how, /<p class="rg-release">Ryagram is in private beta\. Creators can <a href="#creators">apply now<\/a>; everyone else can <a href="#waitlist">join the waitlist<\/a>\.<\/p>/);
  assert.doesNotMatch(pageHtml, /\[RELEASE DATE\]/);
  const checks = [...pageHtml.matchAll(/<p class="rg-checks">([^<]*)<\/p>/g)];
  assert.equal(checks.length, 1);                                              // ONE line
  assert.match(checks[0][1], /^Every film is checked against its data before you get it: /);
  assert.doesNotMatch(pageHtml, /check-list|checks-strip|rg-strip-checks|Correctness checks/);   // and no strip or section
});

test('LANDING: the sections run hero, films, how it works, creator beta, waitlist, then the coming-soon compilation maker; non-creators are pointed at the waitlist', () => {
  const at = id => pageHtml.indexOf(id === 'hero' ? 'class="rg-wrap rg-hero"' : `<section id="${id}"`);
  const order = ['hero', 'films', 'how', 'creators', 'waitlist', 'compilation'].map(at);
  assert.ok(order.every(i => i > -1), JSON.stringify(order));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  assert.match(pageHtml.match(/<section id="creators"[\s\S]*?<\/section>/)[0], /Not a creator\? <a href="#waitlist">Join the waitlist<\/a> instead\./);
});

test('LANDING: no claim the product cannot back yet: nothing about an editor, speed, self-serve sign-up, free trials or prices outside the one creator-beta terms paragraph', () => {
  assert.doesNotMatch(publicText, /\b(editor|instant|instantly|minutes|self[- ]serve|sign up now|free trial|try it free|pricing|prices?|cheap|AI[- ]powered|powered by AI|unlimited|guarantee[sd]?)\b/i);
  assert.doesNotMatch(publicText.replace(/Applying doesn't guarantee a place; we reply by email\./, ''), /guarantee/i);
  assert.doesNotMatch(visibleText, /\$\d/);
});

test('the operator is L\'Ai, LLC everywhere it is named; Ryagram pages, the policy and the app give ryagram@, the main pages ryan.galen@', () => {
  const page = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const named = ['index.html', 'ryagram/index.html', 'privacy-policy.html', 'workflow-audit/index.html', 'workflow-audit-thanks.html', 'film/index.html', 'app/index.html'];
  for (const f of named) {
    const html = page(f);
    assert.doesNotMatch(html, /Seasonings/, f);
    assert.match(html, /L'Ai, LLC/, f);
  }
  // Ryagram's own pages, the policy and the app: ryagram@, never the personal address.
  for (const f of ['ryagram/index.html', 'privacy-policy.html', 'app/index.html']) {
    const html = page(f);
    assert.match(html, /mailto:ryagram@uselai\.com/, f);
    assert.doesNotMatch(html, /ryan\.galen@uselai\.com/, f);
  }
  assert.match(page('assets/ryagram.js'), /const CONTACT = 'ryagram@uselai\.com';/);
  // The main uselai.com pages keep Ryan's address.
  for (const f of ['index.html', 'workflow-audit/index.html', 'workflow-audit-thanks.html', 'thank-you.html']) assert.match(page(f), /ryan\.galen@uselai\.com/, f);
  // The app names its operator and links the policy (it had no footer before).
  assert.match(page('app/index.html'), /<footer class="app-foot"><span>Ryagram is operated by L'Ai, LLC\.<\/span><a href="mailto:ryagram@uselai\.com">ryagram@uselai\.com<\/a><a href="\/terms\/">Terms of Use<\/a><a href="\/privacy-policy\.html">Privacy Policy<\/a><a href="\/ai-content\/">AI content<\/a><\/footer>/);
  // The Auth email templates live in the Supabase dashboard: the README says what to paste.
  assert.match(page('supabase/README.md'), /Ryagram is operated by L'Ai, LLC\. Questions: ryagram@uselai\.com/);
});

test('the waitlist form keeps its fields: required email, optional "What do you do?", the bot trap, and the call to action repeats', () => {
  assert.match(pageHtml, /<form id="waitlist-form"/);
  assert.match(pageHtml, /id="wl-email" name="email" type="email"[^>]*required/);
  assert.match(pageHtml, /<label for="wl-use">What do you do\? <span>\(optional\)<\/span><\/label>/);
  assert.match(pageHtml, /id="wl-use" name="use_case"(?![^>]*required)/);
  assert.match(pageHtml, /name="website"/);
  assert.ok([...pageHtml.matchAll(/href="#waitlist"/g)].length >= 3);        // header, hero, skip link
  assert.match(pageHtml, /<section id="waitlist"[^>]*>[\s\S]*Want to make one\?/);
});

// The one deliberate exception (Ryan, 2026-10-14): the creator beta terms must say plainly that beta credits are free. That paragraph (class
// rg-terms) is checked on its own below, so "credits" is allowed THERE and nowhere else.
const termsParagraph = (pageHtml.match(/<p class="rg-terms">[\s\S]*?<\/p>/) || [''])[0];
const publicText = visibleText.replace(termsParagraph.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), ' ');

test('nothing on the page reveals how data is found or chosen, or how anything is priced', () => {
  assert.notEqual(termsParagraph, '');
  assert.doesNotMatch(publicText, /\b(broker|brokering|sourcing|catalog|catalogue|price|pricing|priced|credits?|per film|Anthropic|Claude|Supabase|Cloudflare|Playwright|worker)\b/i);
  assert.doesNotMatch(visibleText, /\$\d/);
});

test('CREATOR BETA: the section says plainly that beta credits are free in exchange for feedback and that any promotion is disclosed, and prices nothing', () => {
  const text = termsParagraph.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Beta credits are free, in exchange for your feedback\./);
  assert.match(text, /promote .* you disclose that your credits were free/);
  assert.doesNotMatch(text, /\$|\b(price|pricing|priced|per film|Anthropic|Claude|Supabase|worker)\b/i);
  assert.match(pageHtml, /<section id="creators"[^>]*aria-labelledby="creators-title"/);
  assert.match(pageHtml, /<a class="rg-navlink" href="#creators">Creator beta<\/a>/);
});

test('CREATOR BETA: the form asks name, email, who they are (all six kinds), what they make, a link, and their data question; has a honeypot; and every field has a label', () => {
  const form = pageHtml.match(/<form id="creator-form"[\s\S]*?<\/form>/)[0];
  for (const name of ['name', 'email', 'kind', 'makes', 'link', 'question', 'website']) assert.match(form, new RegExp(`name="${name}"`), name);
  for (const kind of ['youtuber', 'podcaster', 'newsletter', 'journalist', 'teacher', 'researcher']) assert.match(form, new RegExp(`<option value="${kind}">`), kind);
  for (const id of [...form.matchAll(/<(?:input|select|textarea) id="([^"]+)"/g)].map(m => m[1])) assert.match(form, new RegExp(`for="${id}"`), id);
  assert.match(form, /<div class="hp" aria-hidden="true">/);
  assert.match(pageHtml, /<script src="\/assets\/creator-beta\.js" defer><\/script>/);
});

test('the page works with the strict policy: no inline script or style, and nothing from outside but the typeface', () => {
  assert.doesNotMatch(pageHtml, /\sstyle="/);
  assert.doesNotMatch(pageHtml, /<script(?![^>]*\ssrc=)[^>]*>/);
  assert.doesNotMatch(pageHtml, /unsafe-inline|unsafe-eval/);
  const external = [...pageHtml.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => new URL(m[1]).hostname);
  for (const host of new Set(external)) assert.ok(['fonts.googleapis.com', 'fonts.gstatic.com', 'youtu.be', 'uselai.com'].includes(host), host);
});

test('accessibility basics: language, one main, a skip link, labelled sections, text alternatives, large tap targets, Night', () => {
  assert.match(pageHtml, /<html lang="en">/);
  assert.equal([...pageHtml.matchAll(/<main>/g)].length, 1);
  assert.match(pageHtml, /<a class="skip-link" href="#waitlist">/);
  for (const sec of pageHtml.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)) assert.match(pageHtml, new RegExp(`id="${sec[1]}"`), sec[1]);
  for (const v of pageHtml.matchAll(/<video[^>]*class="rg-loop"[^>]*>/g)) assert.match(v[0], /aria-label=/);
  const css = fs.readFileSync(path.join(__dirname, '../assets/ryagram.css'), 'utf8');
  assert.match(css, /\.rg-btn\{[^}]*min-height:52px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /--bg:#14141a/);                                          // Night, as in the films
});

// ---- ryagram-loops.js ------------------------------------------------------------------------------------------
const loopsCode = fs.readFileSync(path.join(__dirname, '../assets/ryagram-loops.js'), 'utf8');
function video() { return { played: 0, paused: 0, attrs: { autoplay: '' }, controls: false, play() { this.played++; return Promise.resolve(); }, pause() { this.paused++; }, removeAttribute(n) { delete this.attrs[n]; } }; }
function runLoops({ reduced = false, observer = true, loops = [video(), video()], walk = video() } = {}) {
  let cb = null; const observed = [];
  vm.runInNewContext(loopsCode, {
    document: { querySelectorAll: () => loops, querySelector: () => walk },
    matchMedia: () => ({ matches: reduced }),
    ...(observer ? { IntersectionObserver: function (fn) { cb = fn; this.observe = t => observed.push(t); } } : {})
  });
  return { loops, walk, observed, fire: entries => cb(entries) };
}
test('loops start only while on screen and pause when they leave', () => {
  const r = runLoops();
  assert.equal(r.observed.length, 2);
  assert.equal(r.loops[0].played, 0);
  r.fire([{ target: r.loops[0], isIntersecting: true }, { target: r.loops[1], isIntersecting: false }]);
  assert.deepEqual([r.loops[0].played, r.loops[1].played, r.loops[1].paused], [1, 0, 1]);
  r.fire([{ target: r.loops[0], isIntersecting: false }]);
  assert.equal(r.loops[0].paused, 1);
});
test('with reduced motion nothing autoplays and the browser controls appear', () => {
  const r = runLoops({ reduced: true });
  for (const v of [...r.loops, r.walk]) assert.deepEqual([v.attrs.autoplay, v.controls, v.paused], [undefined, true, 1]);
  assert.equal(r.observed.length, 0);
});
test('without IntersectionObserver the loops simply play; a refused play never throws', () => {
  const r = runLoops({ observer: false });
  assert.deepEqual(r.loops.map(v => v.played), [1, 1]);
  const bad = video(); bad.play = () => { throw new Error('refused'); };
  assert.doesNotThrow(() => runLoops({ observer: false, loops: [bad] }));
});

// ---- the walkthrough video's words (no prices, no credits) ---------------------------------------------------------------
test('the walkthrough shows no credits, prices or "free" labels: the words on the page while it was recorded are saved beside it, tied to the exact video by its hash', () => {
  const crypto = require('node:crypto');
  const list = fs.readFileSync(path.join(__dirname, 'fixtures', 'walkthrough.text.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  const video = fs.readFileSync(path.join(__dirname, '../assets/ryagram-walkthrough.mp4'));
  assert.equal(list[0], `sha256 ${crypto.createHash('sha256').update(video).digest('hex')}`);   // this list belongs to THIS video
  const words = list.slice(1);
  assert.ok(words.length > 60, 'the recorder captured the page text');
  for (const must of ['Shape the film', 'Make contact sheet', 'Make preview', 'Render final film', 'Editor']) assert.ok(words.includes(must), must);
  const priced = words.filter(w => /\bcredits?\b(?!\s*line)|\bfree\b|\bpric(e|es|ing)\b|[$][0-9]|\b\d+\s*cr\b/i.test(w) && !/^Credit line$/.test(w));
  assert.deepEqual(priced, []);
  assert.doesNotMatch(words.join('\n'), /\(mock\)|mock@|localhost/i);              // and none of the mock app's own labels
});
test('the recorder keeps prices out of the video by rewriting the page while it records, and saves the words it saw', () => {
  const rec = fs.readFileSync(path.join(__dirname, '../tools/record-walkthrough.py'), 'utf8');
  for (const part of ['PRICE_TAIL', 'PRICE_LINE', 'MutationObserver', 'walkthrough.text.txt', 'seen-text.json']) assert.ok(rec.includes(part), part);
});
