// The AI content page as a PREVIEW notice (WEB 11-23, LAUNCH-WED-1125): same style as the preview Terms (tests/preview-terms-1122.test.mjs).
// Each factual sentence is tied to its source string in the code; proposals/WEB-PREVIEW-AI-CONTENT-1123.md lists them with file:line. Lawyer review comes before payments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const page = read('ai-content/index.html');
const LABEL = 'Preview terms: free preview, no payments';
const NOT_OPEN = 'Credits and payments are not open yet; these terms will be replaced before any payment.';
const main = page.match(/<main[\s\S]*?<\/main>/)[0];
const text = main.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const BANNER = /<strong>Preview terms[^<]*<\/strong>[^<]*/;

test('LABEL: the banner is the preview Terms banner, word for word, before any section; no draft or placeholder wording is left', () => {
  assert.match(page, /<p class="shell-banner" role="note"><strong>Preview terms: free preview, no payments\.<\/strong> Credits and payments are not open yet; these terms will be replaced before any payment\.<\/p>/);
  assert.ok(page.indexOf(LABEL) < page.indexOf('<h2>'));
  assert.ok(text.includes(NOT_OPEN));
  assert.doesNotMatch(page, /DRAFT\. Pending legal review|This page is a placeholder|PLACEHOLDER SHELL|data-legal-shell|\[RYAN|\[ATTORNEY|\bTBD\b/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(text, /Last updated November 23, 2026/);
  const terms = read('terms/index.html').match(BANNER);
  if (terms) assert.equal(terms[0], page.match(BANNER)[0], 'same banner as the preview Terms, when the Terms are the preview terms');
});

test('NO PAYMENTS: no price, refund, tax, subscription or buying word, apart from the label and the not-open sentence', () => {
  const rest = text.split(NOT_OPEN).join(' ').split(LABEL).join(' ').replace(/You can connect an AI assistant[^<]*?own terms\./, ' ');   // the Connect sentence says "credits" only to say the AI cannot spend them
  assert.doesNotMatch(rest, /\$\s?\d|\bUS\$|\bprices?\b|\bpricing\b|\brefund|\btax(es)?\b|subscri|\bbuy\b|\bbought\b|\bpurchas|\bpay(s|ing|ment|ments)?\b|\bcheckout\b|\bbilling\b|\binvoice|\bStripe\b|\bcredits?\b|per month|a month/i);
});

test('NOTHING INVENTED: no governing law, liability, arbitration, AI Act, YouTube-policy or vendor text; only the confirmed ryagram@ address', () => {
  assert.doesNotMatch(text.replace(/You can connect an AI assistant[^<]*?own terms\./, ' '), /governed by|governing law|arbitrat|class action|DMCA|liability|liable|indemnif|warrant|AI Act|\bEU\b|YouTube|Anthropic|OpenAI|Claude|ChatGPT|copyright|licen[cs]e/i);
  assert.doesNotMatch(page, /[A-Za-z0-9._%+-]+@(?!uselai\.com)[A-Za-z0-9.-]+\.[a-z]{2,}/);
  assert.match(page, /mailto:ryagram@uselai\.com/);
  assert.equal((page.match(/mailto:/g) || []).length, 1);
});

test('PLAIN: no sentence runs past 45 words', () => {
  const t = main.replace(/<\/(p|li|h\d)>/g, '. ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const sentence of t.split(/(?<=[.!?])\s+/)) assert.ok(sentence.split(' ').length <= 45, sentence.slice(0, 80));
});

test('NOT YET: uploads and film pages appear ONLY in the one "not yet in the preview" sentence; voices, faces, music, forecasts and the AI editor are not mentioned', () => {
  assert.match(text, /Some things are not yet in the preview: uploading your own data and publishing a film page\./);
  const rest = text.replace(/Some things are not yet in the preview:[^.]*\./, '').replace(/You can connect an AI assistant[^<]*?own terms\./, '');
  assert.doesNotMatch(rest, /upload|spreadsheet|\bpublish(ed|es|ing)?\b|connect(ed|ing)? (an|your|AI)|\bAI assistant|Report page|\/report\/|voice|face|music|song|forecast|future|AI editor|editor/i);
  assert.ok(!page.includes('/report/') && !page.includes('/connect-ai/'));
});

test('LINKS: every internal link resolves to a file in the repo; the page links Terms, Privacy and Help; the footer carries the usual four', () => {
  const exists = (href) => { const c = href.split('#')[0].split('?')[0]; if (!c.startsWith('/')) return true; const rel = c.slice(1); return rel === '' || fs.existsSync(path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel)); };
  const hrefs = [...page.matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(h => !/^(mailto:|https?:)/.test(h));
  for (const h of hrefs) assert.ok(exists(h), h);
  for (const must of ['/terms/', '/privacy-policy.html', '/help/', '/ai-content/']) assert.ok(hrefs.includes(must), must);
  const foot = page.match(/<footer[\s\S]*?<\/footer>/)[0];
  assert.match(foot, /<a href="\/help\/">Help<\/a><a href="\/terms\/">Terms of Use<\/a><a href="\/privacy-policy\.html">Privacy Policy<\/a><a href="\/ai-content\/" aria-current="page">AI content<\/a>/);
});

test('FACTS: each factual sentence is tied to its source string in the code', () => {
  const lib = read('assets/app-library.js'), film = read('assets/film.js'), cfg = read('assets/ryagram-config.js');
  // "Every film carries the label ..." and "You see it on the page where you collect your film."
  assert.match(text, /Every finished film carries the label "AI-assisted \(Ryagram\)" in the video file's details and on the page where you collect it\. Previews and contact sheets are not labelled\./);
  assert.doesNotMatch(text, /Every film carries the label/);
  assert.ok(lib.includes("const AI_LABEL = 'AI-assisted (Ryagram)';") && film.includes("const AI_LABEL = 'AI-assisted (Ryagram)';"));
  assert.ok(lib.includes('`${AI_LABEL}. This film is kept for 30 days, then deleted.'), 'the delivery page prints the label');
  assert.ok(lib.includes("h('h1', { tabindex: '-1' }, 'Your film')"));
  // "A film lists what it is made from, with the publisher of each source."
  assert.match(text, /Your project page lists what the film is made from, with the publisher of each source\./);
  assert.ok(lib.includes("h('h2', { id: 'sources-title' }, 'What this film is made from')"));
  assert.ok(lib.includes('one card per source with its publisher'));
  assert.ok(film.includes("h('a', { href: '#sources' }, 'View sources')"), 'the public film page (off in the preview) uses View sources');
  // "Open Get help in the app" (ops tools ON; the in-app help page is headed Get help)
  assert.match(text, /Open Get help in the app/);
  assert.ok(lib.includes("opsOn() ? h('a', { href: '#/help' }, 'Get help') : null"));
  assert.ok(lib.includes("h('h1', { tabindex: '-1' }, 'Get help')"));
  assert.match(cfg, /\n\s*opsTools: true,/);
  // the checks exist
  assert.match(read('help/index.html'), /Every film goes through checks before you get it/);
});

test('SWITCHES: what the page leaves out is OFF in the config; if one flips ON this test fails and the swap-in text in WEB-PREVIEW-AI-CONTENT-1123.md applies', () => {
  const cfg = read('assets/ryagram-config.js');
  for (const off of ['aiEditor', 'forecastToggle', 'songIntake', 'uploads', 'filmPages']) assert.match(cfg, new RegExp(`\\n\\s*${off}: false,`), `${off} is OFF`);
});
