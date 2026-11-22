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

test('GAMES help: the live editor answer does not say nothing is sent; it says no credits are used and the changes are a draft you can undo', () => {
  assert.match(read('assets/app-editor-draft.js'), /rpc\('editor_apply_ops'/, 'every edit is sent to the server first');
  const check = t => { assert.match(t, /No credits are used while you try things; your changes are saved as a draft you can undo\./); assert.doesNotMatch(t, /Nothing is sent to the server/); };
  const help = read('help/index.html');
  check(help);
  goesRed(check, help.replace('No credits are used while you try things; your changes are saved as a draft you can undo.', 'Nothing is sent to the server and no credits are used while you try things.'));
});
