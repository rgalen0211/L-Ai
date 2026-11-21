// Customer step (WEB 11-21): the preview's last stage, "Checking the film against its data 454/454", gives no time word, and a person watching it at its last count wonders if it is stuck.
// That stage alone says, honestly and without a number, that it can take several minutes. No other stage says it; no stage promises a fixed time.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-jobs.js'), 'utf8'), { window });
const J = window.ryagramJobs;
const now = Date.parse('2026-11-21T10:00:00Z');
const job = detail => ({ state: 'running', started_at: '2026-11-21T09:56:00Z', progress_detail: detail });
const SAID = 'This step can take several minutes.';

test('CHECKS NOTE: the checking stage says it can take several minutes, even at its last count', () => {
  for (const d of [{ stage: 'checks', done: 454, total: 454, unit: 'clips' }, { stage: 'checks', done: 1, total: 454, unit: 'clips' }, { stage: 'checks' }]) {
    assert.equal(J.progressView(job(d), now).note, SAID, JSON.stringify(d));
  }
  assert.equal(J.progressView(job({ stage: 'checks', done: 454, total: 454, unit: 'clips' }), now).stage, 'Checking the film against its data');
});

test('CHECKS NOTE: no other stage, and no job with no detail, says it', () => {
  for (const d of [{ stage: 'starting' }, { stage: 'drawing', done: 5, total: 300, unit: 'frames' }, { stage: 'encoding' }, { stage: 'uploading' }, { stage: 'done' }, { stage: 'something_new' }, null]) {
    assert.equal(J.progressView(job(d), now).note, '', JSON.stringify(d));
  }
});

test('CHECKS NOTE: the sentence promises no number and no fixed time', () => {
  assert.doesNotMatch(SAID, /\d|about|~|exactly|will take|within/i);
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-jobs.js'), 'utf8');
  assert.ok(src.includes(`'${SAID}'`), 'the page says exactly this sentence');
});

test('CHECKS NOTE: the Render panel draws the note under the stage fields', () => {
  const lib = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-library.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(lib, /p\.note \? h\('p', \{ class: 'form-note job-step-note' \}, p\.note\) : null/);
});
