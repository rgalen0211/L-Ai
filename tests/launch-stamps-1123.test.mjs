// Wednesday's launch flips switches in ryagram-config.js and changes the words creator-beta.js writes on /ryagram/. A returning visitor keeps a cached copy of a script
// until its ?v= changes, so a launch file loaded WITHOUT a stamp, or with a stamp that no longer matches its content, can show yesterday's switches or words after a push
// (GAMES 11-23: creator-beta.js had no ?v= on /ryagram/, so an old copy could still rewrite the hero to 'Email to request an invite').
// Same rule as tests/asset-versions.test.mjs and tests/ryagram-stamp.test.mjs, widened to the launch files on both pages:
//   1. every /assets/ script on /ryagram/ and /app/ carries a ?v=, except the files in OLD_UNSTAMPED (frozen: that list may only shrink);
//   2. each LAUNCH file is pinned: its ?v= on every page has a recorded pair in tests/asset-versions.json, and the pair is the file as it is now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const hash = f => crypto.createHash('sha256').update(read(`assets/${f}`).replace(/\r\n/g, '\n')).digest('hex');
const record = JSON.parse(read('tests/asset-versions.json'));

const PAGES = ['ryagram/index.html', 'app/index.html'];
const LAUNCH = ['ryagram-config.js', 'creator-beta.js', 'free-account-line.js'];
// Loaded without a stamp before 11-23 and not changed for Wednesday. Stamp one when you next change it, and take it off this list.
const OLD_UNSTAMPED = new Set(['auth-forward.js', 'analytics-config.js', 'analytics.js', 'funnel.js', 'ryagram-loops.js']);

const scripts = page => [...read(page).matchAll(/<script[^>]*\bsrc="\/assets\/([a-z0-9.-]+\.js)(?:\?v=([0-9a-z]+))?"/g)].map(m => ({ page, file: m[1], v: m[2] || null }));
const all = PAGES.flatMap(scripts);

test('every /assets/ script on /ryagram/ and /app/ has a ?v= stamp (except the frozen old list)', () => {
  const bad = all.filter(s => !s.v && !OLD_UNSTAMPED.has(s.file)).map(s => `${s.page}: /assets/${s.file} has no ?v=`);
  assert.deepEqual(bad, []);
});

test('the frozen old list only shrinks: a file on it that now carries a stamp must come off it', () => {
  const stamped = [...OLD_UNSTAMPED].filter(f => all.some(s => s.file === f) && all.filter(s => s.file === f).every(s => s.v));
  assert.deepEqual(stamped, []);
});

test('each launch file is loaded by the pages that need it', () => {
  for (const [page, file] of [['ryagram/index.html', 'ryagram-config.js'], ['ryagram/index.html', 'creator-beta.js'], ['ryagram/index.html', 'free-account-line.js'],
                              ['app/index.html', 'ryagram-config.js'], ['app/index.html', 'free-account-line.js']]) {
    assert.ok(all.some(s => s.page === page && s.file === file), `${page} no longer loads ${file}; update LAUNCH in this test if that is on purpose`);
  }
});

test('each launch file\'s ?v= has a recorded pair that is the file as it is now (a changed launch file needs a new ?v= on EVERY page and its pair added)', () => {
  const bad = [];
  for (const s of all.filter(x => LAUNCH.includes(x.file))) {
    const want = s.v && record[s.file] && record[s.file][s.v];
    if (!s.v) bad.push(`${s.page}: ${s.file} has no ?v=`);
    else if (!want) bad.push(`${s.page}: ${s.file} ?v=${s.v} has no recorded pair; add "${s.v}": "${hash(s.file)}" under "${s.file}" in tests/asset-versions.json`);
    else if (want !== hash(s.file)) bad.push(`${s.page}: ${s.file} changed but its ?v= is still ${s.v}; bump it on every page and add its pair`);
  }
  assert.deepEqual(bad, []);
});
