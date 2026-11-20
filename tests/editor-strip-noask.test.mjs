// The Film row's strip of frames NEVER asks the worker for a window (WORKER 11-20, its review of WEB's filmstrip 12112ed).
// Every window the server has not cached is a film_bundle job on the house worker, and those jump the queue (28 to 85 s each):
// a strip that asked for every window would cost the worker the whole film each time a person opens the editor, and make every
// other person's sheet, preview or film wait. The strip only shows windows the playhead or its read-ahead has brought in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/app-editor-film.js', import.meta.url), 'utf8');

function body(name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} exists`);
  let depth = 0, i = src.indexOf('{', at);
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

test('the strip fills its tiles only from windows that are already ready', () => {
  const fill = body('fillThumbs');
  assert.match(fill, /store\.stateOf\(t\.mid\)/, 'it reads the state of each tile\'s window');
  assert.match(fill, /store\.thumbUri\(t\.mid/, 'and draws a tile from a ready window');
  assert.doesNotMatch(fill, /\.want\(/, 'it never asks the store (so never the worker) for a window');
  assert.doesNotMatch(fill, /fetchWindow|api\.window/, 'nor fetches one any other way');
});

test('laying out the strip asks for nothing either', () => {
  const lay = body('layoutStrip');
  assert.doesNotMatch(lay, /\.want\(|fetchWindow|api\.window/);
});

test('only the playhead and playback ask for windows', () => {
  const calls = [...src.matchAll(/store\.want\(([^)]*)\)/g)].map(m => m[1].trim());
  assert.deepEqual(calls.sort(), ['next', 'position'], `the only window asks are the playhead (position) and playback (next): ${calls}`);
});

test('the page loads this file under a new stamp', () => {
  const index = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(index, /app-editor-film\.js\?v=20261120w/);
});
