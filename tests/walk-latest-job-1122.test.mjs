// WEB buying-path walk 11-22 (mock mode): the Version page's "Latest job" card said "Preview: running" / "Final render: claimed" / "Final render: cancelled" (raw state words) while the Jobs list said Rendering / Starting / Cancelled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('LATEST JOB: the Version page card words a job by the same labels as the Jobs list (Starting / Rendering / Cancelled), never the raw state', () => {
  const lib = read('assets/app-library.js');
  const m = /facts\.job\.replaceChildren\(([^\n]*)\);/.exec(lib);
  assert.ok(m, 'the latest-job card is drawn in onJobs');
  assert.match(m[1], /window\.ryagramJobs\.STATE_LABELS\[j\.state\]/, 'job states come from the jobs labels');
  const win = {}; vm.runInNewContext(read('assets/app-jobs.js'), { window: win });
  const L = win.ryagramJobs.STATE_LABELS;
  assert.equal(L.claimed, 'Starting'); assert.equal(L.running, 'Rendering'); assert.equal(L.cancelled, 'Cancelled');
});
