// BUILDER 11-27 (Claude 09:05 item 2: tests for every new server call): the contract between BUILDER's new SQL calls and their clients, pinned by READING FILES ONLY (no database).
// A rename of a function, an argument, a body key, a state, a switch name or a refusal sentence on either side fails here, so the page (WEB), the AI tools (CONNECT) and the desktop app
// (FACES) can be compared against one list. Sources: supabase/migrations/20261127000300_compilations_for_everyone.sql, 20261127000250_department_switches.sql, the node route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/20261127000300_compilations_for_everyone.sql');
const DEPT = read('supabase/migrations/20261127000250_department_switches.sql');
const ROUTER = read('supabase/functions/node-core/router.ts');
const DB = read('supabase/functions/node/db.ts');
const code = s => s.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
const set = a => [...new Set(a)].sort();

// Every refusal the 0300 SQL raises (raise exception and the request checker's return), with its errcode. Change a sentence on the server and this table must change with it.
const WORDS = [
  ['Compilations are not open for this account yet.', '42501'],
  ['Project not found.', 'PT404'],
  ['That is not a compilation state.', '22023'],
  ['That reason is set by Ryagram itself, never by the computer.', '22023'],
  ['That is not a reason Ryagram knows for a build to stop.', '22023'],
  ['A failed build needs its reason.', '22023'],
  ['Only a failed build has a reason.', '22023'],
  ['The matches and clips are whole numbers from 0 to 100000.', '22023'],
  ['The film length is 0 to 86400 seconds.', '22023'],
  ['That build already ended. Start a new one.', '22023'],
  ['Another compilation is still being made on your computer. Let it finish or cancel it first.', '55000'],
  ['That compilation was not started.', '22023'],
  ["That request is not the project''s current one. Load it again.", 'PT404'],
  ['You have started 30 compilations in the last 24 hours. Try again later.', 'PT429'],
  ['That compilation has already moved past %.', '22023'],
  ['device_decide is not the one this change expects (its tester check differs from the repository); nothing was changed. Send this sentence to BUILDER.', null],
  ['request_app_download is not the one this change expects (its tester-or-admin check differs from the repository); nothing was changed. Send this sentence to BUILDER.', null],
];
const REQUEST_WORDS = [                                   // returned by compilation_request_problem, raised by my_compilation_set with errcode 22023
  'That compilation request is not valid.',
  'That compilation request is too long.',
  'A compilation request holds folder names and a phrase only, never a file, a path or a link.',
  // the request's own rules (the connector's schema and the page's buildRequest; CC1 09:10, FACES 09:18)
  'Give the words to look for, at most 200 characters.',
  'How to look must be every time it is said, or these words in this order.',
  'Name 1 to 10 folders.',
  'A folder is a NAME of 1 to 80 characters, never . or .., and without \\ / : * ? " < > |.',
  'Songs are not open in compilations yet: they are made in the song tools.',
  'The note can be at most 500 characters.',
  'Clip labels are file, or file and time.',
  'At most 20 picture rules.',
  'Each picture rule needs its words (at most 200 characters), a picture name, 0.5 to 10 seconds and a place on screen.',
  'At most 20 texts.',
  'Each text needs its words (at most 120 characters), a start, a length of 0.5 to 30 seconds and a place on screen.',
  'At most 4 cards.',
  'Each card needs its words (at most 120 characters), start or end, and 0.5 to 10 seconds.',
  'At most 12 checklist items.',
  'Each checklist item needs what footage to get (at most 200 characters), and at most 20 files.',
  "A checklist item names a folder that is not in the request''s folders.",
  'The checklist names a site in words (like the National Archives), never a web address.',
];
const REPORT_CODES = ['request_invalid', 'song_request', 'folder_not_chosen', 'folder_missing', 'folder_empty', 'folders_overlap', 'no_speech', 'not_said', 'edit_failed', 'build_failed', 'crash'];

test('the three signatures are exactly as posted to WEB, CONNECT and FACES', () => {
  const c = code(SQL).replace(/\s+/g, ' ');
  assert.match(c, /create function public\.my_compilation_set\(p_project uuid, p_request jsonb\) returns text /);
  assert.match(c, /create function public\.my_compilation_get\(p_project uuid\) returns jsonb /);
  assert.match(c, /create function public\.node_compilation_report\(p_access_hash text, p_project uuid, p_request_sha256 text, p_state text, p_matches int default null, p_clips int default null, p_film_seconds numeric default null, p_error_code text default null\) returns bigint /);
  assert.match(c, /grant execute on function public\.node_compilation_report\(text, uuid, text, text, int, int, numeric, text\) to node_runner;/);
  assert.match(c, /grant execute on function public\.my_compilation_set\(uuid, jsonb\), public\.my_compilation_get\(uuid\) to authenticated;/);
});

test('the node route calls node_compilation_report with the SQL argument types and accepts exactly its body keys and states', () => {
  const m = /this\.scalar\("node_compilation_report", (\[[^\]]+\])/.exec(DB);
  assert.ok(m, 'db.ts calls node_compilation_report');
  assert.deepEqual(JSON.parse(m[1]), ['text', 'uuid', 'text', 'text', 'int', 'int', 'numeric', 'text']);
  const sqlTypes = /grant execute on function public\.node_compilation_report\(([^)]+)\)/.exec(SQL)[1].split(',').map(s => s.trim());
  assert.deepEqual(JSON.parse(m[1]), sqlTypes, 'the route passes the types the SQL grant names');
  const keys = JSON.parse(/const REPORT_KEYS = (\[[^\]]+\]);/.exec(ROUTER)[1]);
  assert.deepEqual(set(keys), set(['project_id', 'request_sha256', 'state', 'matches', 'clips', 'film_seconds', 'error_code']));
  const routeStates = JSON.parse(/const RUN_STATES = (\[[^\]]+\]);/.exec(ROUTER)[1]);
  const sqlStates = /state text not null check \(state in \(([^)]+)\)\)/.exec(SQL)[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(set(routeStates), set(sqlStates), 'the route and the table accept the same six states');
  assert.deepEqual(set(sqlStates), set(['planning', 'matching', 'building', 'done', 'failed', 'cancelled']));
  const fnStates = /p_state not in \(([^)]+)\)/.exec(SQL)[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(set(fnStates), set(sqlStates), 'the function and the table agree too');
  assert.match(ROUTER, /const REPORT_ROUTE = "\/node\/compilation-report";/);
  const routeCodes = JSON.parse(/const REPORT_CODES = (\[[^\]]+\]);/.exec(ROUTER)[1]);
  const sqlCodes = /codes constant text\[\] := array\[([^\]]+)\]/.exec(SQL)[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(set(routeCodes), set(REPORT_CODES), 'the route closes the same list');
  assert.deepEqual(set(sqlCodes), set(REPORT_CODES), 'the SQL closes the same list');
  assert.ok(!sqlCodes.includes('stale') && /p_error_code = 'stale' then/.test(SQL), "'stale' is set by the server only");
});

test('every refusal sentence of the 0300 SQL is in WORDS with its errcode, and nothing else is', () => {
  const raised = [...code(SQL).matchAll(/raise exception '((?:[^']|'')*)'(?:, [^;]*?)?(?: using errcode = '([0-9A-Z]{5})')?;/g)]
    .map(m => [m[1], m[2] || null]).filter(([w]) => w !== '%');
  assert.deepEqual(set(raised.map(r => JSON.stringify(r))), set(WORDS.map(r => JSON.stringify(r))));
  assert.match(code(SQL), /raise exception '%', why using errcode = '22023';/, 'the request checker\'s sentence is raised as 22023');
  const returned = [...code(SQL).matchAll(/return '((?:[^']|'')*)';/g)].map(m => m[1]);
  assert.deepEqual(set(returned), set(REQUEST_WORDS));
});

test('the department switch names are exactly compilations, games, perfectCity, for compilations, games, geo_intelligence', () => {
  const m = /case p_department ((?:when '[a-z_]+' then '[A-Za-z]+' ?)+)end/.exec(code(DEPT));
  assert.ok(m, 'the map is there');
  const pairs = [...m[1].matchAll(/when '([a-z_]+)' then '([A-Za-z]+)'/g)].map(x => [x[1], x[2]]);
  assert.deepEqual(pairs, [['compilations', 'compilations'], ['games', 'games'], ['geo_intelligence', 'perfectCity']]);
  assert.match(code(SQL), /exists \(select 1 from ryagram_private\.departments_for\(p_person\) x where x\.id = 'compilations' and x\.status = 'working'\)/, 'compilations_on reads the top bar itself (departments_for: the switch, 82a, invited only; CC1 09:35)');
});

test('the request schema name is the one the connector already writes', () => {
  const name = s => /p ?(?:_request)? ->> 'schema' is distinct from '([^']+)'/.exec(s)[1];
  assert.equal(name(code(SQL)), 'ryagram.compilation-request/0');
  assert.equal(name(code(read('supabase/migrations/20261026000300_compilation_requests.sql'))), 'ryagram.compilation-request/0');
});
