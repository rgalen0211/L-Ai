// Launch polish found by the live walk of the public pages (WEB 11-18, with GAMES' tap-size finding): the report form preselects nothing, the hero 'Watch the full film' link is a 44 px target,
// and the sign-in page puts "Have an invite code?" with the other two links UNDER the card, not above it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the report form preselects no problem: a person who skims is asked to choose, and the page says so kindly', () => {
  const html = read('report/index.html');
  assert.equal((html.match(/<input type="radio" name="reason"/g) || []).length, 5);
  assert.doesNotMatch(html, /name="reason"[^>]*\bchecked\b/);
  assert.match(read('assets/report.js'), /Choose what the problem is\./);
});

test('the hero caption link on /ryagram/ is a 44 px tap target (padding, so the sentence keeps its line height)', () => {
  assert.match(read('assets/ryagram.css'), /\.rg-hero-film figcaption a\{font-weight:700;padding:13px 2px\}/);
  assert.match(read('ryagram/index.html'), /ryagram\.css\?v=20261118a/);
});

test('sign-in page order: the card, then Forgot your password, then Have an invite code (and its form), then the help lines', () => {
  const html = read('app/index.html');
  const at = id => { const i = html.indexOf(`id="${id}"`); assert.ok(i > 0, id); return i; };
  assert.ok(at('sign-in-form') < at('forgot-row') && at('forgot-row') < at('invite-row') && at('invite-row') < at('invite-form') && at('invite-form') < html.indexOf('class="form-note sign-in-help"'));
});
