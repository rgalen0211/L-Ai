// What a free-preview user is told when a contact sheet or preview fails (WEB 11-21, from WORKER's table proposals/WORKER-FREE-PREVIEW-FAILURES-1121.md, rows 1-20).
// Customer step: a free-preview user who hits a failure is told what happened in plain words. Each row runs the real app-jobs.js problem() with the detail text the table quotes.
// The shown sentence must hold none of the code shapes below, and keep its plain advice.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(src) { const window = {}; vm.runInNewContext(src, { window }); return window.ryagramJobs; }
const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-jobs.js'), 'utf8');
const J = load(SRC);

// The code shapes a person must never see (kept independent of the page's own filter).
const CODE = /[$\[\]{}]|::|Traceback|\bat line\b|\bException\b|[a-z]+_[a-z_]+|\b[A-Z][a-z]+Error\b|\bexit \d|\.(?:mp4|json|png|csv|py|log|txt)\b|limit \d{3,}|\d{5,}|\b(?:sidecar|engine commit|preflight)\b/i;
const job = (over) => ({ state: 'failed', attempt: 2, error_class: 'infrastructure', error_detail: '', ...over });
const MACHINE = /We had a problem on our side, not with your story\./;

// [row, name, job, advice regexp the sentence must keep]
const ROWS = [
  [1, 'crash with a Python traceback', job({ error_detail: 'Traceback (most recent call last):\n  File "worker.py", line 88, in run\nKeyError: 1' }), /You can try again\./],
  [2, 'crash with a plain last line', job({ error_detail: 'exit 1: could not open the dataset cache' }), /You can try again\./],
  [3, 'start_failed', job({ error_detail: '' }), /You can try again\./],
  [4, 'worker_error', job({ error_detail: 'KeyError' }), /You can try again\./],
  [5, 'worker_lost', job({ error_detail: '' }), /You can try again\./],
  [6, 'upload_failed', job({ error_detail: 'StorageError: 413 Payload Too Large' }), /You can try again\./],
  [7, 'no_receipt', job({ attempt: 1, error_detail: 'the render wrote no readable sidecar' }), /You can try again\./],
  [8, 'no_commit', job({ attempt: 1, error_detail: 'the receipt records no engine commit' }), /You can try again\./],
  [9, 'no_output', job({ error_class: 'unknown', error_detail: 'exit 0 but no preview.mp4' }), /You can try again\./],
  [10, 'timeout', job({ job_type: 'preview', error_class: 'timeout', error_detail: 'stopped after 120 s' }), /shorten the film or the preview window/],
  [11, 'limit (memory or disk), no next step before', job({ job_type: 'preview', error_class: 'limit', error_detail: '' }), /Try a shorter preview window, or ask us to help\./],
  [12, 'limit (output too big)', job({ job_type: 'preview', error_class: 'limit', error_detail: 'outputs are 61234567 bytes, limit 52428800' }), /Try a shorter preview window, or ask us to help\./],
  [13, 'gate_failed (checks failed)', job({ error_class: 'gate', error_detail: '2 preflight check(s) failed' }), /Change the story, then make a new preview\./],
  [14, 'gate_failed (checks did not run)', job({ error_class: 'gate', error_detail: 'the checks did not run: ValueError: bad palette' }), /Nothing is wrong with your story\. You can try again/],
  [15, 'engine_refused, plain', job({ error_class: 'invalid_input', error_detail: 'The dataset has no data before 2010.' }), /Fix the story and submit again\./],
  [16, 'engine_refused, code-looking', job({ error_class: 'invalid_input', error_detail: 'SequenceError: clip map: unknown key forecast' }), /Fix the story and submit again\./],
  [17, 'schema_rejected', job({ error_class: 'invalid_input', error_detail: "$.sequence.clips[0].colour: unknown key 'colour'" }), /Remove the setting\(s\) above/],
  [18, 'engine_unsupported', job({ error_class: 'invalid_input', error_code: 'engine_unsupported', error_detail: 'engine_unsupported: no drawer for this job' }), /Tell us and we will fix it\./],
  [19, 'dataset_not_allowed', job({ error_class: 'invalid_input', error_detail: 'This dataset is not available on the render machine yet.' }), /Fix the story and submit again\./],
  [20, 'cancelled', job({ state: 'cancelled', error_class: null, error_detail: '' }), /^Cancelled\.$/]
];

for (const [row, name, j, advice] of ROWS) {
  test(`JOB WORDS row ${row}: ${name}: no code shapes, plain advice kept`, () => {
    const said = J.problem(j);
    assert.ok(said.length > 0);
    assert.doesNotMatch(said, CODE, said);
    assert.match(said, advice, said);
  });
}

test('JOB WORDS: row 1-9 still say it is the machine and not the story (the infrastructure class)', () => {
  for (const [row, , j] of ROWS.filter(r => r[0] <= 8)) assert.match(J.problem(j), MACHINE, `row ${row}`);
});

test('JOB WORDS row 11 and 12: a limit always has a next step in plain words', () => {
  for (const d of ['', 'outputs are 61234567 bytes, limit 52428800', 'out of memory']) {
    assert.match(J.problem(job({ job_type: 'preview', error_class: 'limit', error_detail: d })), /It went over a size or memory limit\..*Try a shorter preview window, or ask us to help\.$/);
  }
});

test('JOB WORDS row 18: engine_unsupported never says "Fix the story" (the machine\'s setup, not the story), whatever the class', () => {
  assert.match(J.problem(job({ error_class: 'engine_unsupported' })), /Tell us and we will fix it\./);
  for (const cls of ['invalid_input', 'infrastructure', 'unknown']) {
    const said = J.problem(job({ error_class: cls, error_code: 'engine_unsupported', error_detail: '' }));
    assert.equal(said, 'The render machine cannot make this kind of film yet. Nothing is wrong with your story. Tell us and we will fix it.');
    assert.doesNotMatch(said, /Fix the story/);
  }
});

test('JOB WORDS row 14: checks that did not run are the machine\'s fault: no "Change the story"; checks that failed still ask for a change', () => {
  const notRun = J.problem(job({ error_class: 'gate', error_detail: 'the checks did not run: ValueError: bad palette' }));
  assert.doesNotMatch(notRun, /Change the story/);
  assert.match(J.problem(job({ error_class: 'gate', error_detail: '$.x: unknown key \'y\'' })), /Change the story/);
  assert.match(J.problem(job({ state: 'editorial_action_required', error_class: null, error_detail: 'the checks did not run: ValueError' })), /Nothing is wrong with your story/);
});

test('JOB WORDS: the worker\'s own plain codes (WORKER proposes these) pass the filter untouched', () => {
  for (const t of ['Something went wrong on the render machine.', 'The finished film could not be stored.', 'The render did not finish its checks.', 'The render machine could not confirm which version made the film.',
                   'The render finished but wrote no film.', 'The film came out larger than the size limit.', 'The dataset has no data before 2010. It is only a short note.']) {
    assert.equal(J.plainDetail(t), t, t);          // the filter keeps plain prose; an infrastructure problem no longer shows the worker's detail at all (wed-v3)
  }
});

test('JOB WORDS: ordinary prose with a full stop is not caught as a file name', () => {
  for (const t of ['It stopped. Try again.', 'Version 2.5 of the story is fine.', 'See www.example.com for more.']) assert.equal(J.plainDetail(t), t, t);
});

test('JOB WORDS PLANTED FAULTS: the old filter lets each missing shape through, the new one does not', () => {
  const OLD = /[$\[\]{}]|::|Traceback|\bat line\b|\bException\b|\b[a-z]+_[a-z_]+\b/;
  const planted = SRC.replace(/const LOOKS_LIKE_CODE = .*;/, `const LOOKS_LIKE_CODE = ${OLD};`);
  assert.notEqual(planted, SRC);
  const Jold = load(planted);
  let leaked = 0;
  for (const [row, , j] of ROWS.filter(r => [2, 4, 6, 7, 8, 9, 12, 13, 14, 16].includes(r[0]))) if (CODE.test(Jold.plainDetail(j.error_detail))) leaked++;
  assert.ok(leaked >= 8, `the old filter leaks ${leaked} of 10 rows`);
});
