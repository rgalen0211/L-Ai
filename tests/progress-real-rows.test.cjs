// The render panel's progress fields, replayed over REAL job rows: a real engine preview rendered
// while WORKER's progress reader fed the real heartbeat on a local Postgres built from these
// migrations, and the row was read back as its owner every ~2 s (tests/fixtures/progress/).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/app-jobs.js'), 'utf8'), { window });
const J = window.ryagramJobs;
const REC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/progress/real-preview-rows.json'), 'utf8'));
const D = '—';

test('the recording is a real run: the engine finished and the heartbeat carried detail', () => {
  assert.equal(REC.engine_exit, 0);
  assert.ok(REC.heartbeats_with_detail >= 10, `${REC.heartbeats_with_detail} heartbeats`);
  const stages = new Set(REC.rows.map(r => r.row.progress_detail?.stage).filter(Boolean));
  assert.ok(stages.has('drawing'), [...stages].join(','));
});

test('replayed in order, every field is what the row says, or "—"; never NaN or infinity', () => {
  let seen = [];
  let sawData = false;
  for (const { read_at, row } of REC.rows) {
    const now = Date.parse(read_at);
    seen = J.addSample(seen, row, now);
    const p = J.progressView(row, now, seen);
    if (!p) continue;                                      // the job has left the active states
    const d = row.progress_detail;
    if (!d) {
      assert.deepEqual([p.stage, p.count, p.eta], [D, D, D], read_at);       // no data yet
      continue;
    }
    sawData = true;
    if (d.total > 0 && d.done != null) {
      assert.equal(p.count, `${Number(d.done).toLocaleString('en-US')} / ${Number(d.total).toLocaleString('en-US')}`);
    } else {
      assert.equal(p.count, D);
    }
    assert.match(p.eta, /^(—|~\d+ min left in this step|~\d+ h( \d+ min)? left in this step)$/, read_at);
    assert.doesNotMatch(JSON.stringify(p), /NaN|Infinity|undefined/);
  }
  assert.ok(sawData);
});

test('the ETA from elapsed time and frames done tracks when drawing really finished', () => {
  const rows = REC.rows.map(r => ({ at: Date.parse(r.read_at), row: r.row }));
  const drawing = rows.filter(r => r.row.progress_detail?.stage === 'drawing');
  // When drawing really ended: the first read showing a later stage, or all frames drawn.
  const end = rows.find(r => r.at > drawing[0].at && (r.row.progress_detail?.stage !== 'drawing'
    || r.row.progress_detail.done >= r.row.progress_detail.total));
  assert.ok(end, 'drawing finished inside the recording');
  let seen = [];
  const checked = [];
  for (const r of drawing) {
    seen = J.addSample(seen, r.row, r.at);
    const eta = J.etaSeconds(seen, r.at);
    if (eta == null || r.at - drawing[0].at < 30000) continue;   // the first 30 s are too noisy to judge
    const actual = (end.at - r.at) / 1000;
    checked.push({ eta, actual });
    assert.ok(Number.isFinite(eta) && eta >= 0);
    // Within a factor of two of the truth, allowing 15 s of slack for the 2 s read interval and
    // the worker's heartbeat cadence.
    assert.ok(eta <= 2 * actual + 15 && actual <= 2 * eta + 15, `predicted ${eta.toFixed(0)} s, really ${actual.toFixed(0)} s`);
  }
  assert.ok(checked.length >= 5, `${checked.length} ETAs checked`);
});
