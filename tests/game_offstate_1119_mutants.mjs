// Planted faults for tests/game-offstate-1119.test.mjs (GAMES 11-19). Each fault is written into the file, the test must FAIL (a failed
// assertion, not a crash), and the file is put back byte for byte. The unbroken code must pass first. Run alone, in a clean tree:
//   node tests/game_offstate_1119_mutants.mjs        rc 0 every fault caught, 1 a fault missed or a bad baseline
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = path.join('tests', 'game-offstate-1119.test.mjs');
const M = [
  ['the TV page still names the draft game in its tab', 'game-tv/index.html', "<title>Not available yet | L'Ai</title>", "<title>Guess the next line, TV screen (draft) | L'Ai</title>"],
  ['the phone page loses one help link', 'game-phone/index.html', `      <li><a href="/app/">Sign in to the app</a></li>\n`, ''],
  ['the TV page keeps a second h1 inside the hidden game', 'game-tv/index.html', '<div id="game-tv" hidden></div>', '<div id="game-tv" hidden><h1>Guess the next line (draft TV screen)</h1></div>'],
  ['the phone footer is back in its old order', 'game-phone/index.html', '<a href="/privacy-policy.html">Privacy Policy</a><a href="/ai-content/">AI content</a>', '<a href="/ai-content/">AI content</a><a href="/privacy-policy.html">Privacy Policy</a>'],
  ['the TV script never brings the game title back', 'assets/game-tv.js', `    if (enabled) document.title = "Guess the next line, TV screen (draft) | L'Ai";`, '    if (false) document.title = "";'],
  ['the phone script sets the game title even when OFF', 'assets/game-phone.js', '    if (enabled) document.title = ', '    if (true) document.title = '],
  ['switches-off goes back to finding only a <p>, so it stops checking the game pages', 'tests/switches-off.test.mjs', 'if (/<(?:p|section) id="not-available"[ >]/.test(code[f])) {', 'if (/<p id="not-available">/.test(code[f])) {'],
];
const run = () => spawnSync(process.execPath, ['--test', TEST], { cwd: root, encoding: 'utf8' });
const base = run();
console.log(`baseline rc ${base.status}`);
if (base.status !== 0) { console.log('BAD BASELINE: the unbroken code does not pass; no fault run'); process.exit(1); }
const missed = [];
for (const [name, file, from, to] of M) {
  const p = path.join(root, file), orig = fs.readFileSync(p), crlf = orig.includes('\r\n'), txt = orig.toString('utf8').replace(/\r\n/g, '\n');
  if (txt.split(from).length !== 2) { console.log(`  RAN BADLY  ${name}: pattern found ${txt.split(from).length - 1} times`); missed.push(name); continue; }
  let r;
  try { const out = txt.replace(from, to); fs.writeFileSync(p, crlf ? out.replace(/\n/g, '\r\n') : out); r = run(); } finally { fs.writeFileSync(p, orig); }
  const failedRight = r.status === 1 && /AssertionError/.test(r.stdout + r.stderr) && !/SyntaxError|ReferenceError|TypeError/.test(r.stdout + r.stderr);
  console.log((failedRight ? '  caught  ' : `  MISSED (rc ${r.status})  `) + name);
  if (!failedRight) missed.push(name);
}
console.log(`\n${M.length - missed.length} of ${M.length} caught`);
process.exit(missed.length ? 1 : 0);
