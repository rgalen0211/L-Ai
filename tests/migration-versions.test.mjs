// Two migration files may never share a version (CC1's HIGH on byod-wide-sql, 2026-10-18).
//
// Supabase keeps ONE row per version in its migration history: two files that start with the same version prefix mean one of them
// fails or is silently skipped on a real database, while a test harness that loads every file in order would never notice. The
// version is the digits before the first underscore of the file name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const MIGRATIONS = path.join(root, 'supabase', 'migrations');

/** Every version that more than one .sql file in `dir` uses, with the files, or []. Also names a file with no usable version. */
export function versionProblems(dir) {
  const byVersion = new Map();
  const problems = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    const m = /^([0-9]{14})_/.exec(f);
    if (!m) { problems.push(`${f}: its name does not start with a 14-digit version and an underscore`); continue; }
    if (!byVersion.has(m[1])) byVersion.set(m[1], []);
    byVersion.get(m[1]).push(f);
  }
  for (const [v, files] of byVersion) if (files.length > 1) problems.push(`version ${v} is used by ${files.length} files: ${files.join(', ')}`);
  return problems;
}

test('CONTROL: no two migration files in the real folder share a version, and every name carries one', () => {
  assert.ok(fs.readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql')).length > 10, 'the real folder is read');
  assert.deepEqual(versionProblems(MIGRATIONS), []);
});

test('MUST-FAIL: two planted files with the same version are caught, naming both; a file with no version is caught; distinct versions pass', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migver-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmp, '20261018000100_connect_ai.sql'), '-- a\n');
  fs.writeFileSync(path.join(tmp, '20261018000100_byod_wide_years.sql'), '-- b\n');
  const caught = versionProblems(tmp);
  assert.equal(caught.length, 1);
  assert.match(caught[0], /version 20261018000100 is used by 2 files: 20261018000100_byod_wide_years\.sql, 20261018000100_connect_ai\.sql/);
  fs.writeFileSync(path.join(tmp, 'notes.sql'), '-- c\n');
  assert.ok(versionProblems(tmp).some(p => /notes\.sql: its name does not start with a 14-digit version/.test(p)), 'a file with no version');
  fs.rmSync(path.join(tmp, '20261018000100_byod_wide_years.sql'));
  fs.rmSync(path.join(tmp, 'notes.sql'));
  fs.writeFileSync(path.join(tmp, '20261018000300_byod_wide_years.sql'), '-- b\n');
  assert.deepEqual(versionProblems(tmp), [], 'CONTROL: the same two files with distinct versions pass');
});
