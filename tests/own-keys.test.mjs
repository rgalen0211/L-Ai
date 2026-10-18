// The MED-3 class (CC1 review of engine-profiles): a lookup or "is this key known" check on a key that comes from outside must not be answered by Object.prototype
// ("constructor", "__proto__", "toString"). Found in WEB's own code and fixed with Object.hasOwn; each has a must-fail with the inherited names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-jobs.js'), { window: win, setTimeout, clearTimeout });
const J = win.ryagramJobs;
const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

test('JOB PROGRESS: a stage name the worker reports that is only an inherited name is "unknown", never a function printed on the page', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  const job = stage => ({ state: 'running', started_at: '2026-10-18T09:56:00Z', progress_detail: { stage } });
  assert.equal(J.progressView(job('drawing'), now).stage, 'Drawing frames', 'control');
  for (const bad of INHERITED) {
    const p = J.progressView(job(bad), now);
    assert.equal(p.stage, '—', bad);
    assert.equal(typeof p.stage, 'string', bad);
  }
});

test('GUARD: the places that look a word up by an outside key use Object.hasOwn', () => {
  assert.ok(read('assets/app-uploads.js').includes('!Object.hasOwn(STATES, m.state)'));
  assert.ok(read('assets/app-jobs.js').includes('Object.hasOwn(STAGES, d.stage)'));
  assert.ok(read('assets/preview/preview-edit.js').includes('Object.hasOwn(LIGHT, key)'));
});
