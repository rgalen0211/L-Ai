// Must-fail proof for tests/games-night.test.mjs (WEB-8): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL. Baseline first. Run: node tests/games_night_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-gn');
const SUITES = ['games-night.test.mjs'];
const D = 'assets/app-departments.js';
const mutants = [
  ['a game is dropped from the list', D, "['dub', 'Dub it'], ['who_said', 'Who said it?']];", "['dub', 'Dub it']];"],
  ['a game the night does not deal is advertised', D, "['who_said', 'Who said it?']];", "['who_said', 'Who said it?'], ['mafia', 'Mafia']];"],
  ['the games are listed in another order', D, "['guess_line', 'Guess the next line'], ['bluff', 'Bluff']", "['bluff', 'Bluff'], ['guess_line', 'Guess the next line']"],
  ['the old placeholder line is back', D, "line: 'Game night on your own TV: phones are the controllers", "placeholder: true, line: 'Game night on your own TV: phones are the controllers"],
  ['the old not-yet words are back', D, "notYet: ['Not part of Ryagram’s first release. Testers are playing an early version on their own computers.', 'There is no price and no date.']", "notYet: ['No game can be played yet.', 'There is no price and no date.']"],
  ['the Wi-Fi rule is dropped', D, ", 'It runs on your own computer and home Wi-Fi: no clip, voice or file goes to the internet or to Ryagram.'", ""],
  ['the AI host sentence is dropped', D, " Your own AI can host the night from the chat on the same computer.`;", "`;"],
  ['the box shows with the switch off', D, "const gameNightOn = cfg => !!cfg && cfg.gameNightSteps === true;", "const gameNightOn = cfg => !!cfg && cfg.gameNightSteps !== false;"],
  ['the box accepts the word account', D, "cfg.gameNightSteps === true;", "(cfg.gameNightSteps === true || cfg.gameNightSteps === 'account');"],
  ['the box carries a button', D, "h('ol', {}, h('li', {}, GAME_NIGHT_STEPS[0])", "h('button', { type: 'button' }, 'Start'), h('ol', {}, h('li', {}, GAME_NIGHT_STEPS[0])"],
  ['the steps start the Wi-Fi night', D, "python -m ryagram.games.room_server --practice'", "python -m ryagram.games.room_server --wifi --practice'"],
  ['the box does not say the page cannot start a night', D, "This page cannot start a night. A night runs on your own computer", "A night runs on your own computer"],
  ['the switch ships on', 'assets/ryagram-config.js', "gameNightSteps: false,", "gameNightSteps: true,"],
  ['the panel keeps the old line', 'supabase/functions/connect-core/home_panel.ts', 'line: "Game night on your own TV:', 'line: "Play with your own data and footage in small games you can share." + "'],
  ['the panel page address id is signed again', 'supabase/functions/connect-core/home_panel.ts', "b = (b ^ (b >>> 13)) >>> 0; }", "b ^= b >>> 13; }"],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
  fs.cpSync(path.join(root, 'app'), path.join(scratch, 'app'), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
const base = run(scratch).status;
if (base) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
