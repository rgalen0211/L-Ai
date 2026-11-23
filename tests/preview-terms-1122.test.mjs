// The Terms of Use and the Privacy Policy as PREVIEW terms (WEB 11-22, LAUNCH-WED-1125 row 5): a free preview, no payments.
// Each factual sentence is traced to code in proposals/WEB-PREVIEW-TERMS-1122.md. Lawyer review comes before payments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const terms = read('terms/index.html');
const privacy = read('privacy-policy.html');
const LABEL = 'Preview terms: free preview, no payments';
const NOT_OPEN = 'Credits and payments are not open yet; these terms will be replaced before any payment.';
const mainOf = (html) => html.match(/<main[\s\S]*?<\/main>/)[0];
const textOf = (html) => mainOf(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const privPart = privacy.match(/<section id="ryagram-preview">[\s\S]*?<\/section>/)[0];

test('LABEL: both pages carry "Preview terms: free preview, no payments" and the not-open sentence, before any section', () => {
  for (const [name, html] of [['terms', terms], ['privacy', privacy]]) {
    assert.ok(textOf(html).includes(LABEL + '.'), name);
    assert.ok(textOf(html).includes(NOT_OPEN), name);
    assert.match(html, /<strong>Preview terms: free preview, no payments\.<\/strong>/, name);
    assert.ok(html.indexOf(LABEL) < html.indexOf('<h2>'), `${name}: the label comes before the first section`);
  }
  assert.match(terms, /<p class="shell-banner" role="note"><strong>Preview terms/);
  assert.doesNotMatch(terms + privacy, /DRAFT\. Pending legal review|drafts while Ryagram is in testing/);
});

test('LAST UPDATED: both pages say Last updated with the date of the commit that wrote them', () => {
  for (const html of [terms, privacy]) assert.match(textOf(html), /Last updated November 22, 2026/);
  assert.doesNotMatch(privacy, /Updated October 2, 2026/);
});

test('NO PAYMENTS: nothing about prices, refunds, tax, subscriptions or buying is written as if it were live', () => {
  // the Ryagram parts only: the older website sections of the privacy page (inquiries, waitlist, analytics) are not about payments
  for (const html of [mainOf(terms), privPart]) {
    const text = html.replace(/<[^>]+>/g, ' ').split(NOT_OPEN).join(' ').split(LABEL).join(' ');
    assert.doesNotMatch(text, /\$\s?\d|\bUS\$|\bprices?\b|\bpricing\b|\brefund|\btax(es)?\b|subscri|\bbuy\b|\bbought\b|\bpurchas|\bpay(s|ing|ment|ments)?\b|\bcheckout\b|\bbilling\b|\binvoice|\bStripe\b|per month|a month/i);
  }
});

test('NOTHING INVENTED: no governing law, liability limit, arbitration or DMCA text; the mailing address is a visible placeholder until Ryan supplies it', () => {
  const text = textOf(terms) + ' ' + textOf(privacy);
  assert.doesNotMatch(text, /governed by|governing law|arbitrat|class action|class-action|DMCA|liability|liable|indemnif|warrant/i);
  for (const html of [terms, privacy]) {
    // When Ryan gives the address, replace the placeholder AND this pin together.
    assert.equal((textOf(html).match(/\[Mailing address: to be added before launch\]/g) || []).length, 1);
    assert.match(textOf(html), /L'Ai, LLC/);
    assert.match(html, /mailto:ryagram@uselai\.com/);
  }
  assert.doesNotMatch(terms + privacy, /[A-Za-z0-9._%+-]+@(?!uselai\.com)[A-Za-z0-9.-]+\.[a-z]{2,}/, 'no other email address on the pages');
});

test('SECTIONS: the pages cover accounts, 18+, uploads, 30-day films, connecting an AI, deleting your account and the contact', () => {
  for (const id of ['what', 'who', 'account', 'uploads', 'films', 'ai', 'connect', 'rules', 'delete', 'contact']) assert.match(terms, new RegExp(`<section id="${id}">`), id);
  const t = textOf(terms);
  assert.match(t, /You must be 18 or older\. To create an account you confirm that you are\./);
  assert.match(t, /kept for 30 days after it is delivered/);
  assert.match(t, /up to 10 MB/);
  assert.match(t, /You can connect an AI assistant/);
  assert.match(t, /delete your login/);
  const p = textOf(privacy);
  assert.match(p, /To create an account you confirm that you are\./);
  assert.match(p, /30 days after delivery/);
  assert.match(p, /Deleting your account/);
});

test('PLAIN: no sentence on either page runs past 45 words', () => {
  for (const html of [mainOf(terms), privPart]) {
    const text = html.replace(/<\/(p|li|h\d)>/g, '. ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const sentence of text.split(/(?<=[.!?])\s+/)) assert.ok(sentence.split(' ').length <= 45, sentence.slice(0, 80));
  }
});

test('LINKS: every internal link on both pages resolves to a file in the repo, and Terms, Privacy, Help and AI content link to each other', () => {
  const exists = (href) => {
    const clean = href.split('#')[0].split('?')[0];
    if (!clean.startsWith('/')) return true;
    const rel = clean.slice(1);
    if (rel === '') return true;
    return fs.existsSync(path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel));
  };
  for (const [name, html] of [['terms', terms], ['privacy', privacy]]) {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(h => !/^(mailto:|https?:)/.test(h));
    for (const h of hrefs) assert.ok(exists(h), `${name}: ${h}`);
    for (const must of ['/terms/', '/privacy-policy.html', '/help/', '/ai-content/']) assert.ok(hrefs.includes(must), `${name} links ${must}`);
  }
  assert.ok(terms.includes('href="/report/"'));
  assert.ok(!terms.includes('/connect-ai/'), 'the Connect-an-AI guide is unlisted: not linked from the Terms')
  for (const page of ['help/index.html', 'ai-content/index.html']) {
    const foot = read(page).match(/<footer[\s\S]*?<\/footer>/)[0];
    assert.match(foot, /href="\/terms\/"/, page);
    assert.match(foot, /href="\/privacy-policy\.html"/, page);
  }
});

test('FACTS: the figures the pages state are the figures in the code', () => {
  assert.match(read('assets/app-uploads.js'), /MAX_BYTES = 10 \* 1024 \* 1024/);
  assert.match(read('supabase/migrations/20261021000100_r9_render_node.sql'), /expires_at timestamptz not null default now\(\) \+ interval '30 days'/);
  assert.match(read('assets/app-library.js'), /const AI_LABEL = 'AI-assisted \(Ryagram\)'/);
  assert.match(read('supabase/functions/join/join.ts'), /if \(body\.adult_confirmed !== true\) return reply\(400/);
  assert.match(read('supabase/functions/delete-account/remove.ts'), /within 30 days/);
  assert.match(read('report/index.html'), /We reply to your email within 7 days/);
  const m = read('supabase/migrations/20261121000500_unfinished_uploads_purged.sql');
  assert.match(m, /interval '7 days'/);
  assert.match(m, /interval '1 day'/);
  for (const f of ['20261121000200_expired_films_really_gone', '20261121000300_upload_films_gone', '20261121000700_connect_ai_open_to_all'])
    assert.ok(fs.existsSync(path.join(root, `supabase/migrations/${f}.sql`)), f);
});
