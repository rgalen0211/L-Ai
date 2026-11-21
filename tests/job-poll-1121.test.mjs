// Customer step (WEB 11-21): a free-preview user follows their own film. The Version page's job list must keep reading the job until it ends, one read at a time, and must not
// freeze behind a read that never answers. The behaviour itself is proved in real Chrome (tools/check-job-poll.py); these pin the pieces it stands on, so none is removed unseen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lib = fs.readFileSync(new URL('../assets/app-library.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const panel = lib.slice(lib.indexOf('function jobsPanel('), lib.indexOf("window.addEventListener('hashchange', route)"));

test('JOB POLL: the panel re-reads every 10 s while a job is active or Realtime is not connected', () => {
  assert.match(panel, /setInterval\(\(\) => \{\s*if \(!watch\.live\(\) \|\| jobs\.some\(J\.isActive\) \|\| openOrders\) refresh\(\);[\s\S]*?\}, 10000\);/);
});

test('JOB POLL: one read at a time (a tick while one runs only asks for another pass)', () => {
  assert.match(panel, /if \(running\) \{ again = true; return running; \}/);
});

test('JOB POLL: a read that never answers is given up on after 30 s, and a late answer is never drawn', () => {
  assert.match(panel, /const STUCK_MS = 30000;/);
  assert.match(panel, /Promise\.race\(\[read, gaveUp\]\)/);
  assert.match(panel, /setTimeout\(\(\) => \{ gen\+\+; resolve\(\); \}, STUCK_MS\)/);
  assert.match(panel, /if \(stopped \|\| pass !== gen\) return;/, 'a late answer must not replace the jobs');
  assert.match(panel, /if \(!stopped && pass === gen\) draw\(\);/, 'a late answer must not draw');
  assert.match(panel, /if \(running === mine\) running = null;/, 'giving up must not clear a newer read');
});

test('JOB POLL: leaving the page stops the timer, Realtime and the visibility listener', () => {
  assert.match(panel, /stop\(\) \{ stopped = true; clearInterval\(timer\); watch\.stop\(\); document\.removeEventListener\('visibilitychange', onVisible\);/);
});
