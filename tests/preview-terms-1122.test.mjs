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
const NOT_OPEN = 'Buying credits and payments are not open yet; these terms will be replaced before any payment.';
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
  for (const html of [terms, privacy]) assert.match(textOf(html), /Last updated November 23, 2026/);
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

test('SECTIONS: the pages cover accounts, 18+, free sheets and previews, 30-day films, deleting your account, what we keep and the contact', () => {
  for (const id of ['what', 'who', 'account', 'making', 'films', 'ai', 'rules', 'delete', 'contact']) assert.match(terms, new RegExp(`<section id="${id}">`), id);
  const t = textOf(terms);
  assert.match(t, /You must be 18 or older\. To create an account you confirm that you are\./);
  assert.match(t, /kept for 30 days after it is delivered/);
  assert.match(t, /Each project gets 6 free previews, and 15 across all your projects in any 24 hours/);
  assert.match(t, /delete your login/);
  const p = textOf(privacy);
  assert.match(p, /To create an account you confirm that you are, on the sign-up page or with an invite code\./);
  assert.match(p, /30 days after delivery/);
  assert.match(p, /Deleting your account/);
  assert.match(p, /for 2 days/);
  assert.match(p, /for 1 day/);
});

test('NOT YET: features that are OFF on Wednesday are named only as "not yet in the preview" (uploads, film pages); swap-in text is in WEB-PREVIEW-TERMS-1122.md section G', () => {
  assert.match(textOf(terms), /Some things are not yet in the preview: uploading your own data and publishing a film page\./);
  assert.match(textOf(privacy), /Not yet in the preview, so nothing is kept for them: uploading your own data and publishing a film page\./);
  const rest = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/Some things are not yet in the preview:[^.]*\./, '').replace(/Not yet in the preview, so nothing[^.]*\./, '').replace(/You can connect an AI assistant[^<]*?own terms\./, '').replace(/Connected AI assistants\.[^<]*?not by us\./, '');
  for (const html of [terms, privPart]) {
    assert.doesNotMatch(rest(html), /upload|spreadsheet|\.csv|Recently deleted|restore|Delete forever|publish|anyone with the link|stop sharing|connect(ed|ing)? (an|your|AI)|\bAI assistant|Report page|DMCA/i);
  }
  assert.doesNotMatch(privPart, /Stripe|sends the sign-up email/);
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
  assert.ok(!terms.includes('/report/') && !terms.includes('/connect-ai/'), 'the Report page and the Connect-an-AI guide are not linked while film pages and Connect-an-AI are off')
  for (const page of ['help/index.html', 'ai-content/index.html']) {
    const foot = read(page).match(/<footer[\s\S]*?<\/footer>/)[0];
    assert.match(foot, /href="\/terms\/"/, page);
    assert.match(foot, /href="\/privacy-policy\.html"/, page);
  }
});

test('FACTS: the figures the pages state are the figures in the code', () => {
  assert.match(read('supabase/migrations/20261017000600_pipe1_orders.sql'), /delivery_days int not null default 30/);
  assert.match(read('supabase/phase-2b/credits_ledger.sql'), /free_previews_per_project int not null default 6,\s*free_previews_per_24h int not null default 15/);
  assert.match(read('supabase/migrations/20261104000200_waiting_join.sql'), /delete from public\.join_attempts where at < now\(\) - interval '2 days'/);
  assert.match(read('supabase/migrations/20261003000200_invite_codes.sql'), /delete from public\.invite_attempts where at < now\(\) - interval '1 day'/);
  assert.match(read('supabase/migrations/20261121000400_retention_outbox_support.sql'), /answered_at is not null and answered_at < now\(\) - interval '3 years'/);
  assert.match(read('supabase/migrations/20261121000400_retention_outbox_support.sql'), /answered_at is null and created_at < now\(\) - interval '12 months'/);
  assert.match(read('supabase/functions/redeem-invite/redeem.ts'), /if \(body\.adult_confirmed !== true\) return reply\(400/);
  assert.match(read('supabase/functions/delete-account/remove.ts'), /if \(c\.has_credit_history\) \{\s*step = "erase";/);
  assert.match(read('assets/app-library.js'), /const AI_LABEL = 'AI-assisted \(Ryagram\)'/);
  assert.match(read('supabase/functions/join/join.ts'), /if \(body\.adult_confirmed !== true\) return reply\(400/);
  assert.match(read('supabase/migrations/20260929000900_account_basics.sql'), /account_request_deletion[\s\S]*?insert into public\.account_deletion_requests/);
  for (const f of ['20261121000200_expired_films_really_gone'])
    assert.ok(fs.existsSync(path.join(root, `supabase/migrations/${f}.sql`)), f);
});

test('WEB 11-23 (BUILDER second review): who reads requests, steps recorded, invite end date, mail provider, the deletion sentence as the system does it', () => {
  const t = textOf(terms), p = textOf(privacy);
  // who reads requests by hand: an admin sees film requests (email, question, notes) and the approval queue (email, film title)
  assert.match(t, /When you ask us to make a film, or a full render waits for our approval, the Ryagram team sees your email and the request or film title\./);
  assert.match(p, /The Ryagram team reads what it handles by hand: a film you ask us to make \(your email, question and notes\) and each full render waiting for approval \(your email and the film's title\)\./);
  assert.match(read('supabase/migrations/20261016000200_creator_flow.sql'), /'email', u\.email, 'question', r\.question, 'notes', r\.notes/);
  assert.match(read('supabase/migrations/20261017000600_pipe1_orders.sql'), /returns table \(stage_id uuid, order_id uuid, owner_id uuid, owner_email text, film_title text/);
  assert.match(read('assets/app-jobs.js'), /We approve each one by hand/);
  // funnel steps: the triggers write them whatever funnelTracking says; 13 months; admin-only; unlinked on delete
  assert.match(p, /We record the steps your account reaches, such as your first project and your first film, with the time\. Only our administrators can read this\. We delete each record 13 months after it happened\. Deleting your account cuts the link to you\./);
  const fun = read('supabase/migrations/20261017000900_funnel_events.sql');
  assert.match(fun, /written by TRIGGERS on the tables where those things really happen/);
  assert.match(fun, /user_id uuid references auth\.users \(id\) on delete set null/);
  assert.match(read('supabase/migrations/20261121000400_retention_outbox_support.sql'), /delete from public\.funnel_events where at < now\(\) - interval '13 months'/);
  // the browser half (utm source, referrer domain) is NOT described: it only runs while funnelTracking is true. If it is switched on, add the swap-in line (proposal section H) and change this pin.
  assert.match(read('assets/ryagram-config.js'), /funnelTracking: false/);
  assert.doesNotMatch(p, /referr|utm|link source of your|where you came from/i);
  // invite end date: named-person invites and the invite mail, 12 months
  assert.match(p, /For an invite we make for a named person, both are removed 12 months after the code was last used or, if unused, expired\. The email we send with it is removed 12 months after it is sent\./);
  const ret = read('supabase/migrations/20261121000400_retention_outbox_support.sql');
  assert.match(ret, /c\.label like 'invite: %'[\s\S]*?interval '12 months'/);
  assert.match(ret, /delete from public\.ops_outbox where kind = 'invite' and created_at < now\(\) - interval '12 months'/);
  // deletion: we record the request; no promise of a date
  for (const x of [t, p]) {
    assert.doesNotMatch(x, /within 30 days/);
    assert.match(x, /we record your request|record your request/);
    assert.match(x, /An administrator then closes the account by hand\./);
  }
  // mail provider: Resend (custom sender, README; ops mail through Resend when OPS_MAIL_MODE is resend)
  assert.match(p, /Resend sends the emails we send you, such as the sign-up link\./);
  assert.match(read('supabase/functions/_shared/ops_mail.ts'), /https:\/\/api\.resend\.com\/emails/);
  assert.match(read('supabase/README.md'), /custom SMTP is set up with Resend instead/);
  // one wording for how fast an expired film's file goes
  assert.doesNotMatch(p, /within minutes/);
  assert.match(p, /within a minute or so\. We try again every minute until it is gone/);
  // nothing in the page source names the author or the proposals path
  assert.doesNotMatch(terms + privacy, /WEB 11-22|proposals\/|<!--/);
  // the placeholders stay until Ryan supplies the address and the Connect wording
  assert.match(t, /\[Mailing address: to be added before launch\]/);
});
