// CLOUD-SITE 11-04 (Ryan 11-04 11:15): the sign-in page and the invite code's own page (#/join), in Chromium, LOCAL server only, signed out, the real app script with the pinned
// Supabase library served from node_modules (a signed-out client makes no network call; every other outside request is blocked and counted as a failure).
// At phone (320, 390 px) and desktop (1280 px):
//   - the sign-in page shows ONLY the sign-in box (email, password, Sign in, Forgot your password?) and under it, in order: Have an invite code?, First time here? Create an account
//     (the waitlist form, for now), Trouble signing in? Get help; no invite form on it;
//   - the keyboard order is exactly that, and Enter on "Have an invite code?" opens #/join with focus on its heading; there the order is Invite code, Your email, Join,
//     Back to sign in; Enter on "Back to sign in" returns with focus on the sign-in heading;
//   - an invite link (#/join?code=...&email=... and /app/?code=...) lands on #/join with both boxes filled, nothing sent, the address bar cleaned to #/join;
//   - the tools/audit-a11y.py scan on both pages (names, headings, contrast, 40 px targets), no sideways scroll, no console error.
//   node tools/check-sign-in-pages.mjs [--root <dir>] [--shots <dir> [--prefix before|after]] [--shots-only]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(arg('--root') || HERE);
const SHOTS = arg('--shots'), PREFIX = arg('--prefix') || 'after', SHOTS_ONLY = process.argv.includes('--shots-only');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright')); }
const SUPABASE = path.join(HERE, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js');
const SCAN = /SCAN = r"""([\s\S]*?)"""/.exec(fs.readFileSync(path.join(HERE, 'tools/audit-a11y.py'), 'utf8'))[1];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const fails = []; let scanned = 0;
const must = (ok, what) => { if (!ok) fails.push(what); };

async function page(b, vw, phone, url) {
  const ctx = await b.newContext({ viewport: { width: vw, height: 820 }, isMobile: phone, hasTouch: phone });
  const outside = [], errors = [];
  await ctx.route(/.*/, (r) => {
    const u = r.request().url();
    if (/^https:\/\/cdn\.jsdelivr\.net\/.*supabase-js/.test(u)) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(SUPABASE) });
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) return r.abort();
    if (!u.startsWith(BASE)) { outside.push(u); return r.abort(); }
    return r.continue();
  });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED/.test(m.text() + ((m.location() || {}).url || ''))) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${BASE}${url}`, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  return { ctx, p, outside, errors };
}
const visibleId = (p) => p.evaluate(() => ['sign-in', 'join'].filter((id) => { const e = document.getElementById(id); return e && !e.hidden; }).join(','));
const focused = (p) => p.evaluate(() => { const e = document.activeElement; return e ? (e.id || e.tagName) + ':' + (e.textContent || e.value || '').trim().slice(0, 40) : ''; });
async function tabOrder(p, startId, n) {
  await p.evaluate((id) => document.getElementById(id).focus(), startId);
  const out = [];
  for (let i = 0; i < n; i++) { await p.keyboard.press('Tab'); out.push(await p.evaluate(() => { const e = document.activeElement; return e.id || (e.textContent || '').trim(); })); }
  return out;
}
async function scan(p, where) {
  const r = await p.evaluate(`(${SCAN})()`); scanned++;
  for (const k of ['noname', 'headings', 'contrast', 'small', 'noalt']) for (const v of r[k]) fails.push(`${where}: ${k}: ${v}`);
  if (r.overflow) fails.push(`${where}: sideways scroll`);
}

const b = await chromium.launch();
for (const [vw, phone] of [[320, true], [390, true], [1280, false]]) {
  const W = (s) => `${vw}px ${s}`;
  // the sign-in page
  let { ctx, p, outside, errors } = await page(b, vw, phone, '/app/?signedout#/');
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `${PREFIX}-sign-in-${vw}.png`), fullPage: true }); }
  if (SHOTS_ONLY) {
    // the invite part as it opens on this tree (old: a toggle on the sign-in page; new: its own page)
    const link = p.locator('#have-invite');
    if (await link.count()) { await link.click(); await p.waitForTimeout(300); await p.screenshot({ path: path.join(SHOTS, `${PREFIX}-invite-${vw}.png`), fullPage: true }); }
    await ctx.close(); continue;
  }
  must((await visibleId(p)) === 'sign-in', W('the sign-in page shows'));
  const shown = await p.evaluate(() => [...document.querySelectorAll('#sign-in input, #sign-in button, #sign-in a')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.id || e.textContent.trim()));
  must(JSON.stringify(shown) === JSON.stringify(['si-email', 'si-password', 'Sign in', 'forgot', 'have-invite', 'create-account', 'Get help']), W(`the sign-in page shows only the sign-in box and the three links, in order (${shown.join(', ')})`));
  must(!(await p.isVisible('#invite-form')), W('no invite form on the sign-in page'));
  must((await p.getAttribute('#create-account', 'href')) === '/ryagram/#waitlist', W('Create an account opens the waitlist form'));
  must(JSON.stringify(await tabOrder(p, 'sign-in-title', 7)) === JSON.stringify(['si-email', 'si-password', 'Sign in', 'forgot', 'have-invite', 'create-account', 'Get help']), W('keyboard order on the sign-in page'));
  await scan(p, W('sign-in'));
  // Enter on "Have an invite code?"
  await p.focus('#have-invite'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  must((await visibleId(p)) === 'join', W('Enter on "Have an invite code?" opens the join page'));
  must(new URL(p.url()).hash === '#/join', W('the join page is #/join'));
  must((await focused(p)).startsWith('join-title'), W(`focus lands on the join page heading (${await focused(p)})`));
  const joinShown = await p.evaluate(() => [...document.querySelectorAll('#join input, #join button, #join a')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.id || e.textContent.trim()));
  must(JSON.stringify(joinShown) === JSON.stringify(['iv-code', 'iv-email', 'Join', 'join-back']), W(`the join page shows Invite code, Your email, Join, Back to sign in (${joinShown.join(', ')})`));
  must(JSON.stringify(await tabOrder(p, 'join-title', 4)) === JSON.stringify(['iv-code', 'iv-email', 'Join', 'join-back']), W('keyboard order on the join page'));
  await scan(p, W('join'));
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${PREFIX}-join-${vw}.png`), fullPage: true });
  await p.focus('#join-back'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  must((await visibleId(p)) === 'sign-in', W('"Back to sign in" returns to the sign-in page'));
  must((await focused(p)).startsWith('sign-in-title'), W('focus lands on the sign-in heading'));
  must(!outside.length, W(`no outside request (${outside.join(', ')})`)); must(!errors.length, W(`no console error (${errors.join(' | ')})`));
  await ctx.close();
  // invite links land on the join page, filled, nothing sent, the address cleaned
  for (const url of ['/app/?signedout#/join?code=RYA-K7M2-9QPX&email=maya%40example.com', '/app/?signedout&code=RYA-K7M2-9QPX&email=maya%40example.com']) {
    ({ ctx, p, outside, errors } = await page(b, vw, phone, url));
    const sent = [];
    p.on('request', (r) => { if (/functions\/v1/.test(r.url())) sent.push(r.url()); });
    must((await visibleId(p)) === 'join', W(`${url}: lands on the join page`));
    must((await p.inputValue('#iv-code')) === 'RYA-K7M2-9QPX' && (await p.inputValue('#iv-email')) === 'maya@example.com', W(`${url}: both boxes filled`));
    const u = new URL(p.url());
    must(u.hash === '#/join' && !/code=|email=/.test(u.search + u.hash), W(`${url}: the address bar is cleaned to #/join (${u.search}${u.hash})`));
    await p.waitForTimeout(300); must(!sent.length, W(`${url}: nothing is sent`));
    must(!outside.length, W(`${url}: no outside request (${outside.join(', ')})`)); must(!errors.length, W(`${url}: no console error (${errors.join(' | ')})`));
    await ctx.close();
  }
}
await b.close(); srv.close();
if (SHOTS_ONLY) { console.log(`screenshots written to ${SHOTS}`); process.exit(0); }
for (const f of fails) console.log('FAIL', f);
console.log(`pages scanned: ${scanned}; FAILURES: ${fails.length}`);
process.exit(fails.length || scanned !== 6 ? 1 : 0);
