// Must-fail proof for tests/connect-words-lint-1127.test.mjs (CONNECT 11-27): each mutant plants ONE public-words fault in a scratch copy of the connector and the lint must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run ALONE:  node tests/connect_words_lint_mutants.mjs   (exit 0 only when every mutant is caught; 2 = the baseline failed, nothing was proved).
// It deletes nothing: the scratch copy (.mut-words, untracked) is copied once, each fault is written over one file, and the original text is written back before the next.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-words');
const C = 'supabase/functions/connect-core/';
const SUITE = 'connect-words-lint-1127.test.mjs';
const G = C + 'games_tools.ts', P = C + 'perfect_city.ts', T = C + 'tools.ts', W = C + 'words.ts';
const OLD = 'L' + String.fromCharCode(0x2019) + 'Ai';                          // the old product name, built here so this file holds no escape
const GAMES_USE = 'Use it when the person asks what games there are.';
const mutants = [
  // money
  ['money: a dollar sign in a department description', G, GAMES_USE, GAMES_USE + ' It costs $5.'],
  ['money: the word price in a department description', P, 'It reads no place and gives no numbers about any place (perfect_city_summary does that for one spot).', 'It reads no place and gives no numbers about any place (perfect_city_summary does that for one spot). The price is low.'],
  // credit amount
  ['credit: a number of credits in a department description', G, GAMES_USE, GAMES_USE + ' It uses 5 credits.'],
  ['credit: a number of credits in a title', G, 'title: "See the games"', 'title: "See the games for 5 credits"'],
  // free
  ['free: a department description says it is free', G, 'Nothing here spends credits.', 'It is free.'],
  ['free: a second "free" beside an allowed one', T, 'Free. If a project with the same title', 'Free. Always free. If a project with the same title'],
  ['free: "free" on a hidden (unlisted) write tool', T, 'Writes down a plan to fetch ONE public-domain video from NASA', 'Writes down a free plan to fetch ONE public-domain video from NASA'],
  // date
  ['date: a promised day in a description', P, 'It reads no place and gives no numbers about any place (perfect_city_summary does that for one spot).', 'It reads no place and gives no numbers about any place (perfect_city_summary does that for one spot). It opens on 1 December 2026.'],
  ['date: "tomorrow" in a description', G, GAMES_USE, GAMES_USE + ' More games arrive tomorrow.'],
  ['date: "will be available" in a description', T, 'To ask for a compilation, use set_compilation_request first.', 'To ask for a compilation, use set_compilation_request first. Songs will be available.'],
  // soon
  ['soon: "soon" in a department description', G, 'Read-only, nothing is started. ', 'Read-only, nothing is started. More games soon. '],
  // jargon
  ['jargon: "scope" in a description', T, 'To ask for a compilation, use set_compilation_request first.', 'To ask for a compilation, use set_compilation_request first (it needs the write scope).'],
  ['jargon: "JWT" in a description', G, 'Read-only; nothing is started.', 'Read-only; nothing is started (a JWT is checked).'],
  ['jargon: "supabase" in a description', P, 'It reads no place and gives no numbers about any place (perfect_city_summary does that for one spot).', 'It reads no place and gives no numbers about any place (perfect_city_summary does that for one spot; supabase answers).'],
  ['jargon: "token" in the no-connection words every department tool returns', W, 'This AI cannot use this Ryagram account right now:', 'This AI cannot use this Ryagram account right now (token problem):'],
  ['jargon: "PT403" in a refusal', G, 'is not available just now. Try again in a minute.', 'is not available just now (PT403). Try again in a minute.'],
  ['jargon: "Postgres" in a refusal', T, 'Compilation status is not available just now. Nothing was looked up.', 'Compilation status is not available just now (Postgres is down). Nothing was looked up.'],
  ['jargon: "schema" in a description of an argument', P, 'Optional: a place id from list_perfect_city_options.', 'Optional: a place id from list_perfect_city_options (see the schema).'],
  // address
  ['address: an email in a description', G, GAMES_USE, GAMES_USE + ' Write to alice@example.test.'],
  ['address: a web address in a description', T, 'To ask for a compilation, use set_compilation_request first.', 'To ask for a compilation, use set_compilation_request first. See https://example.test/x.'],
  ['address: an IP number in a refusal', P, 'Perfect City is not switched on for this Ryagram account.', 'Perfect City is not switched on for this Ryagram account (10.0.0.1).'],
  // names
  ['names: the old product name in a description', G, GAMES_USE, GAMES_USE + ' Made by ' + OLD + '.'],
  ['names: the other old name in a refusal', P, 'Perfect City is not switched on for this Ryagram account.', 'Perfect City is not switched on for this MindWise account.'],
  // refusal words
  ['refusal: a price in the closed words of Perfect City', P, 'Nothing was looked up.";', 'Nothing was looked up. It will cost $9.";'],
  ['refusal: a promised date in the closed words of Compilations', T, 'a data film made in the website works for them.";', 'a data film made in the website works for them. It opens tomorrow.";'],
  ['refusal: a credit amount in the closed words of Games', G, 'and do not promise a date.`', 'and do not promise a date. It would use 5 credits.`'],
  ['refusal: "soon" in the closed words of Games', G, 'Tell them plainly that games are not available to them yet,', 'Tell them plainly that games are coming soon,'],
  // the allow list cannot go stale or grow silently
  ['allow list: an allowed sentence changes (the case goes stale)', T, 'Starts a new, empty film project. Free.', 'Starts a new, empty film project.'],
];

const run = () => spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd: scratch, timeout: 300000, killSignal: 'SIGKILL' });
const hung = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
fs.copyFileSync(path.join(root, 'tests', SUITE), path.join(scratch, 'tests', SUITE));
if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));

const base = hung(run());
if (base.status !== 0) { console.log('BASELINE FAILS (nothing proved):\n' + String(base.stdout).slice(-1500)); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  const target = path.join(scratch, file);
  const original = fs.readFileSync(path.join(root, file), 'utf8');              // always the real file's text, so a faulted copy can never carry over
  const src = original.replace(/\r\n/g, '\n');
  const copies = src.split(from).length - 1;
  if (copies !== 1) { console.log(`BROKEN MUTANT (${copies} copies of the text, expected 1): ${name}`); missed++; fs.writeFileSync(target, original); continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = hung(run()).status !== 0;
  fs.writeFileSync(target, original);                                           // put it back before the next one
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
const after = hung(run());
if (after.status !== 0) { console.log('RESTORE CHECK FAILS: the scratch copy no longer passes after the last fault was put back'); process.exit(2); }
console.log(missed ? `${missed} of ${mutants.length} not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
