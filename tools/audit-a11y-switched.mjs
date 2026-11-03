// CLOUD-SITE 11-02 round 2: accessibility and keyboard pass on the app pages that sit behind switches that are OFF (live editor, My films, the intake, the tester wizard, the admin
// Tester computers page, worker health on the admin Operations page). Chromium, the app's MOCK mode, LOCAL server only; the switches are turned ON in a local config copy only.
// The same checks as tools/audit-a11y-app.py (which needs Chrome): its SCAN is read from tools/audit-a11y.py, and its Tab walk is done the same way here (every control reached, a
// visible focus mark, no trap). Phone (390 px) and desktop (1280 px). Exit 1 on any finding. Uses the Playwright already installed (no new dependency).
//   node tools/audit-a11y-switched.mjs [route-name ...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright')); }
const SCAN = /SCAN = r"""([\s\S]*?)"""/.exec(fs.readFileSync(path.join(ROOT, 'tools/audit-a11y.py'), 'utf8'))[1];

export const SWITCHES = ['liveEditor', 'myFilms', 'testerFilmProgress', 'intake', 'songIntake', 'testerWizard', 'adminTesterDevices', 'workerHealth'];
// (name, query+hash, heading that proves the page opened, text the switched feature must show)
export const ROUTES = [
  ['films', '?mock#/films', 'My films'],
  ['films-tester', '?mock&tester#/films', 'My films'],
  ['intake', '?mock#/new', 'Make a film'],
  ['tester-wizard', '?mock&tester&wzquiet#/tester-start', 'Get started as a tester'],
  ['editor-data', '?mock#/editor/data', 'Edit your film'],
  ['editor-compilation', '?mock#/editor/compilation', 'Edit your film'],
  ['admin-tester', '?mock#/admin/tester', 'Tester computers'],
  ['admin-ops', '?mock#/admin/ops', 'Operations', 'Worker health'],
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' };
export function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const CONTROLS = `() => { const seen = new Set(), out = [];
  for (const e of (document.querySelector('main') || document.body).querySelectorAll('input:not([type=hidden]),select,textarea,button:not([disabled]),a[href],summary')) {
    const r = e.getBoundingClientRect(); const isRadio = e.type === 'radio';
    if (!((r.width > 0 && r.height > 0) || isRadio || e.type === 'checkbox')) continue;
    const d = e.closest('details:not([open])'); if (d && !(e.tagName === 'SUMMARY' && e.parentElement === d)) continue;
    if (e.closest('[hidden]')) continue;
    const key = isRadio ? 'radio:' + e.name : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ':' + (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 60);
    if (seen.has(key)) continue; seen.add(key); out.push(key); }
  return out; }`;
const FOCUSED = `() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const w = e.closest('label,.builder-card') || e; const ws = getComputedStyle(w);
  const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none') || (ws.outlineStyle !== 'none' && parseFloat(ws.outlineWidth) > 0 && w.matches(':focus-within')) || (ws.boxShadow && ws.boxShadow !== 'none' && w.matches(':focus-within'));
  return { d: e.type === 'radio' ? 'radio:' + e.name : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ':' + (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 60), ring: !!ring, inMain: !!e.closest('main') }; }`;

async function tabWalk(p) {
  await p.evaluate(() => { const m = document.querySelector('main') || document.body; const had = m.hasAttribute('tabindex'); if (!had) m.setAttribute('tabindex', '-1'); m.focus(); window.scrollTo(0, 0); if (!had) m.removeAttribute('tabindex'); });
  const all = await p.evaluate(`(${CONTROLS})()`);
  const ids = [], noring = new Set(); let prev = null, stuck = 0;
  for (let i = 0; i < Math.min(all.length + 12, 80); i++) {
    await p.keyboard.press('Tab');
    const f = await p.evaluate(`(${FOCUSED})()`);
    if (!f) continue;
    if (prev === f.d) stuck++; prev = f.d;
    if (f.inMain) { ids.push(f.d); if (!f.ring) noring.add(f.d); }
  }
  const got = new Set(ids);
  return { n: all.length, reached: got.size, missed: all.filter(c => !got.has(c)), noring: [...noring], trapped: stuck > 3 };
}

// Press each button with the keyboard (Enter), from a fresh load each time: focus must stay on a control that is still on the page, never fall to the page body
// (CLOUD-SITE 11-02 found the live editor and the tester wizard rebuilding their panels and dropping it). Not on admin-ops: only its worker-health part is switched, and it has no button.
const NO_PRESS = new Set(['admin-ops']);
async function pressAll(p, url) {
  const labels = await p.evaluate(() => [...document.querySelectorAll('main button:not([disabled])')].filter(e => e.getBoundingClientRect().height > 0 && !e.closest('[hidden]') && !/mock-/.test(e.className))
    .map(e => (e.getAttribute('aria-label') || e.textContent).trim()));
  const lost = [];
  for (let i = 0; i < Math.min(labels.length, 60); i++) {
    await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(500);
    const ok = await p.evaluate((l) => { const b = [...document.querySelectorAll('main button:not([disabled])')].find(e => (e.getAttribute('aria-label') || e.textContent).trim() === l && e.getBoundingClientRect().height > 0); if (!b) return false; b.focus(); return document.activeElement === b; }, labels[i]);
    if (!ok) continue;
    await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    if (await p.evaluate(() => { const e = document.activeElement; return !e || e === document.body || !document.contains(e) || e.getBoundingClientRect().height === 0; })) lost.push(labels[i]);
  }
  return { pressed: labels.length, lost };
}

export async function audit(only = []) {
  const srv = await serve(); const BASE = `http://127.0.0.1:${srv.address().port}`;
  let cfg = fs.readFileSync(path.join(ROOT, 'assets/ryagram-config.js'), 'utf8');
  for (const k of SWITCHES) cfg = cfg.replace(new RegExp(`\\b${k}:\\s*false`), `${k}: true`);
  const findings = [], skipped = [], opened = [];
  const b = await chromium.launch();
  for (const [dev, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const ctx = await b.newContext(opts);
    const outside = [];
    // the page font and the pinned Supabase library are cut off and not counted (both are decided hosts, and mock mode needs neither); anything else outside is a finding
    await ctx.route(/.*/, (r) => { const u = r.request().url(); if (/^https:\/\/(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)\//.test(u)) return r.abort(); if (!u.startsWith(BASE)) { outside.push(u); return r.abort(); } return r.continue(); });
    await ctx.route('**/assets/ryagram-config.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: cfg }));
    for (const [name, q, heading, feature] of ROUTES) {
      if (only.length && !only.includes(name)) continue;
      const p = await ctx.newPage(); const errors = [];
      p.on('dialog', (d) => d.accept()); p.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
      const where = `${dev} ${name}`;
      try {
        await p.goto(`${BASE}/app/${q}`, { waitUntil: 'load' }); await p.waitForTimeout(1200);
        const shown = await p.evaluate((h) => [...document.querySelectorAll('h1,h2')].some(e => e.getBoundingClientRect().height > 0 && e.textContent.includes(h)), heading);
        if (!shown) { skipped.push(`${where} (no "${heading}" heading)`); await p.close(); continue; }
        opened.push(where);
        if (feature && !(await p.evaluate((t) => document.querySelector('main').innerText.includes(t), feature))) findings.push(`${where}: the switched feature does not show (${feature})`);
        const r = await p.evaluate(`(${SCAN})()`);
        for (const [k, label] of [['noname', 'control with no name'], ['headings', 'heading'], ['contrast', 'low contrast'], ['small', 'tap target under 40 px'], ['noalt', 'image with no alt']]) {
          for (const v of r[k]) if (!v.includes('mock-')) findings.push(`${where}: ${label}: ${v}`);
        }
        if (r.overflow) findings.push(`${where}: sideways scroll`);
        for (const v of r.live) if (v.includes('NOT-LIVE')) findings.push(`${where}: message not in a live region: ${v}`);
        const t = await tabWalk(p);
        if (t.reached < t.n * 0.8) findings.push(`${where}: keyboard reaches ${t.reached} of about ${t.n} controls (missed: ${t.missed.slice(0, 5).join(', ')})`);
        for (const d of t.noring) if (!d.includes('mock-')) findings.push(`${where}: no visible focus mark on ${d}`);
        if (t.trapped) findings.push(`${where}: keyboard focus got stuck`);
        if (!NO_PRESS.has(name)) { const pr = await pressAll(p, `${BASE}/app/${q}`); for (const l of pr.lost) findings.push(`${where}: pressing "${l.slice(0, 50)}" with the keyboard drops focus to the page`); }
        for (const e of errors) findings.push(`${where}: page error: ${e}`);
      } catch (e) { findings.push(`${where}: could not be opened: ${String(e).slice(0, 100)}`); }
      await p.close();
    }
    if (outside.length) findings.push(`${dev}: outside requests: ${[...new Set(outside)].slice(0, 3).join(', ')}`);
    await ctx.close();
  }
  await b.close(); srv.close();
  return { findings, skipped, opened };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { findings, skipped, opened } = await audit(process.argv.slice(2));
  for (const s of skipped) console.log('SKIPPED:', s);
  for (const f of findings) console.log(f);
  console.log(`opened ${opened.length}, FINDINGS: ${findings.length}, skipped ${skipped.length}`);
  process.exit(findings.length || skipped.length ? 1 : 0);
}
