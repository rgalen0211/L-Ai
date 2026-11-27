// Must-fail proof for tests/connect-games-tools.test.mjs (CONNECT 11-27, the two Games tools): each mutant breaks ONE thing in a scratch copy of the connector and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run ALONE:  node tests/connect_games_mutants.mjs   (exit 0 only when every mutant is caught; 2 = the baseline failed, nothing was proved).
// It deletes nothing: the scratch copy (.mut-games, untracked) is copied once, each fault is written over one file, and the original text is written back before the next.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-games');
const C = 'supabase/functions/connect-core/';
const SUITE = 'connect-games-tools.test.mjs';
const G = C + 'games_tools.ts';
const mutants = [
  // the tools' permissions and honesty hints
  ['list_games needs write permission', G, 'title: "See the games", scope: "read"', 'title: "See the games", scope: "write"'],
  ['open_games_page needs write permission', G, 'title: "Find the Games page", scope: "read"', 'title: "Find the Games page", scope: "write"'],
  ['list_games is not marked read-only', G, 'title: "See the games", scope: "read", readOnly: true,', 'title: "See the games", scope: "read", readOnly: false,'],
  ['open_games_page is not marked read-only', G, 'title: "Find the Games page", scope: "read", readOnly: true,', 'title: "Find the Games page", scope: "read", readOnly: false,'],
  ['the description says it is free', G, 'Nothing here spends credits.', 'It is free.'],
  ['the description no longer says not to promise a date', G, 'Use it when the person asks what games there are. If games are not open for this person yet, it says so plainly: tell them, and do not promise a date.', 'Use it when the person asks what games there are.'],
  ['the description drops what the AI cannot do', G, 'You cannot press anything on the page, see a room, its players or their guesses, play, or change anything', 'You can see everything'],
  // the switch
  ['the switch is not checked at all', G, 'if (on) return null;', 'return null;'],
  ['the switch is looked for under another name', G, 'sw.includes("games")', 'sw.includes("game")'],
  ['a coming-soon department counts as open', G, 'r.id === "games" && r.status === "working"', 'r.id === "games" && r.status !== "xx"'],
  ['when neither list can be read the tools answer anyway', G, 'if (rows === null && sw === null) return refuse(', 'if (rows === null && sw === null) return null; if (false) return refuse('],
  ['list_games skips the switch', G, '{ const g = await gate(ctx, "Games"); if (g) return g; }', ''],
  ['open_games_page skips the switch', G, '{ const g = await gate(ctx, "The Games page"); if (g) return g; }', ''],
  // what the answers hold
  ['the players page is an outside address', G, 'export const PLAYERS_PAGE_PATH = "/game-phone/";', 'export const PLAYERS_PAGE_PATH = "https://evil.example/game-phone/";'],
  ['the Games page path carries a key', G, 'export const GAMES_PAGE_PATH = "/app/#/d/games";', 'export const GAMES_PAGE_PATH = "/app/#/d/games?key=abc123";'],
  ['the answer names the account of the person', G, 'ok(["Games is open for this person. How a game goes', 'ok(["Games is open for " + String(ctx.principal.userId) + ". How a game goes'],
  // aligned to GAMES' page (11-27 09:0x): the games, the numbers, the steps and the notes must say what the page says
  ['the second game is left out of the list', G, '  Object.freeze({ id: "fill_the_gap", label: "Fill the gap", line: "The host reads out a line with one word missing; everyone types the missing word on their phone." }),\n', ''],
  ['the second game has another name than the page gives it', G, 'label: "Fill the gap"', 'label: "Fill in the blank"'],
  ['the player limit differs from the page', G, 'players_max: 8,', 'players_max: 12,'],
  ['the round time differs from the page', G, 'seconds_per_round: 45 }', 'seconds_per_round: 60 }'],
  ['the number of rounds differs from the page', G, 'rounds_per_game: 5,', 'rounds_per_game: 10,'],
  ['the room code length is back in the numbers (GAMES is lengthening the code)', G, 'seconds_per_round: 45 }', 'seconds_per_round: 45, room_code_letters: 6 }'],
  ['a step states a code length in words', G, 'shows a room code, made of letters and no numbers, straight away', 'shows a room code of six letters straight away'],
  ['the room code is said to hold numbers', G, 'made of letters and no numbers', 'made of letters and numbers'],
  ['a step names a host button the page does not have (Kick)', G, 'press "Remove" beside', 'press "Kick" beside'],
  ['a step names the lock button wrongly', G, 'or "Lock the room" so no one new can join', 'or "Close the room" so no one new can join'],
  ['a step lets the host remove a player at any time', G, 'While the room is waiting, the host can press', 'At any time the host can press'],
  ['the steps leave out that the host can remove or lock', G, ' While the room is waiting, the host can press "Remove" beside a player\'s name to take that player out, or "Lock the room" so no one new can join.', ''],
  ['the notes promise a room that closes itself after a time (the page code has none yet)', G, 'Closing the host\'s page ends the room, and', 'Closing the host\'s page ends the room, an idle room closes itself after 15 minutes, and'],
  ['the notes say the game saves to an account', G, 'The game saves nothing to an account or a file, but', 'The game saves to an account and a file, and'],
  ['the notes no longer say every name and guess goes to the whole room', G, ', but every name and guess goes to everyone in the room.', '.'],
  ['the notes drop that anyone with the code can join', G, '"Anyone who has the room code can join while the room is open, so the host should share it only with the people who are playing.",', ''],
  ['the notes say the code is a password', G, 'Anyone who has the room code can join while the room is open, so', 'The room code is a password, so'],
  ['the notes drop that a silent host screen is said on the phones', G, ', and a phone whose host screen stops answering says so', ''],
  ['the least players differs from the page (a game could start with nobody)', G, 'players_min: 1,', 'players_min: 0,'],
  ['a step names a button the page does not have', G, 'The host presses "Start the game"', 'The host presses "Begin the game"'],
  ['a step tells the host to pick the game under another heading', G, 'Under "Which game?" the host picks', 'Under "Choose" the host picks'],
  ['the steps say a phone needs a sign-in', G, 'No sign-in is needed on a phone.', 'Players sign in on their phones.'],
  ['the notes say there is a video', G, 'and there is no video, so the host reads the line aloud.', 'and there is a video of each line.'],
  ['the notes say it is free', G, 'Points follow one rule in both games:', 'Points are free. Points follow one rule in both games:'],
  ['the notes are not given in the answer data', G, 'notes: [...ABOUT_THE_GAMES], ', ''],
  ['the numbers are not given in the answer data', G, 'facts: { ...GAMES_FACTS },', ''],
  ['the closed answer carries the numbers of the page', G, '{ ok: false, reason: "games_not_open" }', '{ ok: false, reason: "games_not_open", facts: GAMES_FACTS }'],
  ['the AI is told it can press things', G, '"press anything on the page", "see a room, its players or their guesses"', '"see a room, its players or their guesses"'],
  ['list_games answers an extra field about the account', G, '{ ok: true, games });', '{ ok: true, games, account: ctx.principal.userId });'],
  ['a tool writes something (a project)', G, 'const games = GAMES_OFFERED.map((g) => ({ ...g }));', 'const games = GAMES_OFFERED.map((g) => ({ ...g })); await ctx.data.createProject("x");'],
];

const run = () => spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd: scratch, timeout: 300000, killSignal: 'SIGKILL' });
const hung = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
fs.cpSync(path.join(root, 'supabase/migrations'), path.join(scratch, 'supabase/migrations'), { recursive: true });   // the suite reads the departments seed
fs.cpSync(path.join(root, 'game-phone'), path.join(scratch, 'game-phone'), { recursive: true });                      // and checks the players' page exists
fs.copyFileSync(path.join(root, 'tests', SUITE), path.join(scratch, 'tests', SUITE));
fs.mkdirSync(path.join(scratch, 'tests/fixtures'), { recursive: true });
fs.copyFileSync(path.join(root, 'tests/fixtures/games-page-facts-1127.json'), path.join(scratch, 'tests/fixtures/games-page-facts-1127.json'));   // the facts copied from GAMES' page
if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));

const base = hung(run());
if (base.status !== 0) { console.log('BASELINE FAILS (nothing proved):\n' + String(base.stdout).slice(-1200)); process.exit(2); }
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
