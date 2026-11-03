// CLOUD-SITE 11-02 task 4: the phone-size and keyboard pass on /geo-demo/ and /game-tv/, in Chromium, LOCAL server only, each page's switch ON in a local config copy (the real config stays OFF).
// At 320 and 375 px (phone) and 1200 px: every control is reached with Tab and shows a focus ring; the whole page is driven with the keyboard only (geo: the mode radios with the arrow keys, each
// example-site button, the selects; TV: the whole recorded game with Tab + Enter, and again with the right arrow key); no sideways scroll; no console error; and the scan of tools/audit-a11y.py
// (names, headings, contrast, 40 px tap targets, alt text) on every state. The page font host is cut off and not counted (as the Python checks do); any other outside request fails.
// Uses the Playwright already installed on the machine (no new dependency).   node tools/check-phone-keyboard-pass.mjs
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
const baseCfg = fs.readFileSync(path.join(ROOT, 'assets/ryagram-config.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const FONT = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const fails = []; let states = 0;
const must = (ok, what) => { if (!ok) fails.push(what); };

async function scan(p, where) {
  const r = await p.evaluate(`(${SCAN})()`); states++;
  for (const k of ['noname', 'headings', 'contrast', 'small', 'noalt']) for (const v of r[k]) fails.push(`${where}: ${k}: ${v}`);
  if (r.overflow) fails.push(`${where}: sideways scroll`);
}
/** Tab through the whole page once; every stop must show a focus ring. Returns the stops in order. */
async function tabWalk(p, where) {
  const stops = [];
  for (let i = 0; i < 60; i++) {
    await p.keyboard.press('Tab');
    const a = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e);
      return { key: `${e.tagName}#${e.id}|${(e.value || e.textContent || '').trim().slice(0, 30)}`, ring: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' }; });
    if (!a || stops.includes(a.key)) break;
    stops.push(a.key); if (!a.ring) fails.push(`${where}: no focus ring on ${a.key}`);
  }
  return stops;
}
async function tabToNext(p, sel) { for (let i = 0; i < 20; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(s => !!document.activeElement && document.activeElement.matches(s), sel)) return true; } return false; }

const b = await chromium.launch();
for (const [vw, phone] of [[320, true], [375, true], [1200, false]]) {
  for (const page of ['geo-demo', 'game-tv']) {
    const flag = page === 'geo-demo' ? 'geoDemo' : 'gameTv', W = s => `${page} ${vw}px ${s}`;
    const ctx = await b.newContext({ viewport: { width: vw, height: 720 }, isMobile: phone, hasTouch: phone });
    const outside = [], errors = [];
    await ctx.route(/.*/, (r) => { const u = r.request().url(); if (FONT.test(u)) return r.abort(); if (!u.startsWith(BASE)) { outside.push(u); return r.abort(); } return r.continue(); });
    await ctx.route('**/assets/ryagram-config.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: baseCfg.replace(new RegExp(`${flag}:\\s*false`), `${flag}: true`) }));
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error' && !FONT.test((m.location() || {}).url || '')) errors.push(m.text()); }); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`${BASE}/${page}/`, { waitUntil: 'load' }); await p.waitForTimeout(250);
    must(await p.isHidden('#not-available'), W('the switch-off line is hidden when ON'));
    await scan(p, W('start'));
    if (page === 'geo-demo') {
      const stops = await tabWalk(p, W('tab walk'));
      for (const want of ['INPUT#|sites', 'INPUT#|A', 'BUTTON#|Middle of the map', 'BUTTON#|North edge', 'BUTTON#|South-east corner', 'SELECT#geo-km', 'BUTTON#|Make this a film']) must(stops.some(s => s.startsWith(want)), W(`Tab reaches ${want}`));
      // each example site with the keyboard: focus stays on the button, the numbers appear
      for (const name of ['Middle of the map', 'North edge', 'South-east corner']) {
        await p.locator('.geo-presets button', { hasText: name }).focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
        must((await p.evaluate(() => document.activeElement.textContent)) === name, W(`focus stays on ${name}`)); await scan(p, W(`site ${name}`));
      }
      must((await p.textContent('.geo-results caption')).includes('Site A and site B'), W('two sites compared'));
      await p.focus('#geo-km'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80); must((await p.evaluate(() => document.activeElement.id)) === 'geo-km', W('focus stays on the ring radius'));
      // City anatomy with the arrow keys on the mode radios
      await p.focus('input[name=geo-mode][value=sites]'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80);
      must(await p.isVisible('#geo-cat'), W('the arrow key switches to City anatomy'));
      for (const id of ['geo-cat', 'geo-miles']) { await p.focus(`#${id}`); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80); must((await p.evaluate(() => document.activeElement.id)) === id, W(`focus stays on #${id}`)); }
      must((await p.textContent('.geo-results caption')).includes('City Anatomy'), W('the anatomy numbers appear')); await scan(p, W('anatomy'));
    } else {
      await p.waitForSelector('.tv-screen');
      const stops = await tabWalk(p, W('tab walk'));
      for (const want of ['BUTTON#|Pause the timer', 'BUTTON#|Lock the guesses']) must(stops.some(s => s.startsWith(want)), W(`Tab reaches ${want}`));
      await p.goto(`${BASE}/game-tv/`, { waitUntil: 'load' }); await p.waitForSelector('.tv-screen');
      // the whole game with Tab + Enter: 3 rounds x 3 screens, then the final scores
      for (let step = 0; step < 9; step++) {
        must(await tabToNext(p, '.tv-next'), W(`step ${step}: Tab reaches the go-on button`)); await p.keyboard.press('Enter'); await p.waitForTimeout(60);
        must((await p.evaluate(() => document.activeElement.tagName)) === 'H2', W(`step ${step}: focus moves to the new heading`)); await scan(p, W(`step ${step + 1}`));
      }
      must((await p.textContent('.tv-stage h2')) === 'Final scores', W('Tab + Enter reaches the final scores'));
      // and again with the right arrow key only
      await p.keyboard.press('ArrowRight'); for (let i = 0; i < 9; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(30); }
      must((await p.textContent('.tv-stage h2')) === 'Final scores', W('the right arrow key walks the whole game'));
    }
    must(!outside.length, W(`no outside request (${outside.join(', ')})`)); must(!errors.length, W(`no console error (${errors.join(' | ')})`));
    await ctx.close();
  }
}
await b.close(); srv.close();
for (const f of fails) console.log('FAIL', f);
console.log(`states scanned: ${states}; FAILURES: ${fails.length}`);
process.exit(fails.length || states !== 3 * (5 + 10) ? 1 : 0);
