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

// ---- GAMES 11:04 LOW: the AI gets a distinct code, so it stops asking instead of retrying
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { errorCodeOf } from '../supabase/functions/connect-core/tools.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';

test('errorCodeOf names the three refusals a retry cannot pass and leaves everything else as error', () => {
  assert.equal(errorCodeOf(err('PTQUE', 'You have 2 films waiting.')), 'queue_full');
  assert.equal(errorCodeOf(err('PTCAP', 'Daily limit.')), 'daily_credit_cap');
  assert.equal(errorCodeOf(err('PTVEW', 'Not available.')), 'not_available');
  for (const code of ['PT404', 'PT429', 'PTXYZ', '42501', '', undefined]) assert.equal(errorCodeOf(err(code, 'x')), 'error', String(code));
  assert.equal(errorCodeOf(err('PTQUE', 'x'.repeat(301))), 'error', 'a message friendlyError would replace gets no special code');
  assert.equal(errorCodeOf(null), 'error');
});

test('a tool that hits PTQUE, PTCAP or PTVEW answers the AI with that distinct code and the real words', async () => {
  const compile = makeCompile(Ajv2020);
  const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
  for (const [code, msg, want] of [['PTQUE', 'You have 2 films waiting. You can start another when one is done.', 'queue_full'], ['PTCAP', 'You reached today\'s credit limit.', 'daily_credit_cap'], ['PTVEW', 'This film is not available yet. Please pick another view.', 'not_available'], ['PT429', 'Too many.', 'error']]) {
    const w = new FakeWorld();
    w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId);
    const data = { ...w.data(A.userId), createProject: async () => { throw err(code, msg); } };
    const r = await callTool('create_project', { title: 'Film' }, A, { data, policy: w.policy(), deps: { compile } });
    assert.equal(r.isError, true, code);
    assert.equal(r.code, want, code);
    assert.equal(r.text, msg, code);
  }
});

test('L6: a 42501 / 22023 message that reads like a Postgres internal becomes the generic sentence; the plain sentences still pass', () => {
  const internals = ['permission denied for function connect_compilation_get', 'permission denied for table projects', 'new row violates row-level security policy for table "versions"',
    'function public.connect_set_compilation_request(text, uuid) does not exist', 'relation "public.projects" does not exist', 'schema "ryagram_private" does not exist', 'column "owner_id" of relation "x" does not exist'];
  for (const code of ['42501', '22023']) for (const m of internals) assert.equal(friendlyError(err(code, m)), GENERIC, code + ' ' + m);
  for (const code of ['42501', '22023']) for (const m of ['Perfect City is not switched on for this account yet.', 'Compilations is not switched on for this account yet.', 'That is not a place Ryagram can look up.']) assert.equal(friendlyError(err(code, m)), m, m);
});
