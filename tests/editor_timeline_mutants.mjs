// Must-fail proof for tests/editor-timeline.test.mjs (WEB item 1): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL. Baseline must PASS first. Run: node tests/editor_timeline_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-tl');
const SUITES = ['editor-timeline.test.mjs'];
const TLJS = 'assets/app-editor-timeline.js', ED = 'assets/app-editor.js';
const mutants = [
  ['the last year gets no tile', TLJS, 'for (let i = 0; i < max; i++) out.push', 'for (let i = 0; i < max - 1; i++) out.push'],
  ['the slider value is not clamped at the ends', TLJS, 'const raw = min + clamp(fraction, 0, 1) * (max - min);', 'const raw = min + fraction * (max - min);'],
  ['the fraction is not clamped', TLJS, 'max > min ? clamp((Number(value) - min) / (max - min), 0, 1) : 0', 'max > min ? (Number(value) - min) / (max - min) : 0'],
  ['the playhead is painted at the wrong place', TLJS, 'head.style.left = `${headFraction(years, value) * 100}%`;', 'head.style.left = `${headFraction(years, value) * 50}%`;'],
  ['the strip is announced to assistive tech', TLJS, "'aria-hidden': 'true', 'data-tiles'", "'data-tiles'"],
  ['dragging goes on after release', TLJS, 'const up = () => { down = false; };', 'const up = () => { };'],
  ['pointer down does not seek', TLJS, 'try { strip.setPointerCapture(ev.pointerId); } catch (e) { /* not every pointer can be captured */ } at(ev); });', 'try { strip.setPointerCapture(ev.pointerId); } catch (e) { /* not every pointer can be captured */ } });'],
  ['the note claims pictures that are not there', TLJS, "anyReal ? 'Pictures from your film. Click or drag to move the playhead.'", "true ? 'Pictures from your film. Click or drag to move the playhead.'"],
  ['the page never moves the strip playhead', ED, 'if (strip) strip.paint(position); if (!isData) head.style.left', 'if (!isData) head.style.left'],
  ['a seek does not stop playback', ED, 'seek: v => { stopPlay(); range.value', 'seek: v => { range.value'],
  ['the strip is built for the film with real drawing data too', ED, 'const strip = isData && !bundleMode && TLM ?', 'const strip = isData && TLM ?'],
  ['the ruler has too many labels', TLJS, 'const step = STEPS.find(s => d / s <= max) || STEPS[STEPS.length - 1];', 'const step = 1;'],
  ['the ruler does not start at zero', TLJS, 'for (let t = 0; t <= d + 1e-9; t += step) ticks.push(t);', 'for (let t = step; t <= d + 1e-9; t += step) ticks.push(t);'],
  ['a ruler click seeks in the wrong unit', TLJS, "o.seek(clamp(((ev.clientX - r.left) / r.width), 0, 1) * dur);", "o.seek(clamp(((ev.clientX - r.left) / r.width), 0, 1));"],
  ['the ruler is announced to assistive tech', TLJS, "h('div', { class: 'le-ruler-bar', 'aria-hidden': 'true' }, marks, head)", "h('div', { class: 'le-ruler-bar' }, marks, head)"],
  ['the ruler playhead is not clamped', TLJS, 'head.style.left = `${clamp(Number(f) || 0, 0, 1) * 100}%`; }, tickCount', 'head.style.left = `${(Number(f) || 0) * 100}%`; }, tickCount'],
  ['the page never moves the ruler playhead', ED, 'function paintHead() { if (rulerPaint) rulerPaint(Math.min(1, position / Math.max(1, ed.state.duration))); ', 'function paintHead() { '],
  ['the page leaves the ruler out of the lanes', ED, 'lanes.replaceChildren(...(rl ? [rl.lane] : []), ...E.TRACKS.map', 'lanes.replaceChildren(...E.TRACKS.map'],
  ['a click picks a year by a linear guess, not the tile under the pointer', TLJS, 'o.seek(years[tileAt(years.length, (ev.clientX - r.left) / r.width)]);', "o.seek(valueAt((ev.clientX - r.left) / r.width, o.get().min, o.get().max, 1));"],
  ['the tile under the pointer is off by one', TLJS, 'clamp(Math.floor(clamp(Number(fraction) || 0, 0, 1) * count), 0, count - 1)', 'clamp(Math.round(clamp(Number(fraction) || 0, 0, 1) * count), 0, count - 1)'],
  ['the playhead ignores the tile centres', TLJS, 'return (k + 0.5 + within) / n;', 'return (k + within) / n;'],
  ['the playhead does not stay on the last tile', TLJS, 'if (y >= years[n - 1]) return (n - 0.5) / n;', 'if (y >= years[n - 1]) return 1;'],
  ['the chat page generator leaves the timeline script out', 'tools/build-chat-editor.mjs', "'assets/app-editor-timeline.js', 'assets/app-editor.js',", "'assets/app-editor.js',"],
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
  fs.cpSync(path.join(root, 'tools'), path.join(scratch, 'tools'), { recursive: true });
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
