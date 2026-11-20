// Must-fail proof for tests/render-hide-film-files.test.mjs (WEB 2026-11-20): each mutant breaks ONE thing in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/render_hide_film_files_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-hf');
const LB = 'assets/app-library.js';
const mutants = [
  ['the filter is gone', LB, "jobs.filter(j => j.job_type !== 'film_bundle')", 'jobs'],
  ['the filter keeps film_bundle instead of removing it', LB, "j.job_type !== 'film_bundle'", "j.job_type === 'film_bundle'"],
  ['the raw jobs are drawn again', LB, 'shown.map(jobItem)', 'jobs.map(jobItem)'],
  ['the empty words are checked on the raw list', LB, 'listEl.replaceChildren(shown.length', 'listEl.replaceChildren(jobs.length']
];
const run = cwd => spawnSync(process.execPath, ['--test', path.join('tests', 'render-hide-film-files.test.mjs')], { encoding: 'utf8', cwd });
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'tests/render-hide-film-files.test.mjs'), path.join(scratch, 'tests/render-hide-film-files.test.mjs'));
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
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
