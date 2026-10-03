const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createFakeClient } = require('./fake-supabase.js');
const { createMockWorker, OUTCOMES } = require('./mock-worker.js');

function load(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), { window });
  return window;
}
const J = load('app-jobs.js').ryagramJobs;
const ryagramData = load('app-data.js').ryagramData;

async function setup() {
  const client = createFakeClient();
  const data = ryagramData(client);
  const { version } = await data.createProject('Story');
  await data.saveStory(version.id, { schema: 1, engine: 'sequence', name: 's' });
  const worker = createMockWorker(client);
  const until = async (jobId, done) => {
    for (let i = 0; i < 50; i++) {
      const j = client.db.jobs.find(x => x.id === jobId);
      if (done(j)) return j;
      worker.tick();
    }
    throw new Error('job never settled');
  };
  return { client, data, version, worker, until };
}
const plain = v => JSON.parse(JSON.stringify(v));
const finished = j => ['complete', 'failed', 'editorial_action_required', 'cancelled'].includes(j.state);

test('every mock outcome ends the way the real queue would', async () => {
  const expected = {
    succeed: ['complete', null, 1],
    crash_once: ['complete', null, 2],
    crash_always: ['failed', 'infrastructure', 3],
    gate: ['editorial_action_required', 'gate', 1],
    timeout: ['failed', 'timeout', 1],
    invalid: ['failed', 'invalid_input', 1],
    limit: ['failed', 'limit', 1]
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(OUTCOMES).sort());
  for (const [outcome, [state, errorClass, attempts]] of Object.entries(expected)) {
    const { client, data, version, worker, until } = await setup();
    worker.setOutcome(outcome);
    const job = await data.submitJob(version.id, 'preview', { window_s: [0, 8] });
    const seen = new Set();
    const end = await until(job.id, j => { seen.add(j.state); return finished(j); });
    assert.equal(end.state, state, outcome);
    assert.equal(end.error_class, errorClass, outcome);
    assert.equal(end.attempt, attempts, outcome);
    if (outcome === 'succeed') {
      assert.deepEqual([...seen].filter(s => s !== 'complete'), ['queued', 'claimed', 'running', 'validating', 'uploading']);
      assert.deepEqual(client.db.artifacts.map(a => a.kind).sort(), ['preview', 'thumbnail']);
    }
    // Each ending gets a readable sentence; only repeatable failures offer Try again.
    const message = J.problem(end);
    if (state !== 'complete') assert.ok(message.length > 20, outcome);
    const jobs = await data.listJobs(version.id);
    assert.equal(J.canRetry(jobs[0], 'draft', jobs), outcome === 'crash_always', outcome);
  }
});

test('the final render unlocks only after a sheet and preview of the current story', async () => {
  const { data, version, until } = await setup();
  let jobs = await data.listJobs(version.id);
  assert.equal(J.ladder(jobs, 'x').missing, 'Make a contact sheet and a preview of this story first.');

  const sheet = await data.submitJob(version.id, 'contact_sheet', { periods: ['2016', '2018', '2020'] });
  await until(sheet.id, finished);
  const preview = await data.submitJob(version.id, 'preview', { window_s: [0, 10] });
  await until(preview.id, finished);
  const { version: v } = await data.getVersion(version.id);
  jobs = await data.listJobs(version.id);
  const ladder = J.ladder(jobs, v.story_sha256);
  assert.equal(ladder.ready, true);
  assert.equal(ladder.sheet.id, sheet.id);

  // Editing the story makes the old sheet and preview stale, in the UI and in the database.
  const saved = await data.saveStory(version.id, { schema: 1, engine: 'sequence', name: 'edited' });
  assert.equal(J.ladder(jobs, saved.story_sha256).ready, false);
  await assert.rejects(data.submitJob(version.id, 'final_render', {}, { sheetJobId: sheet.id, previewJobId: preview.id }),
                       /must both be complete, for this exact story/);
});

test('a final render locks the version, and its outcome becomes the version state', async () => {
  const { client, data, version, worker, until } = await setup();
  const sheet = await data.submitJob(version.id, 'contact_sheet', {});
  await until(sheet.id, finished);
  const preview = await data.submitJob(version.id, 'preview', { window_s: [0, 10] });
  await until(preview.id, finished);
  worker.setOutcome('gate');
  const final = await data.submitJob(version.id, 'final_render', {}, { sheetJobId: sheet.id, previewJobId: preview.id });
  assert.equal(client.db.versions[0].state, 'queued');
  await assert.rejects(data.saveStory(version.id, {}), /locked \(queued\)/);
  await until(final.id, finished);
  assert.equal(client.db.versions[0].state, 'editorial_action_required');
});

test('files from a job that did not complete are never listed', async () => {
  const { client, data, version, until } = await setup();
  const done = await data.submitJob(version.id, 'preview', { window_s: [0, 10] });
  await until(done.id, finished);
  const stuck = await data.submitJob(version.id, 'contact_sheet', {});
  client.db.artifacts.push({ id: 'partial', job_id: stuck.id, version_id: version.id, kind: 'contact_sheet',
                             storage_path: 'x/sheet.png', deleted_at: null, created_at: client.now() });
  Object.assign(client.db.jobs.find(j => j.id === stuck.id), { state: 'cancelled' });
  const { artifacts } = await data.getVersion(version.id);
  assert.deepEqual(artifacts.map(a => a.kind).sort(), ['preview', 'thumbnail']);
});

test('a complete version takes no new jobs; a failed one may retry', async () => {
  assert.equal(J.versionTakesJobs('complete'), false);
  assert.equal(J.versionTakesJobs('failed'), true);
  const { client, data, version } = await setup();
  client.db.versions[0].state = 'complete';
  await assert.rejects(data.submitJob(version.id, 'preview', { window_s: [0, 10] }), /complete and cannot take new jobs/);
});

test('cancel stops a queued job at once and a running one at its next step', async () => {
  const { data, version, worker, until } = await setup();
  worker.pause();
  const queued = await data.submitJob(version.id, 'preview', { window_s: [0, 10] });
  assert.equal(await data.queuePosition(queued.id), 1);
  assert.equal((await data.cancelJob(queued.id)).state, 'cancelled');
  worker.resume();
  const running = await data.submitJob(version.id, 'preview', { window_s: [0, 10] });
  await until(running.id, j => j.state === 'running');
  assert.equal((await data.cancelJob(running.id)).cancel_requested, true);
  assert.equal((await until(running.id, finished)).state, 'cancelled');
  const jobs = await data.listJobs(version.id);
  assert.equal(J.canRetry(jobs[0], 'draft', jobs), true);
  assert.equal(J.problem(jobs[0]), 'Cancelled.');
});

test('queue positions count everyone ahead; submit refuses a second job of the same kind', async () => {
  const { data, version, worker } = await setup();
  worker.pause();
  const a = await data.submitJob(version.id, 'contact_sheet', {});
  await assert.rejects(data.submitJob(version.id, 'preview', {}), /A preview needs window_s/);   // the worker would reject it
  const b = await data.submitJob(version.id, 'preview', { window_s: [0, 10] });
  assert.deepEqual([await data.queuePosition(a.id), await data.queuePosition(b.id)], [1, 2]);
  await assert.rejects(data.submitJob(version.id, 'preview', { window_s: [0, 10] }), /already in progress/);
  await assert.rejects(data.submitJob(version.id, 'preview', { cmd: 'x' }), /Unknown parameter/);
  assert.equal(J.progressNote({ state: 'queued', attempt: 1 }, 2), 'Number 2 in line.');
  assert.match(J.progressNote({ state: 'queued', attempt: 2 }, 1), /Next in line\. Retrying .*attempt 2 of 3/);
});

test('Realtime tells the page about changes, and says when it is live', async () => {
  const { data, version } = await setup();
  let calls = 0;
  const watch = data.watchJobs(version.id, () => calls++);
  assert.equal(watch.live(), false);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(watch.live(), true);
  await data.submitJob(version.id, 'preview', { window_s: [0, 10] });
  assert.equal(calls, 1);
  watch.stop();
  await data.submitJob(version.id, 'contact_sheet', {});
  assert.equal(calls, 1);
  assert.equal(watch.live(), false);
});

test('retry is offered only where repeating can help', () => {
  const failed = cls => ({ job_type: 'preview', state: 'failed', error_class: cls });
  assert.equal(J.canRetry(failed('infrastructure'), 'draft', []), true);
  for (const cls of ['gate', 'invalid_input', 'timeout', 'limit']) assert.equal(J.canRetry(failed(cls), 'draft', []), false, cls);
  assert.equal(J.canRetry(failed('infrastructure'), 'queued', []), false);            // version busy
  assert.equal(J.canRetry(failed('infrastructure'), 'draft', [{ job_type: 'preview', state: 'running' }]), false);
  assert.equal(J.canRetry({ ...failed('infrastructure'), job_type: 'final_render' }, 'failed', []), true);
  const old = { ...failed('infrastructure'), id: 'a', created_at: '2026-09-28T10:00:00Z' };
  const newer = { job_type: 'preview', state: 'complete', id: 'b', created_at: '2026-09-28T11:00:00Z' };
  assert.equal(J.canRetry(old, 'draft', [newer, old]), false);                          // superseded
});

test('run inputs are checked before anything is sent', () => {
  assert.deepEqual(J.parsePeriods('').value, null);
  assert.deepEqual(JSON.parse(JSON.stringify(J.parsePeriods('2016, 2018 2020').value)), ['2016', '2018', '2020']);
  for (const bad of ['2016, 2018', '2016,2017,2018,2019,2020,2021', '2016, 18, 2020', '2016-03, 2017, 2018']) {
    assert.ok(J.parsePeriods(bad).error, bad);
  }
  assert.deepEqual(J.parseWindow('', '').value, null);
  assert.deepEqual(JSON.parse(JSON.stringify(J.parseWindow('2', '12').value)), [2, 12]);
  for (const [a, b] of [['2', '13'], ['5', '5'], ['-1', '3'], ['1', ''], ['x', '3']]) assert.ok(J.parseWindow(a, b).error, `${a}-${b}`);
});

test('the final render waits for one engine version across sheet, preview and worker', async () => {
  const { client, data, version, until } = await setup();
  const sheet = await data.submitJob(version.id, 'contact_sheet', {});
  await until(sheet.id, finished);
  client.engineCommit = 'f00dfee';                               // Ryan updates the worker
  const preview = await data.submitJob(version.id, 'preview', { window_s: [0, 10] });
  await until(preview.id, finished);
  const { version: v } = await data.getVersion(version.id);
  let jobs = await data.listJobs(version.id);
  let ladder = J.ladder(jobs, v.story_sha256, await data.currentEngine());
  assert.equal(ladder.ready, false);
  assert.match(ladder.missing, /different versions of the engine/);
  await assert.rejects(data.submitJob(version.id, 'final_render', {}, { sheetJobId: sheet.id, previewJobId: preview.id }),
                       /from the same engine version/);

  const sheet2 = await data.submitJob(version.id, 'contact_sheet', {});
  await until(sheet2.id, finished);
  jobs = await data.listJobs(version.id);
  ladder = J.ladder(jobs, v.story_sha256, await data.currentEngine());
  assert.equal(ladder.ready, true);
  assert.equal(ladder.sheet.id, sheet2.id);

  client.engineCommit = 'beefcafe0';                             // updated again after the preview
  const other = await data.submitJob(version.id, 'contact_sheet', {});   // any job reveals the new engine
  await until(other.id, finished);
  jobs = await data.listJobs(version.id);
  ladder = J.ladder(jobs, v.story_sha256, await data.currentEngine());
  assert.equal(ladder.ready, false);
  assert.match(ladder.missing, /engine has been updated since this preview/);
});

test('engine checks: unknown current engine only compares sheet and preview; a preview without one is refused', () => {
  const job = (type, commit, at) => ({ id: type + at, job_type: type, state: 'complete', story_sha256: 's', engine_commit: commit,
                                     created_at: `2026-09-29T0${at}:00:00Z` });
  assert.equal(J.ladder([job('contact_sheet', 'aaa1111', 1), job('preview', 'aaa1111', 2)], 's', null).ready, true);
  assert.match(J.ladder([job('contact_sheet', 'aaa1111', 1), job('preview', null, 2)], 's').missing, /no engine version recorded/);
  // An older sheet from the preview's engine still counts; the newest sheet needn't be it.
  const l = J.ladder([job('contact_sheet', 'aaa1111', 1), job('contact_sheet', 'bbb2222', 3), job('preview', 'aaa1111', 2)], 's', 'aaa1111');
  assert.equal(l.ready, true);
  assert.equal(l.sheet.id, 'contact_sheet1');
});

test('live progress: every field is "—" until the data gives it; never a made-up number', () => {
  const D = '—';
  const now = Date.parse('2026-10-03T10:00:00Z');
  const job = (detail, extra = {}) => ({ state: 'running', started_at: '2026-10-03T09:56:00Z', progress_detail: detail, ...extra });
  // Nothing yet: claimed, no detail, no start time.
  assert.deepEqual(plain(J.progressView({ state: 'claimed', progress_detail: null }, now)),
    { stage: D, countLabel: 'Frames', count: D, fraction: null, eta: D, running: D });
  // A stage with no count (the data build, encoding): the stage, and dashes for the rest.
  let p = J.progressView(job({ stage: 'starting' }), now);
  assert.deepEqual([p.stage, p.count, p.eta, p.running], ['Building the data', D, D, '4 min']);
  p = J.progressView(job({ stage: 'encoding', done: 0, total: null }), now);
  assert.deepEqual([p.stage, p.count, p.fraction], ['Encoding the film', D, null]);
  // A count, but only one sighting: no ETA. The engine's own eta_s is not used.
  const drawing = done => job({ stage: 'drawing', done, total: 3000, unit: 'frames', eta_s: 999, eta_is_a_guess: true });
  let seen = J.addSample([], drawing(1200), now);
  p = J.progressView(drawing(1200), now, seen);
  assert.deepEqual([p.stage, p.countLabel, p.count, p.fraction, p.eta], ['Drawing frames', 'Frames', '1,200 / 3,000', 0.4, D]);
  // 3 s later: still too soon to call a rate.
  seen = J.addSample(seen, drawing(1230), now + 3000);
  assert.equal(J.progressView(drawing(1230), now + 3000, seen).eta, D);
  // 60 s after the first sighting, 600 more frames: 10 frames/s, 1,200 left -> 2 min.
  seen = J.addSample(seen, drawing(1800), now + 60000);
  assert.equal(J.progressView(drawing(1800), now + 60000, seen).eta, '~2 min left in this step');
  // Unchanged reads add nothing; a near-done stage still floors at ~1 min.
  assert.equal(J.addSample(seen, drawing(1800), now + 61000), seen);
  seen = J.addSample(seen, drawing(2995), now + 180000);
  assert.equal(J.progressView(drawing(2995), now + 180000, seen).eta, '~1 min left in this step');
  // A new stage starts its own count: no ETA carried over from drawing.
  const checks = job({ stage: 'checks', done: 1, total: 5, unit: 'clips' });
  seen = J.addSample(seen, checks, now + 200000);
  p = J.progressView(checks, now + 200000, seen);
  assert.deepEqual([p.stage, p.countLabel, p.count, p.eta], ['Checking the film against its data', 'Clips', '1 / 5', D]);
  // A count that doesn't move gives no ETA (no division by zero, no infinity).
  const stuck = J.addSample(J.addSample([], drawing(10), now), drawing(10), now + 30000);
  assert.equal(J.etaSeconds(stuck, now + 30000), null);
  // A count that stops moving: the ETA grows with the wait instead of standing still.
  const burst = J.addSample(J.addSample([], drawing(0), now), drawing(900), now + 6000);   // 150 frames/s
  assert.equal(Math.round(J.etaSeconds(burst, now + 6000)), 14);     // 2,100 left at 150/s
  assert.equal(Math.round(J.etaSeconds(burst, now + 36000)), 84);    // 900 in 36 s = 25/s -> 2,100 / 25
  assert.equal(J.etaSeconds([]), null);
  // Garbage in the detail is not a count.
  for (const d of [{ stage: 'drawing', done: 5, total: 0 }, { stage: 'drawing', done: -1, total: 10 }, { stage: 'hacking', done: 1, total: 2 },
                   { stage: 'drawing', done: 'x', total: 10 }, { stage: 'drawing', total: 10 }]) {
    assert.equal(J.progressView(job(d), now).count, D, JSON.stringify(d));
  }
  for (const j of [{ state: 'queued' }, { state: 'complete' }, { state: 'running', cancel_requested: true }]) assert.equal(J.progressView(j, now), null);
  assert.equal(J.progressView(job({ stage: 'starting' }, { started_at: '2026-09-28T00:00:00Z' }), now).running, D);   // clock problem
});

test('jobs load without progress_detail until its SQL is applied', async () => {
  const calls = [];
  const fakeQuery = cols => {
    calls.push(cols);
    const res = cols.includes('progress_detail')
      ? { data: null, error: { message: 'column jobs.progress_detail does not exist' } }
      : { data: [{ id: 'j1' }], error: null };
    const q = { select: () => q, eq: () => q, order: () => Promise.resolve(res) };
    return q;
  };
  const data = ryagramData({ from: () => ({ select: cols => fakeQuery(cols) }) });
  assert.deepEqual(await data.listJobs('v'), [{ id: 'j1' }]);
  assert.deepEqual(await data.listJobs('v'), [{ id: 'j1' }]);
  assert.equal(calls.filter(c => c.includes('progress_detail')).length, 1);      // asked once, then remembered
});
