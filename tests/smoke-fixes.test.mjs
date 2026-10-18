// Ryan's smoke-test bugs: (a) a locked button shows not-allowed and says why on hover, (b) a refusal is plain words with the raw text behind "Get help with this",
// (c) a running job whose worker sends nothing reads "Working…" plus how long, not three dashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
vm.runInNewContext(read('assets/app-jobs.js'), { window: win, setTimeout, clearTimeout });
const J = win.ryagramJobs;

test('REFUSALS: known engine messages become plain sentences; code-looking text is dropped; plain text stays; the raw text is kept for the help panel', () => {
  assert.equal(J.plainDetail("$: unknown key 'outro'"), 'The story has a setting Ryagram doesn’t recognise: “outro”. Remove it, or pick a ready-made film and start again.');
  assert.match(J.plainDetail("$.scenes[0].title: unknown key 'colour'"), /recognise: “colour” \(in scenes > 0 > title\)/);
  assert.match(J.plainDetail("$.fps: missing key 'fps'"), /missing a required setting: “fps” \(in fps\)/);
  assert.match(J.plainDetail('$.fps: expected integer, got string'), /wrong kind of value \(in fps\)/);
  assert.equal(J.plainDetail('$.a.b: something odd'), '');
  assert.equal(J.plainDetail('Traceback (most recent call last): boom'), '');
  assert.equal(J.plainDetail('No data for 2031 in this dataset.'), 'No data for 2031 in this dataset.');
  assert.equal(J.plainDetail(null), '');
  const job = { state: 'failed', error_class: 'invalid_input', error_detail: "$: unknown key 'outro'" };
  assert.doesNotMatch(J.problem(job), /\$|unknown key/);
  assert.match(J.problem(job), /recognise: “outro”/);
  assert.equal(J.rawDetail(job), "$: unknown key 'outro'");
  assert.doesNotMatch(J.problem({ state: 'failed', error_class: 'gate', error_detail: '$.x: boom_thing' }), /\$|boom_thing/);
});

test('WORKING: with no stage, count or ETA the view says working and how long; with any of them it keeps the fields', () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  const p = J.progressView({ state: 'running', started_at: '2026-10-03T09:56:00Z', progress_detail: null }, now);
  assert.equal(p.working, true);
  assert.equal(p.elapsed, '4 min');
  const q = J.progressView({ state: 'claimed', created_at: '2026-10-03T09:59:00Z', progress_detail: null }, now);
  assert.deepEqual([q.working, q.elapsed], [true, '1 min']);
  const known = J.progressView({ state: 'running', started_at: '2026-10-03T09:56:00Z', progress_detail: { stage: 'drawing', done: 5, total: 10, unit: 'frames' } }, now);
  assert.equal(known.working, false);
});

test('PAGE: locked run buttons carry data-locked and a title with the reason; the not-allowed cursor is only for those; the failed-job help panel holds the raw text', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /button\.dataset\.locked = 'true'; button\.title = why\[key\]/);
  assert.match(lib, /delete button\.dataset\.locked; button\.removeAttribute\('title'\)/);
  for (const reason of ['A contact sheet is already being made.', 'A preview is already being made.', 'A full render is already being made.']) assert.ok(lib.includes(reason), reason);
  assert.match(lib, /if \(!ladder\.ready\) why\.final = ladder\.missing/);
  assert.ok(lib.includes("p.working") && lib.includes("h('p', { class: 'working' }") && lib.includes('Working' + String.fromCharCode(92) + 'u2026'), 'the working line');
  assert.match(lib, /h\('details', \{ class: 'job-help' \}, h\('summary', \{\}, 'Get help with this'\)/);
  assert.match(lib, /h\('code', \{\}, J\.rawDetail\(j\)\)/);
  assert.match(read('assets/app.css'), /\.button\[data-locked\]:disabled\{cursor:not-allowed\}/);
});
