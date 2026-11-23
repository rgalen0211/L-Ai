// Must-fail proof for tests/help-upload-retention.test.mjs (Help tells the truth about what happens to an uploaded file): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_help_retention_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it; a timeout is neither "caught" nor "missed"
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '): end its node child by its own PID and write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-helpret');
const SUITE = 'help-upload-retention.test.mjs';
const HELP = 'help/index.html', LIB = 'assets/app-library.js';
const U = '\\u2019';                                  // the app source writes an apostrophe as a backslash and u2019
const mutants = [
  ['the Help page brings back always deleted, none of it kept', HELP, "You choose whether Ryagram keeps your file: Store my data keeps it privately until you delete it; Don't keep my data deletes it once your final film is made, or after 7 days without activity.", 'Your uploaded data is always deleted once it has been used; none of it is kept.'],
  ['the Help page forgets the 7 days', HELP, ' or after 7 days without activity.</p>', '.</p>'],
  ['the Help page forgets the unreadable-file clause', HELP, " If a file can't be read you'll see why, and the file is deleted automatically.", ''],
  ['the Help page source comment says always deleted again', HELP, '<!-- source: the upload form (assets/app-library.js,', "<!-- source: the upload form: an uploader's files are always deleted (assets/app-library.js,"],
  ['the app help brings back always deleted, none of it kept', LIB, 'deleted automatically. You choose whether Ryagram keeps your file: Store', 'deleted automatically. Your uploaded data is always deleted once it has been used; none of it is kept. You choose whether Ryagram keeps your file: Store'],
  ['the app help says Coming soon again', LIB, "'Ryagram reads spreadsheets (CSV and similar files). If a file can" + U + 't be read', "'Coming soon: Ryagram reads spreadsheets (CSV and similar files). If a file can" + U + 't be read'],
  ['the upload form stops defaulting to Store my data', LIB, "checked: value === 'keep'", "checked: value === 'dont_keep'"],
  ['the upload form changes the 7 days', LIB, 'or after 7 days without activity. The film', 'or after 30 days without activity. The film'],
  ['the upload form renames the Store option', LIB, "radio('keep', 'Store my data',", "radio('keep', 'Keep my data',"],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'help'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  for (const f of [HELP, LIB]) fs.copyFileSync(path.join(root, f), path.join(scratch, f));
  fs.copyFileSync(path.join(root, 'tests', SUITE), path.join(scratch, 'tests', SUITE));
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
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
