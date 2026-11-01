// Every script the app page loads must at least parse. A merge once left a block without its closing brace and no test noticed, because the other tests read the files as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('every /assets script that app/index.html loads parses', () => {
  const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const files = [...html.matchAll(/<script src="(\/assets\/[^"?]+)/g)].map(m => m[1]);
  assert.ok(files.length > 10, 'the page lists its scripts');
  for (const f of files) {
    const src = fs.readFileSync(new URL(`..${f}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: f }), f);
  }
});
