// The home page's CRM preview (a 1.9 MB video) is fetched only when it is about to be seen, and its poster is a JPEG, not a 389 KB PNG (tools/audit-page-weight.py, tools/check-home-lazy-video.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

test('HOME VIDEO IS LAZY: no autoplay and no source address until the script arms it; the poster is a small JPEG; the old PNG is gone', () => {
  const html = read('index.html');
  const tag = html.match(/<video[^>]*data-lazy-video[^>]*>/)[0];
  assert.doesNotMatch(tag, /autoplay/);
  assert.match(tag, /preload="none"/);
  assert.match(tag, /poster="assets\/crm-room-preview-poster\.jpg"/);
  assert.match(html, /<source data-src="assets\/crm-room-preview\.webm" type="video\/webm">/);
  assert.doesNotMatch(html, /<source src="assets\/crm-room-preview\.webm"/, 'a plain src would make every first visit download it');
  assert.match(html, /<script src="\/assets\/lazy-video\.js\?v=20261019a" defer><\/script>/);
  assert.ok(fs.statSync(new URL('assets/crm-room-preview-poster.jpg', root)).size < 100 * 1024, 'the poster stays small');
  assert.ok(!fs.existsSync(new URL('assets/crm-room-preview-poster.png', root)), 'the 389 KB PNG is not shipped any more');
});

test('LAZY SCRIPT: starts the video when it is about to be seen, and honours reduce motion (the poster stays, the player shows its own controls)', () => {
  const js = read('assets/lazy-video.js');
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /setAttribute\('controls', ''\)/);
  assert.doesNotMatch(js, /eval\(|innerHTML|document\.write/);
});
