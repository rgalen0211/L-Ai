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

test('one group for every crawler, Disallow lines only, no wildcards; the ONE full address is the Sitemap line', () => {
  assert.deepEqual(rules.filter((l) => /^user-agent:/i.test(l)), ['User-agent: *']);
  for (const l of rules) assert.match(l, /^(user-agent|disallow|sitemap):/i, l);
  for (const d of disallow) assert.doesNotMatch(d, /[*$]/, d);
  // A sitemap line must be a full address (RFC 9309 section 2.2.4); it is the only one, and the domain plan's step 7 lists it.
  assert.deepEqual(rules.filter((l) => /^sitemap:/i.test(l)), ['Sitemap: https://uselai.com/sitemap.xml']);
  const rest = rules.filter((l) => !/^sitemap:/i.test(l)).join('\n');
  assert.doesNotMatch(rest, /uselai\.com|https?:/i, 'no other host in the file');
});

test('the working folders are kept out of search', () => {
  for (const p of ['/proposals/X.md', '/docs/A.md', '/supabase/migrations/a.sql', '/tests/a.test.mjs', '/tools/x.py',
    '/legal-drafts/terms.html', '/directory-drafts/terms/', '/landing-drafts/song-films/',
    '/README.md', '/package.json', '/package-lock.json']) assert.ok(blocked(p), p);
});

test('no line for the consulting archive: _archive/ is never published by the Pages build, and /archive/ no longer exists', () => {
  assert.ok(!disallow.some((d) => /archive/.test(d)), disallow.join(' '));
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
