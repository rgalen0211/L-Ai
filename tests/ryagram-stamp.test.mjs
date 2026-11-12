// The public /ryagram/ page loads assets/ryagram.js (the waiting-list form). A returning visitor keeps a cached copy unless the script's ?v= changes with it,
// and the old direct-insert door is closed on the assumption that everyone has the new form. Same rule as tests/asset-versions.test.mjs: the page's current ?v= must have a recorded pair, and the pair must match the file now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const hash = crypto.createHash('sha256').update(read('assets/ryagram.js').replace(/\r\n/g, '\n')).digest('hex');
const record = JSON.parse(read('tests/asset-versions.json'))['ryagram.js'] || {};
const tags = [...read('ryagram/index.html').matchAll(/<script[^>]*src="\/assets\/ryagram\.js(\?v=([0-9a-z]+))?"/g)];

test('/ryagram/ loads ryagram.js exactly once, with a ?v= stamp', () => {
  assert.equal(tags.length, 1);
  assert.ok(tags[0][2], 'the ryagram.js tag has no ?v= stamp');
});

test('the stamp has a recorded pair and the pair is the file as it is now (a changed script needs a new ?v= and its pair added)', () => {
  const v = tags[0][2];
  assert.ok(record[v], `?v=${v} has no pair; add "${v}": "${hash}" under "ryagram.js" in tests/asset-versions.json`);
  assert.equal(record[v], hash, 'ryagram.js changed but its ?v= did not; bump it in ryagram/index.html and add its pair');
});
