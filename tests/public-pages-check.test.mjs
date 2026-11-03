// CLOUD-SITE 11-02 round 3 (task 2): tools/check-public-pages.mjs, the read-from-files check of every served page (links, anchors, assets, alt text, titles, descriptions,
// noindex on drafts and private pages). It must report NO hard finding on the site as it is, and it must catch each kind of fault when one is planted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../tools/check-public-pages.mjs';

test('PUBLIC PAGES: no hard finding on the site as it is; the site-wide warnings are the known ones', () => {
  const r = check();
  assert.ok(r.pages.length >= 20);
  assert.deepEqual(r.hard, []);
  for (const w of r.warn) assert.match(w, /robots\.txt|sitemap\.xml|\.nojekyll|<h1>|own script draws/, w);
});

test('PUBLIC PAGES: a planted page with each fault is caught (no title, an image with no alt, a broken link, a broken anchor, a missing asset, a draft without noindex)', () => {
  const f = 'zz-cloud-site-planted.html';
  const html = '<!DOCTYPE html><html><head><meta name="description" content="A planted page that exists only for this test and is never written to disk at all."></head><body><main>'
    + '<p>DRAFT words.</p><img src="/favicon.ico"><a href="/no-such-page/">x</a><a href="/help/#no-such-anchor">y</a><script src="/assets/no-such.js"></script></main></body></html>';
  const hard = check({ extraPages: { [f]: html } }).hard.filter((x) => x.startsWith(f)).join('\n');
  for (const want of [/no <title>/, /no lang/, /no viewport/, /has no alt/, /no-such-page\/" goes nowhere/, /anchor "#no-such-anchor"/, /no-such\.js" goes nowhere/, /draft or not available, but does not say noindex/]) assert.match(hard, want);
});
