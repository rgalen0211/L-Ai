// BACKLOG WEB-8 (WEB, 2026-11-13): the Games department's Coming soon page says what a game night is and what exists, nothing more (proposals/GEO-GAMES-PAGE-ENTRY-1113.md). The page can never start a night:
// a night runs on the person's own computer. The games it names are pinned to Ryagram's room_server.GAMES, so a removed game cannot stay advertised. Offline; no real clip, name or number of anyone's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
vm.runInNewContext(read('assets/app-departments.js'), { window: win, document: { addEventListener() {}, removeEventListener() {}, body: {}, createElement() { return {}; } }, console });
const Dp = win.ryagramDepartments;
const plain = v => JSON.parse(JSON.stringify(v));

// the games the page may name, pinned here as well as to the engine file below
const PINNED = ['guess_line', 'bluff', 'guess_who', 'old_maid', 'trivia', 'act_it_out', 'dub', 'who_said'];

test('the page names exactly the games a night deals, by id, in a pinned order (and the engine checkout agrees when it is there)', () => {
  assert.deepEqual(plain(Dp.GAME_LIST.map(g => g[0])), PINNED);
  const engine = process.env.RYAGRAM_ENGINE && `${process.env.RYAGRAM_ENGINE}/ryagram/games/room_server.py`;
  if (engine && fs.existsSync(engine)) {
    const m = fs.readFileSync(engine, 'utf8').match(/^GAMES = \(([^)]*)\)/m); assert.ok(m, 'room_server.GAMES found');
    const ids = [...m[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]);
    assert.deepEqual(ids, PINNED, 'the page advertises exactly what room_server.GAMES deals: change both together');
  }
});

test('the Games line and details say what exists: no placeholder, no "considering", no "no game can be played", the number comes from the list', () => {
  assert.equal(Dp.KNOWN.games.placeholder, undefined);
  assert.match(Dp.KNOWN.games.line, /^Game night on your own TV: phones are the controllers, and the clips come from videos you own\./);
  const d = Dp.DETAILS.games, all = [...d.building, ...d.rules, ...d.notYet].join(' ');
  assert.match(d.building[0], /^Eight games work today in the early version: Guess the next line, Bluff, Guess Who, Old Maid, Trivia, Act it out, Dub it and Who said it\? Your own AI can host the night from the chat on the same computer\.$/);
  assert.ok(d.rules.includes('It runs on your own computer and home Wi-Fi: no clip, voice or file goes to the internet or to Ryagram.'));
  assert.deepEqual(plain(d.notYet), ['Not part of Ryagram’s first release. Testers are playing an early version on their own computers.', 'There is no price and no date.']);
  assert.doesNotMatch(all, /considering|first idea|No game can be played yet|leaves your computer/i);
  assert.doesNotMatch(all + Dp.KNOWN.games.line, /\$\d|\b20\d\d\b|\bcoming (in|on|by)\b|\bwill be (ready|available)\b/i, 'no price, date or plan');
  assert.ok(!/\bnight starts here|start (a|your) night (here|now)|click|press the button/i.test(all + Dp.KNOWN.games.line), 'nothing says the website starts a night');
});

test('the box "Try it on your computer": a switch that is OFF, strict, text only (no button, no link), the practice night only, and it says the page cannot start a night', () => {
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /\n  gameNightSteps: false,/);
  assert.equal(Dp.gameNightOn({ gameNightSteps: true }), true);
  for (const v of [false, 'account', 'true', 1, undefined, null]) assert.equal(Dp.gameNightOn({ gameNightSteps: v }), false, String(v));
  assert.equal(Dp.gameNightOn(null), false);
  const steps = plain(Dp.GAME_NIGHT_STEPS);
  assert.equal(steps.length, 3);
  assert.equal(steps[1], '$env:RYAGRAM_GAME_ROOM="1"; python -m ryagram.games.room_server --practice', 'the practice night only: made-up clips, the library never opened');
  assert.ok(!/--wifi|RYAGRAM_GAME_ROOM_WIFI|--ai-host/.test(steps.join(' ')), 'no Wi-Fi, no AI host, no library in the page\'s steps');
  const src = read('assets/app-departments.js');
  const box = src.slice(src.indexOf('function gameNightBox()'), src.indexOf('// The small picture a Coming soon page may carry'));
  assert.ok(!/'button'|'a',|href|onclick|fetch\(|window\.open|location\./.test(box), 'text only: nothing here runs, opens or links');
  assert.match(box, /This page cannot start a night\. A night runs on your own computer, with made-up clips, and your library is never opened\./);
  assert.match(src, /id === 'games' && gameNightOn\(window\.ryagramConfig\) \? gameNightBox\(\) : null/);
});

test('wiring: the stamp moved and the switch is read strictly', () => {
  assert.match(read('app/index.html'), /app-departments\.js\?v=20261113c/);
});

test("the home panel games line is the site line, and its page address keeps its shape (the id hash is unsigned; a signed one printed a minus sign and broke the address)", () => {
  const panel = read('supabase/functions/connect-core/home_panel.ts');
  assert.ok(panel.includes('games: { label: "Games", line: "' + Dp.KNOWN.games.line + '" }'), 'the panel says what the site says');
  assert.match(panel, /b = \(b \^ \(b >>> 13\)\) >>> 0;/);
});
