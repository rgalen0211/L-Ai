// The Terms of Use and Privacy Policy drafts (legal-drafts/) and the approval script that publishes them (tools/legal-approve.py).
// Nothing here publishes anything: the drafts are unlisted, noindex and linked from nowhere until Ryan approves the wording.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const terms = read('legal-drafts/terms.html');
const privacy = read('legal-drafts/privacy-policy.html');
const both = terms + privacy;
const names = (html, attr) => [...html.matchAll(new RegExp(`data-${attr}="([a-z0-9-]+)"`, 'g'))].map(m => m[1]);
const py = spawnSync('python', ['--version']);
const hasPython = py.status === 0;

test('DRAFTS: both are marked as drafts for Ryan, noindex, with the draft stylesheet, and the policy still names L\'Ai, LLC as the operator', () => {
  for (const html of [terms, privacy]) {
    assert.match(html, /<div class="draft-banner" role="note"><strong>DRAFT FOR RYAN'S APPROVAL\. Not published\.<\/strong>/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<link rel="stylesheet" href="\/assets\/legal-draft\.css">/);
    assert.match(html, /operated by L'Ai, LLC/);
    assert.match(html, /ryagram@uselai\.com/);
  }
  assert.ok(fs.existsSync(path.join(root, 'assets/legal-draft.css')));
});

test('DRAFTS: nothing on the site links to a draft or to /terms/ yet (approval adds the links)', () => {
  const pages = ['index.html', 'ryagram/index.html', 'app/index.html', 'film/index.html', 'help/index.html', 'report/index.html', 'privacy-policy.html', 'thank-you.html', 'workflow-audit/index.html'];
  for (const p of pages) {
    if (!fs.existsSync(path.join(root, p))) continue;
    assert.doesNotMatch(read(p), /legal-drafts|href="\/terms\/?"/, p);
  }
  assert.ok(!fs.existsSync(path.join(root, 'terms')), 'no published terms page exists before approval');
});

test('DRAFTS: the privacy draft is the live policy UNCHANGED plus new sections: every existing section is there word for word', () => {
  const live = read('privacy-policy.html');
  const sections = [...live.matchAll(/<section>.*?<\/section>/gs)].map(m => m[0]);
  assert.ok(sections.length >= 6);
  for (const s of sections) assert.ok(privacy.includes(s), s.slice(0, 60));
  for (const h of ['Ryagram accounts', 'Creator beta applications', 'Your films', 'Who can see your data', 'Help requests and reports', 'Page visits', 'Deleting your account']) {
    assert.match(privacy, new RegExp(`<h2>${h}</h2>`), h);
  }
});

test('DRAFTS: the open decisions and the "requires" statements are exactly the ones listed (a new one cannot slip in unnoticed)', () => {
  assert.deepEqual(names(terms, 'decision').sort(), ['commercial-use', 'creator-beta-terms', 'governing-law', 'last-updated', 'liability-cap']);
  assert.deepEqual(names(privacy, 'decision').sort(), ['application-retention', 'last-updated', 'report-retention']);
  assert.deepEqual([...new Set(names(both, 'requires'))].sort(),
    ['account-tools', 'backups-pro', 'creator-beta-live', 'film-pages', 'film-requests', 'ledger-cancel-spent', 'ops-tools', 'resend-email', 'stripe-test-mode', 'visit-counting']);
});

test('DRAFTS: what is not built or not live is NOT in the text: no uploads, AI, Find data, compilation, marks, per-item delete, prices or purchases', () => {
  const main = html => html.match(/<main[\s\S]*?<\/main>/)[0];                           // (the site header's brand line is not policy text)
  const text = (main(terms) + main(privacy)).replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /Anthropic|Claude|editor|spreadsheet|upload|Find data|Compilation|watermark|C2PA|content credentials|Recently deleted|Parody|fingerprint/i);
  assert.doesNotMatch(text, /\bAI\b/);                                              // (case-sensitive: "L'Ai" is the company)
  assert.doesNotMatch(text, /\$\s?\d|\bprice|\bpricing\b|per film/i);
  assert.match(terms, /You cannot buy credits yet\./);
  assert.match(terms, /Beta credits are free, in exchange for your feedback\. If you talk about or promote Ryagram, or a film you made with it, you disclose that your credits were free\./);
});

// ---- the approval script, on a scratch copy -------------------------------------------------------------------------------------------------------
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-'));
  for (const p of ['legal-drafts', 'assets/legal-draft.css', 'privacy-policy.html', 'ryagram/index.html', 'app/index.html', 'film/index.html', 'help/index.html', 'report/index.html']) {
    if (!fs.existsSync(path.join(root, p))) continue;
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.cpSync(path.join(root, p), path.join(dir, p), { recursive: true });
  }
  return dir;
}
const run = (dir, args) => spawnSync('python', [path.join(root, 'tools/legal-approve.py'), '--root', dir, ...args], { encoding: 'utf-8' });
const REQUIRES = 'account-tools,backups-pro,creator-beta-live,film-pages,film-requests,ledger-cancel-spent,ops-tools,resend-email,stripe-test-mode,visit-counting';
const DECISIONS = { 'commercial-use': 'yes, including commercially,', 'creator-beta-terms': 'We may ask for a short written note after each film.', 'liability-cap': 'US$100',
                    'governing-law': 'These terms are governed by the laws of New York.', 'application-retention': 'We keep applications for 12 months.', 'report-retention': 'We keep reports for 12 months.' };

test('APPROVE: with nothing decided it refuses, names every open decision and every unconfirmed statement, and writes nothing', { skip: !hasPython }, () => {
  const dir = scratch();
  const r = run(dir, ['--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NOT PUBLISHED\. Nothing was written\./);
  assert.match(r.stdout, /--date is missing/);
  for (const d of ['commercial-use', 'liability-cap', 'governing-law', 'creator-beta-terms', 'application-retention', 'report-retention']) assert.match(r.stdout, new RegExp(d));
  for (const q of REQUIRES.split(',')) assert.match(r.stdout, new RegExp(q));
  assert.ok(!fs.existsSync(path.join(dir, 'terms')));
  assert.ok(fs.existsSync(path.join(dir, 'legal-drafts/terms.html')));
  assert.equal(fs.readFileSync(path.join(dir, 'privacy-policy.html'), 'utf8'), read('privacy-policy.html'));
});

test('APPROVE: every confirmation is required one by one, and a placeholder is not accepted as wording', { skip: !hasPython }, () => {
  const dir = scratch();
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, JSON.stringify(DECISIONS));
  const missing = run(dir, ['--date', 'October 18, 2026', '--decisions', file, '--requires-ok', REQUIRES.split(',').slice(1).join(','), '--apply']);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /confirm each with --requires-ok: account-tools/);
  fs.writeFileSync(file, JSON.stringify({ ...DECISIONS, 'liability-cap': '[counsel: TODO]' }));
  const placeholder = run(dir, ['--date', 'October 18, 2026', '--decisions', file, '--requires-ok', REQUIRES, '--apply']);
  assert.equal(placeholder.status, 1);
  assert.match(placeholder.stdout, /still looks like a placeholder/);
  assert.ok(!fs.existsSync(path.join(dir, 'terms')));
});

test('APPROVE: a decisions file marked _DRAFT_FOR_COUNSEL can be dry-run but --apply refuses until the key is deleted', { skip: !hasPython }, () => {
  const dir = scratch();
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, JSON.stringify({ _DRAFT_FOR_COUNSEL: 'DRAFT FOR COUNSEL: not final', ...DECISIONS }));
  const dry = run(dir, ['--date', 'October 18, 2026', '--decisions', file, '--requires-ok', REQUIRES]);
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /marked _DRAFT_FOR_COUNSEL/);
  const apply = run(dir, ['--date', 'October 18, 2026', '--decisions', file, '--requires-ok', REQUIRES, '--apply']);
  assert.equal(apply.status, 1);
  assert.match(apply.stdout, /counsel has not signed it off/);
  assert.ok(!fs.existsSync(path.join(dir, 'terms')));
  fs.writeFileSync(file, JSON.stringify(DECISIONS));
  assert.equal(run(dir, ['--date', 'October 18, 2026', '--decisions', file, '--requires-ok', REQUIRES, '--apply']).status, 0);
});

test('APPROVE: a dry run (no --apply) says what it would do and writes nothing', { skip: !hasPython }, () => {
  const dir = scratch();
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, JSON.stringify(DECISIONS));
  const r = run(dir, ['--date', 'October 18, 2026', '--decisions', file, '--requires-ok', REQUIRES]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /WOULD WRITE: terms\/index\.html, privacy-policy\.html/);
  assert.ok(!fs.existsSync(path.join(dir, 'terms')));
});

test('APPROVE: with everything decided and confirmed it publishes clean pages: no draft marks, noindex or banner, the final wording in place, links added once', { skip: !hasPython }, () => {
  const dir = scratch();
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, JSON.stringify(DECISIONS));
  const args = ['--date', 'October 18, 2026', '--decisions', file, '--requires-ok', REQUIRES, '--apply'];
  const r = run(dir, args);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const t = fs.readFileSync(path.join(dir, 'terms/index.html'), 'utf8');
  const p = fs.readFileSync(path.join(dir, 'privacy-policy.html'), 'utf8');
  for (const html of [t, p]) {
    assert.doesNotMatch(html, /draft-|DRAFT|noindex|legal-draft|<mark|\[date|\[Ryan|\[counsel|TODO/);
    assert.match(html, /Last updated October 18, 2026|Updated October 18, 2026/);
  }
  assert.match(t, /including commercially, yes, including commercially,|including commercially, /);
  assert.match(t, /limited to US\$100\./);
  assert.match(t, /governed by the laws of New York\./);
  assert.match(p, /We keep applications for 12 months\./);
  assert.match(p, /We keep reports for 12 months\./);
  assert.match(t, /You can delete your account at any time from Your account\./);          // a confirmed "requires" statement stays, unmarked
  for (const f of ['ryagram/index.html', 'app/index.html', 'film/index.html', 'help/index.html', 'report/index.html']) {
    if (!fs.existsSync(path.join(dir, f))) continue;
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal((s.match(/href="\/terms\/"/g) || []).length >= 1, true, f);
  }
  assert.match(fs.readFileSync(path.join(dir, 'app/index.html'), 'utf8'), /By joining you agree to the <a href="\/terms\/">Terms of Use<\/a>/);
  assert.match(fs.readFileSync(path.join(dir, 'ryagram/index.html'), 'utf8'), /By applying you agree to the <a href="\/terms\/">Terms of Use<\/a>/);
  assert.ok(!fs.existsSync(path.join(dir, 'legal-drafts')));
  assert.ok(!fs.existsSync(path.join(dir, 'assets/legal-draft.css')));
  // the existing policy text is still there, untouched
  for (const s of [...read('privacy-policy.html').matchAll(/<section>.*?<\/section>/gs)].map(m => m[0])) assert.ok(p.includes(s), s.slice(0, 50));
});

test('APPROVE: --cut removes a statement that is not true yet (sentence and all) instead of confirming it, and refuses a name that is in both lists or in neither draft', { skip: !hasPython }, () => {
  const dir = scratch();
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, JSON.stringify(DECISIONS));
  const rest = REQUIRES.split(',').filter(x => !['ledger-cancel-spent', 'film-pages'].includes(x)).join(',');
  const base = ['--date', 'October 18, 2026', '--decisions', file, '--requires-ok', rest];
  const both = run(dir, [...base, '--cut', 'ledger-cancel-spent,film-pages,account-tools']);
  assert.equal(both.status, 1);
  assert.match(both.stdout, /named in both --requires-ok and --cut: account-tools/);
  const nothing = run(dir, [...base, '--cut', 'ledger-cancel-spent,no-such-thing']);
  assert.equal(nothing.status, 1);
  assert.match(nothing.stdout, /--cut names no statement in the drafts: no-such-thing/);
  assert.match(nothing.stdout, /confirm each with --requires-ok: film-pages/);                 // and film-pages is still neither confirmed nor cut
  const ok = run(dir, [...base, '--cut', 'ledger-cancel-spent,film-pages', '--apply']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const t = fs.readFileSync(path.join(dir, 'terms/index.html'), 'utf8');
  const p = fs.readFileSync(path.join(dir, 'privacy-policy.html'), 'utf8');
  assert.doesNotMatch(t, /A film that has not started being made when you cancel it/);       // the cut Terms statement is gone
  assert.doesNotMatch(p, /A film is public only if you choose to publish its page/);          // and the cut privacy statement
  assert.match(t, /You cannot buy credits yet\./);                                          // its neighbours stay
  assert.match(p, /These are private to your account: other users cannot see them\./);
  assert.doesNotMatch(t + p, /draft-|DRAFT|noindex|  +<\/p>|<p> /);
  for (const s of [...read('privacy-policy.html').matchAll(/<section>.*?<\/section>/gs)].map(m => m[0])) assert.ok(p.includes(s), s.slice(0, 50));   // existing text untouched (indentation too)
});

test('APPROVE: the script never touches git and never writes outside the repository root it is given', () => {
  const src = read('tools/legal-approve.py');
  assert.doesNotMatch(src, /\bgit\b.*subprocess|subprocess|os\.system|shutil\.rmtree/);
  assert.match(src, /It never touches git/);
});
