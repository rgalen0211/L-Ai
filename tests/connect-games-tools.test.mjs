// GAMES for the person's AI (CONNECT 11-27): list_games and open_games_page through the REAL dispatch, scope gate and argument check, against the stand-in world.
// Contract: Ryagram-logs/proposals/CONNECT-DEPT-GAMES-1127.md. GAMES keeps a round only on the host's screen and the players' phones (no server call), so the AI can say what the Games page offers and where it is,
// and nothing more: it cannot press, see a room or a guess, play, start or end a round, or spend credits. Both tools refuse in plain words while the account's `games` switch is off.
// (The tools that would start, read and end a round are kept as a draft with the contract paper, for the day a round lives on the server.)
import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { toolList } from '../supabase/functions/connect-core/mcp.ts';
import { GAMES_OFFERED, GAMES_PAGE_PATH, PLAYERS_PAGE_PATH, HOW_A_ROUND_GOES, ABOUT_THE_GAMES, GAMES_FACTS } from '../supabase/functions/connect-core/games_tools.ts';

const compile = makeCompile(Ajv2020);
const NAMES = ['list_games', 'open_games_page'];
const SITE_PATH = /^\/(?!\/)[A-Za-z0-9_.\/-]{0,80}(#\/[A-Za-z0-9_\/-]{0,60})?$/;

function world() {
  const w = new FakeWorld();
  const mk = (id, scopes, switches) => { w.addUser(id, id + '@example.test', 100); w.users.get(id).switches = switches; w.invite(id, 'client-' + id, scopes); return { tokenHash: 'h-' + id, userId: id, clientId: 'client-' + id }; };
  const A = mk('u-a', ['read', 'write', 'render_free'], ['games']);                         // the switch is on for A only
  const B = mk('u-b', ['read', 'write', 'render_free'], []);
  const W = mk('u-w', ['write'], ['games']);                                                  // no read permission
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  const call = (p, tool, args = {}) => callTool(tool, args, p, env(p));
  return { w, A, B, W, call, env };
}
const everything = (r) => JSON.stringify([r.text, r.data]);

test('both tools are listed, read-only, idempotent, with the read scope and plain names', () => {
  const list = Object.fromEntries(toolList().map((t) => [t.name, t]));
  for (const n of NAMES) {
    assert.ok(list[n], n);
    assert.equal(list[n].annotations.readOnlyHint, true); assert.equal(list[n].annotations.destructiveHint, false); assert.equal(list[n].annotations.idempotentHint, true); assert.equal(list[n].annotations.openWorldHint, false);
    assert.equal(TOOLS.find((t) => t.name === n).scope, 'read');
    assert.ok(/^[a-z0-9_]+$/.test(n)); assert.ok(!/call it first|you must|read it before/i.test(list[n].description), n);
  }
});

test('the words: no price, no credit amount, no "free" claim, no date; and they say what the AI cannot do', () => {
  for (const n of NAMES) {
    const t = TOOLS.find((x) => x.name === n);
    assert.ok(!/\$|\bfree\b|\bcosts?\b|\bcredits? (cost|price)|\b20\d\d\b|\bsoon\b/i.test(t.description + ' ' + t.title), n + ': ' + t.description);
    assert.match(t.description, /do not promise a date/);
  }
  const d = TOOLS.find((t) => t.name === 'open_games_page').description;
  assert.match(d, /cannot press anything/); assert.match(d, /their guesses/); assert.match(d, /Nothing here spends credits/);
});

test('list_games: the games on offer, with the next step named', async () => {
  const { A, call } = world();
  const r = await call(A, 'list_games');
  assert.ok(!r.isError, r.text);
  assert.deepEqual(r.data.games.map((g) => g.id), ['guess_the_next_line', 'fill_the_gap']);                  // the two games under "Which game?" on GAMES' page, in its order
  assert.deepEqual(r.data.games.map((g) => g.label), ['Guess the next line', 'Fill the gap']);
  assert.match(r.text, /guess_the_next_line: Guess the next line\./); assert.match(r.text, /fill_the_gap: Fill the gap\./); assert.match(r.text, /open_games_page/); assert.match(r.text, /"Which game\?"/);
  assert.deepEqual(r.data.games, GAMES_OFFERED);
});

test('open_games_page: where Games is, how a round goes, and what the AI cannot do', async () => {
  const { A, call } = world();
  const r = await call(A, 'open_games_page');
  assert.ok(!r.isError, r.text);
  assert.equal(r.data.page_path, GAMES_PAGE_PATH); assert.equal(r.data.players_page_path, PLAYERS_PAGE_PATH);
  for (const p of [r.data.page_path, r.data.players_page_path]) assert.match(p, SITE_PATH, p);                // a path on the site, never an address
  assert.deepEqual(r.data.steps, [...HOW_A_ROUND_GOES]);
  assert.match(r.text, /room code, made of letters and no numbers/); assert.match(r.text, /if the page looks different, the page is right/); assert.match(r.text, /cannot press anything/);
  for (const bad of ['press anything on the page', 'see a room, its players or their guesses', 'play', 'start or end a round']) assert.ok(r.data.ai_cannot.includes(bad), bad);
});

test('nothing is written or started: no credits move, no job, no round, no project', async () => {
  const { w, A, call } = world();
  const before = JSON.stringify(await w.data('u-a').whoami());
  for (const n of NAMES) { const r = await call(A, n); assert.ok(!r.isError, r.text); assert.equal(w.logs.at(-1).credits, 0); }
  assert.equal(JSON.stringify(await w.data('u-a').whoami()), before);
  assert.deepEqual(await w.data('u-a').listProjects(), []);
  assert.equal(w.users.get('u-a').jobs.length, 0);
});

test('the switch: with `games` off for the account both tools refuse in plain words', async () => {
  const { B, call } = world();
  for (const n of NAMES) {
    const r = await call(B, n);
    assert.equal(r.isError, true, n); assert.equal(r.code, 'not_available', n); assert.equal(r.data.reason, 'games_not_open', n); assert.equal(r.data.ok, false, n);
    assert.match(r.text, /not open for this account yet/); assert.match(r.text, /do not promise a date/);
    assert.ok(!r.text.includes(GAMES_PAGE_PATH) && !r.text.includes(PLAYERS_PAGE_PATH), 'nothing about the page is given: ' + r.text);
  }
});

test('the switch is per account: it is on for A, not for B; another department\'s switch does not open it; the department being `working` for the account does', async () => {
  const { w, A, B, call } = world();
  assert.ok(!(await call(A, 'list_games')).isError);
  assert.equal((await call(B, 'list_games')).code, 'not_available');
  w.users.get('u-b').switches = ['perfectCity', 'compilations', 'myFilms', 'Games', 'game'];                  // other names, a different case and a near miss
  assert.equal((await call(B, 'list_games')).code, 'not_available');
  w.users.get('u-b').departments = [{ id: 'games', label: 'Games', status: 'soon' }, { id: 'compilations', label: 'Compilations', status: 'working' }];
  assert.equal((await call(B, 'open_games_page')).code, 'not_available');                                    // another department working is not this one
  w.users.get('u-b').departments = [{ id: 'games', label: 'Games', status: 'working' }];                       // after Ryan opens the department for everyone
  assert.ok(!(await call(B, 'list_games')).isError); assert.ok(!(await call(B, 'open_games_page')).isError);
  w.users.get('u-a').switches = [];                                                                           // and turning A's switch off closes it again at once (nothing is cached)
  assert.equal((await call(A, 'open_games_page')).code, 'not_available');
});

test('the switch fails closed: when neither list can be read nothing is answered; one readable list that names games is enough', async () => {
  const { w, A } = world();
  const d = w.data('u-a'); d.departments = async () => { throw new Error('down'); }; d.switches = async () => { throw new Error('down'); };
  const env = { data: d, policy: w.policy(), deps: { compile } };
  for (const n of NAMES) { const r = await callTool(n, {}, A, env); assert.equal(r.isError, true); assert.equal(r.code, 'unavailable'); assert.match(r.text, /not available just now/); }
  d.switches = async () => ['games'];
  assert.ok(!(await callTool('list_games', {}, A, env)).isError);
  d.switches = async () => { throw new Error('down'); }; d.departments = async () => [{ id: 'games', label: 'Games', status: 'soon' }];
  assert.equal((await callTool('list_games', {}, A, env)).code, 'not_available');                           // readable and not on: refused, not "unavailable"
});

test('the scope gate: a connection without read permission gets nothing', async () => {
  const { W, call } = world();
  for (const n of NAMES) { const r = await call(W, n); assert.equal(r.isError, true); assert.equal(r.code, 'scope'); }
});

test('bad input: an argument of any kind is refused by the argument check', async () => {
  const { A, call } = world();
  for (const n of NAMES) for (const args of [{ game: 'guess_the_next_line' }, { round_id: '00000000-0000-4000-8000-000000000001' }, { code: 'ABCD' }, { owner: 'u-b' }, 'x', [1]]) {
    const r = await call(A, n, args);
    assert.equal(r.isError, true, n + JSON.stringify(args)); assert.equal(r.code, 'args', n + JSON.stringify(args));
  }
});

test('PRIVACY: the answers hold no email, address, key, token, code, file or other person\'s data', async () => {
  const { A, call } = world();
  for (const n of NAMES) {
    const r = await call(A, n);
    const all = everything(r);
    assert.ok(!/@|https?:\/\/|www\.|\bkey\b|token|secret|password|host_key|[A-Za-z]:\\|\.(mp4|mkv|avi|wav|csv|json)\b/i.test(all), n + ': ' + all);
    assert.ok(!all.includes('u-a') && !all.includes('example.test'), n);                                      // nothing about the person's account either
  }
  const d = (await call(A, 'open_games_page')).data;
  assert.deepEqual(Object.keys(d).sort(), ['ai_can', 'ai_cannot', 'facts', 'notes', 'ok', 'page_path', 'players_page_path', 'steps']);
  assert.deepEqual(Object.keys(d.facts).sort(), ['players_max', 'players_min', 'rounds_per_game', 'seconds_per_round']);         // numbers only, nothing about a room
  const l = (await call(A, 'list_games')).data;
  assert.deepEqual(Object.keys(l).sort(), ['games', 'ok']); for (const g of l.games) assert.deepEqual(Object.keys(g).sort(), ['id', 'label', 'line']);
});

test('the two paths are plain paths on the Ryagram site and the steps use exactly them', () => {
  for (const p of [GAMES_PAGE_PATH, PLAYERS_PAGE_PATH]) assert.match(p, SITE_PATH, p);
  const steps = HOW_A_ROUND_GOES.join('\n');
  assert.ok(steps.includes(GAMES_PAGE_PATH) && steps.includes(PLAYERS_PAGE_PATH));
  assert.ok(!/https?:|\/\/|\.\./.test(steps));
});

test('the page the tools name is the page the site really has: the phone page exists and the games department id is the one the top bar uses', async () => {
  const fs = await import('node:fs');
  assert.ok(fs.existsSync('game-phone/index.html'), 'the players\' page file');
  assert.ok(fs.existsSync(PLAYERS_PAGE_PATH.slice(1) + 'index.html'), PLAYERS_PAGE_PATH);
  const dept = fs.readFileSync('supabase/migrations/20261027000100_departments.sql', 'utf8');
  assert.match(dept, /\('games', 'Games'/);
  const home = fs.readFileSync('supabase/functions/connect-core/home_panel.ts', 'utf8');
  assert.match(home, /games: \{ label: "Games"/);
});

// ---- ALIGNED TO GAMES' PAGE (CONNECT 11-27 09:0x): the words the AI reads are tested against what GAMES' page says about itself (tests/fixtures/games-page-facts-1127.json, read from its code on e7e2b0c6 / e22af41f).
const FACTS = JSON.parse((await import('node:fs')).readFileSync('tests/fixtures/games-page-facts-1127.json', 'utf8'));
const quoted = (s) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

test('the games listed are exactly the games the page offers under "Which game?", same names, same order', () => {
  assert.deepEqual(GAMES_OFFERED.map((g) => g.label), FACTS.games.map((g) => g.label));
  assert.deepEqual(GAMES_OFFERED.map((g) => g.id), ['guess_the_next_line', 'fill_the_gap']);
  for (const g of GAMES_OFFERED) assert.match(g.line, /^The host reads out /);                                  // the host reads the line aloud: there is no video on the page
});

test('the numbers the AI is told are the numbers on the page; the paths are the page\'s paths', () => {
  assert.equal(GAMES_FACTS.players_max, FACTS.max_players); assert.equal(GAMES_FACTS.seconds_per_round, FACTS.round_seconds);
  assert.equal(GAMES_FACTS.rounds_per_game, FACTS.rounds_per_game.line); assert.equal(GAMES_FACTS.rounds_per_game, FACTS.rounds_per_game.gap);
  assert.equal(GAMES_FACTS.players_min, FACTS.start_needs_a_player ? 1 : 0);
  assert.equal(GAMES_PAGE_PATH, FACTS.host_path); assert.equal(PLAYERS_PAGE_PATH, FACTS.players_path);
  const steps = HOW_A_ROUND_GOES.join('\n');
  assert.match(steps, /Up to 8 players/); assert.match(steps, /45 seconds/); assert.match(steps, /five rounds/); assert.match(steps, /room code, made of letters and no numbers/); assert.match(steps, /at most 16 letters/);
  assert.match(steps, /No sign-in is needed on a phone/); assert.equal(FACTS.phone_needs_sign_in, false);
});

test('the steps come in the order the page runs: the code shows, the host picks a game, players join, the host starts, the answer and scores, the final', () => {
  const at = (re) => HOW_A_ROUND_GOES.findIndex((s) => re.test(s));
  const order = [at(/room code, made of letters/), at(/Which game\?/), at(/players' page/), at(/"Start the game"/), at(/shows the answer, each player's points/)];
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
  assert.match(HOW_A_ROUND_GOES[4], /final scores/); assert.match(HOW_A_ROUND_GOES[4], /"Play again with the same players"/);
});

test('the words state no room code LENGTH (GAMES is lengthening the code): a number of letters anywhere in the answer would go stale', async () => {
  const { A, call } = world();
  const all = [everything(await call(A, 'open_games_page')), everything(await call(A, 'list_games')), ...TOOLS.filter((t) => NAMES.includes(t.name)).map((t) => t.description)].join(' | ');
  const LEN = /\b(four|five|six|seven|eight|nine|ten|[4-9]|1[0-2])[- ](letter|character|digit)s?\b/i;
  assert.ok(!LEN.test(all), 'a code length in the words: ' + all.match(LEN));
  assert.ok(!/\bcode\b[^.|]{0,40}\b(four|six|eight|[468])\b/i.test(all));
  assert.equal(Object.keys(GAMES_FACTS).includes('room_code_letters'), false);
  assert.match(all, /letters and no numbers/);                                                                // what the page's alphabet makes true at any length
  assert.equal(FACTS.code_has_digits, false); assert.ok(!/[0-9]/.test(FACTS.code_alphabet));
});

test('the host controls the page has are said, and only those: remove a player and lock the room while waiting (no kick mid-game, no idle timer promised)', () => {
  const steps = HOW_A_ROUND_GOES.join(' | ');
  assert.match(steps, /"Remove" beside a player's name/); assert.match(steps, /"Lock the room"/); assert.match(steps, /While the room is waiting/);
  assert.equal(FACTS.host_can_remove_a_player_in_the_lobby, true); assert.equal(FACTS.host_can_lock_the_room, true);
  const all = [...HOW_A_ROUND_GOES, ...ABOUT_THE_GAMES].join(' | ');
  const TIMER = /\b(idle|minutes?|closes itself|times out|rate limit|too many)\b/i;
  assert.ok(!TIMER.test(all), 'a timer or a limit the page code does not have yet: ' + all.match(TIMER));
});

test('every button or heading the steps put in quotes is a real one on the page', () => {
  const real = new Set([...FACTS.buttons, FACTS.which_game_legend, FACTS.lobby_heading]);
  const named = [...HOW_A_ROUND_GOES, ...ABOUT_THE_GAMES, ...GAMES_OFFERED.map((g) => g.line)].flatMap(quoted);
  assert.ok(named.length >= 4, 'the steps do name the page\'s own buttons: ' + named.join(' | '));
  for (const n of named) assert.ok(real.has(n), `"${n}" is not a button or heading on the page`);
  assert.ok(named.includes('Start the game') && named.includes('Which game?'));
});

test('the notes say what the page says of itself: a draft with sample rounds, nothing saved, everything goes to the whole room, and anyone who has the room code can join; no price, no date, no "free"', async () => {
  const { A, call } = world();
  const r = await call(A, 'open_games_page');
  assert.deepEqual(r.data.notes, [...ABOUT_THE_GAMES]); assert.deepEqual(r.data.facts, { ...GAMES_FACTS });
  const n = ABOUT_THE_GAMES.join('\n');
  assert.match(n, /draft/); assert.match(n, /made-up script/); assert.match(n, /no video/); assert.match(n, /saves nothing to an account or a file/); assert.match(n, /every name and guess goes to everyone in the room/); assert.match(n, /a phone whose host screen stops answering says so/); assert.match(n, /Anyone who has the room code can join while the room is open/);
  assert.ok(!/not kept|only lock/.test(n), 'the old wording (GAMES 10:45: names and guesses are said to everyone, the code is not the only lock)');
  for (const line of ABOUT_THE_GAMES) assert.ok(!/\$|\bfree\b|\bcosts?\b|\b20\d\d\b|\bsoon\b|\bkey\b|\btoken\b/i.test(line), line);
  assert.ok(ABOUT_THE_GAMES.every((line) => r.text.includes(line)), 'every note reaches the AI in the answer text');
});

test('a closed account is told nothing about the page: no game name, no button, no number, no path', async () => {
  const { B, call } = world();
  for (const n of NAMES) {
    const r = await call(B, n); const all = everything(r);
    for (const secret of ['Guess the next line', 'Fill the gap', 'fill_the_gap', 'Which game', 'Start the game', 'room code', 'Lock the room', 'Remove', 'sample rounds', GAMES_PAGE_PATH, PLAYERS_PAGE_PATH]) assert.ok(!all.includes(secret), `${n}: ${secret}`);
    assert.ok(!/\b(45|8 players|five rounds)\b/.test(all), n);
  }
});

test('when GAMES\' own files are in the checkout, the page itself says what the tools say (skips nothing: with no page files it only notes so)', async (t) => {
  const fs = await import('node:fs');
  if (!fs.existsSync('assets/app-games.js')) { t.diagnostic('GAMES\' page files are not in this checkout (they land with games-live-1127): only the copied facts were checked.'); return; }
  const host = fs.readFileSync('assets/app-games.js', 'utf8');
  assert.match(host, new RegExp(`MAX_PLAYERS = ${GAMES_FACTS.players_max}\\b`)); assert.match(host, new RegExp(`ROUND_SECONDS = ${GAMES_FACTS.seconds_per_round}\\b`));
  for (const g of GAMES_OFFERED) assert.ok(host.includes(`'${g.label}'`), g.label);
  for (const b of [...FACTS.buttons, FACTS.which_game_legend, FACTS.lobby_heading]) assert.ok(host.includes(b), b);
  const room = fs.readFileSync('assets/game-room.js', 'utf8');
  assert.ok(room.includes(`'${FACTS.code_alphabet}'`), 'the room code alphabet: letters only, no digits, no I and no O');                // what "letters and no numbers" claims
  const len = room.match(/CODE_LEN = (\d+)\b/); assert.ok(len, 'CODE_LEN is found');
  if (Number(len[1]) !== FACTS.code_letters) t.diagnostic(`NOTE: the page's room code is now ${len[1]} letters, the copied facts say ${FACTS.code_letters}: update tests/fixtures/games-page-facts-1127.json (the tools' words state no length, so nothing else changes)`);
  assert.ok(Number(len[1]) >= 4 && Number(len[1]) <= 16);
  assert.match(room, /A room code is \$\{CODE_LEN\} letters with no I, no O and no numbers/);                                      // the page's own words for it
  assert.ok(host.includes("'Remove'") && host.includes("'Lock the room'") && host.includes('Waiting for players'));                    // the host controls the steps name
  assert.match(host, /if \(s\.phase !== 'lobby'\) return false;/);                                                                  // a player can be removed only while waiting
  const load = (file, key) => { const w = {}; new Function('window', fs.readFileSync(file, 'utf8'))(w); return w[key]; };
  assert.equal(load('assets/game-rounds.js', 'ryagramGameRounds').rounds.length, GAMES_FACTS.rounds_per_game);
  assert.equal(load('assets/game-gap-rounds.js', 'ryagramGameGapRounds').rounds.length, GAMES_FACTS.rounds_per_game);
  assert.ok(!/\bfetch\(|\.rpc\(|\.from\(/.test(host), 'the host page makes no server call, so the tools need none');
});
