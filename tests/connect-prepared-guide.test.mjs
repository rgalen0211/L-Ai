// The guide never promises what a customer cannot see (GAMES 11-21, Q634). The data hand-over is real only when THREE things are on together, and this test makes them one change:
//   1. the site's uploads flag (assets/ryagram-config.js: uploads: true), which builds the "Prepared by your AI" Accept card,
//   2. the connector's own switch CONNECT_PREPARED_DATA (a secret Ryan sets in the same step; the connector tests cover it: tests/connect-prepared-data.test.mjs),
//   3. the guide's sentence about it (connect-ai/index.html) and the directory listing's two tools (supabase/directory/tools.json).
// While uploads is false the guide must not mention the hand-over and the listing must not offer the two tools; the day uploads is true, both must say it. Flipping the flag without the words, or the words without the flag, fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('connect-ai/index.html');
const uploadsOn = /^\s*uploads:\s*true\b/m.test(read('assets/ryagram-config.js'));
const SENTENCE = 'It can hand Ryagram a table of data it found for you, with its sources. It waits for you in Ryagram: you see it, see where your AI says it came from (Ryagram has not checked this), and nothing is used until you press Accept yourself. Ryagram labels it &ldquo;Unverified, user-supplied&rdquo;.';
const TOOLS = ['submit_prepared_data', 'list_my_data'];

test('the guide has the hand-over sentence if and only if the site\'s uploads flag is on (today: ' + (uploadsOn ? 'on' : 'off') + ')', () => {
  assert.equal(page.includes(SENTENCE), uploadsOn, uploadsOn ? 'uploads is on: the guide must say what the hand-over does' : 'uploads is off: the Accept card cannot be seen, so the guide must not promise it');
  assert.equal(/hand Ryagram a table/i.test(page), uploadsOn, 'and no other wording of it either');
});

test('the directory listing offers the two data tools if and only if the uploads flag is on (the connector lists them only while its own switch is on)', () => {
  const names = JSON.parse(read('supabase/directory/tools.json')).tools.map((t) => t.name);
  for (const n of TOOLS) assert.equal(names.includes(n), uploadsOn, n);
});

test('the words the guide would use are the card\'s and the upload path\'s own words (checked now, so the flip commit cannot drift from them)', () => {
  const card = read('assets/app-prepared.js');
  assert.ok(card.includes('Ryagram has not checked this') && card.includes("const TRUST_LABEL = 'Unverified, user-supplied'"), 'the card says the same about what the AI declared, and its label is the quoted one');
  assert.ok(read('assets/app-uploads.js').includes("unverified_user: 'Unverified, user-supplied'"), 'which is the label the upload path itself uses');
  assert.ok(read('assets/app-connect.js').includes('and press Accept. Nothing uses it before you do'), 'and the consent line for the scope says the same thing');
});
