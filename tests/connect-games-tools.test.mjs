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
import { GAMES_OFFERED, GAMES_PAGE_PATH, PLAYERS_PAGE_PATH, HOW_A_ROUND_GOES } from '../supabase/functions/connect-core/games_tools.ts';

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
  assert.deepEqual(r.data.games.map((g) => g.id), ['guess_the_next_line', 'fill_the_gap'], 'the two games the host screen offers under "Which game?" (GAMES games-live-1127, assets/app-games.js)');
  assert.match(r.text, /guess_the_next_line: Guess the next line\./); assert.match(r.text, /fill_the_gap: Fill the gap\./); assert.match(r.text, /open_games_page/);
  assert.deepEqual(r.data.games, GAMES_OFFERED);
});

test('open_games_page: where Games is, how a round goes, and what the AI cannot do', async () => {
  const { A, call } = world();
  const r = await call(A, 'open_games_page');
  assert.ok(!r.isError, r.text);
  assert.equal(r.data.page_path, GAMES_PAGE_PATH); assert.equal(r.data.players_page_path, PLAYERS_PAGE_PATH);
  for (const p of [r.data.page_path, r.data.players_page_path]) assert.match(p, SITE_PATH, p);                // a path on the site, never an address
  assert.deepEqual(r.data.steps, [...HOW_A_ROUND_GOES]);
  assert.match(r.text, /four-letter room code/); assert.match(r.text, /if the page looks different, the page is right/); assert.match(r.text, /cannot press anything/);
  // the four steps follow the page as built (games-live-1127): the room opens by itself on the page (no "start a round" first), the host presses Start the game once players are in, the rounds are made-up samples
  assert.match(r.data.steps[1], /opens a room by itself/); assert.ok(!/^Start a round there/.test(r.data.steps[1]));
  assert.match(r.data.steps[3], /Start the game/); assert.match(r.data.steps[3], /made-up samples/); assert.match(r.data.steps[3], /no video/);
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
  assert.deepEqual(Object.keys(d).sort(), ['ai_can', 'ai_cannot', 'ok', 'page_path', 'players_page_path', 'steps']);
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
