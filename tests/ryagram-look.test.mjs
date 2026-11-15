// The shared Ryagram look (WEB, 2026-11-15, Ryan's order: every page at the level of the waiting page /ryagram/). One sheet, assets/ryagram-look.css, holds the look's tokens; every page that wears it links it with one
// stamp; the tokens are the waiting page's own; no other sheet redefines them for a page that wears the look. Look only: no word and no behaviour lives in the sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = read('assets/ryagram-look.css'), waiting = read('assets/ryagram.css');
const SKIP = /^(tests|node_modules|tools|supabase|\.git|\.claude|\.mut[\w-]*)$/;
const walk = (dir) => fs.readdirSync(new URL('../' + dir, import.meta.url), { withFileTypes: true }).flatMap(e => SKIP.test(e.name) ? [] : e.isDirectory() ? walk(dir + e.name + '/') : /\.html$/.test(e.name) ? [dir + e.name] : []);
const pages = walk('');
const wearing = pages.filter(f => /<body[^>]*class="[^"]*\bryagram-look\b/.test(read(f)));

test('the tokens are the waiting page\'s own', () => {
  const root = waiting.match(/:root\{([^}]*)\}/)[1];
  const w = k => root.match(new RegExp(`--${k}:([^;}]+)`))[1].trim();
  const tok = k => css.match(new RegExp(`--${k}:([^;]+);`))[1].trim();
  for (const [mine, theirs] of [['bg', 'bg'], ['paper', 'panel'], ['soft', 'panel-2'], ['line', 'line'], ['ink', 'text'], ['muted', 'muted'], ['accent', 'accent'], ['accent-ink', 'accent-ink'], ['link', 'link'], ['radius', 'radius']])
    assert.equal(tok(mine), w(theirs), `--${mine} is the waiting page's --${theirs}`);
  assert.equal(tok('brand'), w('accent'), 'the old brand token is the accent now, so every sheet that reads it follows');
});

test('every page that wears the look links the sheet once, with one stamp, and the stamp is the same on all of them', () => {
  assert.ok(wearing.length >= 6, wearing.join());
  const stamps = new Set();
  for (const f of wearing) { const m = [...read(f).matchAll(/ryagram-look\.css\?v=(\w+)/g)]; assert.equal(m.length, 1, f); stamps.add(m[0][1]); }
  assert.equal(stamps.size, 1, [...stamps].join());
});

test('the sheet is look only: no content, no script hook, no outside address, nothing off the tokens for the accent', () => {
  assert.ok(!/content\s*:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no generated words');
  assert.ok(!/url\(|@import|expression\(|javascript:/.test(css), 'no outside address');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => /#ff8a3d/i.test(l) && !/^\s*--|^body\.ryagram-look\{/.test(l) && !/^\s*--/.test(l));
  assert.deepEqual(bare.filter(l => !/--accent|--brand/.test(l)), [], 'the accent colour is written once, as a token');
});

test('the other sheets do not redefine the look tokens for a page that wears it', () => {
  for (const f of ['assets/app.css', 'assets/help.css', 'assets/film.css', 'assets/app-editor.css']) {
    const src = read(f);
    assert.ok(!/body\.ryagram-look[^{]*\{[^}]*--(accent|brand|bg|paper|line|ink):/.test(src), f);
  }
});

test('the pages that do NOT wear the look are exactly the ones left out on purpose (a new page is dressed or named here)', () => {
  const left = pages.filter(f => !wearing.includes(f)).sort();
  assert.deepEqual(left, [
    'game-phone/index.html', 'game-tv/index.html',                         // GAMES owns these two; their own sheets are in flight (WALK P5)
    'index.html', 'privacy-policy.html', 'thank-you.html', 'workflow-audit-thanks.html', 'workflow-audit/index.html',   // the L'Ai consulting pages: a brand decision for Ryan
    'ryagram/index.html',                                                   // the waiting page: the reference the look is taken from
    'preview-demo/index.html',                                              // saved for offline use by name: a new sheet needs the saved list changed too
  ].sort());
});

test('contrast: every text pair is 4.5:1 or better and every field border and ring 3:1, computed from the sheet own tokens', () => {
  const tok = k => css.match(new RegExp(`--${k}:(#[0-9a-f]{6});`, 'i'))[1];
  const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [fg, bg, need] of [['ink', 'bg', 4.5], ['ink', 'paper', 4.5], ['muted', 'bg', 4.5], ['muted', 'paper', 4.5], ['muted', 'soft', 4.5], ['link', 'bg', 4.5], ['link', 'paper', 4.5], ['accent-ink', 'accent', 4.5], ['accent', 'paper', 4.5], ['line-strong', 'bg', 3], ['line-strong', 'paper', 3], ['accent', 'bg', 3]])
    assert.ok(ratio(tok(fg), tok(bg)) >= need, `${fg} on ${bg} is ${ratio(tok(fg), tok(bg)).toFixed(2)}, needs ${need}`);
});
