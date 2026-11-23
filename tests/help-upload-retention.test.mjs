// Help must tell the truth about what happens to an uploaded file (WEB 11-22, CONNECT). The upload form asks "Should Ryagram keep this file?" and Store my data is the DEFAULT (kept privately until the person deletes it);
// Don't keep my data deletes it once the final film is made, or after 7 days without activity. So no Help text may say uploaded data is always deleted or that none of it is kept while the Store option exists.
// Two places say it: help/index.html and the app's own help (assets/app-library.js, where an apostrophe is written as a backslash followed by u2019). Must-fails: tests/connect_help_retention_mutants.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const BS = String.fromCharCode(92);                                  // a backslash, so the source's u2019 escape can be matched as text
const lib = read('assets/app-library.js');
const html = read('help/index.html');
const FALSE = /always deleted|none of it is kept|none of (your|their) data (is|was) kept/i;
const helpAnswer = (s) => { const i = s.indexOf('My own data (spreadsheet) won'); return i < 0 ? '' : s.slice(i, i + 900); };
const plain = (s) => s.split(BS + 'u2019').join("'").replace(/’/g, "'");        // one apostrophe everywhere, for comparing

test('the upload form still offers the Store option, as its default, and the Dont-keep option with its 7 days (so the words below can be checked against it)', () => {
  const form = plain(lib);
  assert.ok(form.includes("radio('keep', 'Store my data', 'Kept privately until you delete it"));
  assert.ok(form.includes("radio('dont_keep', 'Don't keep my data', 'Deleted once your final film is made, or after 7 days without activity."));
  assert.ok(lib.includes("checked: value === 'keep'"), 'Store my data is the default');
});

test("no Help text says uploaded data is always deleted or none of it is kept, in the page, its source comment, or the app's own help", () => {
  const page = helpAnswer(html), app = helpAnswer(lib);
  assert.ok(page.length > 100 && app.length > 100, 'both help answers exist');
  assert.ok(!FALSE.test(page), 'help/index.html');
  assert.ok(!FALSE.test(app), "the app's own help");
  const comment = /<!-- source: the upload form[^>]*-->/.exec(html);
  assert.ok(comment, 'the source comment above the answer names the upload form');
  assert.ok(!FALSE.test(comment[0].replace('the old claim that uploaded data is always deleted was false', '')), 'the source comment above the answer is the true one');
});

test("both answers say what the person chooses, in the form's own option names and the 7 days, and keep the unreadable-file clause", () => {
  const CHOICE = "You choose whether Ryagram keeps your file: Store my data keeps it privately until you delete it; Don't keep my data deletes it once your final film is made, or after 7 days without activity.";
  for (const [where, t] of [['help/index.html', plain(helpAnswer(html))], ['the app help', plain(helpAnswer(lib))]]) {
    assert.ok(t.includes("If a file can't be read"), where + ': the unreadable-file clause');
    assert.ok(t.includes('the file is deleted automatically'), where);
    assert.ok(t.includes(CHOICE), where + ": the choice, in the form's own words");
    assert.ok(!/Coming soon/.test(t), where + ': no Coming soon once uploads is on');
  }
});
