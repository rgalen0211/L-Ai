// Every public page names an icon that exists, and the page's own security policy lets it load (found on the live home page: the browser asked for /favicon.ico, got a 404 and logged an error on every first visit).
// The icon is the existing Ryagram mark (assets/ryagram.ico in the Ryagram repo, drawn by tools/make_icon.py), copied byte for byte to /favicon.ico. No new design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const pages = [];
const walk = d => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
  if (['node_modules', '.git', 'supabase', 'tests', 'tools', 'legal-drafts'].includes(e.name)) continue;
  const rel = path.posix.join(d, e.name);
  if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.html')) pages.push(rel);
} };
walk('.');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const iconOf = html => { const m = html.match(/<link\b[^>]*\brel="(?:shortcut )?icon"[^>]*>/i); const h = m && m[0].match(/\bhref="([^"]*)"/i); return h ? h[1] : null; };

test('there are public pages to check', () => assert.ok(pages.length >= 15, `only ${pages.length} pages found`));

test('every public page names a real icon file (not data:, not missing)', () => {
  const bad = [];
  for (const p of pages) {
    const href = iconOf(read(p));
    if (!href) { bad.push(`${p}: no <link rel="icon">`); continue; }
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) { bad.push(`${p}: the icon is ${href.slice(0, 20)}..., not a file on this site`); continue; }
    const file = href.startsWith('/') ? href.slice(1) : path.posix.join(path.posix.dirname(p), href);
    if (!fs.existsSync(path.join(root, file.split('?')[0]))) bad.push(`${p}: ${href} does not exist`);
  }
  assert.deepEqual(bad, []);
});

test("every page's own security policy lets its icon load (img-src, else default-src, must allow 'self')", () => {
  const bad = [];
  for (const p of pages) {
    const csp = (read(p).match(/Content-Security-Policy"\s+content="([^"]*)"/i) || [])[1];
    if (!csp) continue;                                  // no policy, nothing can block it
    const dir = n => (csp.split(';').map(s => s.trim()).find(s => s.startsWith(n + ' ')) || '').split(/\s+/).slice(1);
    const allowed = dir('img-src').length ? dir('img-src') : dir('default-src');
    if (!allowed.includes("'self'") && !allowed.includes('*')) bad.push(`${p}: img-src/default-src is ${allowed.join(' ') || 'empty'}`);
  }
  assert.deepEqual(bad, []);
});

test('/favicon.ico is a real multi-size icon (the browser asks for it by default, and old clients ignore <link>)', () => {
  const b = fs.readFileSync(path.join(root, 'favicon.ico'));
  assert.ok(b.length > 1000 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0, 'not an ICO file');
  assert.ok(b.readUInt16LE(4) >= 3, 'the icon should carry several sizes');
});
