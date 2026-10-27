// /preview-demo/ offline (preview-demo/sw.js, assets/preview/preview-offline.js): what is saved, how it is served when the network is off or slow,
// and that nothing but this page's own files is touched. The service worker runs here against fake caches and a fake network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('preview-demo/index.html');
const swSource = read('preview-demo/sw.js');

// ---- a fake worker world --------------------------------------------------------------------------------------------------------------------
class FakeResponse {
  constructor(body, { status = 200, error = false } = {}) { this.body = body; this.status = status; this.ok = status >= 200 && status < 300 && !error; this.error = error; }
  clone() { return new FakeResponse(this.body, { status: this.status, error: this.error }); }
}
FakeResponse.error = () => new FakeResponse('', { status: 0, error: true });
class FakeRequest { constructor(url, init = {}) { this.url = typeof url === 'string' ? new URL(url, 'https://uselai.com').href : url.url; this.method = (init.method || (url.method) || 'GET'); this.cache = init.cache; } }

function world({ online = true, slowMs = 0, files = null } = {}) {
  const net = { online, slowMs, calls: [], modes: [], files: files || {} };
  const stores = new Map();
  const norm = (u, ignoreSearch) => { const x = new URL(typeof u === 'string' ? u : u.url, 'https://uselai.com'); return ignoreSearch ? x.origin + x.pathname : x.href; };
  const makeCache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      async put(u, res) { m.set(norm(u, true), res); },
      async match(u, opts = {}) { return m.get(norm(u, !!opts.ignoreSearch)) || m.get(norm(u, true)); },
      async keys() { return [...m.keys()].map(k => ({ url: k })); }
    };
  };
  const messages = [];
  const listeners = {};
  const self = {
    location: new URL('https://uselai.com/preview-demo/sw.js'),
    clients: { matchAll: async () => [{ postMessage: m => messages.push(m) }], claim: async () => {} },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {}
  };
  const caches = { open: async name => makeCache(name), keys: async () => [...stores.keys()], delete: async name => stores.delete(name) };
  const fetch = async req => {
    const url = new URL(typeof req === 'string' ? req : req.url, 'https://uselai.com');
    net.calls.push(url.pathname);
    net.modes.push(typeof req === 'string' ? undefined : req.cache);
    if (net.slowMs) await new Promise(r => setTimeout(r, net.slowMs));
    if (!net.online) throw new TypeError('Failed to fetch');
    const body = url.pathname in net.files ? net.files[url.pathname] : `body of ${url.pathname}`;
    return new FakeResponse(body, { status: body === null ? 404 : 200 });
  };
  const ctx = { self, caches, fetch, Request: FakeRequest, Response: FakeResponse, URL, Promise, setTimeout, clearTimeout, Error, TypeError, Array, Object, String, JSON };
  vm.createContext(ctx);
  vm.runInContext(swSource + '\n;this.__PRECACHE = PRECACHE; this.__VERSION = VERSION;', ctx);
  const dispatch = async (type, init) => {
    const waits = [];
    const event = { waitUntil: p => waits.push(p), respondWith: p => { event.response = p; }, ...init };
    listeners[type](event);
    await Promise.all(waits);
    return event;
  };
  const get = async (url, extra = {}) => {
    const req = { url: new URL(url, 'https://uselai.com').href, method: 'GET', ...extra };
    const ev = await dispatch('fetch', { request: req });
    return ev.response === undefined ? undefined : await ev.response;
  };
  return { net, stores, messages, ctx, dispatch, get, precache: ctx.__PRECACHE, version: ctx.__VERSION };
}

// ---- what is saved ---------------------------------------------------------------------------------------------------------------------------
test('the saved list covers the page and EVERY same-origin script and style it loads, plus the film bundle, and all of them exist', () => {
  const w = world();
  const wanted = new Set(['/preview-demo/', '/preview-demo/interstate.bundle.zip']);
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)/g)) wanted.add(m[1]);
  for (const p of wanted) assert.ok(w.precache.includes(p), `${p} is loaded by the page but not saved for offline use`);
  for (const p of w.precache) {
    assert.ok(wanted.has(p), `${p} is saved but the page does not load it`);
    const file = p === '/preview-demo/' ? 'preview-demo/index.html' : p.slice(1);
    assert.ok(fs.existsSync(path.join(root, file)), `${p} does not exist`);
  }
  assert.ok(w.precache.length >= 12);
});

test('the service worker is registered from the page\'s own scope, under a policy that allows only its own scripts', () => {
  assert.match(html, /<script src="\/assets\/preview\/preview-offline\.js/);
  assert.match(html, /id="demo-offline"/);
  assert.match(html, /id="demo-offline-btn"/);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe/);
  const js = read('assets/preview/preview-offline.js');
  assert.match(js, /register\('\/preview-demo\/sw\.js', \{ scope: '\/preview-demo\/' \}\)/);
  assert.doesNotMatch(js + swSource, /localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|sendBeacon|eval\(|importScripts/);
});

test('install saves every file from the network (never an old copy), reports progress, and says ready only when all are saved', async () => {
  const w = world();
  await w.dispatch('install');
  const cache = await w.ctx.caches.open(w.version);
  assert.equal((await cache.keys()).length, w.precache.length);
  const progress = w.messages.filter(m => m.type === 'progress');
  assert.equal(progress.length, w.precache.length + 1);
  assert.deepEqual([progress[0].done, progress.at(-1).done, progress.at(-1).total], [0, w.precache.length, w.precache.length]);
  assert.ok(w.net.modes.length === w.precache.length && w.net.modes.every(m => m === 'reload'), 'every file is fetched past the browser cache');
  assert.deepEqual(JSON.parse(JSON.stringify(w.messages.at(-1))), { source: 'ryagram-preview-demo-sw', type: 'done', cached: w.precache.length, total: w.precache.length, ready: true });
  const bad = world({ files: { '/assets/app.css': null } });                     // one file missing on the server: NOT ready, and says so
  await bad.dispatch('install');
  assert.equal(bad.messages.at(-1).ready, false);
  assert.equal(bad.messages.at(-1).cached, bad.precache.length - 1);
});

// ---- how it is served ------------------------------------------------------------------------------------------------------------------------
test('NETWORK OFF: the page, a script, a style and the film bundle all come from the saved copy', async () => {
  const w = world();
  await w.dispatch('install');
  w.net.online = false;
  for (const p of ['/preview-demo/', '/assets/preview/preview-viewer.js?v=20261011a', '/preview-demo/interstate.bundle.zip', '/assets/app.css?v=20261011a']) {
    const res = await w.get(p);
    assert.ok(res && res.ok, p);
    assert.match(res.body, /^body of \/(preview-demo|assets)\//, p);
  }
});

test('BAD WIFI: the page waits 3 seconds for the network, then shows the saved copy; a fast network gets the fresh page and refreshes the saved one', async () => {
  const slow = world();
  await slow.dispatch('install');
  slow.net.slowMs = 4000;                                                        // answers, but after the 3 s allowance
  const t0 = Date.now();
  const res = await slow.get('/preview-demo/');
  assert.ok(Date.now() - t0 < 3600, 'it gave up on the network after about 3 seconds');
  assert.equal(res.body, 'body of /preview-demo/');
  const fast = world();
  await fast.dispatch('install');
  fast.net.files['/preview-demo/'] = 'NEW PAGE';
  const fresh = await fast.get('/preview-demo/');
  assert.equal(fresh.body, 'NEW PAGE');
  assert.equal((await (await fast.ctx.caches.open(fast.version)).match('/preview-demo/')).body, 'NEW PAGE');
});

test('ONLINE: saved scripts are served at once and refreshed in the background; the bundle is never re-fetched; a file not saved yet comes from the network', async () => {
  const w = world();
  await w.dispatch('install');
  w.net.calls.length = 0;
  w.net.files['/assets/preview/preview-core.js'] = 'NEWER CORE';
  const first = await w.get('/assets/preview/preview-core.js');
  assert.equal(first.body, 'body of /assets/preview/preview-core.js');             // the saved copy now
  const again = await w.get('/assets/preview/preview-core.js');
  assert.equal(again.body, 'NEWER CORE');                                          // the refresh landed for next time
  w.net.calls.length = 0;
  await w.get('/preview-demo/interstate.bundle.zip');
  assert.deepEqual(w.net.calls, [], 'the bundle is not fetched again');
  const empty = world();                                                          // before the first install finishes: the network
  const live = await empty.get('/assets/preview/preview-edit.js');
  assert.equal(live.body, 'body of /assets/preview/preview-edit.js');
});

test('OTHER REQUESTS ARE UNTOUCHED: another site, another path, a POST, and Google Fonts all go straight to the browser', async () => {
  const w = world();
  await w.dispatch('install');
  for (const req of [{ url: 'https://fonts.googleapis.com/css2?family=Noto+Serif+Display', method: 'GET' }, { url: 'https://other.example/assets/preview/preview-core.js', method: 'GET' }, { url: 'https://uselai.com/app/', method: 'GET' },
                     { url: 'https://uselai.com/ryagram/', method: 'GET' }, { url: 'https://uselai.com/preview-demo/', method: 'POST' },
                     { url: 'https://uselai.com/assets/ryagram-config.js', method: 'GET' }]) {
    const ev = await w.dispatch('fetch', { request: req });
    assert.equal(ev.response, undefined, `${req.method} ${req.url}`);
  }
});

test('a new version deletes the old saved copies of THIS page only', async () => {
  const w = world();
  await w.ctx.caches.open('ryagram-preview-demo-v0');
  await w.ctx.caches.open('something-else');
  await w.dispatch('install');
  await w.dispatch('activate');
  const names = await w.ctx.caches.keys();
  assert.ok(names.includes(w.version) && names.includes('something-else') && !names.includes('ryagram-preview-demo-v0'));
});

test('the page can ask for a fresh save and for the status, and gets the answer', async () => {
  const w = world();
  await w.dispatch('install');
  w.messages.length = 0;
  await w.dispatch('message', { data: { type: 'status' } });
  assert.equal(w.messages.at(-1).ready, true);
  w.messages.length = 0;
  await w.dispatch('message', { data: { type: 'precache' } });
  assert.equal(w.messages.at(-1).type, 'done');
  assert.equal(w.messages.filter(m => m.type === 'progress').length, w.precache.length + 1);
});

test('a slow or missing connection can never hold the page back: no stylesheet from another site in the head; the display font is added after load', () => {
  assert.doesNotMatch(html, /<link[^>]+(fonts\.googleapis|fonts\.gstatic)/);
  const js = read('assets/preview/preview-offline.js');
  assert.match(js, /addEventListener\('load', addFont\)/);
  assert.match(js, /fonts\.googleapis\.com\/css2\?family=Noto\+Serif\+Display/);
  assert.match(html, /style-src 'self' https:\/\/fonts\.googleapis\.com/);            // the policy still allows it when it can load
});
