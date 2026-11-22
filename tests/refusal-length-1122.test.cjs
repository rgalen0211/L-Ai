// Customer step: a refused story reads the WHOLE next step. The worker keeps up to 500 characters of a refusal, so plainFault keeps up to 500 and, past that, cuts at a full stop.
// The four sentences are ENGINE's (Ryagram engine-customer-messages-1121 a3f56e23), built from the f-strings in ryagram/maprace/lines.py, callouts.py, pipeline.py and
// ryagram/sequence/compose.py with ordinary values (8 colours, 14 lines, year 2019, note 'peak' to frame 912 of 900, a 12 s hold, a paired race in clip 'race').
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-jobs.js'), 'utf8'), { window });
const J = window.ryagramJobs;
const mk = (detail, over) => ({ state: 'failed', attempt: 1, error_class: 'invalid_input', error_code: 'x_story', error_detail: detail, job_type: 'preview', ...over });

const n = 8, safe = n / 2, p = '2019';
const LINE_RACE = `This line race has 14 lines on screen around ${p} but this theme has only ${n} colours, and two lines in one colour cannot be told apart. A race needs a spare colour while one line takes another's place: show ${safe} lines or fewer (that always leaves a spare colour for each line that takes another's place), or use a theme with more colours.`;
const FINAL_HOLD = `A final hold of 20 s is longer than one period's hold (12 s). A held picture never runs past its period, so it would be cut to 12 s without saying so. Choose more than 1.5 s and at most 12 s, or lengthen the period's hold.`;
const NOTE_PAST_END = `The note 'peak' runs to frame 912, past the end of the film (frame 899). A note at the last year needs the last year to be held long enough to show it: hold ${p} for at least 4.0s (a declared still), in a clip whose hold is at least that long.`;
const PAIRED = `The paired race in clip 'race' was not started: its smoothness has to be measured first (the largest number of keyframes a year whose steps stay at or under 14 pixels, between 2 and 24), and this story does not carry that measurement. Please contact Ryagram: this kind of film can only be made after our team has measured it.`;
const FOUR = { LINE_RACE, FINAL_HOLD, NOTE_PAST_END, PAIRED };

test('REFUSAL LENGTH: the four sentences are the long ones this fix is for (over 200, under 500)', () => {
  for (const [k, s] of Object.entries(FOUR)) assert.ok(s.length > 200 && s.length <= 500, `${k} ${s.length}`);
});

test('REFUSAL LENGTH: each sentence reaches the customer whole, with its next step, and ends at a full stop', () => {
  for (const [k, s] of Object.entries(FOUR)) {
    const said = J.problem(mk(s));
    assert.ok(said.includes(s), `${k}: ${said}`);
    assert.match(said, /\.$/, k);
  }
  assert.match(J.problem(mk(LINE_RACE)), /show 4 lines or fewer .* or use a theme with more colours\./);
  assert.match(J.problem(mk(FINAL_HOLD)), /or lengthen the period's hold\./);
  assert.match(J.problem(mk(NOTE_PAST_END)), /a declared still\), in a clip whose hold is at least that long\./);
});

test('REFUSAL LENGTH: the contact-Ryagram sentence is not followed by "Fix the story and submit again"', () => {
  const said = J.problem(mk(PAIRED));
  assert.match(said, /Please contact Ryagram: this kind of film can only be made after our team has measured it\.$/);
  assert.doesNotMatch(said, /Fix the story/);
  const gate = J.problem(mk(PAIRED, { state: 'editorial_action_required', error_class: 'gate' }));
  assert.doesNotMatch(gate, /Change the story/);
  assert.match(gate, /Please contact Ryagram/);
  // The other three still ask for a fix.
  for (const s of [LINE_RACE, FINAL_HOLD, NOTE_PAST_END]) assert.match(J.problem(mk(s)), /Fix the story and submit again\.$/);
});

test('REFUSAL LENGTH: past 500 it is cut at the last full stop, never mid-sentence', () => {
  const a = 'The first thing is wrong and here is how to change it.';
  const long = Array.from({ length: 12 }, (_, i) => `${a} (${i})`.replace(/ \(\d+\)$/, ` Part ${i} of the advice runs on a while.`)).join(' ');
  assert.ok(long.length > 500);
  const said = J.problem(mk(long));
  const kept = said.slice(said.indexOf('The first'), said.lastIndexOf(' Fix the story'));
  assert.ok(kept.length <= 500 && kept.endsWith('.'), kept);
  assert.ok(long.startsWith(kept) && long[kept.length] === ' ', 'cut falls exactly after a full stop');
  // No full stop at all in the first 500 characters: nothing is cut mid-sentence; the plain "cannot put into words" line is shown.
  assert.match(J.problem(mk('word '.repeat(150))), /cannot put into plain words/);
});

test('REFUSAL LENGTH: shorter faults, the $ path and other codes keep their old wording', () => {
  assert.equal(J.problem(mk('The dataset has no data before 2010.')), 'The story or its settings weren’t accepted. The dataset has no data before 2010. Fix the story and submit again.');
  assert.equal(J.problem(mk("$.sequence.fps: \"x\" is not one of 24, 25, 30")), 'The story or its settings weren’t accepted. The value “x” (in sequence > fps) isn’t an allowed choice here. Allowed: 24, 25, 30. Fix the story and submit again.');
  assert.equal(J.problem(mk('x', { state: 'cancelled' })), 'Cancelled.');
  assert.match(J.problem(mk(LINE_RACE, { error_code: 'ladder_missing', job_type: 'final_render' })), /^This render did not match the contact sheet/);
  assert.match(J.problem(mk(LINE_RACE, { error_class: 'engine_unsupported' })), /^The render machine cannot make this kind of film yet\./);
  assert.match(J.problem(mk(LINE_RACE, { error_class: 'limit' })), /Try a shorter preview window/);
});
