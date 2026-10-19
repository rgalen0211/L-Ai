// Local Supabase CLI state (supabase/.temp: the linked project's ref and organisation, the CLI's own version note) is a person's machine state, not source.
// Committing it overwrote another checkout's link on fast-forward (CC1, 2026-10-18). Nothing under supabase/.temp may be tracked, and .gitignore must keep it out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const trackedUnder = (repo, dir) => git(repo, 'ls-files', '--', dir).split('\n').filter(Boolean);

test('no file under supabase/.temp is tracked in this repository', () => {
  assert.deepEqual(trackedUnder(ROOT, 'supabase/.temp'), []);
});

test('.gitignore keeps supabase/.temp out', () => {
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^supabase\/\.temp\/\s*$/m);
});

test('MUST-FAIL: the check does see a tracked file under supabase/.temp (planted in a scratch repository)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-state-'));
  try {
    git(repo, 'init', '-q');
    fs.mkdirSync(path.join(repo, 'supabase', '.temp'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'supabase', '.temp', 'linked-project.json'), '{"ref":"planted"}');
    fs.writeFileSync(path.join(repo, 'supabase', 'ok.sql'), 'select 1;');
    git(repo, 'add', '-f', 'supabase/.temp/linked-project.json', 'supabase/ok.sql');
    assert.deepEqual(trackedUnder(repo, 'supabase/.temp'), ['supabase/.temp/linked-project.json']);
    assert.notDeepEqual(trackedUnder(repo, 'supabase/.temp'), []);          // so the first test above would fail on this repository
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('MUST-FAIL: the ignore rule really ignores a new file there (git check-ignore on a planted path)', () => {
  const out = git(ROOT, 'check-ignore', '-v', 'supabase/.temp/some-new-cli-file.json').trim();
  assert.match(out, /\.gitignore/);
});
