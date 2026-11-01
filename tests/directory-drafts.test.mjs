// NEXT-WEB 183: the two DRAFT pages for the connector directory listings (/directory-drafts/privacy/ and /terms/). They are noindex and linked from nowhere (tests/public-pages.test.mjs), their text is hidden unless
// the switch directoryDrafts is on (off), every sentence that needs Ryan's or the lawyer's wording is marked, and the facts they state match the connector facts paper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PAGES = { privacy: read('directory-drafts/privacy/index.html'), terms: read('directory-drafts/terms/index.html') };

function run(cfg) {                                                                        // the real script against a minimal page
  const els = { draft: { hidden: true }, 'not-available': { hidden: false } };
  vm.runInNewContext(read('assets/directory-drafts.js'), { window: { ryagramConfig: cfg }, document: { getElementById: id => els[id] || null } });
  return { draft: els.draft.hidden, off: els['not-available'].hidden };
}

test('the text is hidden and a plain sentence shows, unless the switch is exactly true', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    assert.match(html, /<p id="not-available">This page is not available yet\.<\/p>/, name);
    assert.match(html, /<div id="draft" hidden>/, name);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/, name);
    assert.ok(html.indexOf('/assets/ryagram-config.js') < html.indexOf('/assets/directory-drafts.js'), `${name}: config before the script`);
    assert.match(html, /script-src 'self'/); assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), `${name}: no inline script`);
  }
  assert.deepEqual(run({}), { draft: true, off: false });
  assert.deepEqual(run(undefined), { draft: true, off: false });
  assert.deepEqual(run({ directoryDrafts: 'true' }), { draft: true, off: false });
  assert.deepEqual(run({ directoryDrafts: 1 }), { draft: true, off: false });
  assert.deepEqual(run({ directoryDrafts: true }), { draft: false, off: true });
  assert.match(read('assets/ryagram-config.js'), /\n  directoryDrafts: false,/);
});

test('every page says it is a DRAFT, marks what needs a person\'s words, and promises nothing in the public voice that is not marked', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    assert.match(html, /class="shell-banner" role="note"><strong>DRAFT\./, name);
    const marks = [...html.matchAll(/<mark>\[(RYAN|LAWYER|LAWYER and RYAN)[^\]]*\]<\/mark>/g)];
    assert.ok(marks.length >= 5, `${name}: ${marks.length} markers`);
    assert.ok(/\[RYAN: the support address to publish\]/.test(html), `${name}: the support address is Ryan's to name, not invented here`);
    assert.ok(!/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/.test(html.split('<body>')[1]), `${name}: no mail address is written into the page`);
    assert.ok(!/<a [^>]*href="https?:/.test(html), `${name}: no outside link yet (the providers' policy links are the lawyer's call)`);
    assert.ok(!/\b(guarantee|always safe|fully secure|never share|we will never)\b/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), `${name}: no absolute promise`);
  }
});

test('the facts match proposals/CONNECT-DIRECTORY-FACTS.md sections 3, 5 and 6 (one hour, 30 days, a call log without the request, no credits, Disconnect)', () => {
  const p = PAGES.privacy, t = PAGES.terms;
  assert.match(p, /access lasts one hour/); assert.match(p, /not used for 30 days/); assert.match(p, /request log is kept for 30 days/);
  assert.match(p, /does not keep what the AI asked for, the contents of your stories, your sign-in tokens or your email address/);
  assert.match(p, /Ryagram does not read your conversation with the AI/);
  assert.match(p, /cannot spend your credits and cannot start a full render/); assert.match(t, /cannot spend your credits or start a full render/);
  assert.match(p, /Account, then Connected AIs/); assert.match(p, /<strong>Disconnect<\/strong>/); assert.match(t, /<strong>Disconnect<\/strong>/);
  assert.match(p, /12 months after the invite is used or expires/);
  assert.match(t, /invited accounts only/);
});

test('they are linked from nowhere else and do not replace the real pages', () => {
  const html = fs.readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.html')).map(f => read(f)).join('\n') + read('help/index.html') + read('privacy-policy.html') + read('terms/index.html');
  assert.ok(!/directory-drafts/.test(html), 'no real page links to them');
  assert.ok(!/directory-drafts/.test(read('assets/app-library.js') + read('assets/app-start.js')), 'no app script links to them');
  assert.ok(/This page is a placeholder|DRAFT/.test(read('terms/index.html')), 'the real Terms page is untouched');
});
