// The Render panel never lists the editor's own background drawing jobs (film_bundle, labelled 'Film files') (WEB 2026-11-20, Q645 live walk: opening the editor put a FAILED 'Film files' job with raw worker words
// in front of a person who never asked for one). Source pins on assets/app-library.js draw(), plus the label table in app-jobs.js; must-fails: tests/render_hide_film_files_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the job list is drawn from the jobs the person asked for: film_bundle is filtered out, and nothing but that list is drawn', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const shown = jobs\.filter\(j => j\.job_type !== 'film_bundle'\);/);
  assert.match(lib, /listEl\.replaceChildren\(shown\.length\n\s+\? h\('ul', \{ class: 'job-list' \}, shown\.map\(jobItem\)\)/);
  assert.ok(!/h\('ul', \{ class: 'job-list' \}, jobs\.map\(jobItem\)\)/.test(lib), 'the raw jobs list is never drawn');
});

test('the empty-list words still show when only film_bundle jobs exist', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /: h\('p', \{ class: 'form-intro' \}, 'No jobs yet\. Start with a contact sheet\.'\)\);/);
});
