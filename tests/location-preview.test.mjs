// The made-up site-check picture on the Geographic Intelligence Coming soon page (CC1 for Claude 15:30 item 3, 11-04; draft words in proposals\CC1-LOCATION-PAGE-WORDS-DRAFT.md).
// The real Dayton demo is OpenStreetMap data, private until attorney row G11, so the page may only ever show MADE-UP places and numbers, behind a switch that is OFF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const src = read('assets/app-departments.js');
const pic = src.match(/function locationPicture\(\) \{[\s\S]*?\n    \}/)[0];

test('the switch is OFF by default and needs exactly true', () => {
  assert.match(read('assets/ryagram-config.js'), /\n  locationPreview: false,\n/);
  assert.match(src, /const locationPreviewOn = cfg => !!cfg && cfg\.locationPreview === true;/);
  assert.match(src, /id === 'geo_intelligence' && locationPreviewOn\(window\.ryagramConfig\) \? locationPicture\(\) : null/);
});

test('every line of the picture is made up and says so, and each number carries its label', () => {
  const lines = [...pic.matchAll(/h\('p', \{[^}]*\}, '([^']+)'\)/g)].map(m => m[1]);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /made-up/); assert.match(lines[4], /made-up places and numbers, not a real place and not a screenshot/);
  assert.match(lines[1], /\(Calculated, from made-up census areas\)$/);
  assert.match(lines[2], /\(Observed, on a made-up map\)$/);
  assert.match(lines[3], /\(Estimated, method shown\)$/);
  assert.ok(lines.slice(1, 4).every(l => /made-up|Estimated/.test(l)), 'no number without "made-up" or "Estimated" beside it');
});

test('no real place, no picture from anywhere, no score or verdict', () => {
  assert.ok(!/Dayton|Montgomery|Ohio|Riverside|Clayton|Trotwood|Kettering|Miamisburg/i.test(pic), 'no real place name');
  assert.ok(!/<img|src:|url\(|https?:|\.png|\.jpg|\.svg|innerHTML/.test(pic), 'text only, drawn here, nothing loaded');
  assert.ok(!/score|best|rank|allowed|permitted|will succeed|guarantee/i.test(pic), 'no score, ranking or verdict words');
  assert.match(pic, /role: 'img', 'aria-label': 'An illustration of a site check on a made-up map'/);
});
