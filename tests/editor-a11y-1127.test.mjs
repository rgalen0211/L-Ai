// WEB 2026-11-27: the clip film editor walk's screen-reader findings. The time slider says its place in plain words; a trim or a move says what it did on the polite status line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = read('assets/app-editor.js');

test('the time slider reads out seconds in plain words, not a clock', () => {
  assert.match(src, /const plainSecs = v =>/);
  assert.match(src, /`\$\{plainSecs\(position\)\} seconds of \$\{plainSecs\(ed\.state\.duration\)\}`/);
  assert.doesNotMatch(src, /aria-valuetext', isData[^;]*`\$\{mmss\(position\)\} of/);
  const plainSecs = new Function('return ' + /const plainSecs = (v => [^;]*);/.exec(src)[1])();
  assert.equal(plainSecs(12.44), '12.4'); assert.equal(plainSecs(46), '46'); assert.equal(plainSecs(undefined), '0');
});

test('an accepted trim, move or reorder says what it did; a refusal still says why', () => {
  assert.match(src, /say\(r\.ok \? doneWords\(op, before\) : r\.reason\)/);
  assert.match(src, /Trimmed the clip to \$\{plainSecs\(c\.len\)\} seconds\./);
  assert.match(src, /Moved the clip to start at \$\{plainSecs\(c\.start\)\} seconds\./);
  assert.match(src, /Moved the clip \$\{at > before \? 'later' : 'earlier'\}, now number/);
  assert.match(src, /role: 'status'/);
});

test('the page loads the changed script under its new stamp', () => {
  assert.match(read('app/index.html'), /app-editor\.js\?v=20261127l1/);
});
