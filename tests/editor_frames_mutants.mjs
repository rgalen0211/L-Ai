// Must-fail proof for tests/editor-frames.test.mjs (WEB piece B): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL. Baseline first. Run: node tests/editor_frames_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-fr');
const SUITES = ['editor-frames.test.mjs'];
const FR = 'assets/app-editor-frames.js';
const mutants = [
  ['the window is rounded, not floored', FR, 'const a = Math.floor(t / WINDOW) * WINDOW;', 'const a = Math.round(t / WINDOW) * WINDOW;'],
  ['a file hash is not checked', FR, "if (await sha256Hex(files[n]) !== f.sha256) fail(", "if (false) fail("],
  ['a file size is not checked', FR, "if (files[n].length !== f.bytes) fail(", "if (false) fail("],
  ['an extra file is let in', FR, 'if (inside.length !== listed.size || inside.some(n => !listed.has(n))) fail(', 'if (inside.some(n => !listed.has(n)) && false) fail('],
  ['a bundle with no manifest is used', FR, "if (!files['manifest.json']) fail(", "if (false) fail("],
  ['a window longer than ten seconds is used', FR, 'w.seconds[1] - w.seconds[0] > WINDOW', 'false'],
  ['another story is drawn', FR, 'scene.story_sha256 !== manifest.story_sha256', 'false'],
  ['the wrong format version is drawn', FR, 'manifest.version !== 4', 'false'],
  ['a failed window is asked again', FR, "if (e.state === 'failed') return;", ''],
  ['the next window is not asked for', FR, 'this._start(windowFor(w.b).text, true);', ''],
  ['a moment outside the window gets the last frame', FR, 'return f < win.frames ? f : (Number(second) <= win.seconds[1] ? win.frames - 1 : null);', 'return win.frames - 1;'],
  ['a moment before the window gets a frame', FR, 'if (!Number.isFinite(rel) || rel < 0) return null;', 'if (!Number.isFinite(rel)) return null;'],
  ['windows are never evicted', FR, 'this._evict(); this.onChange(text, e);', 'this.onChange(text, e);'],
  ['a picture is drawn before its window is ready', FR, "if (e.state !== 'ready') return { state: e.state, svg: null, reason: e.reason };", ''],
  ['the thumbnail width is not bounded', FR, 'Math.min(4096, Math.max(16, Math.floor(width)))', 'width'],
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
