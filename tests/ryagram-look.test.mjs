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
