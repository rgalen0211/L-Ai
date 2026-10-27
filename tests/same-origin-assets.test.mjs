// A public page must not ask this site for a file that is not there: every first visit would log a 404 (found on the live home page at 09:52: the browser asked for /favicon.ico, which did not exist).
// Static check: for every public .html page, each same-origin file it references (link href, script src, img/source/video src, video poster) must exist in the repo, and /favicon.ico must be a real icon file.
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

// the files a page asks for itself, resolved against the page's own folder (an absolute path starts at the site root)
const refsOf = (page, html) => {
  const out = [];
  const add = u => {
    if (!u || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(u)) return;      // another site, a fragment or a data: address is not ours to check
    const clean = u.split('#')[0].split('?')[0];
    if (!clean) return;
    const abs = clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(page), clean);
    out.push({ ref: u, file: abs });
  };
  for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]*)"[^>]*>/gi)) if (!/rel="(?:preconnect|dns-prefetch|canonical|alternate)"/i.test(m[0])) add(m[1]);
  for (const m of html.matchAll(/<(?:script|img|source|video|audio|iframe)\b[^>]*\bsrc="([^"]*)"/gi)) add(m[1]);
  for (const m of html.matchAll(/<video\b[^>]*\bposter="([^"]*)"/gi)) add(m[1]);
  return out;
};

test('no public page asks for a same-origin file that does not exist', () => {
  const missing = [];
  for (const p of pages) {
    const html = fs.readFileSync(path.join(root, p), 'utf8');
    for (const r of refsOf(p, html)) if (!fs.existsSync(path.join(root, r.file))) missing.push(`${p}: ${r.ref} (no file ${r.file})`);
  }
  assert.deepEqual(missing, []);
});

test('/favicon.ico exists and is a real icon (the browser asks for it on the first visit unless a page names another icon)', () => {
  const f = path.join(root, 'favicon.ico');
  assert.ok(fs.existsSync(f), 'favicon.ico is missing at the site root');
  const b = fs.readFileSync(f);
  assert.ok(b.length >= 22 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0, 'favicon.ico is not an ICO file');
});
