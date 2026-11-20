// Must-fail proof for tests/pro-editor-behaviour.test.mjs (WEB 11-20, PRO mode behaviour): each mutant breaks ONE thing in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/pro_editor_behaviour_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-pe');
const SUITES = ['pro-editor-behaviour.test.mjs'];
const PR = 'assets/app-editor-pro.js';
const mutants = [
  ["PRO is on by default", PR, "let pro = false, zoom = 0", "let pro = true, zoom = 0"],
  ["the choice is not remembered", PR, "if (remember) keep.set(modeKey, pro ? 'pro' : 'simple');", ""],
  ["the remembered choice is not used", PR, "if (keep.get(modeKey) === 'pro') setMode(true, false);", ""],
  ["zoom goes past eight", PR, "zoom = Math.max(0, Math.min(ZOOMS.length - 1, n));", "zoom = Math.max(0, n);"],
  ["leaving PRO keeps the zoom", PR, "if (!pro) { stopShuttle(); setZoom(0); safeOn = false; }", "if (!pro) { stopShuttle(); safeOn = false; }"],
  ["a frame step is always a tenth", PR, "const d = x.fps && x.fps > 10 ? 1 / x.fps : 0.1;", "const d = 0.1;"],
  ["the playhead runs past the end", PR, "x.seek(Math.max(0, Math.min(x.total(), s)));", "x.seek(Math.max(0, s));"],
  ["the rounding to a tenth is gone", PR, "const r1 = n => Math.round(n * 10) / 10;", "const r1 = n => n;"],
  ["a marker is added twice", PR, "if (!markers.some(m => Math.abs(m - at) < 0.05)) {", "if (true) {"],
  ["markers are not kept in order", PR, "markers.sort((a, b) => a - b); saveMarks();", "saveMarks();"],
  ["markers are shared by every film", PR, "const markKey = MARK_KEY + (c.project || 'none');", "const markKey = MARK_KEY + 'all';"],
  ["a bad stored marker is let in", PR, "markers = m.filter(x => Number.isFinite(x) && x >= 0).slice(0, 200);", "markers = m.slice(0, 200);"],
  ["more than 200 markers are kept", PR, ".slice(0, 200)", ".slice(0, 2000)"],
  ["the shuttle works in Simple", PR, "if (!pro) return;\n      const x = t(); if (!x) { say('There is no picture to play", "const x = t(); if (!x) { say('There is no picture to play"],
  ["the shuttle has no top speed", PR, "Math.max(-4, Math.min(4, rate + dir))", "rate + dir"],
  ["the other way keeps the speed", PR, "(rate !== 0 && Math.sign(rate) === dir) ? Math.max(-4, Math.min(4, rate + dir)) : dir;", "Math.max(-4, Math.min(4, rate + dir));"],
  ["K does not stop the shuttle", PR, "if (dir === 0) { stopShuttle(); say(''); return; }", "if (dir === 0) { say(''); return; }"],
  ["the shuttle runs past the end", PR, "if (next <= 0 || next >= y.total()) { seek(next <= 0 ? 0 : y.total()); stopShuttle(); say(''); return; }", "seek(next); return;"],
  ["keys work in Simple", PR, "if (!pro || ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;", "if (ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;"],
  ["keys work while typing", PR, "if (!pro || ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;", "if (!pro || ev.ctrlKey || ev.metaKey || ev.altKey) return;"],
  ["Ctrl+M adds a marker", PR, "if (!pro || ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;", "if (!pro || typing(ev.target)) return;"],
  ["the slider counts as typing", PR, "['range', 'button', 'checkbox', 'radio', 'color'].includes(el.type)", "['button', 'checkbox', 'radio', 'color'].includes(el.type)"],
  ["a split is two undo steps", PR, "{ op: 'trim_clip', id: sel.id, edge: 'end', to: at }, add], true)", "{ op: 'trim_clip', id: sel.id, edge: 'end', to: at }, add], false)"],
  ["a split loses the rest of a text clip", PR, "const rest = r1(sel.start + sel.len - at);", "const rest = 1;"],
  ["a split loses the picture", PR, "track: 'pictures', start: at, len: rest, picture: sel.picture", "track: 'pictures', start: at, len: rest"],
  ["a video clip is split", PR, "if (sel.track !== 'text' && sel.track !== 'pictures') {", "if (false) {"],
  ["a split too near an end is made", PR, "if (at < sel.start + min - 1e-9 || at > sel.start + sel.len - min + 1e-9) {", "if (false) {"],
  ["a data film gets a split button", PR, "c.isData ? null : btn('Split at playhead (S)'", "btn('Split at playhead (S)'"],
  ["undo back to here undoes one step", PR, "for (let guard = 0; guard < 60 && ed.log.length > i; guard += 1) {", "for (let guard = 0; guard < 1 && ed.log.length > i; guard += 1) {"],
  ["undo back can loop for ever", PR, "if (ed.log.length >= before) break;", ""],
  ["the history says A change for everything", PR, "case 'move_clip': return `Moved clip ${a.id} to ${r1(a.start)} s`;", "case 'move_clip': return 'A change';"],
  ["the key handler stays after the page stops", PR, "root.removeEventListener('keydown', onKey, true);", ""],
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
