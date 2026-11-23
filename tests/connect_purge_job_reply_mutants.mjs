// Must-fail proof for tests/connect-purge-job-reply.test.mjs (what the two purge functions tell the scheduler): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_purge_job_reply_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-purgejobreply');
const SUITE = 'connect-purge-job-reply.test.mjs';
const SW = 'supabase/functions/purge-uploads/sweep.ts', PI = 'supabase/functions/purge-partial-uploads/index.ts';
const SJ = '    if (caller === "job") return json(200, { ok: true, fn: "purge-uploads" });\n';
const PJ = '  if (caller === "job") return json(200, { ok: true, fn: "purge-partial-uploads" });\n';
const mutants = [
  ['purge-uploads no longer says its name to the scheduler', SW, SJ, ''],
  ['purge-uploads says another function\'s name', SW, 'fn: "purge-uploads" });', 'fn: "purge-partial-uploads" });'],
  ['purge-uploads tells the scheduler how much it removed', SW, 'return json(200, { ok: true, fn: "purge-uploads" });', 'return json(200, { ok: true, fn: "purge-uploads", removed });'],
  ['purge-uploads answers the scheduler with the detailed body only', SW, SJ, '    if (caller === "job") return reply(caller, 200, { due: due.length, removed });\n'],
  ['purge-partial-uploads no longer says its name to the scheduler', PI, PJ, ''],
  ['purge-partial-uploads says the other function\'s name', PI, 'fn: "purge-partial-uploads" });', 'fn: "purge-uploads" });'],
  ['purge-partial-uploads gives its name to every caller', PI, '  if (caller === "job") return json(200, { ok: true, fn: "purge-partial-uploads" });\n', '  return json(200, { ok: true, fn: "purge-partial-uploads" });\n'],
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
