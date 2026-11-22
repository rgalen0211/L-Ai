// A person who cannot connect an AI is told the truth in plain words (CONNECT 2026-11-22, CC1 12:12 routing): never "invite-only" and never "ask Ryan". With open-to-all on, the only accounts refused are accounts still
// waiting for admission, so the words say it is not open to THIS account yet and where to write. The consent page's own refusal text lives in a live migration (not changed here); the page now shows its own words whenever
// the server says the account is not allowed to connect (invited false). Reads app-connect.js, the listing and the guide; talks to nothing. Must-fails: tests/connect_not_open_words_mutants.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = read('assets/app-connect.js');
const WORDS = 'Connecting an AI is not open to your account yet. To ask for it, write to ryagram@uselai.com.';

test('the line shown to an account that may not connect says it is not open yet and where to write, in one place', () => {
  assert.ok(code.includes("const INVITE_ONLY = '" + WORDS + "';"));
  assert.ok(!/by invitation|invite-only|invite only/i.test(WORDS));
});

test('the consent page shows those words, not the server\'s invite-only reason, when the account is not allowed to connect', () => {
  assert.match(code, /c && c\.invited === false && !\/\^Administrator accounts cannot be connected\/\.test\(c\.reason \|\| ''\) \? INVITE_ONLY : c && c\.reason \? c\.reason : NOT_ALLOWED/);
});

test('an administrator who follows a consent link still reads the server\'s true sentence, not the not-open words (GAMES LOW)', () => {
  const pick = (c) => (c && c.invited === false && !/^Administrator accounts cannot be connected/.test(c.reason || '') ? 'NOT_OPEN' : c && c.reason ? c.reason : 'NOT_ALLOWED');
  assert.equal(pick({ allowed: false, invited: false, reason: 'Administrator accounts cannot be connected to an AI assistant.' }), 'Administrator accounts cannot be connected to an AI assistant.');
  assert.equal(pick({ allowed: false, invited: false, reason: 'This Ryagram account is not enabled for AI assistants yet (invite-only for now).' }), 'NOT_OPEN');
  assert.ok(code.includes("c && c.invited === false && !/^Administrator accounts cannot be connected/.test(c.reason || '')"), 'the page runs exactly that choice');
  assert.match(read('supabase/migrations/20261018000100_connect_ai.sql'), /Administrator accounts cannot be connected to an AI assistant\./, 'the server still says it');
});

test('no customer-facing text in the connect screen says ask Ryan or invite-only (code comments aside)', () => {
  const shown = code.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/ .*$/gm, '');
  assert.ok(!/Ask Ryan|ask Ryan/.test(shown), 'ask Ryan');
  assert.ok(!/invite-only|by invitation/i.test(shown), 'invite-only');
  assert.match(shown, /The connector address is not available on this page\. Write to ryagram@uselai\.com and we will send it\./);
});

test('the directory listing\'s before-you-connect line is true with connecting open to everyone', () => {
  const l = JSON.parse(read('supabase/directory/anthropic-listing.json'));
  assert.ok(!/invite-only|invited/i.test(l.before_you_connect), l.before_you_connect);
  assert.match(l.before_you_connect, /allowed to connect an AI/);
});
