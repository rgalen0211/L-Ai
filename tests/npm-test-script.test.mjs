// CLOUD-SITE 11-02 round 2: `npm test` must run EVERY test file. The old script was `node --test tests/`; Node 22 does not take a folder there (it tries to load the folder as one
// module: "Cannot find module .../tests"), so `npm test` ran NO test file and reported one failure, while `node --test` with no argument ran all of them.
// This test resolves the script's own arguments the way Node 22's runner does (each argument is a file or a glob pattern, never a folder) WITHOUT running the suite (that would
// run this file again), and checks the result is exactly the test files in tests/. It also proves the old script resolved to none of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// the test files on disk (not git's list: a new test file must count before it is committed)
const testFiles = fs.readdirSync(path.join(root, 'tests')).filter((f) => /\.test\.(mjs|cjs|js)$/.test(f)).map((f) => `tests/${f}`).sort();

/** The arguments after `node --test`, quotes removed (npm runs the script through a shell; double quotes keep a glob for Node to expand itself, on Windows too). */
function argsOf(script) {
  const m = /^node --test((?:\s+(?:"[^"]*"|\S+))*)\s*$/.exec(script.trim());
  assert.ok(m, `the test script is not a plain "node --test ...": ${script}`);
  return [...m[1].matchAll(/"([^"]*)"|(\S+)/g)].map((x) => x[1] ?? x[2]).filter((a) => !a.startsWith('--'));
}
/** The test files Node 22 would load for these arguments: each one is a file or a glob; a folder loads nothing (it is an error). */
function filesFor(args) {
  const out = new Set();
  for (const a of args) for (const f of fs.globSync(a, { cwd: root })) { if (fs.statSync(path.join(root, f)).isFile()) out.add(f.split(path.sep).join('/')); }
  return [...out].sort();
}

test('npm test resolves to every test file in tests/, and to nothing else', () => {
  assert.ok(testFiles.length > 100, 'the repo has its test files');
  const args = argsOf(pkg.scripts.test);
  assert.ok(args.length > 0, 'name the files: with no argument Node searches the whole tree');
  for (const a of args) {
    const p = path.join(root, a);
    assert.ok(!(fs.existsSync(p) && fs.statSync(p).isDirectory()), `"${a}" is a folder: Node 22 cannot load a folder as a test, and runs nothing`);
  }
  assert.deepEqual(filesFor(args), testFiles);
});

test('the old script ("node --test tests/") resolved to NO test file: this is what it missed', () => {
  const old = filesFor(argsOf('node --test tests/'));
  assert.deepEqual(old, []);
  assert.ok(testFiles.length > 100, `so it missed all ${testFiles.length} test files`);
});
