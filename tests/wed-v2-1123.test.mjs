// web-wed-1123-v2 additions (CC1 coordinator 11-23; GAMES review of f117ea03 LOW1; BUILDER 08:31): every check fails on the old words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('privacy: no waitlist promise of invitations; the Keep me posted form is described as what the code does (email, optional note, the link you came from)', () => {
  const p = read('privacy-policy.html');
  assert.doesNotMatch(p, /Ryagram waitlist|including invitations to try it|cover our website, inquiries and the waitlist/);
  assert.match(p, /<h2>People who ask for Ryagram updates<\/h2>/);
  assert.match(p, /Keep me posted form on the Ryagram page, you provide your email address/);
  const js = read('assets/ryagram.js');
  assert.ok(js.includes('p_email:') && js.includes('p_reason:') && js.includes('p_source:'), 'what the form sends is what the page says it keeps');
});

test('Connect sentence agrees on all four pages: connecting your own AI assistant is not yet in the preview', () => {
  assert.match(read('terms/index.html'), /connecting your own AI assistant/);
  assert.match(read('privacy-policy.html'), /connecting your own AI assistant/);
  assert.match(read('ai-content/index.html'), /connecting your own AI assistant/);
  assert.match(read('help/index.html'), /Connecting your own AI is not yet in the preview\./);
});

test('the sign-in link-expired word says email link, not invite link', () => {
  assert.doesNotMatch(read('assets/app-auth.js'), /That invite link has expired/);
  assert.match(read('assets/app-auth.js'), /That email link has expired or was already used\. If you set a password, sign in; if not, write to ryagram@uselai\.com and tell us the address you signed up with\./);
});

