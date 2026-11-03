// CLOUD-SITE 11-03: tools/pre-merge-check.mjs, the one command to run before a merge. It must find every test file and every connector mutant runner on its own (a new
// one is picked up without editing the tool), read the node runner's totals, and call the whole run FAIL when any step fails (a SKIP alone is not a failure).
// This test never runs the tool itself (that would run this file again).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nodeTotals, steps, table } from '../tools/pre-merge-check.mjs';

const dir = new URL('./', import.meta.url);
const testFiles = fs.readdirSync(dir).filter((f) => /\.test\.(mjs|cjs)$/.test(f));
const mutants = fs.readdirSync(dir).filter((f) => /^connect_.*mutants\.mjs$/.test(f));

test('the full run has the node tests (every test file), both public-pages audits, the maker check and EVERY connector mutant runner; --quick has no mutants', () => {
  const all = steps();
  const nodeStep = all.find((s) => s[1] === 'node tests');
  assert.deepEqual(nodeStep[2].filter((a) => a.startsWith('tests/')).sort(), testFiles.map((f) => `tests/${f}`).sort());
  for (const n of ['check-public-pages.mjs', 'audit-public-pages.py', 'build-maker-live.mjs --check']) assert.ok(all.some((s) => s[1] === n), n);
  assert.ok(mutants.length >= 10);
  assert.deepEqual(all.filter((s) => s[0] === 'connector mutants').map((s) => s[1]).sort(), mutants.sort());
  const quick = steps({ quick: true });
  assert.ok(!quick.some((s) => s[0] === 'connector mutants' || s[0] === 'page checks'));
  assert.ok(!all.some((s) => s[0].startsWith('sql')), 'no SQL unless a Python is named');
  assert.ok(steps({ sql: 'py' }).some((s) => s[1] === 'test_connect.py' && s[2][0] === 'py'));
});

test('the node totals are read from the runner\'s own lines; the table says FAIL when any step failed, PASS when the rest passed or were skipped', () => {
  assert.deepEqual(nodeTotals('ok 1\n# tests 12\n# suites 0\n# pass 10\n# fail 1\n# cancelled 0\n# skipped 1\n'), { tests: 12, pass: 10, fail: 1, skipped: 1 });
  assert.deepEqual(nodeTotals('nothing'), { tests: null, pass: null, fail: null, skipped: null });
  const row = (result) => ({ group: 'g', name: 'n', result, said: '', secs: 1 });
  assert.match(table([row('PASS'), row('FAIL'), row('SKIP')]).text, /OVERALL: FAIL \(1 passed, 1 failed, 1 skipped\)/);
  assert.equal(table([row('PASS'), row('FAIL')]).failed, 1);
  assert.match(table([row('PASS'), row('SKIP')]).text, /OVERALL: PASS \(1 passed, 0 failed, 1 skipped\)/);
});
