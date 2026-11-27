// site_origins (supabase/functions/_shared/site_origins.ts; CONNECT 2026-11-27, step 0 of the domain-move plan): with no settings every function trusts and links to exactly what it did before; two optional secrets can ADD a new domain; the old two origins can never be dropped by a bad secret.
// Planted faults: tests/site_origins_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveSiteOrigins, resolveSiteUrl } from '../supabase/functions/_shared/site_origins.ts';

const env = (o) => (k) => o[k];
const OLD = ['https://uselai.com', 'https://www.uselai.com'];

test('with no settings: exactly the two old origins and the old site address (nothing changes today)', () => {
  assert.deepEqual(resolveSiteOrigins(env({})), OLD);
  assert.equal(resolveSiteUrl(env({})), 'https://uselai.com');
  assert.deepEqual(resolveSiteOrigins(env({ SITE_URL: '', EXTRA_SITE_ORIGINS: '' })), OLD);
});

test('EXTRA_SITE_ORIGINS adds the new domain before the switch; SITE_URL stays old until it is set', () => {
  const e = env({ EXTRA_SITE_ORIGINS: 'https://newbrand.example, https://www.newbrand.example' });
  assert.deepEqual(resolveSiteOrigins(e), [...OLD, 'https://newbrand.example', 'https://www.newbrand.example']);
  assert.equal(resolveSiteUrl(e), 'https://uselai.com');
});

test('SITE_URL switches the link address and is allowed as an origin with its www twin; the old two stay allowed', () => {
  const e = env({ SITE_URL: 'https://newbrand.example' });
  assert.equal(resolveSiteUrl(e), 'https://newbrand.example');
  assert.deepEqual(resolveSiteOrigins(e), [...OLD, 'https://newbrand.example', 'https://www.newbrand.example']);
  const w = env({ SITE_URL: 'https://www.newbrand.example' });
  assert.deepEqual(resolveSiteOrigins(w), [...OLD, 'https://www.newbrand.example', 'https://newbrand.example']);
});

test('case and spaces are tidied; duplicates are not repeated', () => {
  const e = env({ SITE_URL: '  HTTPS://NewBrand.Example ', EXTRA_SITE_ORIGINS: 'https://newbrand.example,https://uselai.com' });
  assert.equal(resolveSiteUrl(e), 'https://newbrand.example');
  assert.deepEqual(resolveSiteOrigins(e), [...OLD, 'https://newbrand.example', 'https://www.newbrand.example']);
});

test('anything that is not exactly https://host is ignored: paths, ports, http, wildcards, spaces, scripts, userinfo, one-label hosts', () => {
  const bad = ['http://newbrand.example', 'https://newbrand.example/', 'https://newbrand.example/app/', 'https://newbrand.example:8443', 'https://*.newbrand.example',
    'https://new brand.example', 'javascript:alert(1)', 'https://user@newbrand.example', 'https://localhost', 'newbrand.example', '*', 'https://-bad.example', 'https://bad-.example', 'https://a..b.example'];
  for (const b of bad) {
    assert.deepEqual(resolveSiteOrigins(env({ SITE_URL: b, EXTRA_SITE_ORIGINS: b })), OLD, b);
    assert.equal(resolveSiteUrl(env({ SITE_URL: b })), 'https://uselai.com', b);
  }
  assert.deepEqual(resolveSiteOrigins(env({ EXTRA_SITE_ORIGINS: 'https://ok.example,*,https://evil.example/x,https://ok2.example' })), [...OLD, 'https://ok.example', 'https://ok2.example']);
});

test('the old origins are never dropped, whatever the secrets say', () => {
  for (const e of [{ SITE_URL: 'https://newbrand.example' }, { EXTRA_SITE_ORIGINS: 'https://newbrand.example' }, { SITE_URL: 'x', EXTRA_SITE_ORIGINS: 'y' }]) {
    for (const o of OLD) assert.ok(resolveSiteOrigins(env(e)).includes(o), JSON.stringify(e));
  }
});

test('every edge function reads its origins and site address from the one module; none still writes the old address in a settings object', () => {
  const dir = 'supabase/functions';
  let withOrigins = 0, withSite = 0;
  for (const d of fs.readdirSync(dir)) {
    const f = `${dir}/${d}/index.ts`;
    if (!fs.existsSync(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /allowedOrigins:\s*\["https:\/\/uselai\.com/, f);
    assert.doesNotMatch(t, /siteUrl:\s*"https:\/\/uselai\.com"/, f);
    if (/allowedOrigins:\s*resolveSiteOrigins\(\)/.test(t)) { withOrigins++; assert.match(t, /import \{[^}]*resolveSiteOrigins[^}]*\} from "\.\.\/_shared\/site_origins\.ts";/, f); }
    if (/siteUrl:\s*resolveSiteUrl\(\)/.test(t)) { withSite++; assert.match(t, /import \{[^}]*resolveSiteUrl[^}]*\} from "\.\.\/_shared\/site_origins\.ts";/, f); }
  }
  assert.equal(withOrigins, 15);
  assert.equal(withSite, 6);
});
