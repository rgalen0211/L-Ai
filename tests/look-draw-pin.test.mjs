// The engine's look drawer (assets/preview/look-draw.js, NEXT-ENGINE 35) is vendored, pinned and drawing-only: the pin file names the Ryagram commit and the file's hash, the bytes are LF,
// the file holds no network, DOM, storage or dynamic-code calls, and it loads on its own and offers the API the editor is written against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bytes = fs.readFileSync(path.join(here, '..', 'assets/preview/look-draw.js'));
const pin = fs.readFileSync(path.join(here, '..', 'assets/preview/look-draw.PIN'), 'utf8');

test('the pin file names the engine commit and the hash of the file as vendored, and the bytes are LF', () => {
  assert.match(pin, /Ryagram branch live-look-engine(-2)? @ [0-9a-f]{7,}/);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), pin.match(/sha256 ([0-9a-f]{64})/)[1]);
  assert.equal(String(bytes.length), pin.match(/\n(\d+) bytes, LF/)[1]);
  assert.ok(!bytes.includes(13), 'LF only');
});

test('the drawer holds drawing code only: no network, no DOM, no storage, no dynamic code', () => {
  const text = bytes.toString('utf8');
  for (const word of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'document.', 'eval(', 'new Function', 'importScripts', 'import(', 'navigator.']) {
    assert.ok(!text.includes(word), `contains ${word}`);
  }
});

test('it loads on its own and offers the API the editor uses', () => {
  const ctx = { Math, Number, String, Object, Array, JSON, parseFloat, isFinite, Error };
  ctx.globalThis = ctx;
  vm.runInNewContext(bytes.toString('utf8'), ctx);
  const L = ctx.RyagramLook;
  for (const name of ['draw', 'drawFrame', 'marks', 'describe', 'lookFromStory', 'frameAt']) assert.equal(typeof L[name], 'function', name);
});
