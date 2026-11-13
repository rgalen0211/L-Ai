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
  ['a failed window is asked again', FR, "_settled(e) { return e.state === 'ready' || e.state === 'building' || e.state === 'failed'; }", "_settled(e) { return e.state === 'ready' || e.state === 'building'; }"],
  ['no window ahead is asked for', FR, 'for (let k = 1; k <= 2; k++) if (here.idx + k < this.plan.windows.length) order.push(here.idx + k);', ''],
  ['a moment outside the window gets the last frame', FR, 'return f < win.frames ? f : (Number(second) <= win.seconds[1] ? win.frames - 1 : null);', 'return win.frames - 1;'],
  ['a moment before the window gets a frame', FR, 'if (!Number.isFinite(rel) || rel < 0) return null;', 'if (!Number.isFinite(rel)) return null;'],
  ['windows are never evicted', FR, 'this._evict(); this.onChange(text, e);', 'this.onChange(text, e);'],
  ['a picture is drawn before its window is ready', FR, "if (e.state !== 'ready') return { state: e.state, svg: null, reason: e.reason };", ''],
  ['the thumbnail width is not bounded', FR, 'Math.min(4096, Math.max(16, Math.floor(width)))', 'width'],
  ['the plan may have a gap', FR, 'w.seconds[0] !== at || ', ''],
  ['the plan windows may be over ten seconds', FR, 'w.seconds[1] - w.seconds[0] > WINDOW\n          || w.window !==', 'false\n          || w.window !=='],
  ['film seconds are used as window seconds', FR, 'const t = Number(second) - this.plan.renderStart, i = windowIndex(this.plan.windows, t);', 'const t = Number(second), i = windowIndex(this.plan.windows, t);'],
  ['a moment in the title block gets a window', FR, 'return i < 0 ? { text: null, sec: t, idx: -1 } : { text: this.plan.windows[i].window, sec: t, idx: i };', 'return { text: this.plan.windows[Math.max(0, i)].window, sec: t, idx: Math.max(0, i) };'],
  ['the film end is not in the last window', FR, 'return t === windows[windows.length - 1].seconds[1] ? windows.length - 1 : -1;', 'return -1;'],
  ['any number of windows may build at once', FR, 'if (this.building() >= this.maxInFlight) break;', ''],
  ['the window behind is never asked', FR, 'if (here.idx > 0) order.push(here.idx - 1);', ''],
  ['a control character stays in a label', FR, 'label: clean(c.label)', 'label: String(c.label)'],
  ['the film editor sets any HTML', 'assets/app-editor-film.js', 'view.innerHTML = r.svg;', 'view.innerHTML = r.svg + String(r.reason);'],
  ['a colour swap is never applied', FR, "svg: this.drawer.draw(this._sceneFor(e), f, { parts: 'all' })", "svg: this.drawer.draw(e.win.scene, f, { parts: 'all' })"],
  ['a bad colour value is let through', FR, 'if (HEX.test(from) && HEX.test(to) && from !== to) out[from] = to;', 'out[from] = to;'],
  ['reset does not put the film colours back', FR, 'this.colours = out; this.cver++;', 'this.colours = Object.assign(this.colours, out); this.cver++;'],
  ['a stale recoloured copy is reused', FR, 'if (e.rc && e.rc.ver === this.cver) return e.rc.scene;', 'if (e.rc) return e.rc.scene;'],
  ['a colour the window does not use is passed to the drawer', FR, 'if (have.has(from)) pairs[from] = to;', 'pairs[from] = to;'],
  ['the colours are offered before the window is ready', FR, "if (!e || e.state !== 'ready' || typeof this.drawer.palette !== 'function') return [];", "if (!e) return [];"],
  ['the page does not say the colours are not saved', 'assets/app-editor-film.js', 'It is not saved to your film yet.', 'It is saved.'],
  ['a bundle for another window is accepted', FR, "if (win.seconds[0] !== a || win.seconds[1] !== b) fail(", "if (false) fail("],
  ['a dropped connection is final', FR, "if (err instanceof FramesError || (window.ryagramZip && err instanceof window.ryagramZip.BundleError) || (err && err.final === true)) e.state = 'failed';", "e.state = 'failed'; if (false) {"],
  ['a refusal of the bundle is not final', FR, "if (err instanceof FramesError || (window.ryagramZip && err instanceof window.ryagramZip.BundleError) || (err && err.final === true)) e.state = 'failed';\n        else {", "if (err && err.final === true) e.state = 'failed';\n        else {"],
  ['a window is asked again without waiting', FR, 'if (e.retryAt && this.now() < e.retryAt) return;\n      e.state', 'e.state'],
  ['a limit waits no longer than a drop', FR, "(err && err.code === '42501' ? 15000 : 3000)", '3000'],
  ['the engine commit is not compared', FR, 'if (scene.engine_commit !== manifest.engine_commit) fail(', 'if (false) fail('],
  ['the frame rate is not compared', FR, 'if (Number(scene.fps) !== Number(manifest.fps)) fail(', 'if (false) fail('],
  ['the page loads the film editor without an API', 'assets/app-editor.js', "const filmApi = filmReady && typeof window.ryagramFilmApi === 'function' ?", "const filmApi = filmReady && true ?"],
  ['the live film API runs in the mock too', 'assets/app-editor.js', 'filmReady && routeProject && !window.ryagramMock && data', 'filmReady && routeProject && data'],
  ['the stand-in is dropped before the film opens', 'assets/app-editor.js', 'if (ok && !destroyedEditor) { standin.hidden = true; filmEd.el.hidden = false; }', 'standin.hidden = true; filmEd.el.hidden = false;'],
  ['the film editor shows before the film opens', 'assets/app-editor.js', 'if (filmEd) filmEd.el.hidden = true;', ''],
  ['the glue asks the oldest version', 'assets/app-film-glue.js', "order('number', { ascending: false })", "order('number', { ascending: true })"],
  ['the glue asks for another window than it was given', 'assets/app-film-glue.js', "p_seconds: text", "p_seconds: '0:10'"],
  ['the glue loses the SQLSTATE', 'assets/app-film-glue.js', "e.code = r.error.code || null;", ""],
  ['the glue invents a progress number', 'assets/app-film-glue.js', "return typeof v === 'number' ? v : null;", "return typeof v === 'number' ? v : 0.5;"],
  ['the glue reads a packed manifest', 'assets/app-film-glue.js', "if (method !== 0) fail(", "if (false) fail("],
  ['the glue accepts any address', 'assets/app-film-glue.js', "if (typeof project !== 'string' || !UUID.test(project)) fail(", "if (false) fail("],
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
