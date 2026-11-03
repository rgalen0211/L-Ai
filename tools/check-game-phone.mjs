// CLOUD-SITE 11-02: the PHONE page for Guess the next line (/game-phone/) in Chromium, LOCAL server only, with gamePhone ON in a local config copy (the real config stays OFF).
// Phone 320 and 375 px, and desktop: the switch OFF shows one plain line; ON, the whole sample is walked with the KEYBOARD only (Tab, typing, Enter, Space): empty and wrong codes, a taken name and an
// empty guess are refused in words, tied to their field and announced; the page never shows the round's answer or a recorded guess; no sideways scroll; no console error; no request leaves 127.0.0.1.
// Each screen also gets the accessibility scan of tools/audit-a11y.py (its SCAN, read from that file): names, headings, contrast, 40 px tap targets, alt text.
// Uses the Playwright that is already installed on the machine (no new dependency).   node tools/check-game-phone.mjs
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
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/game-night-sample.json'), 'utf8'));
const baseCfg = fs.readFileSync(path.join(ROOT, 'assets/ryagram-config.js'), 'utf8');
const onCfg = baseCfg.replace(/gamePhone:\s*false/, 'gamePhone: true');
if (onCfg === baseCfg) { console.log('FAIL the config has no gamePhone: false to turn on'); process.exit(1); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

const fails = []; let screens = 0;
const must = (ok, what) => { if (!ok) fails.push(what); };

async function scan(p, where) {
  const r = await p.evaluate(`(${SCAN})()`); screens++;
  for (const k of ['noname', 'headings', 'contrast', 'small', 'noalt']) for (const v of r[k]) fails.push(`${where}: ${k}: ${v}`);
  if (r.overflow) fails.push(`${where}: sideways scroll`);
  for (const l of r.live) if (/NOT-LIVE/.test(l)) fails.push(`${where}: an error line is not announced: ${l}`);
}
const focused = p => p.evaluate(() => (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) || '');
async function tabTo(p, id, max = 20) { for (let i = 0; i < max; i++) { await p.keyboard.press('Tab'); if ((await focused(p)) === id) return true; } return false; }
async function tabToButton(p, text, max = 20) {
  for (let i = 0; i < max; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(t => document.activeElement && document.activeElement.tagName === 'BUTTON' && document.activeElement.textContent.trim() === t, text)) return true; }
  return false;
}

const b = await chromium.launch();
for (const [name, opts] of [['phone320', { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }], ['phone375', { viewport: { width: 375, height: 700 }, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1200, height: 900 } }]]) {
  for (const on of [false, true]) {
    const ctx = await b.newContext(opts);
    const outside = [], errors = [];
    // the page font is the shared site template's (as on /game-tv/): it is cut off here, as tools/audit-a11y-gametv.py does, and is not counted; anything else outside fails
    const FONT = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
    await ctx.route(/.*/, (route) => { const u = route.request().url(); if (FONT.test(u)) return route.abort(); if (!u.startsWith(BASE)) { outside.push(u); return route.abort(); } return route.continue(); });
    await ctx.route('**/assets/ryagram-config.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: on ? onCfg : baseCfg }));
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error' && !FONT.test((m.location() || {}).url || '')) errors.push(m.text()); }); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`${BASE}/game-phone/`, { waitUntil: 'load' });
    if (!on) {
      must(await p.isVisible('#not-available'), `${name} OFF: the plain line is shown`); must(await p.isHidden('#game-phone'), `${name} OFF: the game is hidden`);
      await ctx.close(); continue;
    }
    const W = (s) => `${name} ${s}`;
    await p.waitForSelector('.ph-screen');
    must(await p.isHidden('#not-available'), W('ON: the plain line is hidden'));
    await scan(p, W('join'));
    // empty form: both refused, focus on the code
    must(await tabToButton(p, 'Join the room'), W('Tab reaches the Join button')); await p.keyboard.press('Enter');
    must((await p.textContent('#ph-code-err')).includes('Type the room code'), W('empty code refused in words'));
    must((await p.getAttribute('#ph-code', 'aria-invalid')) === 'true', W('the code field is marked invalid')); must((await focused(p)) === 'ph-code', W('focus goes to the code'));
    await scan(p, W('join, errors'));
    // a code that is not a room, then a code with a number
    await p.keyboard.type('abcd'); await p.keyboard.press('Enter');
    must((await p.textContent('#ph-code-err')).includes('no room with that code'), W('a wrong code is refused'));
    await p.fill('#ph-code', 'G4ME'); await p.focus('#ph-code'); await p.keyboard.press('Enter');
    must((await p.textContent('#ph-code-err')).includes('no numbers'), W('a code with a number is refused'));
    // right code typed loosely, a taken name, then a good one
    await p.fill('#ph-code', ''); await p.focus('#ph-code'); await p.keyboard.type('ga me');
    must(await tabTo(p, 'ph-name'), W('Tab reaches the name')); await p.keyboard.type('ana'); await p.keyboard.press('Enter');
    must((await p.textContent('#ph-name-err')).includes('already has that name'), W('a taken name is refused')); must((await p.textContent('#ph-code-err')) === '', W('the code error clears once the code is right'));
    await p.fill('#ph-name', ''); await p.focus('#ph-name'); await p.keyboard.type('Dee'); await p.keyboard.press('Enter');
    for (const [i, r] of sample.rounds.entries()) {
      await p.waitForSelector('#ph-guess');
      const h2 = await p.textContent('h2'); must(h2 === `Round ${i + 1} of ${sample.rounds.length}`, W(`round ${i + 1} heading (${h2})`));
      const text = await p.textContent('main');
      must(text.includes(r.public.heard_text), W(`round ${i + 1}: what was said so far is shown`));
      must(!text.includes(r.reveal.answer_text), W(`round ${i + 1}: the answer is NOT shown`));
      for (const g of r.guesses) if (g.text) must(!text.includes(g.text), W(`round ${i + 1}: a recorded guess is NOT shown`));
      await scan(p, W(`round ${i + 1}`));
      // an empty guess is refused, then a real one is sent with the keyboard
      must(await tabToButton(p, 'Send my guess'), W('Tab reaches Send')); await p.keyboard.press('Enter');
      must((await p.textContent('#ph-guess-err')).includes('Type your guess'), W('an empty guess is refused')); must((await focused(p)) === 'ph-guess', W('focus goes to the guess'));
      await p.keyboard.type('my guess number ' + (i + 1)); must((await p.textContent('#ph-guess-count')) === `${('my guess number ' + (i + 1)).length} of 120 characters`, W('the counter counts'));
      must((await p.textContent('#ph-guess-err')) === '', W('the guess error clears while typing'));
      must(await tabToButton(p, 'Send my guess'), W('Tab reaches Send again')); await p.keyboard.press(' ');
      await p.waitForSelector('text=Guess sent');
      must((await p.textContent('main')).includes(`my guess number ${i + 1}`), W('the sent guess is shown back')); must((await focused(p)) === 'H2', W('focus moves to the new heading'));
      await scan(p, W(`round ${i + 1}, sent`));
      const last = i + 1 === sample.rounds.length;
      must(await tabToButton(p, last ? 'Finish the sample' : 'Next round (sample)'), W('Tab reaches the next button')); await p.keyboard.press('Enter');
    }
    await p.waitForSelector('text=That was the last round'); await scan(p, W('over'));
    must(await tabToButton(p, 'Leave the room'), W('Tab reaches Leave')); await p.keyboard.press('Enter');
    await p.waitForSelector('#ph-code'); must((await p.inputValue('#ph-code')) === '', W('leaving starts again with an empty form'));
    must(!outside.length, W(`no outside request (${outside.join(', ')})`)); must(!errors.length, W(`no console error (${errors.join(' | ')})`));
    await ctx.close();
  }
}
await b.close(); srv.close();
for (const f of fails) console.log('FAIL', f);
console.log(`screens scanned: ${screens}; FAILURES: ${fails.length}`);
process.exit(fails.length || screens !== 3 * 9 ? 1 : 0);
