// Worker stats lines for #/admin/renders (NEXT-WORKER 58): the formatter only; the rows come from admin_worker_stats(days),
// specified in proposals/WORKER-STATS-ADMIN.md (Ryagram-logs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), { window });
  return window;
}
const O = load('app-ops.js').ryagramOps;

test('one plain line per day: films made, the average, and failures with their codes', () => {
  const r = O.workerStatsLines([
    { day: '2026-10-29', made: 3, failed: 1, avg_min: 4.4, failures: [{ code: 'worker_lost', count: 1 }] },
    { day: '2026-10-28', made: 1, failed: 0, avg_min: 0.4, failures: [] },
    { day: '2026-10-27', made: 0, failed: 2, avg_min: null, failures: [{ code: 'engine_crash', count: 1 }, { code: 'upload_failed', count: 1 }] },
  ]);
  assert.deepEqual([...r.lines], [
    '2026-10-29: 3 films made, average 4 minutes; 1 failed (worker_lost x1).',
    '2026-10-28: 1 film made, average under a minute; none failed.',
    '2026-10-27: 0 films made; 2 failed (engine_crash x1, upload_failed x1).',
  ]);
  assert.equal(r.summary, 'Last 3 days: 4 films made, 3 failed.');
});

test('nothing to show says so; bad rows are dropped, never shown', () => {
  for (const empty of [[], null]) { const e = O.workerStatsLines(empty); assert.equal(e.summary, 'No films in this period.'); assert.equal(e.lines.length, 0); }
  const r = O.workerStatsLines([{ day: '<b>x</b>', made: 9 }, { day: '2026-10-29', made: -3, failed: 'x', failures: 'nope' }]);
  assert.deepEqual([...r.lines], ['2026-10-29: 0 films made; none failed.']);
});

test('a failure code is shown as letters, digits and underscores only, and at most 31 days and 6 codes a day', () => {
  const r = O.workerStatsLines([{ day: '2026-10-29', made: 0, failed: 1, failures: [{ code: '<script>alert(1)</script>', count: 1 }] }]);
  assert.equal(r.lines[0], '2026-10-29: 0 films made; 1 failed (scriptalert1script x1).');
  const many = Array.from({ length: 40 }, (_, i) => ({ day: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, made: 1, failed: 0 }));
  assert.equal(O.workerStatsLines(many).lines.length, 31);
  const codes = Array.from({ length: 9 }, (_, i) => ({ code: `c${i}`, count: 1 }));
  assert.equal((O.workerStatsLines([{ day: '2026-10-29', made: 0, failed: 9, failures: codes }]).lines[0].match(/x1/g) || []).length, 6);
});
