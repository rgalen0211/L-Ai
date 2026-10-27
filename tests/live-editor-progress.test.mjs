// What the person reads while a final render runs (assets/app-editor-progress.js, NEXT-WEB 152, WORKER 41 part b): numbers, an ETA that is only a guess and never invented,
// a bar that never runs backwards, a plain sentence for a job that went quiet, and no 0-seconds-then-wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(here, '..', 'assets/app-editor-progress.js'), 'utf8'), { window, Number, Math, String, Object, Array, RegExp });
const P = window.ryagramEditorProgress;
const plain = x => JSON.parse(JSON.stringify(x));
const draw = (done, extra = {}) => ({ stage: 'drawing', done, total: 2820, unit: 'frames', eta_s: 360, eta_is_a_guess: true, total_is_provisional: false, ...extra });

test('the headline is the numbers, with thousands separators, and "at least" when the total is provisional', () => {
  const t = new P.Tracker();
  assert.equal(t.feed(draw(1160), 0).headline, 'Drawing frames: 1,160 of 2,820');
  assert.equal(t.feed(draw(1200, { total_is_provisional: true }), 1000).headline, 'Drawing frames: 1,200 of at least 2,820');
  assert.equal(new P.Tracker().feed({ stage: 'encoding', done: 10, total: 100, unit: 'frames' }, 0).headline, 'Putting the video together: 10 of 100');
  assert.equal(new P.Tracker().feed({ stage: 'something-new', done: 1, total: 2 }, 0).headline, 'Working: 1 of 2');            // an unknown stage gets a plain label, no text from the render
});

test('the time left is only a number the worker gave, always marked as a guess, and absent (not invented) when there is none', () => {
  assert.match(new P.Tracker().feed(draw(10), 0).eta, /^about 6 min left \(a guess, rechecked as it runs\)$/);
  assert.equal(new P.Tracker().feed(draw(10, { eta_s: null }), 0).eta, 'working out how long this takes');
  assert.equal(new P.Tracker().feed(draw(10, { eta_s: undefined }), 0).eta, 'working out how long this takes');
  assert.equal(new P.Tracker().feed(draw(10, { eta_s: -5 }), 0).eta, 'working out how long this takes');                          // not a time
  assert.equal(new P.Tracker().feed(draw(10, { eta_s: 'soon' }), 0).eta, 'working out how long this takes');
  assert.doesNotMatch(new P.Tracker().feed(draw(10, { eta_s: 40, eta_is_a_guess: false }), 0).eta, /guess/);                       // the worker says it is not a guess
  assert.match(new P.Tracker().feed(draw(10, { eta_s: 40 }), 0).eta, /^about 40 seconds left \(a guess/);
});

test('it never says "0 seconds" and then waits: the last seconds read "finishing up"', () => {
  for (const s of [0, 1, 4.9]) assert.equal(new P.Tracker().feed(draw(2800, { eta_s: s }), 0).eta, 'finishing up', String(s));
  assert.equal(P.etaWords(3600), 'about 60 min left');
  assert.equal(P.etaWords(5340), 'about 89 min left');
  assert.equal(P.etaWords(5400), 'about 1.5 hours left');
  assert.equal(P.etaWords(7200), 'about 2 hours left');
  assert.equal(P.etaWords(36000), 'about 10 hours left');
});

test('the bar never runs backwards, across a lower reading, a new total and the move to the next stage; and it does not sit at 100% while the video is put together', () => {
  const t = new P.Tracker();
  const f = r => t.feed(r, 0).fraction;
  const a = f(draw(1000)), b = f(draw(2000)), c = f(draw(900));            // a stale or lower report
  assert.ok(b > a);
  assert.equal(c, b);
  const d = f(draw(1500, { total: 5000, total_is_provisional: true }));     // the total grew: the bar holds
  assert.equal(d, b);
  const e = f(draw(2820));
  assert.ok(e <= 0.85 + 1e-9, 'a finished drawing is not the whole job');
  const g = f({ stage: 'encoding', done: 0, total: 100, unit: 'frames' });
  assert.ok(g >= e && g < 1);
  const h = f({ stage: 'encoding', done: 100, total: 100 });
  const i = f({ stage: 'checking', done: 1, total: 2 });
  assert.ok(i >= h && i < 1);
  assert.ok(f({ stage: 'checking', done: 2, total: 2 }) <= 1);
});

test('after drawing, the page says what comes next, so the time left is understood to count all of it', () => {
  assert.match(new P.Tracker().feed(draw(10), 0).then, /Then: putting the video together, then the checks\./);
  assert.match(new P.Tracker().feed({ stage: 'encoding', done: 1, total: 10 }, 0).then, /Then: the checks\./);
  assert.equal(new P.Tracker().feed({ stage: 'checking', done: 1, total: 10 }, 0).then, null);
});

test('a job that stops reporting says so in plain words after two minutes, with when it last did; a new number clears it', () => {
  const t = new P.Tracker();
  assert.equal(t.feed(draw(100), 0).stalled, false);
  assert.equal(t.feed(draw(100), P.STALL_MS - 1).stalled, false);                       // the same numbers, just under the limit
  const v = t.feed(draw(100), P.STALL_MS + 1000);
  assert.equal(v.stalled, true);
  assert.match(v.stalledText, /^Waiting for your computer to report back\. It last reported a moment ago\.$|^Waiting for your computer to report back\. It last reported 2 minutes ago\.$/);
  assert.equal(t.feed(draw(150), P.STALL_MS + 2000).stalled, false);                    // it moved
  assert.match(t.feed(draw(150), P.STALL_MS * 20).stalledText, /It last reported \d+ minutes ago\./);
});

test('before the first report, and after the end', () => {
  const t = new P.Tracker();
  assert.equal(t.feed(null, 0).state, 'waiting');
  assert.equal(t.feed(undefined, 5).headline, 'Waiting for your computer to start.');
  assert.equal(t.feed('nonsense', 5).state, 'waiting');
  t.feed(draw(500), 10);
  t.finish('failed');
  const f = t.feed(draw(900), 20);
  assert.equal(f.state, 'failed');
  assert.match(f.then, /Your draft is as you left it/);
  assert.match(f.then, /Nothing was spent on a film that did not finish/);
  const c = new P.Tracker(); c.finish('cancelled');
  assert.equal(c.feed(null, 0).headline, 'The render was cancelled.');
  const ok = new P.Tracker(); ok.finish('complete');
  assert.deepEqual(plain(ok.feed(null, 0)), { state: 'complete', headline: 'Your film is ready.', fraction: 1, eta: null, then: null, stalled: false, stalledText: null });
});

test('numbers that are not numbers never reach the page', () => {
  const v = new P.Tracker().feed({ stage: 'drawing', done: '<b>9</b>', total: Infinity, unit: '<script>' }, 0);
  assert.equal(v.headline, 'Drawing frames');
  assert.equal(v.fraction, 0);
  const w = new P.Tracker().feed({ stage: 'drawing', done: 5, total: 10, unit: 'frames <img src=x>' }, 0);
  assert.doesNotMatch(w.headline, /[<>]/);
});
