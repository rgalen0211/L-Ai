// Customer step: a paid final render refused with ladder_missing reads ONE next step and knows the credits came back.
// A contact sheet or preview (free, no hold) gets the same line with no credit claim. The engine's own text never reaches the page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-jobs.js'), 'utf8'), { window });
const J = window.ryagramJobs;
const LINE = 'This render did not match the contact sheet and preview you approved. Make a new contact sheet and preview, then render again.';
const RAW = 'LadderMissingError: no ladder rung for sha 9f3a77c1 in sidecar.json';
const mk = (job_type, over) => ({ state: 'failed', attempt: 1, error_class: 'invalid_input', error_code: 'ladder_missing', error_detail: RAW, job_type, ...over });

test('LADDER: a final render says the plain line, then that the held credits were returned', () => {
  assert.equal(J.problem(mk('final_render')), LINE + ' The credits held for it were returned.');
});

test('LADDER: a contact sheet or preview gets the plain line alone, no credit claim', () => {
  for (const t of ['contact_sheet', 'preview', undefined]) assert.equal(J.problem(mk(t)), LINE, String(t));
});

test('LADDER: one next step, no story blame, no engine text, whatever the class or job', () => {
  for (const t of ['final_render', 'preview']) for (const cls of ['invalid_input', 'infrastructure', 'unknown', null]) {
    const said = J.problem(mk(t, { error_class: cls }));
    assert.doesNotMatch(said, /story|settings|Fix the|submit again|accepted/i, said);
    assert.doesNotMatch(said, /Ladder|sidecar|9f3a|_/, said);
    assert.equal((said.match(/render again/g) || []).length, 1, said);
  }
});

test('LADDER: only the code ladder_missing is special; other invalid_input still asks to fix the story', () => {
  assert.match(J.problem(mk('final_render', { error_code: 'x_other', error_detail: 'The dataset has no data before 2010.' })), /Fix the story and submit again\./);
});
