// Must-fail proof for tests/connect-credit-words.test.mjs (what a connected AI is told about credits when the free previews are used up): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_credit_words_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-creditwords');
const SUITE = 'connect-credit-words.test.mjs';
const TL = 'supabase/functions/connect-core/tools.ts';
const NOT_ENOUGH = ": `The person has ${q.available} credits, which is not enough, so nothing more can be started right now: tell them so, and do not send them to the Ryagram app for it.`";
const mutants = [
  ['a refused preview sends a person with no credits to the app', TL, NOT_ENOUGH, ": `The person has ${q.available} credits and can start it in the Ryagram app.`"],
  ['a refused preview no longer says the free previews are used up', TL, 'the free previews of this project (6) or of the day (15 in any 24 hours) are used up. ', ''],
  ['the cost estimate sends a person who cannot pay to the app', TL, 'enough ? "A connection cannot spend credits: the person starts it in the Ryagram app." : "A connection cannot spend credits and the person does not have enough, so nothing more can be started right now."', '"A connection cannot spend credits: the person starts it in the Ryagram app."'],
  ['whoami says previews are always free again', TL, 'A preview is free for the first 6 of a project (15 in any 24 hours), then it costs 1 credit.', 'A preview is free.'],
  ['whoami sends everyone to the app for a refused step', TL, 'if they have none, nothing more can be started right now, so do not send them there for it. ', ''],
];

function run(cwd) { return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
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
