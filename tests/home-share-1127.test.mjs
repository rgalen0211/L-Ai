// The front door's share preview and sitemap (GEO 11-27, wave 8 a). A link to uselai.com or /ryagram/ pasted into a chat
// or a post shows Ryagram's own title, line and the hero picture; the sitemap lists only pages that may be indexed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const meta = (html, attr, key) => {
  const m = html.match(new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, (c) => `\\${c}`)}" content="([^"]*)">`));
  return m && m[1];
};
const PAGES = ['index.html', 'ryagram/index.html'];
const IMAGE = 'assets/ryagram-hero-still.jpg';

test('both pages carry the share tags, and the words are the page own words (no new public words)', () => {
  for (const p of PAGES) {
    const h = read(p);
    const desc = meta(h, 'name', 'description');
    assert.ok(desc, p);
    assert.equal(meta(h, 'property', 'og:description'), desc, `${p}: og:description = the page description`);
    assert.equal(meta(h, 'property', 'og:title'), read('index.html').match(/<title>([^<]*)<\/title>/)[1], `${p}: og:title = the home page title`);
    assert.equal(meta(h, 'property', 'og:site_name'), 'Ryagram', p);
    assert.equal(meta(h, 'property', 'og:type'), 'website', p);
    assert.equal(meta(h, 'name', 'twitter:card'), 'summary_large_image', p);
    assert.doesNotMatch(meta(h, 'property', 'og:title'), /L.Ai/, `${p}: the preview says Ryagram, not L'Ai`);
  }
});

test('og:image is a full https address of the hero still that exists, a JPEG of the size the tags say', () => {
  const b = fs.readFileSync(new URL(`../${IMAGE}`, import.meta.url));
  assert.deepEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
  // the size from the JPEG's own frame header (SOF0 or SOF2)
  let i = 2, w = 0, hgt = 0;
  while (i < b.length) {
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) { hgt = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
    i += 2 + len;
  }
  for (const p of PAGES) {
    const h = read(p);
    assert.equal(meta(h, 'property', 'og:image'), `https://uselai.com/${IMAGE}`, p);
    assert.equal(meta(h, 'property', 'og:image:type'), 'image/jpeg', p);
    assert.equal(Number(meta(h, 'property', 'og:image:width')), w, `${p}: width`);
    assert.equal(Number(meta(h, 'property', 'og:image:height')), hgt, `${p}: height`);
  }
  assert.ok(b.length < 300 * 1024, 'small enough for link previews');
});

test('the sitemap lists exactly the indexable pages, each file exists and none says noindex', () => {
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ['https://uselai.com/', 'https://uselai.com/ryagram/', 'https://uselai.com/help/', 'https://uselai.com/privacy-policy.html']);
  for (const u of locs) {
    const path = u.replace('https://uselai.com/', '');
    const file = path === '' || path.endsWith('/') ? `${path}index.html` : path;
    const h = read(file);
    assert.doesNotMatch(h, /name="robots" content="[^"]*noindex/, `${file} is indexable`);
  }
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/uselai\.com\/sitemap\.xml$/m);
});

test('MUST-FAIL: a sitemap entry for a noindex page, or a preview that drifts from the page words, is caught', () => {
  const noindex = /name="robots" content="[^"]*noindex/;
  assert.match(read('app/index.html'), noindex, 'the app is noindex, so it must never be listed');
  assert.match(read('terms/index.html'), noindex, 'terms is noindex today, so it is not listed');
  const h = read('index.html').replace(/(<meta property="og:description" content=")[^"]*/, '$1Something else');
  assert.notEqual(meta(h, 'property', 'og:description'), meta(h, 'name', 'description'));
});
