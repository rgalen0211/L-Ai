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

// Golden strings: produced by the real ryagram.worker.schema.validate_story (ENGINE, tests/worker_schema.py's probe story) with one planted fault each, 2026-10-18.
const GOLDEN = {
  twoUnknown: "$: unknown key 'outro'; $: unknown key 'description_notes'",
  datasetNotAllowed: "$.sequence.clips[1].dataset: 'not_on_this_worker' is not on this worker's dataset allowlist",
  notOneOf: '$.sequence.fps: "thirty" is not one of 24, 25, 30',
  badView: '$.sequence.clips[1].view: "globe" is not one of "map", "bars", "line", "paired", "panel", "shares"',
  viewNotOffered: "$.sequence.clips[1].view: 'bars' is not offered for cbp_suppression on this worker (offered: line)",
  missingSchema: "$: missing 'schema'",
  wrongType: '$.sequence.clips[1].dataset: expected a string',
  mixed: "$: unknown key 'outro'; $.sequence.fps: \"x\" is not one of 24, 25, 30"
};

test('REFUSALS: every fault in a joined list is put into words (not only the first), each real validate_story message has a sentence, nothing code-like survives, and an unknown fault still gets a plain sentence', () => {
  const p = J.plainDetail;
  const two = p(GOLDEN.twoUnknown);
  assert.match(two, /recognise: “outro”\./);
  assert.match(two, /recognise: “description_notes”\./, 'the second fault is not lost');
  assert.match(p(GOLDEN.datasetNotAllowed), /The dataset “not_on_this_worker” \(in sequence > clip 2 > dataset\) can’t be drawn here\. Pick a dataset from the catalog\./);
  assert.match(p(GOLDEN.notOneOf), /The value “thirty” \(in sequence > fps\) isn’t an allowed choice here\. Allowed: 24, 25, 30\./);
  assert.match(p(GOLDEN.badView), /The value “globe” .*Allowed: map, bars, line, paired, panel, shares\./);
  assert.match(p(GOLDEN.viewNotOffered), /cbp_suppression can’t be drawn as bars \(in sequence > clip 2 > view\)\. It can be drawn as: line\./);
  assert.match(p(GOLDEN.missingSchema), /missing a required setting: “schema”\./);
  assert.match(p(GOLDEN.wrongType), /wrong kind of value/);
  const mixed = p(GOLDEN.mixed);
  assert.match(mixed, /recognise: “outro”/);
  assert.match(mixed, /“x” \(in sequence > fps\) isn’t an allowed choice/);
  for (const g of Object.values(GOLDEN)) assert.doesNotMatch(p(g), /\$|\[\d\]|unknown key|is not one of/, g);
  assert.equal(p('$.some.new.rule: a message nobody has seen'), 'Something in the story (in some > new > rule) wasn’t accepted.');
  assert.match(p('$: boom_thing'), /^Something in the story wasn’t accepted\.$/);
  assert.match(p('Traceback (most recent call last): boom'), /cannot put into plain words/);
  assert.equal(p('No data for 2031 in this dataset.'), 'No data for 2031 in this dataset.');
  assert.equal(p(null), '');
  const many = p(Array.from({ length: 8 }, (_, i) => `$: unknown key 'k${i}'`).join('; '));
  assert.match(many, /And 3 more: open “Get help with this”\.$/);
  const job = { state: 'failed', error_class: 'invalid_input', error_detail: GOLDEN.twoUnknown };
  assert.doesNotMatch(J.problem(job), /\$|unknown key/);
  assert.equal(J.rawDetail(job), GOLDEN.twoUnknown);
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
