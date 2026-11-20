// Must-fail proof for tests/editor-nosketch.test.mjs (WEB 11-20, a person's own film in the website editor): each mutant breaks ONE thing in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/editor_nosketch_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-ns');
const SUITES = ['editor-nosketch.test.mjs'];
const AE = 'assets/app-editor.js';
const mutants = [
  ["a preview comes before the contact sheet", AE, "arts.find(x => x.kind === 'contact_sheet') || arts.find(x => x.kind === 'preview') || arts.find(x => x.kind === 'thumbnail')", "arts.find(x => x.kind === 'preview') || arts.find(x => x.kind === 'contact_sheet') || arts.find(x => x.kind === 'thumbnail')"],
  ["more than four versions are read", AE, '.slice(0, 4);', '.slice(0, 9);'],
  ["the oldest version first", AE, '.sort((a, b) => b.number - a.number)', '.sort((a, b) => a.number - b.number)'],
  ["a file with no address is shown", AE, 'if (!src) continue;', ''],
  ["a stopped page is drawn into", AE, 'if (!destroyedEditor) drawData();\n      }\n      function drawData()', 'drawData();\n      }\n      function drawData()'],
  ["a redraw restarts a preview", AE, 'if (key === drawnKey) return;', ''],
  ["the picture area is called an image", AE, "view.setAttribute('role', 'group');", "view.setAttribute('role', 'img');"],
  ["the sheet is not said to be not live", AE, 'It is not live: it does not show the changes you make here.', ''],
  ["a border width of 9 is sent", AE, 'Number.isFinite(v) && v >= 0 && v <= 4)', 'Number.isFinite(v))'],
  ["an emptied border box sends 0", AE, "raw !== '' && Number.isFinite(v)", "Number.isFinite(v)"],
  ["an out-of-range border is left standing in the box", AE, "num.value = good !== undefined ? String(good) : '';", ""],
  ["an unset theme reads as dark", AE, "sel.value = theme || '';", "sel.value = theme || 'dark';"],
  ["an AI change to a new row is not marked", AE, "const mark = key => (touched.has('look:' + key) ?", "const mark = key => (false ?"],
  ["the theme row sends the wrong key", AE, "key: 'sequence.theme', value: sel.value", "key: 'theme', value: sel.value"],
  ["the light ramp shows the dark ends", AE, "light ? '#eef1f6' : '#232838'", "'#232838'"],
  ["a real film gets the waiting list", AE, 'realFilm ? extraLookRows() :', 'false ? extraLookRows() :'],
  ["a film in a host counts as the website's own", AE, '!window.ryagramLiveHost && !bundleMode;', '!bundleMode;'],
  ["the film's own sheet is never looked for", AE, 'if (realFilm) loadSheet();', ''],
  ["a real film is titled with the sample's name", AE, "routeProject ? 'Edit your film' : isData ?", "isData ?"],
  ["the link goes to a version, not the film", AE, '`#/p/${routeProject}`', '`#/v/${routeProject}`'],
  ["the sketch is drawn for a real film", AE, 'if (realFilm) { drawNoSketch(); return; }', ''],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/migrations'), path.join(scratch, 'supabase/migrations'), { recursive: true });
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
