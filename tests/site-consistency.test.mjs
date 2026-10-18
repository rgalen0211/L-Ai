// Things that must agree ACROSS pages (found in CC1's review of the web train): one ?v= per shared asset, and the same legal links in every Ryagram footer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const pages = [];
const walk = d => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
  if (['node_modules', '.git', 'supabase', 'tests', 'tools', 'assets', 'legal-drafts'].includes(e.name)) continue;
  const rel = path.posix.join(d, e.name);
  if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.html')) pages.push(rel);
} };
walk('.');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('ONE ?v= PER SHARED ASSET: help.css and ryagram-config.js carry the same version on every page that loads them', () => {
  for (const asset of ['help.css', 'ryagram-config.js']) {
    const seen = new Map();
    for (const p of pages) for (const m of read(p).matchAll(new RegExp('/assets/' + asset.replace('.', '[.]') + '[?]v=([0-9a-z]+)', 'g'))) seen.set(p, m[1]);
    assert.ok(seen.size >= 2, asset + ' ' + JSON.stringify([pages.length, [...seen]]));
    assert.equal(new Set(seen.values()).size, 1, `${asset}: ${JSON.stringify([...seen])}`);
  }
});

test('RYAGRAM FOOTERS: every Ryagram page (404, Help, Report, Film, preview demo, the app, the guide pages) links Terms of Use and AI content beside the Privacy Policy', () => {
  const ryagram = pages.filter(p => /Ryagram, from L'Ai|Ryagram is operated by L'Ai/.test(read(p)));
  assert.ok(ryagram.length >= 8, ryagram.join(', '));
  for (const p of ryagram) {
    const foot = [...read(p).matchAll(/<footer[\s\S]*?<\/footer>/g)].map(m => m[0]).join('');
    assert.match(foot, /<a href="\/terms\/"[^>]*>Terms of Use<\/a>/, p);
    assert.match(foot, /<a href="\/ai-content\/"[^>]*>AI content<\/a>/, p);
    assert.match(foot, /<a href="\/privacy-policy\.html"[^>]*>Privacy Policy<\/a>/, p);
  }
});

test('EVERY PAGE THAT READS ryagramConfig LOADS IT (before the scripts that read it): without it nobody can sign in and every flag reads off', () => {
  const readsConfig = new Set();
  for (const f of fs.readdirSync(path.join(root, 'assets'))) if (f.endsWith('.js') && f !== 'ryagram-config.js' && /ryagramConfig/.test(read(`assets/${f}`))) readsConfig.add(`/assets/${f}`);
  assert.ok(readsConfig.size >= 4, [...readsConfig].join());
  let checked = 0;
  for (const p of pages) {
    const html = read(p);
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"?]+)(?:\?[^"]*)?"/g)].map(m => m[1]);
    const first = scripts.findIndex(s => readsConfig.has(s));
    if (first < 0) continue;
    checked++;
    const cfg = scripts.indexOf('/assets/ryagram-config.js');
    assert.ok(cfg >= 0, `${p} loads ${scripts[first]} but not ryagram-config.js`);
    assert.ok(cfg < first, `${p}: ryagram-config.js must load before ${scripts[first]}`);
  }
  assert.ok(checked >= 4, `only ${checked} pages checked`);
  assert.ok(pages.includes('app/index.html'));
  assert.match(read('app/index.html'), /<script src="\/assets\/ryagram-config\.js\?v=[0-9a-z]+"><\/script>/);
});
