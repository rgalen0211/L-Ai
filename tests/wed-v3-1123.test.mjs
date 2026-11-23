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

// ---- jobs words (FACES 09:47 and CC1): a stranger reads true plain words about the wait and about problems ---------------------------------------------
const J = (() => { const win = {}; vm.runInNewContext(read('assets/app-jobs.js'), { window: win }); return win.ryagramJobs; })();
const HOURS = /At busy times yours may take a few hours\.|it may take a few hours or more\./;

test('queue: every waiting job, from position 1 and with no position, says one at a time and that busy times can take hours; a contact sheet keeps its 5 minute sentence for 2 and up', () => {
  for (const type of ['contact_sheet', 'preview', 'final_render', undefined]) {
    for (const pos of [0, 1, 2, 3, 7, 20]) {
      const s = J.progressNote({ state: 'queued', attempt: 1, job_type: type }, pos);
      assert.match(s, /We make one film at a time\./, `${type}/${pos}`);
      assert.match(s, HOURS, `${type}/${pos}`);
      assert.doesNotMatch(s, /The machine|render machine/, `${type}/${pos}`);
    }
  }
  assert.match(J.progressNote({ state: 'queued', attempt: 1, job_type: 'contact_sheet' }, 2), /about 5 minutes for each film ahead of yours/);
  assert.match(J.progressNote({ state: 'queued', attempt: 1, job_type: 'contact_sheet' }, 7), /With this many ahead of yours, it may take a few hours or more\./);
  assert.doesNotMatch(J.progressNote({ state: 'queued', attempt: 1, job_type: 'contact_sheet' }, 3), /With this many/);
});

test('Help "Why is my film still Queued?" says it can be hours at busy times, on both Help pages', () => {
  const A = 'We make one film at a time, oldest first. Yours starts when the ones ahead of it finish. A contact sheet usually takes about 5 minutes, but at busy times yours may take a few hours.';
  assert.ok(read('help/index.html').includes(A));
  assert.ok(read('assets/app-library.js').includes(A));
});

test('words a stranger should not read: no attempt counts, no "tried N times", no worker detail on a machine-side problem', () => {
  const failed = over => J.problem({ state: 'failed', attempt: 2, error_class: 'infrastructure', error_detail: '', ...over });
  const MOCK = 'The engine process exited unexpectedly (mock).';
  for (const code of ['crash', 'worker_lost', undefined]) {
    const s = failed({ error_code: code, error_detail: MOCK });
    assert.equal(s, 'We had a problem on our side, not with your story. You can try again. If it keeps happening, open “Get help with this”.');
    assert.doesNotMatch(s, /tried|attempt|engine|process|render machine|mock/i);
  }
  assert.equal(J.progressNote({ state: 'queued', attempt: 2 }, 1), 'Next in line. We make one film at a time. At busy times yours may take a few hours. This was put back in line after a problem on our side.');
  assert.doesNotMatch(J.progressNote({ state: 'queued', attempt: 2 }, 3), /attempt|Retrying|render-machine/);
  // an unrecognised class does not show the worker's words either; a story problem (checks, invalid input) still shows the plain reason the person can act on
  assert.doesNotMatch(J.problem({ state: 'failed', error_class: 'weird', error_detail: MOCK }), /engine process/);
  assert.match(J.problem({ state: 'failed', error_class: 'invalid_input', error_detail: 'The dataset has no data before 2010.' }), /no data before 2010/);
  assert.equal(failed({ error_code: 'queue_timeout', job_type: 'contact_sheet', attempt: 1 }), 'The render machine did not get to it in time, so we stopped it. This is not your story. You can try again.');
});

test('contact sheet words: a failed sheet says a new contact sheet, a sheet timeout has no preview window, the state label is plain, the Latest job card maps claimed and running', () => {
  const gate = type => J.problem({ state: 'editorial_action_required', error_class: 'gate', error_detail: '2 preflight check(s) failed', job_type: type });
  assert.match(gate('contact_sheet'), /Change the story, then make a new contact sheet\.$/);
  assert.match(gate('preview'), /Change the story, then make a new preview\.$/);
  const slow = type => J.problem({ state: 'failed', error_class: 'timeout', error_detail: '', job_type: type });
  assert.doesNotMatch(slow('contact_sheet'), /preview window/); assert.match(slow('contact_sheet'), /shorten the film first\.$/);
  assert.doesNotMatch(slow('final_render'), /preview window/);
  assert.match(slow('preview'), /shorten the film or the preview window first\.$/);
  assert.equal(J.STATE_LABELS.editorial_action_required, 'Stopped by our checks');
  assert.equal(J.STATE_LABELS.claimed, 'Starting'); assert.equal(J.STATE_LABELS.running, 'Rendering');
  assert.match(read('assets/app-library.js'), /window\.ryagramJobs\.STATE_LABELS\[j\.state\] \|\| STATE_LABELS\[j\.state\] \|\| j\.state/);
});

test('get-app: the Windows download page is noindex and no stranger-visible page links to it (only the invite email does); the card in Account is tester-only', () => {
  assert.match(read('get-app/index.html'), /<meta name="robots" content="noindex, nofollow">/);
  for (const p of ['app/index.html', 'ryagram/index.html', 'help/index.html', 'index.html', 'terms/index.html', 'privacy-policy.html', 'report/index.html', 'ai-content/index.html', 'connect-ai/index.html']) {
    assert.doesNotMatch(read(p), /href="[^"]*get-app/, p);
  }
  for (const f of ['assets/app-library.js', 'assets/app-device.js', 'assets/app-start.js', 'assets/app-connect.js']) assert.doesNotMatch(read(f), /href: ['"`][^'"`]*\/get-app/, f);
  assert.match(read('assets/app-device.js'), /if \(!tester\) return null;\s+\/\/ only an account with the tester flag sees the card/);
});
