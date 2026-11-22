// WEB 11-22 "promises the code keeps": every sentence below is a rule the database or the page really follows, checked against the file that holds the rule.
// Each check is a function of the text, so the test also runs it on the OLD wording and shows it goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-jobs.js'), { window: win, setTimeout, clearTimeout });
const J = win.ryagramJobs;
const goesRed = (check, oldText) => assert.throws(() => check(oldText), undefined, 'the check must fail on the old wording');

// ---- GROUP A ------------------------------------------------------------------------------------------------------------------------------------------
test('F4: the free-preview rule says what credits_ledger.sql does (6 a project, 15 in 24 hours, then 1 credit, a failed free preview still counts)', () => {
  const sql = read('supabase/phase-2b/credits_ledger.sql');
  assert.match(sql, /free_previews_per_project int not null default 6,/);
  assert.match(sql, /free_previews_per_24h int not null default 15,/);
  assert.match(sql, /'preview_extra', 1, null/);
  assert.match(sql, /and not \(state = 'failed' and error_class = 'infrastructure'\)/, 'only an infrastructure failure is not counted');
  const RULE = 'Each project gets 6 free previews, and you get 15 free previews in any 24 hours across all your projects. After that a preview costs 1 credit. A free preview that fails because of your story still counts.';
  const check = lib => {
    assert.ok(lib.includes(`const FREE_PREVIEW_RULE = '${RULE}';`));
    assert.ok(lib.includes("'Buying credits is not open yet. Contact sheets are free. ' + FREE_PREVIEW_RULE"));
    assert.ok(lib.includes("'Credits pay for full films and for previews after the free ones. Contact sheets are free. ' + FREE_PREVIEW_RULE"));
    assert.ok(lib.includes("open ? ' Contact sheets are free. ' + FREE_PREVIEW_RULE : null"));
    assert.ok(!/so are your first previews/.test(lib), 'the old "first previews" promise is gone');
  };
  const lib = read('assets/app-library.js');
  check(lib);
  goesRed(check, lib.replace(/const FREE_PREVIEW_RULE = '[^']*';/, "const FREE_PREVIEW_RULE = 'Contact sheets are free, and so are your first previews.';"));
  goesRed(check, lib.replace(/open \? ' Contact sheets are free\. ' \+ FREE_PREVIEW_RULE : null/, "open ? ' Contact sheets are free, and so are your first previews.' : null"));
});

test('F2: the report sentence says "usually at once" in the help page, the in-app help and the report page (the auto-hide is capped in ops_readiness.sql)', () => {
  const sql = read('supabase/migrations/20261010000100_ops_readiness.sql');
  assert.match(sql, /hold := held_today < s\.abuse_hide_per_reporter_day/, 'the auto-hide is capped per reporter');
  const check = text => { assert.match(text, /we usually hide the film at once while we review it\./); assert.doesNotMatch(text, /right away/); };
  for (const f of ['help/index.html', 'assets/app-library.js', 'report/index.html']) {
    const text = read(f);
    if (f === 'help/index.html' || f === 'assets/app-library.js') assert.match(text, /we usually hide the film at once while we review it\./, f);
    else check(text);
    goesRed(check, text.replace('we usually hide the film at once', 'we hide the film right away'));
  }
});

test('F3: a retry says "attempt 2 of 2": the database retries a job once (attempt is 1 or 2)', () => {
  const sql = read('supabase/migrations/20261017000600_pipe1_orders.sql');
  assert.match(sql, /check \(attempt between 1 and 2\)/);
  assert.match(sql, /lost\.attempt < 2 then 'queued'/);
  const check = note => assert.match(note, /^Next in line\. Retrying once after a render-machine problem \(attempt 2 of 2\)\.$/);
  check(J.progressNote({ state: 'queued', attempt: 2 }, 1));
  goesRed(check, 'Next in line. Retrying after a render-machine problem (attempt 2 of 3).');
  assert.equal(J.progressNote({ state: 'queued', attempt: 1 }, 1), 'Next in line.');
});

test('GAMES help: the live editor answer does not say nothing is sent; it says no credits are used and a change can be undone', () => {
  assert.match(read('assets/app-editor-draft.js'), /rpc\('editor_apply_ops'/, 'every edit is sent to the server first');
  const check = t => { assert.match(t, /No credits are used while you try things, and you can undo a change in the editor\./); assert.doesNotMatch(t, /Nothing is sent to the server/); };
  const help = read('help/index.html');
  check(help);
  goesRed(check, help.replace('No credits are used while you try things, and you can undo a change in the editor.', 'Nothing is sent to the server and no credits are used while you try things.'));
});

// ---- GROUP B: the order line and the job line tell what really happened ---------------------------------------------------------------------------------
// The "old" behaviour is planted by running the check on the old function's answer (what a page without the branch says).
const ORDER_OLD = 'The full render failed. Your credits were returned. You can request it again.';
const order = (state, error_code) => J.orderLine({ state, error_code, stages: [] });
const T = read('supabase/pipe1/pipe1_orders.template.sql');

test('B1 orderLine: a short balance or the daily cap says nothing was charged (stage_submit holds nothing) and does not say credits were returned', () => {
  assert.match(T, /state = 'failed', error_code = 'insufficient_credits'/);
  assert.match(T, /order_end\(p_order\.id, 'failed', 'daily_cap'\)/);
  assert.match(T, /Not enough credits \(2B raises 53400\): no job, no hold/);
  const credits = s => { assert.match(s, /enough credits\. Nothing was charged\. (?:Buy credits, then request it again|Buying credits is not open yet)\.$/); assert.doesNotMatch(s, /returned/); };
  const cap = s => { assert.match(s, /today’s credit limit\. Nothing was charged\. You can request it again after 24 hours\.$/); assert.doesNotMatch(s, /returned/); };
  credits(order('failed', 'insufficient_credits')); cap(order('failed', 'daily_cap'));
  goesRed(credits, ORDER_OLD); goesRed(cap, ORDER_OLD);
});

test('B1 orderLine: a final refused for its story does not say "request it again" alone; it says change the story or make a new sheet and preview', () => {
  const refused = s => { assert.match(s, /Change the story[^.]*, or make a new contact sheet and preview, then request it again\./); assert.match(s, /refused the same way|stop it the same way/); };
  for (const c of ['engine_refused', 'schema_rejected', 'timeout', 'limit_exceeded']) refused(order('failed', c));
  assert.match(order('failed', 'ladder_missing'), /did not match the contact sheet and preview you approved\. Your credits were returned\. Make a new contact sheet and preview/);
  goesRed(refused, ORDER_OLD);
  assert.equal(order('failed', 'worker_lost'), ORDER_OLD, 'a failure with no story fault keeps the plain line');
  assert.equal(order('failed', undefined), ORDER_OLD);
});

test('B1 orderLine: a cancel while it ran says "You cancelled"; a film past its 30 days says it was kept and deleted, not "not approved in time"', () => {
  assert.match(T, /order_end\(o\.id, 'cancelled', 'cancelled'\)/);
  assert.match(T, /set state = 'expired', error_code = 'delivery_expired'/);
  assert.match(T, /final_close\(s\.id, 'expired', 'approval_expired'/);
  const cancelled = s => assert.match(s, /^You cancelled the full render\. Your credits were returned\.$/);
  cancelled(order('failed', 'cancelled')); cancelled(order('cancelled', 'cancelled'));
  goesRed(cancelled, ORDER_OLD);
  const gone = s => assert.equal(s, 'Your film was kept for 30 days and has been deleted.');
  gone(order('expired', 'delivery_expired'));
  goesRed(gone, order('expired', 'approval_expired'));
  assert.match(order('expired', 'approval_expired'), /not approved in time/, 'an approval that ran out keeps its own line');
  assert.match(order('expired', undefined), /not approved in time/);
});

const job = o => J.problem({ state: 'failed', attempt: 1, ...o });

test('B2 invalid_input: an upload that was not confirmed (or a generic upload refusal) does not say "Fix the story"', () => {
  const fine = s => assert.doesNotMatch(s, /Fix the story/);
  const NC = 'This uploaded data has not been confirmed for use, so no film was made from it. Open it in Your data and confirm it to try again.';
  fine(job({ error_class: 'invalid_input', error_code: 'dataset_not_allowed', error_detail: NC }));
  fine(job({ error_class: 'invalid_input', error_code: 'engine_refused', error_detail: 'The film could not be made from your data. Check that your columns and places are right.' }));
  assert.match(job({ error_class: 'invalid_input', error_code: 'dataset_not_allowed', error_detail: NC }), /confirm it to try again\.$/);
  assert.match(job({ error_class: 'invalid_input', error_code: 'dataset_not_allowed' }), /Open Your data to check it\.$/);
  goesRed(fine, 'The story or its settings weren’t accepted. Fix the story and submit again.');
  assert.match(job({ error_class: 'invalid_input', error_code: 'schema_rejected', error_detail: '$.title: unknown key' }), /Fix the story|Remove the setting/, 'a real story fault keeps its next step');
});

test('B3 queue_timeout: the job never ran, so it does not say "It tried N times"', () => {
  assert.match(read('supabase/migrations/20261010000100_ops_readiness.sql'), /error_code = 'queue_timeout', error_class = 'infrastructure'/);
  const s = job({ error_class: 'infrastructure', error_code: 'queue_timeout', attempt: 1, error_detail: 'Rendering was delayed, so this film could not start. Your credits were returned.' });
  const check = t => { assert.doesNotMatch(t, /tried/); assert.match(t, /Rendering was delayed, so this film could not start\. Your credits were returned\. You can try again\.$/); };
  check(s);
  goesRed(check, 'The render machine had a problem, not your story. It tried 1 time. Rendering was delayed, so this film could not start.');
  assert.match(job({ error_class: 'infrastructure', error_code: 'worker_lost', attempt: 2 }), /It tried 2 times\./, 'a job that did run keeps the count');
});

test('B4 limit: only a preview is told to try a shorter preview window', () => {
  const noWindow = s => { assert.doesNotMatch(s, /preview window/); assert.match(s, /Ask us to help\.$/); };
  noWindow(job({ error_class: 'limit', job_type: 'final_render' }));
  noWindow(job({ error_class: 'limit', job_type: 'contact_sheet' }));
  assert.match(job({ error_class: 'limit', job_type: 'preview' }), /Try a shorter preview window, or ask us to help\.$/);
  goesRed(noWindow, job({ error_class: 'limit', job_type: 'preview' }));
});

test('B5 a final render Ryagram declined, or whose approval ran out, says it was not approved and the credits came back (final_close sets the job code)', () => {
  assert.match(T, /error_class = 'cancelled', error_code = p_error/);
  assert.match(T, /final_close\(s\.id, 'declined', 'declined', me, p_note\)/);
  const declined = s => assert.equal(s, 'This render was not approved, so nothing was rendered and your credits came back.');
  const late = s => assert.equal(s, 'This render was not approved in time, so it was cancelled and your credits came back.');
  declined(J.problem({ state: 'cancelled', job_type: 'final_render', error_class: 'cancelled', error_code: 'declined' }));
  late(J.problem({ state: 'cancelled', job_type: 'final_render', error_class: 'cancelled', error_code: 'approval_expired' }));
  assert.equal(J.problem({ state: 'cancelled', error_class: 'cancelled', error_code: 'cancelled' }), 'Cancelled.', 'a cancel the person chose is still just Cancelled.');
  goesRed(declined, 'Cancelled.');
});

test('B6 the local-only override gate line points to "Get help with this", not to changing the story', () => {
  const gate = job({ state: 'editorial_action_required', error_class: 'gate', error_code: 'gate', error_detail: 'the receipt carries a --render-anyway override, which the web worker never accepts' });
  const check = s => { assert.match(s, /Open “Get help with this”\.$/); assert.doesNotMatch(s, /Change the story/); };
  check(gate);
  goesRed(check, 'Ryagram’s checks stopped this render. Change the story, then make a new preview.');
  assert.match(J.problem({ state: 'editorial_action_required', error_class: 'gate', error_detail: '2 preflight check(s) failed' }), /Change the story, then make a new preview\.$/, 'an ordinary check failure keeps its step');
  assert.match(J.problem({ state: 'editorial_action_required', error_class: 'gate', error_detail: 'the checks did not run: x' }), /Nothing is wrong with your story/, 'checks-did-not-run keeps its line');
});

// ---- WEB 11-22 12:4x: GAMES 12:35 + FACES 12:37 review findings ----
const withCfg = (cfg, mock, f) => {
  const w = {}; w.ryagramConfig = cfg; if (mock) w.ryagramMock = {};
  vm.runInNewContext(read('assets/app-jobs.js'), { window: w, setTimeout, clearTimeout });
  return f(w.ryagramJobs);
};
const noCredits = { state: 'failed', error_code: 'insufficient_credits', stages: [] };
test('R1 insufficient_credits: "Buy credits" only while buying is open (the Credits page switch); closed says "Buying credits is not open yet."', () => {
  const closed = s => { assert.match(s, /Nothing was charged\. Buying credits is not open yet\.$/); assert.doesNotMatch(s, /Buy credits/); };
  const open = s => assert.match(s, /Nothing was charged\. Buy credits, then request it again\.$/);
  closed(withCfg({ credits: true, payments: true, buyingOpen: false }, false, j => j.orderLine(noCredits)));
  closed(withCfg({}, false, j => j.orderLine(noCredits)));
  open(withCfg({ credits: true, payments: true, buyingOpen: true }, false, j => j.orderLine(noCredits)));
  open(withCfg(undefined, true, j => j.orderLine(noCredits)));
  goesRed(closed, 'The full render did not start because you do not have enough credits. Nothing was charged. Buy credits, then request it again.');
  assert.match(read('assets/app-library.js'), /const buyingOn = \(\) => paymentsOn\(\) && \(window\.ryagramConfig\?\.buyingOpen === true/);
});
test('R2 failed order: only codes whose credits are really returned say so; advance_error (no refund_job in the exception handler) does not', () => {
  assert.match(T, /exception when others then\s+update public\.render_orders set state = 'failed', error_code = 'advance_error'/);
  const handler = T.slice(T.indexOf("error_code = 'advance_error'"), T.indexOf('return null;', T.indexOf("error_code = 'advance_error'")));
  assert.ok(!/refund_job/.test(handler), 'the handler never calls refund_job');
  const plain = s => { assert.equal(s, 'The full render failed. Ask us to help.'); assert.doesNotMatch(s, /credits/); };
  plain(order('failed', 'advance_error')); plain(order('failed', 'something_new'));
  assert.equal(order('failed', 'worker_lost'), ORDER_OLD);
  assert.equal(order('failed', undefined), ORDER_OLD);
  assert.equal(order('failed', 'delivery_failed'), ORDER_OLD);
  goesRed(plain, ORDER_OLD);
});
test('R3 live-editor help line is true for the mock and own-PC editors too: it promises an undo, not a saved draft', () => {
  const src = read('assets/app-editor-core.js');
  assert.match(src, /undo/i);
  const check = t => { assert.match(t, /No credits are used while you try things, and you can undo a change in the editor\./); assert.doesNotMatch(t, /saved as a draft/); };
  const help = read('help/index.html');
  check(help);
  goesRed(check, help.replace('No credits are used while you try things, and you can undo a change in the editor.', 'No credits are used while you try things; your changes are saved as a draft you can undo.'));
  for (const f of ['assets/app-library.js', 'assets/app-editor.js', 'app/index.html']) { try { assert.doesNotMatch(read(f), /saved as a draft you can undo/); } catch (e) { if (e.code === 'ENOENT') continue; throw e; } }
});
test('R4 limit on a final render or contact sheet: the worker\u2019s own "shorter preview window" advice is replaced; a preview keeps it', () => {
  const W = 'The film is over the size the render machine allows. Try a shorter preview window.';
  const tooLarge = s => { assert.equal(s, 'This film is too large for the render machine. Ask us to help.'); assert.doesNotMatch(s, /preview window/); };
  tooLarge(job({ error_class: 'limit', job_type: 'final_render', error_detail: W }));
  tooLarge(job({ error_class: 'limit', job_type: 'contact_sheet', error_detail: W }));
  assert.match(job({ error_class: 'limit', job_type: 'preview', error_detail: W }), /Try a shorter preview window/);
  goesRed(tooLarge, 'It went over a size or memory limit. ' + W + ' Ask us to help.');
});
