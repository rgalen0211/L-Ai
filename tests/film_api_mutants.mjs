// Must-fail proof for tests/film-api.test.mjs (the editor's film API): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every text must occur exactly once. Run:  node tests/film_api_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-filmapi');
const C = 'supabase/functions/connect-core/';
const SUITES = ['film-api.test.mjs'];
const HEAD = 'name: "get_story", title: "Read back a project\'s saved story", scope: "read", readOnly: true';
const SC = C + 'story_check.ts';
const F = 'assets/app-film-api.js';
const mutants = [
  ['polling can be faster than every 3 seconds', F, `const poll = Math.max(POLL_MS, Number(pollMs) || POLL_MS);`, `const poll = Number(pollMs) || POLL_MS;`],
  ['a limit or a pause is taken for the film failing', F, `code === '42501' && ++busy < BUSY_TRIES`, `false && ++busy < BUSY_TRIES`],
  ['a limit is asked again for ever', F, `++busy < BUSY_TRIES`, `++busy < 1000000`],
  ['a refused window is not final', F, `final: code === '22023'`, `final: false`],
  ['a window that failed on its input is not final', F, `|| 'The engine could not draw this part of your film.', { final: true })`, `|| 'The engine could not draw this part of your film.', { final: false })`],
  ['a percentage is invented while it builds', F, `onProgress(fraction);`, `onProgress(fraction == null ? 0.5 : fraction);`],
  ['a progress outside 0 to 1 is passed on', F, `v >= 0 && v < 1) fraction = v;`, `true) fraction = v;`],
  ['a failing progress look fails the build', F, `catch (e) { fraction = null; }`, `catch (e) { throw e; }`],
  ['a progress is looked up with no job', F, `typeof r.job_id === 'string' && r.job_id) {`, `true) {`],
  ['the progress the worker wrote is never read', F, `const v = await jobProgress(r.job_id);`, `const v = null;`],
  ['a bad window is asked for', F, `if (typeof text !== 'string' || !WINDOW.test(text))`, `if (false)`],
  ['an empty file is taken for a bundle', F, `if (!out.length) throw`, `if (false) throw`],
  ['a plan whose windows do not tile from zero is accepted', F, `if (a !== at || b <= a || b - a > 10) fail();`, `if (b <= a) fail();`],
  ['a plan with no render start is accepted', F, `|| !(rs >= 0) ||`, `||`],
  ['a plan with no film is accepted', F, `if (!isObj(film)) fail();`, `if (false) fail();`],
  ['the plan is not read from the first window', F, `planFromManifest(readManifest(await windowBytes(FIRST_WINDOW)))`, `planFromManifest(readManifest(await windowBytes('10:20')))`],
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
