import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// CC1 10:33: a Windows checkout turned the committed block list into CRLF (core.autocrlf=true), so a byte pin passed on one PC and failed on another.
// .gitattributes keeps tools/data/*.json LF on every checkout.
test('tools/data/*.json is LF on every checkout', () => {
  const attrs = fs.readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(attrs, /^tools\/data\/\*\.json text eol=lf$/m);
});
