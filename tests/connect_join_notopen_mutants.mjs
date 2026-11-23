// Must-fail proof for tests/connect-join-notopen.test.mjs (what the join function says when sign-up is not open): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_join_notopen_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-joinnotopen');
const SUITE = 'connect-join-notopen.test.mjs';
const JN = 'supabase/functions/join/join.ts';
const NW = 'export const NOT_OPEN_WORDS = "Making an account is not open yet. Please try again later.";';
const OFF = 'if (r.reason === "off") return reply(409, { error: NOT_OPEN_WORDS });';
const mutants = [
  ['the not-open words send the person to a waitlist again', JN, NW, 'export const NOT_OPEN_WORDS = "Making an account is not open yet. Join the waitlist instead.";'],
  ['the not-open words send the person to an invite', JN, NW, 'export const NOT_OPEN_WORDS = "Making an account is not open yet. Ask for an invite.";'],
  ['the not-open words stop saying to try again', JN, NW, 'export const NOT_OPEN_WORDS = "Making an account is not open yet.";'],
  ['the not-open answer is not a 409 (the page reads 409 as not open)', JN, OFF, 'if (r.reason === "off") return reply(400, { error: NOT_OPEN_WORDS });'],
  ['the not-open answer is its own old text again, not the constant', JN, OFF, 'if (r.reason === "off") return reply(409, { error: "Making an account is not open yet. Join the waitlist instead." });'],
  ['the throttled answer points to a person', JN, 'return reply(429, { error: "Too many tries. Wait a while, then try again." });', 'return reply(429, { error: "Too many tries. Ask Ryan for an invite." });'],
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
