// NEXT-WEB 193: the two DRAFT landing pages (/landing-drafts/song-films/ and /compilations/). noindex, linked from nowhere (tests/public-pages.test.mjs), text hidden unless the switch landingDrafts is on (off),
// and EVERY sentence of the public text carries a marker for Ryan's (or the lawyer's) wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PAGES = { 'song-films': read('landing-drafts/song-films/index.html'), compilations: read('landing-drafts/compilations/index.html') };

function run(cfg) {
  const els = { draft: { hidden: true }, 'not-available': { hidden: false } };
  vm.runInNewContext(read('assets/landing-drafts.js'), { window: { ryagramConfig: cfg }, document: { getElementById: id => els[id] || null } });
  return { draft: els.draft.hidden, off: els['not-available'].hidden };
}

test('the text is hidden and a plain sentence shows, unless the switch is exactly true', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    assert.match(html, /<p id="not-available">This page is not available yet\.<\/p>/, name);
    assert.match(html, /<div id="draft" hidden>/, name);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/, name);
    assert.ok(html.indexOf('/assets/ryagram-config.js') < html.indexOf('/assets/landing-drafts.js'), `${name}: config before the script`);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), `${name}: no inline script`);
  }
  assert.deepEqual(run({}), { draft: true, off: false }); assert.deepEqual(run(undefined), { draft: true, off: false });
  assert.deepEqual(run({ landingDrafts: 'true' }), { draft: true, off: false }); assert.deepEqual(run({ landingDrafts: 1 }), { draft: true, off: false });
  assert.deepEqual(run({ landingDrafts: true }), { draft: false, off: true });
  assert.match(read('assets/ryagram-config.js'), /\n  landingDrafts: false,/);
});

test('EVERY paragraph of the public text ends with a marker for a person\'s wording; nothing is left unmarked', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    const inner = html.split('<div id="draft" hidden>')[1].split('</div>')[0];
    const paras = [...inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1]).filter(s => !/^<strong>DRAFT/.test(s));
    assert.ok(paras.length >= 10, `${name}: ${paras.length} paragraphs`);
    for (const s of paras) assert.match(s, /<mark>\[(RYAN|LAWYER)[^\]]*\]<\/mark>(?: <mark>\[CHECK:[^\]]*\]<\/mark>)?$/, `${name}: unmarked: ${s.slice(0, 70)}`);
  }
});

test('they promise nothing: no absolute words, no price, no outside link, no mail address, and they say where things stay only with a CHECK marker', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    const body = html.split('<body>')[1];
    assert.ok(!/\b(guarantee|always|never share|we will never|best|fastest|perfect)\b/i.test(body.replace(/<mark>[\s\S]*?<\/mark>/g, '')), `${name}: no absolute or boasting word`);
    assert.ok(!/[$£€]\s?\d/.test(body), `${name}: no price`);
    assert.ok(!/<a [^>]*href="https?:/.test(body), `${name}: no outside link`);
    assert.ok(!/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/.test(body), `${name}: no mail address`);
    assert.match(body, /Where your things stay<\/h2>\s*<p>[^<]*<mark>\[RYAN\]<\/mark> <mark>\[CHECK:/, name);
    assert.match(body, /<mark>\[RYAN: what making|<mark>\[RYAN: the price/, name);       // the price is Ryan's, never invented
    assert.match(body, /<mark>\[LAWYER:/, name);
    assert.match(body, /<a href="\/ai-content\/">AI content<\/a>/, name);                  // the Ryagram footer rule
  }
});

test('they are linked from nowhere else', () => {
  const all = fs.readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.html')).map(f => read(f)).join('\n') + read('help/index.html') + read('ryagram/index.html') + read('get-app/index.html');
  assert.ok(!/landing-drafts/.test(all), 'no real page links to them');
  assert.ok(!/landing-drafts/.test(read('assets/app-library.js') + read('assets/app-start.js') + read('assets/app-intake.js')), 'no app script links to them');
});
