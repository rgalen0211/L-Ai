// Must-fail proof for tests/film-strip.test.mjs (WEB 11-20, the Film row as a strip of frames): each mutant breaks ONE thing in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/film_strip_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-fs');
const SUITES = ['film-strip.test.mjs'];
const FR = 'assets/app-editor-film.js';
const mutants = [
  ['a tile asks the worker for its window', FR, '// a tile whose window is not ready stays a plain tile:', "if (st === 'idle') store.want(t.mid); // a tile whose window is not ready stays a plain tile:"],
  ['a tile every 10 px, not 96', FR, 'Math.floor(w / 96)', 'Math.floor(w / 10)'],
  ['no minimum of three tiles', FR, 'Math.max(3, Math.min(14,', 'Math.max(0, Math.min(14,'],
  ['no maximum of fourteen tiles', FR, 'Math.min(14, Math.floor(w / 96))', 'Math.floor(w / 96)'],
  ['a bar with no width gets tiles', FR, 'if (w < 40) return;', ''],
  ['a title tile loses its words', FR, "(c && c.label) || 'Title'", "'Title'"],
  ['the old colours stay on the tiles', FR, 'thumbVer = store.cver; thumbs.clear();', 'thumbVer = store.cver;'],
  ['a tile is drawn again every time', FR, 'thumbs.set(key, u); setThumb(t, u);', 'setThumb(t, u);'],
  ['two tiles in one turn', FR, 'setTimeout(fillThumbs, 40); break; } }', 'setTimeout(fillThumbs, 40); } }'],
  ['pressing a tile does nothing', FR, "tile.addEventListener('click', () => seekSeconds(mid));", "tile.addEventListener('click', () => {});"],
  ['no tile is marked', FR, "t.tile.classList.toggle('le-film-tile-on', on);", "t.tile.classList.toggle('le-film-tile-on', false);"],
  ['a stopped page keeps drawing', FR, 'if (filling || destroyed || !store || !tiles.length) return;', 'if (filling || !store || !tiles.length) return;'],
  ['the note never goes away', FR, "stripNote.hidden = tiles.every(t => !t.inR || t.tile.querySelector('img'));", 'stripNote.hidden = false;'],
  ['the tile is drawn at a different size', FR, 'store.thumbUri(t.mid, 200)', 'store.thumbUri(t.mid, 64)'],
  ['the note is gone', FR, 'Frames fill in as you play or move through the film.', ''],
  ['every tile is a tab stop', FR, "t.tile.tabIndex = on ? 0 : -1;", "t.tile.tabIndex = 0;"],
  ['no tile is the current frame', FR, "if (on) t.tile.setAttribute('aria-current', 'true'); else t.tile.removeAttribute('aria-current');", ""],
  ['the old current frame stays marked', FR, "else t.tile.removeAttribute('aria-current');", ""],
  ['the right arrow does nothing', FR, "ArrowRight: 1,", "ArrowRight: 0,"],
  ['Home goes to the last tile', FR, "Home: -Infinity, End: Infinity", "Home: Infinity, End: Infinity"],
  ['the arrow keys let focus run past the ends', FR, "Math.max(0, Math.min(tiles.length - 1, Number.isFinite", "Math.max(0, Number.isFinite"],
  ['an arrow key is not taken from the page', FR, "ev.preventDefault(); tiles[next].tile.focus();", "tiles[next].tile.focus();"],
  ['leaving the page leaves the strip’s clock running', FR, "stop(); if (pumpTimer) clearInterval(pumpTimer); }", "stop(); }"],
  ['the strip does not tell a screen reader about the arrows', FR, " Left and Right arrows move between frames.", ""],
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
  fs.copyFileSync(path.join(root, '.gitattributes'), path.join(scratch, '.gitattributes'));
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
