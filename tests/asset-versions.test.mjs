// A changed app script must carry a NEW ?v= in app/index.html, or a returning visitor keeps the old cached file after a deploy (found by CC1 on byod-wide-years: app-uploads.js changed, its ?v= did not).
// tests/asset-versions.json records, for every app-*.js the page loads, the ?v= and the content hash the LIVE site had when it was last recorded. When a script's content differs from the record, the page's ?v= must differ too.
// After a bump (and a deploy), update the record with the new version and hash so the next change is compared with it.
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

test('a changed app script has a new ?v= (a returning visitor must not keep the old file)', () => {
  const stale = [];
  for (const [f, v] of loaded) {
    if (!record[f]) continue;
    if (hash(f) !== record[f].sha256 && v === record[f].v) stale.push(`${f}: content changed but ?v= is still ${v}`);
  }
  assert.deepEqual(stale, []);
});
