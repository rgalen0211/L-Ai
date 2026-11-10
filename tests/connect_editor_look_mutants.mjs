// Must-fail proof for tests/connect-editor-look.test.mjs (full-screen room at the bottom of the chat editor panel; Look swatches that are not black): each mutant breaks ONE thing in a scratch copy, the page is
// REGENERATED from the broken source, and the suites must then FAIL. A baseline run on the unbroken copy must PASS first, and every text must occur exactly once.
// Run:  node tests/connect_editor_look_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-edlook');
const H = 'tools/chat-editor/live-host.js', CSS = 'tools/chat-editor/chat-extra.css', AE = 'assets/app-editor.js';
const SUITES = ['connect-editor-look.test.mjs', 'connect-chat-editor.test.mjs'];
const mutants = [
  ['the full-screen room is only 40 px', CSS, 'padding-bottom:calc(96px + var(--le-safe-bottom,0px))', 'padding-bottom:calc(40px + var(--le-safe-bottom,0px))'],
  ['the full-screen room is not there', CSS, '.le-fullscreen body{padding-bottom:calc(96px + var(--le-safe-bottom,0px))}', ''],
  ['the room is there in the chat too', CSS, '.le-fullscreen body{padding-bottom:calc(96px + var(--le-safe-bottom,0px))}', 'body{padding-bottom:calc(96px + var(--le-safe-bottom,0px))}'],
  ['the page never marks itself as full screen', H, "de.classList.toggle('le-fullscreen', ctx.displayMode === 'fullscreen');", ''],
  ['the page marks itself as full screen when it is not', H, "de.classList.toggle('le-fullscreen', ctx.displayMode === 'fullscreen');", "de.classList.toggle('le-fullscreen', ctx.displayMode !== 'fullscreen');"],
  ['the safe area is passed on without a limit', H, 'Math.min(200, Math.max(0, Math.round(ctx.safeAreaInsets.bottom)))', 'ctx.safeAreaInsets.bottom'],
  ['the safe area is never read', H, "typeof ctx.safeAreaInsets.bottom === 'number' && isFinite(ctx.safeAreaInsets.bottom)", 'false'],
  ['a document element without a style object breaks the page', H, "if (de.style && de.style.setProperty) de.style.setProperty(", "de.style.setProperty("],
  ['an unset Look colour is a black swatch', AE, "value: ed.state.look[key] !== undefined ? ed.state.look[key] : DATA_BASE().look[key], id: `le-look-${key}`", "value: ed.state.look[key], id: `le-look-${key}`"],
  ['the panel does not say the swatches are starting colours', AE, "LOOK_ROWS.some(([k]) => ed.state.look[k] === undefined)", 'false'],
  ['the panel says the swatches are the film\'s own colours', AE, "is shown in the editor's own starting colour. The film's own colours are not shown here yet.", "is the film's own colour."],
];

function run(cwd) {
  const gen = spawnSync(process.execPath, [path.join('tools', 'build-chat-editor.mjs')], { encoding: 'utf8', cwd });
  if (gen.status) return gen;
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tests', 'assets', 'tools/chat-editor', 'tools/maker-live']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  fs.copyFileSync(path.join(root, 'tools/build-chat-editor.mjs'), path.join(scratch, 'tools/build-chat-editor.mjs'));
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`BROKEN MUTANT (text found ${n} times, need 1): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const r = run(scratch);
  const caught = r.status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
