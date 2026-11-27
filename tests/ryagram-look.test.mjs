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

test('in-page links land below the sticky header, and the sheet sets no smooth scrolling (the film page jumps and focuses at once; a smooth scroll is cut short by the focus: #sources stopped 450px low, 11-15)', () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/scroll-behavior/.test(bare), 'no scroll-behavior in the look sheet');
  assert.match(bare, /body\.ryagram-look \[id\]\{scroll-margin-top:\d+px\}/, 'every anchor target clears the sticky header');
  const m = bare.match(/scroll-margin-top:(\d+)px/), nav = bare.match(/\.nav\{min-height:(\d+)px\}/);
  assert.ok(Number(m[1]) >= Number(nav[1]), 'the margin is at least the header height');
});

test('RENDERER 11-15 review: section cards have room inside and no card inside a card; script-focused headings show no ring; table headers keep words whole; version rows are cards; the film nav gap never reopens the phone-hidden nav', () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = sel => { const i = bare.lastIndexOf(sel); assert.ok(i >= 0, sel); return bare.slice(i, bare.indexOf('}', i)); };
  assert.match(rule('body.ryagram-look .account-section,body.ryagram-look .ops-section{'), /padding:\d+px \d+px/, 'section cards have inner padding');
  assert.match(rule('body.ryagram-look .account-section .contact-form,'), /border:0/, 'a form inside a section card is not a second card');
  assert.match(rule('body.ryagram-look [tabindex="-1"]:focus,'), /outline:none/, 'a heading focused by a script has no ring');
  assert.match(rule('body.ryagram-look .admin-table th{'), /overflow-wrap:normal/, 'table header words are not broken inside a word');
  assert.match(rule('body.ryagram-look p>.button.small{'), /margin:\d+px \d+px \d+px 0/, 'small buttons in a paragraph (the day pills) have a gap');
  assert.match(rule('body.ryagram-look .project-list,body.ryagram-look .version-list{'), /display:grid/, 'version rows are cards like project rows');
  assert.match(bare, /@media\(min-width:561px\)\{body\.ryagram-look \.page-nav\{display:flex/, 'the nav gap is only above the width where film.css hides the nav');
  assert.ok(!/body\.ryagram-look \.page-nav\{display/.test(bare.replace(/@media\(min-width:561px\)\{body\.ryagram-look \.page-nav\{display:flex[^}]*\}\}/, '')), 'no unguarded display rule on the film nav (it would beat film.css hiding it on a phone)');
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
    'archive/consulting/index.html', 'archive/consulting/thank-you.html', 'archive/consulting/workflow-audit-thanks.html', 'archive/consulting/workflow-audit/index.html', 'index.html', 'privacy-policy.html', 'thank-you.html', 'workflow-audit-thanks.html', 'workflow-audit/index.html',   // the L'Ai consulting pages: a brand decision for Ryan
    'ryagram/index.html',                                                   // the waiting page: the reference the look is taken from
    'preview-demo/index.html',                                              // saved for offline use by name: a new sheet needs the saved list changed too
  ].sort());
});

const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
const darkBlock = bareCss.match(/body\.ryagram-look\{([^}]*)\}/)[1];
const lightBlock = (bareCss.match(/@media\(prefers-color-scheme:light\)\{\s*body\.ryagram-look\{([^}]*)\}/) || [])[1];
const themes = { dark: darkBlock, light: lightBlock };

test('Ryan 11-15: light follows the device (prefers-color-scheme), dark stays the default; the light block changes tokens only and redefines every colour the dark block themes', () => {
  assert.ok(lightBlock, 'a prefers-color-scheme:light block on body.ryagram-look');
  assert.match(lightBlock, /color-scheme:light/);
  assert.match(darkBlock, /color-scheme:dark/, 'dark is the default');
  const names = b => [...b.matchAll(/--([\w-]+):/g)].map(m => m[1]);
  const lightNames = new Set(names(lightBlock));
  for (const k of ['bg', 'paper', 'soft', 'line', 'ink', 'muted', 'line-strong', 'link', 'danger', 'ring', 'accent-text', 'header-bg', 'ok-bg', 'ok', 'bad-bg', 'bad', 'warn-bg', 'warn', 'info-bg', 'info', 'problem', 'warning', 'tint', 'mock', 'chat'])
    assert.ok(lightNames.has(k), `--${k} is redefined for light`);
  const after = bareCss.slice(bareCss.indexOf('@media(prefers-color-scheme:light)'));
  const light = after.slice(0, after.indexOf('@media(max-width:560px)'));
  assert.ok(!/[^-\w]\.[\w-]+\{[^}]*(width|height|margin|padding|display|position)/.test(light.replace(/body\.ryagram-look \.le-[^{]*\{[^}]*\}/g, '')), 'the light block holds colours only, no layout');
  const rest = bareCss.replace(/body\.ryagram-look\{[^}]*\}/g, '');
  const literal = rest.split('\n').filter(l => /#[0-9a-f]{3,6}\b|rgba?\(/i.test(l) && !/^body\.ryagram-look \.le-/.test(l) && !/^\s*--/.test(l));
  assert.deepEqual(literal.filter(l => !/\.button\.danger|^\s*body\.ryagram-look\{/.test(l) && !/#fff\b|rgba\(0,0,0/.test(l)), [], 'no theme-dependent literal colour is left outside the token blocks');
  assert.ok(!/outline:3px solid var\(--accent\)/.test(bareCss), 'rings use --ring (the orange is too pale on white)');
  assert.match(light, /\.le-view,[^{]*\.le-lanes[^{]*\{[^}]*--ink:#f2f2ef/, 'the editor preview, timeline and banners stay dark islands in a light page');
});

test('contrast, in BOTH themes: every text pair is 4.5:1 or better and every field border and ring 3:1, computed from the sheet own tokens', () => {
  for (const [name, block] of Object.entries(themes)) {
    const tok = k => { const m = block.match(new RegExp(`--${k}:(#[0-9a-f]{6});`, 'i')) || darkBlock.match(new RegExp(`--${k}:(#[0-9a-f]{6});`, 'i')); assert.ok(m, `${name}: --${k}`); return m[1]; };
    const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const [fg, bg, need] of [['ink', 'bg', 4.5], ['ink', 'paper', 4.5], ['ink', 'soft', 4.5], ['muted', 'bg', 4.5], ['muted', 'paper', 4.5], ['muted', 'soft', 4.5], ['link', 'bg', 4.5], ['link', 'paper', 4.5], ['accent-ink', 'accent', 4.5],
      ['accent-text', 'bg', 4.5], ['accent-text', 'paper', 4.5], ['ok', 'ok-bg', 4.5], ['bad', 'bad-bg', 4.5], ['warn', 'warn-bg', 4.5], ['info', 'info-bg', 4.5], ['problem', 'paper', 4.5], ['warning', 'paper', 4.5], ['danger', 'paper', 4.5], ['ink', 'tint', 4.5], ['ink', 'mock', 4.5], ['ink', 'chat', 4.5],
      ['line-strong', 'bg', 3], ['line-strong', 'paper', 3], ['ring', 'bg', 3], ['ring', 'paper', 3]])
      assert.ok(ratio(tok(fg), tok(bg)) >= need, `${name}: ${fg} on ${bg} is ${ratio(tok(fg), tok(bg)).toFixed(2)}, needs ${need}`);
  }
});

test('the phone shows an admin table whole and scrolls it sideways; the Render card, the consent cards and the caps rows have room (RENDERER 19:07/19:08)', () => {
  const rule = sel => { const i = bareCss.lastIndexOf(sel); assert.ok(i >= 0, sel); return bareCss.slice(i, bareCss.indexOf('}', i)); };
  assert.match(bareCss, /@media\(max-width:560px\)\{body\.ryagram-look \.admin-table\{display:block;overflow-x:auto/, 'admin tables scroll sideways on a phone');
  assert.match(rule('body.ryagram-look .admin-table th,body.ryagram-look .admin-table td{white-space:nowrap'), /overflow-wrap:normal/, 'no letter-by-letter breaking');
  assert.match(rule('body.ryagram-look .jobs-panel,body.ryagram-look .consent-where'), /padding:\d+px \d+px/, 'the Render card and the consent cards have inner padding');
  assert.match(rule('body.ryagram-look .render-caps .inline-row input'), /max-width:\d+em/, 'the cap box has a max width');
  assert.match(rule('body.ryagram-look input.le-range'), /min-height:44px/, "the editor's slider stays 44 px tall (the checkbox rule that zeroes min-height must not win)");
  assert.match(rule('body.ryagram-look .le-top h1'), /font-size:1\.35rem/, "the editor heading keeps the editor's own size so the film strip stays on the first screen");
  assert.match(rule('body.ryagram-look .le-free'), /color:var\(--ok\)/, "the editor's pale green note is the theme's own green in light");
});
