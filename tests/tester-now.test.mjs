// ROUGH SPOT (Q636, WEB 11-17): #/admin/tester showed only History, so nobody could tell who is a tester NOW without reading it. 'Currently on' is worked out from the same audit rows: the newest row
// for each account decides, and only an account whose newest row turned it on is listed, with when and why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/app-device.js'), { window: win, setTimeout, clearTimeout });
const D = win.ryagramDevice, J = x => JSON.parse(JSON.stringify(x));
const r = (email, on, at, reason = 'because') => ({ user_email: email, was_on: !on, turned_on: on, at, reason, set_by_email: 'admin@x' });

test('the newest row per account decides who is on now; each entry carries since and why', () => {
  const rows = [r('sam@x', false, '2026-11-17T21:21:00Z', 'done'), r('pat@x', true, '2026-11-10T09:00:00Z', 'tries r9'), r('sam@x', true, '2026-10-26T12:00:00Z', 'download test'), r('lee@x', true, '2026-11-12T10:00:00Z', 'film check'), r('pat@x', false, '2026-11-01T09:00:00Z', 'x')];
  const out = J(D.currentlyOn(rows));
  assert.deepEqual(out.map(x => [x.email, x.since, x.why]), [['lee@x', '2026-11-12T10:00:00Z', 'film check'], ['pat@x', '2026-11-10T09:00:00Z', 'tries r9']]);   // sam was turned off last: not listed
});

test('order of the rows given does not matter; nothing on, or unreadable rows, give an empty list', () => {
  const rows = [r('a@x', true, '2026-11-01T00:00:00Z'), r('a@x', false, '2026-11-02T00:00:00Z')];
  assert.deepEqual(J(D.currentlyOn(rows)), []); assert.deepEqual(J(D.currentlyOn(rows.slice().reverse())), []);
  assert.deepEqual(J(D.currentlyOn(undefined)), []); assert.deepEqual(J(D.currentlyOn([null, {}, { user_email: 5 }])), []);
});

test('the page draws the list at the top, above the History, with a Turn off button per row', () => {
  const src = read('assets/app-device.js');
  assert.match(src, /'Currently on'/);
  assert.ok(src.indexOf("'Currently on'") < src.indexOf("h('h2', {}, 'History')"), 'Currently on comes before History');
  assert.match(src, /data-turn-off/);
});
