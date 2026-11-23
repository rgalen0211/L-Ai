// What a connected AI is told when the database refuses a call (CONNECT 2026-11-23, BUILDER's 09:45 ask; supabase/functions/connect-core/tools.ts friendlyError).
// Customer step: an AI connected to a stranger's account reads the REAL words of a plain refusal (the daily credit cap, "You have 2 films waiting", "This film is not available yet") and does not retry what a retry cannot pass.
// Before: only PT + 3 digits, P0002, 42501 and 22023 passed; PTCAP (live today), and BUILDER's PTQUE and PTVEW, became 'Try again in a moment', so the AI retried a refusal that never passes.
// Runs the real function; talks to nothing. Must-fails: tests/connect_friendly_errors_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from '../supabase/functions/connect-core/tools.ts';

const err = (code, message) => Object.assign(new Error(message), { code });
const GENERIC = 'Ryagram could not do that right now. Nothing was changed. Try again in a moment.';

test('the cap and view refusals reach the AI with their own words', () => {
  assert.equal(friendlyError(err('PTCAP', 'You reached today\'s credit limit.')), 'You reached today\'s credit limit.');
  assert.equal(friendlyError(err('PTQUE', 'You have 2 films waiting. You can start another when one is done.')), 'You have 2 films waiting. You can start another when one is done.');
  assert.equal(friendlyError(err('PTVEW', 'This film is not available yet. Please pick another view.')), 'This film is not available yet. Please pick another view.');
});

test('the codes that always passed still pass', () => {
  for (const code of ['PT404', 'PT429', 'PT503', 'P0002', '42501', '22023']) assert.equal(friendlyError(err(code, 'Plain words.')), 'Plain words.', code);
});

test('anything else, however it is named, is replaced: no pattern lets an unknown PT code through, and a long or internal message never does', () => {
  for (const code of ['PTXYZ', 'PTABC', 'P0001', '42P01', 'XX000', '', undefined]) assert.equal(friendlyError(err(code, 'relation "versions" does not exist at /srv/app/x.ts:12')), GENERIC, String(code));
  assert.equal(friendlyError(err('PTQUE', 'x'.repeat(301))), GENERIC, 'a message over 300 characters is replaced even for a known code');
  assert.equal(friendlyError(new Error('boom')), GENERIC);
});

test('a token inside a passed message is still removed', () => {
  const out = friendlyError(err('PTQUE', 'bad eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig12345678 and rgc_abcdefgh1234'));
  assert.doesNotMatch(out, /eyJ|rgc_abcdefgh/);
  assert.match(out, /\[removed\]/);
});
