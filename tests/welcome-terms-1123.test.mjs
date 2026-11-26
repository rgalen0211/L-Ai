// Welcome credits on the Terms and Privacy (WEB 11-23, Ryan's Q679 B at 15:46): 8 credits when the email is VERIFIED, once per email address ever,
// invite-code accounts excluded; buying stays closed. Each clause below is pinned to the page words AND to the migration that makes it true.
// CONNECT's migration (supabase/migrations/20261123000600_welcome_credits.sql, branch connect-welcome-credits-1123 65d9d896) is VERIFIED against these clauses
// (proposal section J, file:line). This branch's base (00195a25) does not contain it, so here only the page words are pinned; on any head that DOES contain it
// (the Wednesday rebuild) the test is strict: the patterns below must match the SQL, the number 8 must be the setting's default, the once-per-address table
// must hold no account id and nothing may delete from it. Proven both ways on origin/cc1-lai-wed-r5-1123 (green; red with the page at 9 or the default at 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const textOf = (html) => html.match(/<main[\s\S]*?<\/main>/)[0].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const terms = textOf(read('terms/index.html'));
const privacy = textOf(read('privacy-policy.html'));
const MIGRATION = 'supabase/migrations/20261123000600_welcome_credits.sql';
const migrationLanded = fs.existsSync(path.join(root, MIGRATION));

// clause -> page sentence + what the migration must show (patterns are CONNECT-agnostic: the grant function, the verified-email trigger, a hashed key, no deletion of the key, invite exclusion)
const CLAUSES = [
  ['8 credits at email confirmation', terms, 'When you confirm your email we give your account 16 welcome credits, once for each email address.', [/after insert or update of email_confirmed_at on auth\.users/, /tg_op = 'UPDATE' and old\.email_confirmed_at is not null then return new/, /perform public\.grant_credits\(new\.id, 'grant', n,/, /welcome_credits integer not null default 8 check/]],
  ['same address again gets none (key survives deletion)', terms, 'If you delete your account and make a new one with the same address, you do not get them again.', [/email_hash text primary key check \(email_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, /sha256\(convert_to\('ryagram-welcome:' \|\| mail/, /on conflict \(email_hash\) do nothing/]],
  ['invite-code accounts keep their own credits, no extra welcome credits', terms, 'An account made with an invite code keeps the credits that came with its code and does not get the welcome credits.', [/adult_source', ''\) = 'invite' or exists \(select 1 from public\.invite_redemptions r where r\.email = mail\)/]],
  ['no cash value, not transferable, buying closed', terms, 'Credits have no cash value and cannot be moved to another person. Buying credits is not open yet.', []],
  ['what a film costs', terms, 'A full film costs about 6 to 10 credits, depending on the film type, so 16 welcome credits cover two line or map films, or one bars film and one line film.', []],
  ['privacy: scrambled copy kept past deletion', privacy, 'To give welcome credits only once, we keep a scrambled copy of your email address. We keep it even if you delete your account.', [/email_hash text primary key check \(email_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, /sha256\(convert_to\('ryagram-welcome:' \|\| mail/, /on conflict \(email_hash\) do nothing/]],
  ['privacy: credit record kept with the account ID, no end date, closed by hand (NOT "we then remove it": no code removes ledger rows)', privacy, 'We keep a record of each credit given to your account or used, with the time and your account\'s ID, as a financial record. We keep it after you delete your account, and we have no end date for it. Your account itself is then closed by hand.', []],
];

test('WORDS: each welcome-credit sentence is on the page, exactly', () => {
  for (const [name, text, sentence] of CLAUSES) assert.ok(text.includes(sentence), name);
});

test('PRICES: the film costs the Terms state are the ledger rows (line 6, map 8, paired 10; 8 welcome credits cover line and map)', () => {
  const l = read('supabase/phase-2b/credits_ledger.sql');
  assert.match(l, /'final_line', 6, null/); assert.match(l, /'final_map', 8, null/); assert.match(l, /'final_paired', 10, null/);
  assert.match(l, /\('line', 'final_line', 1\)/); assert.match(l, /\('map', 'final_map', 2\)/);
});

test('MIGRATION: clauses are checked against CONNECT\'s welcome migration when it is on this branch; until then the page words are pinned alone', () => {
  const proposal = fs.existsSync(path.join(root, 'proposals/WEB-PREVIEW-TERMS-1122.md')) ? read('proposals/WEB-PREVIEW-TERMS-1122.md') : null;
  if (migrationLanded) {
    const sql = read(MIGRATION);
    for (const [name, , , pats] of CLAUSES) for (const p of pats) assert.match(sql, p, name);
    const table = sql.match(/create table ryagram_private\.welcome_credit_grants \([\s\S]*?\n\);/)[0];
    assert.doesNotMatch(table, /user_id|owner_id|references/, 'the once-per-address memory holds no account id and no foreign key');
    assert.doesNotMatch(sql, /delete from ryagram_private\.welcome_credit_grants|truncate/i, 'nothing removes the once-per-address memory');
    // the page number must be the migration's default
    assert.match(sql, /welcome_credits integer not null default 8 /);
    assert.match(terms, /we give your account 16 welcome credits/);
  } else {
    assert.equal(migrationLanded, false);
  }
});

test('LEDGER: the credit record cannot go on closure (append-only, owner_id on delete restrict), so the Privacy page must not say we remove it', () => {
  const l = read('supabase/phase-2b/credits_ledger.sql');
  assert.match(l, /owner_id uuid not null references auth\.users \(id\) on delete restrict/);
  assert.match(l, /credit_ledger_no_update before update or delete on public\.credit_ledger/);
  assert.match(read('supabase/README.md'), /the ledger is an append-only financial record and restricts deletion, so the request\s+is recorded in `account_deletion_requests` for you to close by hand/);
  assert.doesNotMatch(privacy, /we (then )?remove (it|that record|the record)|record is removed/i);
  assert.match(privacy, /Your account itself is then closed by hand\./);
});

test('SETTING (once 000600 is on this branch): the page says 8 and the migration default for ops_settings.welcome_credits must be 8', () => {
  if (!migrationLanded) return assert.ok(true, 'page words only on a head without the migration');
  assert.match(read(MIGRATION), /welcome_credits[^;]*default 8/i);
});

test('PLAIN + NO NEW PROMISES: no sentence over 45 words; no retention number or end date invented; no price, refund or money words for credits', () => {
  for (const text of [terms, privacy]) for (const s of text.split(/(?<=[.!?])\s+/)) assert.ok(s.split(' ').length <= 45, s.slice(0, 80));
  const mine = CLAUSES.map(c => c[2]).join(' ');
  assert.doesNotMatch(mine, /\$|\brefund|\bprices?\b|\bsubscri|\bmonths?\b|\byears?\b|\bdays?\b/i);
  assert.doesNotMatch(privacy.split('Welcome credits.')[1].split('Credit history.')[0], /no end date|for \d/);
});

test('BANNER: the label stays true (buying closed) and no longer says credits do not exist', () => {
  for (const f of ['terms/index.html', 'privacy-policy.html', 'ai-content/index.html']) {
    const h = read(f);
    assert.match(h, /Buying credits and payments are not open yet; these terms will be replaced before any payment\./, f);
    assert.doesNotMatch(h, /Credits and payments are not open yet|Credits are not open yet/, f);
  }
});
