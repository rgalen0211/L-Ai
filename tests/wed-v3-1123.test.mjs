// web-wed-v3-1123 (GAMES second review 11-23 09:04 MEDIUMs 2-5 and LOWs): every check fails on the old words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('M2 Terms: only a FINISHED film carries the label, as the AI content page says (previews and contact sheets are not labelled)', () => {
  const t = read('terms/index.html');
  assert.match(t, /Every finished film carries the label "AI-assisted \(Ryagram\)"\./);
  assert.doesNotMatch(t, /Every film carries the label/);
  assert.match(read('ai-content/index.html'), /Every finished film carries the label "AI-assisted \(Ryagram\)"/);
});

test('M3 Privacy: the Keep me posted section names the field as the form asks it, says what the abuse limit keeps and who can read the list', () => {
  const form = read('ryagram/index.html');
  assert.match(form, /<label for="wl-use">What do you do\? <span>\(optional\)<\/span><\/label>/);
  assert.match(form, /<label for="wl-email">Email <span>\(required\)<\/span><\/label>/);
  const p = read('privacy-policy.html');
  const sec = text(p.match(/<h2>People who ask for Ryagram updates<\/h2>[\s\S]*?<\/section>/)[0]);
  assert.match(sec, /your email address and, if you choose, your answer to “What do you do\?”/);
  assert.doesNotMatch(p, /a note about what you would make with Ryagram/);
  assert.match(sec, /scrambled form \(a hash\) of your network address and the day, with the hour of your visit/);
  assert.match(sec, /delete those entries once they are 2 days old, but only when the next person joins/);
  assert.match(sec, /Nobody can read the list from the website or the app: the Ryagram team sees only counts there, and reads the addresses in the database itself\./);
  // the words match the code: field name, the hash kept with an hour, the 2 day cleanup inside join_waitlist, no read grant to visitors
  const sql = read('supabase/migrations/20261110000200_waitlist_join.sql');
  assert.ok(sql.includes("hour < now() - interval '2 days'") && sql.includes("date_trunc('hour', now())") && sql.includes('encode(sha256('));
  assert.ok(read('assets/ryagram.js').includes('p_reason:'));
  assert.match(read('supabase/ryagram-waitlist.sql'), /revoke all on table public\.ryagram_waitlist from anon, authenticated;\ngrant insert \(email, use_case, source\)/);
  // the draft the approval script publishes carries the same section (tests/legal-pages.test.cjs compares them word for word)
  assert.ok(read('legal-drafts/privacy-policy.html').includes('your answer to “What do you do?”'));
});

test('M3 Privacy: the page description names Ryagram accounts as well as inquiries, the Workflow Audit and updates', () => {
  const d = read('privacy-policy.html').match(/<meta name="description" content="([^"]*)"/)[1];
  assert.match(d, /Ryagram account/);
  assert.match(d, /inquiry/); assert.match(d, /Workflow Audit/); assert.match(d, /Ryagram update/);
});

test('M5 report page: no "public" film while film pages are off', () => {
  const r = read('report/index.html');
  assert.match(r, /Tell us what is wrong with a Ryagram film\./);
  assert.doesNotMatch(text(r), /public/i);
  assert.match(read('assets/ryagram-config.js'), /\n  filmPages: false,/);
});

// ---- M4: the access check -------------------------------------------------------------------------------------------------------------------------
const W = (() => { const win = { ryagramConfig: { waitingAccounts: true } }; vm.runInNewContext(read('assets/app-waiting.js'), { window: win, location: {} }); return win.ryagramWaiting; })();
const noWait = () => { const calls = []; const pause = async ms => { calls.push(ms); }; pause.calls = calls; return pause; };

test('M4 checkAccess: the server says active -> active (one call, no pause)', async () => {
  let n = 0; const pause = noWait();
  assert.equal(await W.checkAccess(async () => { n++; return { status: 'active' }; }, pause), 'active');
  assert.equal(n, 1); assert.equal(pause.calls.length, 0);
});

test('M4 checkAccess: the server says waiting -> waiting (the real waiting answer is kept, no retry)', async () => {
  let n = 0; const pause = noWait();
  assert.equal(await W.checkAccess(async () => { n++; return 'waiting'; }, pause), 'waiting');
  assert.equal(await W.checkAccess(async () => ({ status: 'waiting' }), pause), 'waiting');
  assert.equal(n, 1); assert.equal(pause.calls.length, 0);
});

test('M4 checkAccess: failed once, then ok -> the answer, after exactly one short pause (an active stranger is not shown the list)', async () => {
  let n = 0; const pause = noWait();
  assert.equal(await W.checkAccess(async () => { n++; if (n === 1) throw new Error('network'); return 'active'; }, pause), 'active');
  assert.equal(n, 2); assert.equal(pause.calls.length, 1); assert.ok(pause.calls[0] > 0 && pause.calls[0] <= 3000, 'a short pause');
});

test('M4 checkAccess: failed twice -> unknown (not waiting), two calls only: no storm', async () => {
  let n = 0; const pause = noWait();
  assert.equal(await W.checkAccess(async () => { n++; throw new Error('network'); }, pause), 'unknown');
  assert.equal(n, 2); assert.equal(pause.calls.length, 1);
  assert.notEqual(W.accessOf(undefined), 'unknown');                      // a bad answer (no error) is still the old fail-closed 'waiting'
});

test('M4 the page for "unknown" says it could not check and to reload, with no list or waiting claim; the gate uses it only when the check failed twice', () => {
  assert.deepEqual({ ...W.UNKNOWN_WORDS }, { title: 'We could not check your account just now.', line: 'Reload the page.' });
  const lib = read('assets/app-library.js');
  assert.match(lib, /checkAccess\(\(\) => data\.myAccess\(\)\)/);
  assert.match(lib, /gateUnknown = access === 'unknown';/);
  assert.match(lib, /view = gateUnknown \? waitingUi\(\)\.unknownView\(\) : await waitingUi\(\)\.waitingView\(/);
  assert.doesNotMatch(lib, /catch \{ \/\* fail closed: the waiting page \*\/ \}/);
  const src = read('assets/app-waiting.js');
  const unknown = src.match(/function unknownView\(\) \{[\s\S]*?\n    \}/)[0];
  assert.doesNotMatch(unknown, /list|waiting|few people/i);
  assert.match(src, /You are on the list/);                                  // the real waiting page is unchanged
  // it renders: a heading, the line and two buttons, as text nodes
  const els = []; const h = (tag, props, ...kids) => { const e = { tag, props, kids }; els.push(e); return e; };
  const out = W.create({ h, data: { signOut() {} }, busy() {}, showError() {}, errorLine() {} }).unknownView();
  assert.equal(out[0].kids[0], 'We could not check your account just now.');
  assert.equal(out[1].kids[0], 'Reload the page.');
});

// ---- LOWs: uploads are off ----------------------------------------------------------------------------------------------------------------------------
test('LOW uploads off: Help says plainly that uploading is not open yet (no claim about deleting data nobody has uploaded), on both Help pages', () => {
  const NEW = 'Coming soon: when uploading your own data opens, this answer will say how your files are read and deleted. Until then nothing can be uploaded.';
  assert.ok(read('help/index.html').includes(NEW));
  assert.ok(read('assets/app-library.js').includes(NEW));
  for (const f of ['help/index.html', 'assets/app-library.js']) assert.doesNotMatch(read(f), /Your uploaded data is always deleted|none of it is kept/);
});

test('LOW delete words: Terms s8, Privacy, the confirm and the section all say "films, previews and files" (one wording; no "uploaded files" while uploads are off)', () => {
  const WORDS = 'We remove your films, previews and files, replace your email in support requests and invite records, and then delete your login.';
  assert.ok(text(read('terms/index.html')).includes(WORDS));
  assert.ok(text(read('privacy-policy.html')).includes('we remove your films, previews and files from storage, replace your email'));
  const lib = read('assets/app-library.js');
  assert.ok(lib.includes(WORDS));
  assert.ok(lib.includes('Your films, previews and files are removed for good.'));
  assert.doesNotMatch(lib, /films and uploaded files/);
});

test('LOW download-my-data: the spreadsheet words appear only when uploads are on', () => {
  const run = cfg => { const win = { ryagramConfig: cfg }; vm.runInNewContext(read('assets/app-account.js'), { window: win }); return win.ryagramAccount.buildExport({ projects: [] }, { email: 'a@b.co', now: new Date('2026-11-23T10:00:00Z') }).not_in_this_file; };
  assert.ok(!run({ uploads: false }).some(l => /Spreadsheets/.test(l)));
  assert.ok(run({ uploads: true }).some(l => /Spreadsheets/.test(l)));
  assert.match(read('assets/app-account.js'), /uploadsOn\(\) \? 'Your films and uploaded spreadsheets are not inside it\.' : 'Your films are not inside it\.'/);
});
