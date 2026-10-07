const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-jobs.js'), 'utf8'), { window });
const J = window.ryagramJobs;

test('engine and worker refusals a subscriber is likely to meet are said plainly', () => {
  const cases = [
    ['choropleth.continuous needs choropleth.mode: solid. A hatched map has no colour to tween.', /Smooth colour needs the solid map fill/],
    ["line view: 9 series but only 8 colours in line.series_palette. Two lines in one colour cannot be told apart", /at most 8 lines/],
    ["a still is declared at '2030', which is not a period of this run (2011, 2012)", /A pause is set at 2030/],
    ['7 periods do not divide into windows of 3: 1 left over (2011).', /Your 7 years don.t split evenly into 3-year averages/],
    ['TX peaks at 40,000 dots with 1 dot = 100. Try 1 dot = 400 or larger.', /too many dots \(40,000/],
    ['a held period runs 2.40s, over the 2s limit: shorten the hold', /sits on one picture for 2\.40 seconds; the limit is 2\./],
    ['!! NOT A CLEAN RENDER: 2 preflight check(s) failed', /didn.t pass 2 quality checks/],
    ['the title card reads at 310 words per minute, over the 250 limit', /goes by too fast to read/],
    ['the headline does not fit on the card', /too long to fit on the card/]
  ];
  for (const [raw, re] of cases) assert.match(J.plainDetail(raw), re, raw);
});

test('text no rule knows is shown as the worker wrote it, and a job problem uses the plain text', () => {
  assert.equal(J.plainDetail('something new went wrong'), 'something new went wrong');
  assert.equal(J.plainDetail(''), '');
  const msg = J.problem({ state: 'failed', error_class: 'invalid_input', error_detail: 'choropleth.continuous needs choropleth.mode: solid.', attempt: 1 });
  assert.match(msg, /Smooth colour needs the solid map fill/);
  assert.doesNotMatch(msg, /choropleth\.continuous/);
  const gate = J.problem({ state: 'editorial_action_required', error_class: 'gate', error_detail: '!! NOT A CLEAN RENDER: 1 preflight check(s) failed', attempt: 1 });
  assert.match(gate, /didn.t pass 1 quality check, so it wasn.t released/);
});
