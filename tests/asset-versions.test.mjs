// A changed app script must carry a NEW ?v= in app/index.html, or a returning visitor keeps the old cached file after a deploy (found by CC1 on byod-wide-years: app-uploads.js changed, its ?v= did not).
// tests/asset-versions.json maps every app-*.js the page loads to { ?v= : content hash } pairs. The page's CURRENT ?v= for a script must be in its map, and the hash recorded for it must equal the file as it is now.
// So a bump has to ADD its pair (the test fails until it does), and a later edit without a bump fails for good: the old pair no longer matches the file. Add the pair in the same commit as the change and the bump.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const hash = f => crypto.createHash('sha256').update(read(`assets/${f}`).replace(/\r\n/g, '\n')).digest('hex');
const record = JSON.parse(read('tests/asset-versions.json'));
const loaded = new Map([...read('app/index.html').matchAll(/\/assets\/(app-[a-z-]+\.js)\?v=([0-9a-z]+)/g)].map(m => [m[1], m[2]]));

test('every app script the page loads is in the version record', () => {
  for (const f of loaded.keys()) assert.ok(record[f], `${f} is loaded by app/index.html but missing from tests/asset-versions.json`);
});

test('each app script is loaded with a ?v= whose recorded hash is the file as it is now (a changed script needs a new ?v= and its pair added)', () => {
  const bad = [];
  for (const [f, v] of loaded) {
    const want = record[f] && record[f][v];
    if (!want) bad.push(`${f}: ?v=${v} has no recorded pair; add "${v}": "${hash(f)}" to tests/asset-versions.json`);
    else if (want !== hash(f)) bad.push(`${f}: content changed but ?v= is still ${v}; bump the ?v= in app/index.html and add its pair`);
  }
  assert.deepEqual(bad, []);
});
