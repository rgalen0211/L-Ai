// Must-fail proof for tests/connect-games-tools.test.mjs (CONNECT 11-27, the two Games tools): each mutant breaks ONE thing in a scratch copy of the connector and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run ALONE:  node tests/connect_games_mutants.mjs   (exit 0 only when every mutant is caught; 2 = the baseline failed, nothing was proved).
// PAGE MUTANTS (last block): they break one line of GAMES' own page files in the scratch copy, so they need a copy of GAMES' head: set GAMES_PAGE_DIR to a `git archive` of it (for the 11-27 final head
// games-on-push1-1127 89dfedb9 that is a folder holding assets/ and game-phone/). Without GAMES_PAGE_DIR they are listed as NOT RUN and the exit code says so (3 when everything else was caught).
// It deletes nothing: the scratch copy (.mut-games, untracked) is copied once, each fault is written over one file, and the original text is written back before the next.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-games');
const pageDir = process.env.GAMES_PAGE_DIR ? path.resolve(process.env.GAMES_PAGE_DIR) : '';
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
  // aligned to GAMES' page (11-27 13:2x, head games-on-push1-1127 89dfedb9): the games, the numbers, the steps and the notes must say what the page says
  ['the second game is left out of the list', G, '  Object.freeze({ id: "fill_the_gap", label: "Fill the gap", line: "The host reads out a line with one word missing; everyone types the missing word on their phone." }),\n', ''],
  ['the second game has another name than the page gives it', G, 'label: "Fill the gap"', 'label: "Fill in the blank"'],
  ['the player limit differs from the page', G, 'players_max: 8,', 'players_max: 12,'],
  ['the round time differs from the page', G, 'seconds_per_round: 45,', 'seconds_per_round: 60,'],
  ['the number of rounds differs from the page', G, 'rounds_per_game: 5,', 'rounds_per_game: 10,'],
  ['the idle close number differs from the page', G, 'idle_close_minutes: 15 }', 'idle_close_minutes: 30 }'],
  ['the room code length is back in the numbers (the page moves to server rooms after launch)', G, 'seconds_per_round: 45,', 'seconds_per_round: 45, room_code_letters: 8,'],
  ['a step states a code length in words', G, 'the screen shows a room code, made of letters and no numbers.', 'the screen shows a room code of eight letters.'],
  ['the room code is said to hold numbers', G, 'made of letters and no numbers', 'made of letters and numbers'],
  ['the code is said to show before the room has opened', G, 'Once the room has opened, under', 'Straight away, under'],
  ['a step names a host button the page does not have (Kick)', G, '"Remove" beside a player', '"Kick" beside a player'],
  ['a step names the lock button wrongly', G, '"Lock the room" stops anyone new joining', '"Close the room" stops anyone new joining'],
  ['a step says Remove works only while the room is waiting (the old words)', G, 'takes that player out, at any time', 'takes that player out, while the room is waiting'],
  ['a step says Lock works at any time (the button is there only while waiting)', G, 'While the room is waiting, "Lock the room"', 'At any time "Lock the room"'],
  ['the controls step is left out of the steps (no Remove, Lock, New room code)', G, 'The host has these controls on the page. ', 'The host can also press things on the page. '],
  ['the steps drop that the page asks to confirm a Remove', G, 'the page asks the host to confirm first, and ', ''],
  ['the steps call Remove a ban', G, 'Remove is a courtesy, not a ban', 'Remove is a permanent ban'],
  ['the steps drop that the room locks itself at the start', G, 'The room also locks itself when the game starts. ', ''],
  ['the steps drop that players already in can rejoin a locked room', G, '; players who are already in can still rejoin)', ')'],
  ['the steps drop the phone rejoin after a reload', G, 'A player whose phone page reloads in the same browser tab can join again as the same player and keep their score.', 'A player whose phone page reloads is out for good.'],
  ['the notes promise no end to an idle room (the idle close is left out)', G, 'A room closes itself after ${GAMES_FACTS.idle_close_minutes} minutes with nothing happening', 'A room stays open for ever, nothing happening'],
  ['the notes say a running round can be closed as idle', G, 'a round that is running never counts as idle', 'a running round is closed too'],
  ['the notes drop that leaving the Games page ends the room', G, "Closing the host's page, or leaving the Games page, ends the room", "Closing the host's page ends the room"],
  ['the notes say the game saves to an account', G, 'The game saves nothing to an account or a file, but', 'The game saves to an account and a file, and'],
  ['the notes no longer say every name and guess goes to the whole room', G, ', but every name and guess goes to everyone in the room.', '.'],
  ['the notes drop that anyone with the code can join', G, 'Anyone who has the room code can join while the room is open, so the host should share it only with the people who are playing. ', ''],
  ['the notes say the code is a password', G, 'Anyone who has the room code can join while the room is open, so', 'The room code is a password, so'],
  ['the notes say the code protects the room', G, 'The code does not protect the room from anyone who has it', 'The code keeps strangers out'],
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

// PAGE MUTANTS: one fault in one of GAMES' own files (read from GAMES_PAGE_DIR, written into the scratch copy only); the page-reading test must go red.
const A = 'assets/app-games.js', R = 'assets/game-room.js', P = 'assets/game-phone-live.js';
const pageMutants = [
  ['PAGE: the idle close is 10 minutes, not 15', A, 'IDLE_MS = 15 * 60000, WARN_MS = 2 * 60000', 'IDLE_MS = 10 * 60000, WARN_MS = 2 * 60000'],
  ['PAGE: the idle warning is 3 minutes before, not 2', A, 'IDLE_MS = 15 * 60000, WARN_MS = 2 * 60000', 'IDLE_MS = 15 * 60000, WARN_MS = 3 * 60000'],
  ['PAGE: a running question round can be closed as idle (the warning is armed in a round)', A, "if (s.closed || s.phase === 'question') return;\n      s.warnT = later(showIdleWarn", "if (s.closed) return;\n      s.warnT = later(showIdleWarn"],
  ['PAGE: the player cap is 12 in the host', A, 'const MAX_PLAYERS = 8, ROUND_SECONDS = 45;', 'const MAX_PLAYERS = 12, ROUND_SECONDS = 45;'],
  ['PAGE: the round is 60 seconds', A, 'const MAX_PLAYERS = 8, ROUND_SECONDS = 45;', 'const MAX_PLAYERS = 8, ROUND_SECONDS = 60;'],
  ['PAGE: the player cap is 12 in the room library', R, 'NAME_MAX = 16, ANSWER_MAX = 120, PROBLEM_MAX = 200, HEARD_MAX = 400, VERDICT_MAX = 20, MAX_PLAYERS = 8;', 'NAME_MAX = 16, ANSWER_MAX = 120, PROBLEM_MAX = 200, HEARD_MAX = 400, VERDICT_MAX = 20, MAX_PLAYERS = 12;'],
  ['PAGE: the room code alphabet gets digits', R, "const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';", "const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23';"],
  ['PAGE: Remove works only in the lobby again (the old rule)', A, 'function kick(pid) {\n      if (s.closed) return false;', "function kick(pid) {\n      if (s.closed || s.phase !== 'lobby') return false;"],
  ['PAGE: the final screen has no players panel (no Remove after the last round)', A, "'Play again with the same players'), ...panel()];", "'Play again with the same players')];"],
  ['PAGE: the lock button is drawn in every phase', A, "lobby ? h('p', { class: 'gh-lock-line' }", "true ? h('p', { class: 'gh-lock-line' }"],
  ['PAGE: New room code is drawn in every phase', A, "lobby ? h('button', { class: 'button secondary', type: 'button', id: 'gh-newcode'", "true ? h('button', { class: 'button secondary', type: 'button', id: 'gh-newcode'"],
  ['PAGE: the room no longer locks itself when the game starts', A, 's.lockedByHost = s.locked; s.locked = true;', 's.lockedByHost = s.locked;'],
  ['PAGE: the undo for a Remove is gone', A, "'Allow again'", "'Undo'"],
  ['PAGE: leaving the Games page no longer closes the room', A, "if (location.hash !== '#/d/games') close();", 'if (false) close();'],
  ['PAGE: the draft banner says the code is a password', A, 'and anyone with the room code can join: it is not a password.', 'and anyone with the room code can join: it is a password.'],
  ['PAGE: the host makes a server call', A, 'const local = () =>', "const ping = () => fetch('/x'); const local = () =>"],
  ['PAGE: the phone keeps its seat for ever (local storage)', P, 'sessionStorage.setItem(SEAT_KEY', 'localStorage.setItem(SEAT_KEY'],
  ['PAGE: the phone says the idle close is 30 minutes', P, 'closed because nothing happened for 15 minutes.', 'closed because nothing happened for 30 minutes.'],
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
const havePage = !!pageDir && fs.existsSync(path.join(pageDir, 'assets/app-games.js'));
if (havePage) {                                                                                                          // GAMES' own files, so the page-reading test runs too
  fs.mkdirSync(path.join(scratch, 'assets'), { recursive: true });
  for (const f of ['app-games.js', 'game-room.js', 'game-phone-live.js', 'game-rounds.js', 'game-gap-rounds.js']) fs.copyFileSync(path.join(pageDir, 'assets', f), path.join(scratch, 'assets', f));
}

const base = hung(run());
if (base.status !== 0) { console.log('BASELINE FAILS (nothing proved):\n' + String(base.stdout).slice(-1200)); process.exit(2); }
console.log(`baseline passes${havePage ? ' (with GAMES\' page files)' : ' (NO page files: GAMES_PAGE_DIR not set, the page mutants will not run)'}`);
let missed = 0, notRun = 0;
const all = [...mutants.map((m) => [...m, root]), ...(havePage ? pageMutants.map((m) => [...m, pageDir]) : [])];
for (const [name, file, from, to, origin] of all) {
  const target = path.join(scratch, file);
  const original = fs.readFileSync(path.join(origin, file), 'utf8');            // always the real file's text, so a faulted copy can never carry over
  const src = original.replace(/\r\n/g, '\n');
  const copies = src.split(from).length - 1;
  if (copies !== 1) { console.log(`BROKEN MUTANT (${copies} copies of the text, expected 1): ${name}`); missed++; fs.writeFileSync(target, original); continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = hung(run()).status !== 0;
  fs.writeFileSync(target, original);                                           // put it back before the next one
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
if (!havePage) { notRun = pageMutants.length; for (const m of pageMutants) console.log(`NOT RUN  ${m[0]}`); }
const after = hung(run());
if (after.status !== 0) { console.log('RESTORE CHECK FAILS: the scratch copy no longer passes after the last fault was put back'); process.exit(2); }
console.log(missed ? `${missed} of ${all.length} not caught` : `all ${all.length} mutants caught${notRun ? `; ${notRun} page mutants NOT RUN (set GAMES_PAGE_DIR)` : ''}`);
process.exit(missed ? 1 : (notRun ? 3 : 0));
