// CLOUD-SITE 11-02 round 3 (task 3): the app's page weight and load steps, OFFLINE (local server, mock mode, nothing fetched from outside: the pinned Supabase library is
// measured from node_modules, the font is cut off and counted as one request). The Node twin of tools/audit-page-weight.py (which needs Chrome).
//  - static: every script and stylesheet app/index.html loads, in order, raw and gzipped (GitHub Pages gzips text), and whether it blocks the first paint;
//  - per route, in Chromium at 1280 px with a cold cache on a simulated 4G phone connection (9 Mbps down, 1.5 up, 85 ms): requests, bytes on the wire, time to
//    DOMContentLoaded, to load and to the page's own heading; 3 runs, the median. The mock's own files (/tests/...) are counted apart: the real site does not load them;
//  - for the projects page: how much of each script the first screen actually ran (V8 coverage).
//   node tools/measure-app-weight.mjs [--write]      --write also writes docs/APP-WEIGHT-1102.md
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright')); }
const SUPABASE_LOCAL = path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

// ------------------------------------------------------------------------------------------------ static
export function staticWeight() {
  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const items = [];
  const headEnd = html.indexOf('</head>');
  for (const m of html.matchAll(/<script\b([^>]*)><\/script>|<link\b([^>]*rel="stylesheet"[^>]*)>/g)) {
    const attrs = m[1] ?? m[2], isCss = m[2] != null;
    const url = (/(?:src|href)="([^"]+)"/.exec(attrs) || [])[1]; if (!url) continue;
    let file = null, outside = false;
    if (url.startsWith('/')) file = path.join(ROOT, url.split('?')[0].slice(1));
    else if (url.includes('supabase-js')) { file = SUPABASE_LOCAL; outside = true; } else outside = true;
    const buf = file && fs.existsSync(file) ? fs.readFileSync(file) : null;
    const blocking = isCss || (!/\b(defer|async)\b/.test(attrs) && m.index < headEnd);
    items.push({ url: url.replace(/\?v=.*/, ''), kind: isCss ? 'css' : 'js', outside, raw: buf ? buf.length : null, gzip: buf ? gz(buf) : null, inHead: m.index < headEnd, deferOrAsync: /\b(defer|async)\b/.test(attrs), blocking });
  }
  return items;
}

// ------------------------------------------------------------------------------------------------ in the browser
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.webp': 'image/webp' };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = p === '/__supabase.js' ? SUPABASE_LOCAL : path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = TYPES[path.extname(f)] || 'application/octet-stream', text = /text|javascript|json|svg/.test(type);
    const body = fs.readFileSync(f);
    if (text && /gzip/.test(req.headers['accept-encoding'] || '')) { res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' }); return res.end(zlib.gzipSync(body)); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
export const ROUTES = [
  ['projects', '?mock#/', 'Your projects'], ['signed-out', '?signedout#/', 'Sign in'], ['account', '?mock#/account', 'Your account'], ['credits', '?mock#/credits', 'Credits'],
  ['build', '?mock#/build', 'film step by step'], ['looks', '?mock#/looks', 'Your look'], ['help', '?mock#/help', 'Get help'], ['admin-ops', '?mock#/admin/ops', 'Operations'],
];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export async function measure({ runs = 3 } = {}) {
  const srv = await serve(); const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await chromium.launch();
  const out = [];
  for (const [name, q, heading] of ROUTES) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
      await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/.*supabase-js.*/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(SUPABASE_LOCAL), headers: { 'Access-Control-Allow-Origin': '*' } }));
      const p = await ctx.newPage();
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 85, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
      const reqs = new Map();
      cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, bytes: 0 }));
      cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
      const t0 = Date.now();
      await p.goto(`${BASE}/app/${q}`, { waitUntil: 'load' });
      await p.waitForFunction((h) => [...document.querySelectorAll('h1,h2')].some((e) => e.getBoundingClientRect().height > 0 && e.textContent.includes(h)), heading, { timeout: 30000 }).catch(() => null);
      const ready = Date.now() - t0;
      await p.waitForTimeout(300);
      const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
      const all = [...reqs.values()], mock = all.filter((r) => /\/tests\//.test(r.url)), site = all.filter((r) => !/\/tests\//.test(r.url) && !/fonts\.g/.test(r.url));
      samples.push({ requests: site.length, bytes: site.reduce((a, r) => a + r.bytes, 0), mockRequests: mock.length, mockBytes: mock.reduce((a, r) => a + r.bytes, 0), dcl: nav.dcl, load: nav.load, ready });
      await ctx.close();
    }
    const pick = (k) => median(samples.map((s) => s[k]));
    out.push({ name, requests: pick('requests'), bytes: pick('bytes'), mockRequests: pick('mockRequests'), mockBytes: pick('mockBytes'), dcl: Math.round(pick('dcl')), load: Math.round(pick('load')), ready: pick('ready') });
  }
  // coverage on the projects page: how much of each script the first screen ran
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/.*supabase-js.*/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(SUPABASE_LOCAL) }));
  const p = await ctx.newPage();
  await p.coverage.startJSCoverage({ resetOnNavigation: false });
  await p.goto(`${BASE}/app/?mock#/`, { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const cov = await p.coverage.stopJSCoverage();
  const coverage = cov.filter((e) => !/\/tests\//.test(e.url) && e.source).map((e) => {
    const used = new Uint8Array(e.source.length);
    for (const fn of e.functions) for (const r of fn.ranges) used.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
    const usedN = used.reduce((a, x) => a + x, 0);
    return { url: e.url.replace(BASE, '').replace(/\?.*/, '').replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, 'jsdelivr:'), size: e.source.length, used: usedN };
  }).sort((a, b) => (b.size - b.used) - (a.size - a.used));
  await ctx.close(); await b.close(); srv.close();
  return { routes: out, coverage };
}

// Groups of scripts every page loads today that only some pages (or only switched-OFF features) need. Sizes are computed from what app/index.html really loads.
const GROUPS = [
  ['The live editor stack (#/editor/*, behind liveEditor, OFF): loaded on every page', ['/assets/app-editor-core.js', '/assets/app-editor-progress.js', '/assets/app-editor-draft.js', '/assets/preview/look-draw.js', '/assets/preview/scene-draw-rules.min.js', '/assets/app-editor-data.js', '/assets/app-editor-pace.js', '/assets/app-why-clip.js', '/assets/app-lyric-cards.js', '/assets/app-editor.js']],
  ['Other pages behind switches that are OFF (intake, My films, tester wizard)', ['/assets/app-intake.js', '/assets/app-films.js', '/assets/app-tester-wizard.js']],
  ['Admin-only code (an admin is one account)', ['/assets/app-ops.js', '/assets/app-admin.js']],
];
function suggestions(items) {
  const by = Object.fromEntries(items.map((x) => [x.url, x]));
  const size = (list) => list.reduce((a, u) => [a[0] + (by[u]?.raw || 0), a[1] + (by[u]?.gzip || 0)], [0, 0]);
  const L = ['## Suggested cuts (for Ryan; none made)', '', 'In order of what they save on every page view. Each is a change to app/index.html and the router, and each needs its own tests; none touches a switch or public wording.', ''];
  let n = 1;
  for (const [what, list] of GROUPS) { const [r, z] = size(list); L.push(`${n++}. **Load on demand: ${what}.** ${list.length} files, ${kb(r)} (${kb(z)} gzipped) that the other pages download, parse and run for nothing. Load them the first time their route opens (one small loader that adds the script tags in order and waits), or drop them from the page while their switch is OFF.`); }
  const lib = by['/assets/app-library.js'];
  if (lib) L.push(`${n++}. **Split app-library.js by route.** ${kb(lib.raw)} (${kb(lib.gzip)} gzipped), the biggest file of ours; the projects page runs about 13% of it. The admin views and the film/version views are the natural first pieces.`);
  const sb = items.find((x) => x.url.includes('supabase-js'));
  if (sb) L.push(`${n++}. **A smaller Supabase client.** The UMD build is ${kb(sb.raw)} (${kb(sb.gzip)} gzipped) and the first screen runs about 4% of it. The app uses sign-in, RPC calls, storage (uploads, downloads, signed links: app-data.js) and a realtime channel for job updates (app-data.js, `client.channel(\`jobs:...\`)`), so a slimmer build still needs auth-js, postgrest-js, storage-js and realtime-js; the saving is the UMD wrapper and what those four do not use, so measure it before deciding. Pin it the same way, with an integrity hash. It also removes the one outside script every page waits for.`);
  L.push(`${n++}. **Mark the scripts defer.** They already sit at the end of the body, so this saves little today, but with defer the browser can fetch all of them while it parses, and a later move into the head cannot make them block the first paint. Their order is kept.`);
  L.push(`${n++}. **Self-host the page font.** The Google Fonts stylesheet is render-blocking and comes from another host (already a pending decision in the page weight pass). One weight of Noto Serif Display, as a woff2 under /assets, with font-display: swap.`);
  L.push(`${n++}. **One cache rule for the ?v= files.** Every script carries a version, so a long cache lifetime would be safe, but GitHub Pages sets its own (10 minutes). If the site ever moves behind a CDN that allows headers, \`Cache-Control: max-age=31536000, immutable\` on /assets/*?v= makes every return visit load from the cache.`);
  L.push('', 'Budget to hold once the cuts are in (a suggestion): **at most 150 KB of our JS gzipped on any page that is not the editor**, at most 15 KB of our CSS gzipped, and the projects page heading on screen in under 2.5 s on the simulated 4G above. Today: about 234 KB of our JS gzipped on every page, and about 4.4 s.', '');
  return L;
}

function report(items, m) {
  const ours = items.filter((x) => !x.outside), js = ours.filter((x) => x.kind === 'js'), css = ours.filter((x) => x.kind === 'css');
  const sum = (xs, k) => xs.reduce((a, x) => a + (x[k] || 0), 0);
  const sb = items.find((x) => x.url.includes('supabase-js'));
  const L = ['# App page weight and load steps, 11-02 (CLOUD-SITE, round 3)', '',
    'Made by `node tools/measure-app-weight.mjs --write`, offline: local server, mock mode, Chromium, cold cache, a simulated 4G phone connection (9 Mbps down, 85 ms). The pinned Supabase library is measured from node_modules (the same version); the page font is cut off. Times are from this cloud box, so compare them with each other, not with a phone in the hand. **Suggestions only: nothing here was changed.**', '',
    '## What app/index.html loads', '',
    `Every app page is the same document: **${js.length} of our scripts (${kb(sum(js, 'raw'))}, ${kb(sum(js, 'gzip'))} gzipped)** and **${css.length} of our stylesheets (${kb(sum(css, 'raw'))}, ${kb(sum(css, 'gzip'))} gzipped)**, plus the Supabase library from jsDelivr (${sb && sb.raw ? `${kb(sb.raw)}, ${kb(sb.gzip)} gzipped` : 'size unknown'}) and the Google font. ${items.filter((x) => x.kind === 'js' && x.deferOrAsync).length} scripts are deferred or async; ${items.filter((x) => x.kind === 'js' && x.inHead).length} sit in the head.`, '',
    '### The heaviest files (gzipped, as GitHub Pages sends them)', '', '| File | Raw | Gzipped | Blocks first paint |', '|---|---|---|---|',
    ...items.filter((x) => x.raw).sort((a, b) => b.gzip - a.gzip).slice(0, 15).map((x) => `| ${x.url}${x.outside ? ' (outside)' : ''} | ${kb(x.raw)} | ${kb(x.gzip)} | ${x.blocking ? 'yes' : 'no'} |`), '',
    '## Per page (median of 3)', '', '| Page | Requests | On the wire | DOM ready | Load | Heading on screen | Mock files (not on the real site) |', '|---|---|---|---|---|---|---|',
    ...m.routes.map((r) => `| ${r.name} | ${r.requests} | ${kb(r.bytes)} | ${r.dcl} ms | ${r.load} ms | ${r.ready} ms | ${r.mockRequests}, ${kb(r.mockBytes)} |`), '',
    '## How much of each script the first screen runs (projects page)', '', '| Script | Size | Run on the first screen | Not run |', '|---|---|---|---|',
    ...m.coverage.slice(0, 15).map((c) => `| ${c.url} | ${kb(c.size)} | ${Math.round((c.used / c.size) * 100)}% | ${kb(c.size - c.used)} |`), '',
    ...suggestions(items)];
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const items = staticWeight();
  const m = await measure();
  const text = report(items, m);
  console.log(text);
  if (process.argv.includes('--write')) { fs.writeFileSync(path.join(ROOT, 'docs/APP-WEIGHT-1102.md'), text + '\n'); console.error('wrote docs/APP-WEIGHT-1102.md'); }
}
