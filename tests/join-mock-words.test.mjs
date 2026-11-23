// The mock's join answers must be the server's own words (WEB 11-23, GAMES' ONE LOW): mock walks show a stranger the real sentences. The words are READ from supabase/functions/join/join.ts
// (identical at f1c33b16 and the Tuesday head 71093710), so the mock cannot drift from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const join = read('supabase/functions/join/join.ts');
const words = name => { const m = join.match(new RegExp(String.raw`export const ${name} = "((?:[^"\\]|\\.)*)";`)); assert.ok(m, name); return JSON.parse(`"${m[1]}"`); };   // JSON.parse decodes \u2019
const mock = read('tests/fake-supabase.js');
const block = mock.slice(mock.indexOf("if (name === 'join')"), mock.indexOf("if (name === 'approve-waiting')"));
const quoted = text => block.includes("'" + text.replace(/\u2019/g, '\u2019') + "'");

test('the mock join answers equal the server join.ts words, sentence for sentence', () => {
  assert.ok(block.length > 500);
  for (const n of ['SENT', 'NOT_OPEN_WORDS', 'SEND_FAILED_WORDS', 'FULL_WORDS', 'BAD_ADDRESS_WORDS', 'ADULT_WORDS']) assert.ok(quoted(words(n)), `${n}: ${words(n)}`);
  assert.equal(words('SENT'), 'If that email can join, a link to finish making your account is on its way. It works once. If it has not come in a few minutes, try again later. Already have an account? Sign in instead.');
});

test('the mock join block holds no old words', () => {
  assert.doesNotMatch(block, /finish joining|waitlist/i);
});
