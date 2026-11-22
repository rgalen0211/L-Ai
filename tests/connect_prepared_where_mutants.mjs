// Must-fail proof for tests/connect-prepared-where.test.mjs (where the person finds the table their AI handed over): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_prepared_where_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it; a timeout is neither "caught" nor "missed"
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '): end its node child by its own PID and write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-prepwhere');
const SUITE = 'connect-prepared-where.test.mjs';
const TL = 'supabase/functions/connect-core/tools.ts', LB = 'assets/app-library.js', PR = 'assets/app-prepared.js';
const mutants = [
  ['the answer to the AI goes back to the old "under Your data" words', TL, 'It waits ${PREPARED_WHERE} for the PERSON', 'It waits under "${r.where}" in the Ryagram app for the PERSON'],
  ['the answer forgets to tell the AI to say it in those words', TL, 'Tell the person where to find it, in those words.', 'Tell the person where to find it.'],
  ['list_my_data stops saying where a waiting table is', TL, 'for the person to accept ${PREPARED_WHERE}.`', 'for the person to accept in the Ryagram app.`'],
  ['the words forget the Advanced tab', TL, 'on the Advanced tab of one of their films', 'on one of their films'],
  ['the structured answer goes back to the database words (Your data)', TL, 'where: PREPARED_WHERE, expires_at: r.expires_at, measured: m }', 'where: r.where, expires_at: r.expires_at, measured: m }'],
  ['the words forget a film must exist', TL, ' (a film has to exist: create_project makes one)', ''],
  ['the words forget the card title', TL, 'in the card called \\"Prepared by your AI\\", which has', 'in the card which has'],
  ['the words name a button the app does not have', TL, 'an \\"Accept and continue\\" button', 'an \\"Approve\\" button'],
  ['the app renames the Advanced tab', LB, "{ id: 'advanced', label: 'Advanced', el: advancedEl }", "{ id: 'advanced', label: 'More', el: advancedEl }"],
  ['the app renames the card', PR, "h('h2', { id: 'prepared-title' }, 'Prepared by your AI')", "h('h2', { id: 'prepared-title' }, 'From your AI')"],
  ['the app renames the button', PR, "'Accept and continue'", "'Use it'"],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase'), path.join(scratch, 'supabase'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'assets'), { recursive: true });
  for (const f of [LB, PR]) fs.copyFileSync(path.join(root, f), path.join(scratch, f));
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
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
