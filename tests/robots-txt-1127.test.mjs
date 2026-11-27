// robots.txt (GEO 11-27, proposals/GEO-USELAI-AUDIT-1127.md section 2): GitHub Pages serves the whole public repo, so the
// working folders are kept out of search results, while every page a person, an email link or a connector uses stays open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text = fs.readFileSync(new URL('../robots.txt', import.meta.url), 'utf8');
const rules = text.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
const disallow = rules.filter((l) => /^disallow:/i.test(l)).map((l) => l.replace(/^disallow:\s*/i, ''));

// RFC 9309 prefix match, the only kind this file uses (no * or $).
const blocked = (path) => disallow.some((d) => d !== '' && path.startsWith(d));

test('one group for every crawler, Disallow lines only, no wildcards, no Sitemap pointing at a host', () => {
  assert.deepEqual(rules.filter((l) => /^user-agent:/i.test(l)), ['User-agent: *']);
  for (const l of rules) assert.match(l, /^(user-agent|disallow):/i, l);
  for (const d of disallow) assert.doesNotMatch(d, /[*$]/, d);
  assert.doesNotMatch(text, /uselai\.com|https?:/i, 'no host in the file, so a domain move needs no edit');
});

test('the working folders are kept out of search', () => {
  for (const p of ['/proposals/X.md', '/docs/A.md', '/supabase/migrations/a.sql', '/tests/a.test.mjs', '/tools/x.py',
    '/archive/consulting/index.html', '/legal-drafts/terms.html', '/directory-drafts/terms/', '/landing-drafts/song-films/',
    '/README.md', '/package.json', '/package-lock.json']) assert.ok(blocked(p), p);
});

test('MUST STAY OPEN: the home page, the app and every route email links, the connector and shared films use', () => {
  for (const p of ['/', '/index.html', '/ryagram/', '/app/', '/app/index.html', '/film/', '/get-app/', '/help/', '/connect-ai/',
    '/terms/', '/privacy-policy.html', '/report/', '/404.html', '/favicon.ico', '/assets/ryagram.css', '/assets/auth-forward.js',
    '/assets/app-auth.js', '/workflow-audit/', '/workflow-audit-thanks.html', '/thank-you.html']) assert.ok(!blocked(p), p);
});

test('MUST-FAIL: a rule that would hide the app or the assets is caught', () => {
  const bad = (rule) => [...disallow, rule].some((d) => '/app/'.startsWith(d) || '/assets/auth-forward.js'.startsWith(d));
  assert.equal(bad('/a'), true);
  assert.equal(bad('/'), true);
  assert.equal(bad('/assets/'), true);
  assert.equal(bad('/zzz/'), false);
});
