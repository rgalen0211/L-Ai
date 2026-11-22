// Where the person finds the table their AI handed over (CONNECT 2026-11-22, WEB's product question on the flip-viewport finding). The connector used to tell the AI the table "waits under Your data"; no screen in the app has that
// name: the card is "Prepared by your AI", on the Advanced tab of a film. This pins the words the AI says to the person to the app's own source, so a rename in the app fails here. Runs the real tools against the stand-in world; reads two
// app files; talks to nothing. Must-fails: tests/connect_prepared_where_mutants.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { PREPARED_WHERE } from '../supabase/functions/connect-core/tools.ts';

const compile = makeCompile(Ajv2020);
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const A = { tokenHash: 'h-a', userId: 'u-a', clientId: 'client-a' };
const world = () => { const w = new FakeWorld(); w.addUser(A.userId, 'a@example.test', 100); w.invite(A.userId, A.clientId, ['read', 'write', 'submit_data']); return { w, call: (name, args) => callTool(name, args, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile }, preparedData: true }) }; };
const csv = 'place,year,value\n' + ['Alabama', 'Alaska', 'Arizona'].flatMap((s) => [2010, 2011, 2012].map((y) => `${s},${y},${35 + (y % 7) / 3}`)).join('\n') + '\n';
const hand = (call) => call('submit_prepared_data', { label: 'Median age by US state', csv_text: csv, sources: { urls: ['https://data.census.gov/table/ACSDT1Y2022.B01002'], licence: 'Public domain', units: 'years of age' }, change_log: ['one row per state and year'] });

test('the AI is told where the person finds the table, in the app\'s own words, and never a screen the app does not have', async () => {
  const { call } = world();
  const r = await hand(call);
  assert.ok(!r.isError, r.text);
  assert.ok(r.text.includes(PREPARED_WHERE), 'the answer carries the where-words');
  for (const part of ['Advanced tab', 'one of their films', 'create_project makes one', '"Prepared by your AI"', '"Accept and continue"']) assert.ok(PREPARED_WHERE.includes(part), part);
  assert.ok(!/under "Your data"/.test(r.text), 'no screen in the app is named Your data');
  assert.equal(r.data.where, PREPARED_WHERE, 'the structured answer carries the same words (RENDERER LOW 11-22: it used to repeat the old database words)');
  assert.ok(!/Your data/.test(JSON.stringify(r.data)), 'and nothing in the structured answer names Your data');
  assert.match(r.text, /Tell the person where to find it, in those words/);
});

test('list_my_data says the same for a table still waiting', async () => {
  const { call } = world();
  await hand(call);
  const l = await call('list_my_data', {});
  assert.equal(l.data.waiting_for_you, 1);
  assert.ok(l.text.includes(PREPARED_WHERE));
});

test('the words are true to the app: the film page has an Advanced tab holding the card, titled and with a button as said', () => {
  const lib = read('assets/app-library.js'), prep = read('assets/app-prepared.js');
  assert.match(lib, /\{ id: 'advanced', label: 'Advanced', el: advancedEl \}/, 'a film page has an Advanced tab');
  assert.match(lib, /uploadsPanel\(/);
  assert.match(lib, /h\('h2', \{\}, 'Advanced: your own data and the story file'\)/);
  assert.match(prep, /h\('h2', \{ id: 'prepared-title' \}, 'Prepared by your AI'\)/, 'the card is titled as the words say');
  assert.match(prep, /'Accept and continue'/, 'the button is labelled as the words say');
});
