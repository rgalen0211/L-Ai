// The intake question must not promise a film: the app that makes it is not open to everyone yet (FACES-COMPILATIONS-HONEST-LAUNCH-WORDS-1127; FOR RYAN'S YES).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'assets/app-intake.js'), 'utf8');
test('INTAKE WORDS: the compilation choice says a request is saved and that the app is not open to everyone yet, and never that Ryagram strings the clips together', () => {
  const m = src.match(/id: 'compilation'.*?blurb: '([^']*)'/);
  assert.ok(m, 'the compilation blurb is there');
  assert.ok(m[1].split(/\s+/).length < 20, 'under 20 words');
  assert.match(m[1], /Save a request for a phrase/);
  assert.match(m[1], /not open to everyone yet/);
  assert.doesNotMatch(m[1], /strings together/);
  assert.match(fs.readFileSync(path.join(root, 'app/index.html'), 'utf8'), /app-intake\.js\?v=20261127x2/);
});
