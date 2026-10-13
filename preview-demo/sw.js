// Offline support for /preview-demo/ (pitch day: venue wifi may be missing or bad). A service worker that saves the page, the drawing code and the film's
// bundle on the device the first time the page is opened online, then serves them when the network is off or too slow. Nothing else is cached, nothing
// is sent anywhere, and nothing here can read what a person does on the page.
//
//   * The page (/preview-demo/): network first, but after 3 seconds (bad wifi) or an error (no wifi) the saved copy is used.
//   * Everything in PRECACHE (scripts, styles, the 2.8 MB film bundle): the saved copy first; the network refreshes it in the background when it is
//     there (so a new deploy shows up on the next visit), except the bundle, which is the same file until the cache name below is changed.
//   * Anything else (other sites, other paths, anything but GET): untouched.
// To ship a changed bundle or file list, change VERSION: the old copy is deleted when the new worker activates.
const VERSION = 'ryagram-preview-demo-v1';
const PAGE = '/preview-demo/';
const BUNDLE = '/preview-demo/interstate.bundle.zip';
const PRECACHE = [
  PAGE,
  BUNDLE,
  '/assets/workflow-audit.css',
  '/assets/app.css',
  '/assets/preview/preview-demo.css',
  '/assets/preview/scene-draw.min.js',
  '/assets/preview/preview-zip.js',
  '/assets/preview/preview-core.js',
  '/assets/preview/preview-viewer.js',
  '/assets/preview/preview-edit.js',
  '/assets/preview/preview-demo.js',
  '/assets/preview/preview-offline.js'
];
const NAVIGATE_TIMEOUT_MS = 3000;

const say = async msg => { for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ source: 'ryagram-preview-demo-sw', ...msg }); };

async function precache() {
  const cache = await caches.open(VERSION);
  let done = 0, failed = 0;
  await say({ type: 'progress', done, total: PRECACHE.length });
  for (const url of PRECACHE) {
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));       // always from the network now: never save an old copy
      if (!res.ok) throw new Error(`status ${res.status}`);
      await cache.put(url, res);
    } catch { failed++; }
    done++;
    await say({ type: 'progress', done, total: PRECACHE.length });
  }
  const have = (await cache.keys()).length;
  await say({ type: 'done', cached: have, total: PRECACHE.length, ready: have >= PRECACHE.length && failed === 0 });
  return { cached: have, failed };
}

self.addEventListener('install', event => { event.waitUntil(precache().then(() => self.skipWaiting())); });

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('ryagram-preview-demo-') && name !== VERSION) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
  if (type === 'precache') event.waitUntil(precache());
  else if (type === 'status') {
    event.waitUntil((async () => {
      const cache = await caches.open(VERSION);
      const have = (await cache.keys()).length;
      await say({ type: 'done', cached: have, total: PRECACHE.length, ready: have >= PRECACHE.length });
    })());
  }
});

const isSaved = path => PRECACHE.includes(path);
const withTimeout = (promise, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('slow')), ms); promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (!isSaved(path)) return;
  if (path === PAGE) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await withTimeout(fetch(req), NAVIGATE_TIMEOUT_MS);
        if (res && res.ok) event.waitUntil(cache.put(PAGE, res.clone()));
        return res;
      } catch {
        return (await cache.match(PAGE, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const saved = await cache.match(path, { ignoreSearch: true });
    if (saved) {
      if (path !== BUNDLE) event.waitUntil(fetch(req).then(res => { if (res && res.ok) return cache.put(path, res); return null; }).catch(() => null));
      return saved;
    }
    return fetch(req);                                                      // not saved yet (first visit, still saving): the network
  })());
});
