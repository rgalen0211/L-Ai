// Must-fail proof for tests/connect-safety-limits.test.mjs (NEXT-CONNECT 169): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_limits_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-sl');
const C = 'supabase/functions/connect-core/';
const T = C + 'tools.ts', D = C + 'dispatch.ts', Y = C + 'types.ts', S = C + 'story_check.ts', F = C + 'fake.ts';
const SUITES = ['connect-safety-limits.test.mjs'];
const mutants = [
  ['the account-wide call limit is gone', D, '    if (!panelCall && !(await policy.hit(principal, "calls_acct", LIMITS.callsPerMinutePerAccount, 60))) {', '    if (false) {'],
  ['the account limit is as small as one connection', Y, 'callsPerMinutePerAccount: 120,', 'callsPerMinutePerAccount: 60,'],
  ['the account limit is far too large', Y, 'callsPerMinutePerAccount: 120,', 'callsPerMinutePerAccount: 100000,'],
  ['a refused call does not say how long to wait', D, ' retry_after_seconds: windowSeconds,', ''],
  ['the account refusal does not say it is the account', D, 'Too many calls on this Ryagram account in the last minute, counting every connected AI together', 'Too many calls in the last minute'],
  ['the connection refusal does not say it is this connection', D, 'Too many calls from this connection in the last minute', 'Too many calls in the last minute'],
  ['the hourly limit reports the wrong window', D, '"hourly_jobs", LIMITS.ladderPerHourPerUser, 3600)', '"hourly_jobs", LIMITS.ladderPerHourPerUser, 60)'],
  ['one busy AI uses up the minute of the others', F, '${bucket === "calls" ? ":" + p.clientId : ""}', ''],
  ['a story that keeps failing is tried again forever', T, 'if (failedBefore >= LIMITS.failedJobsPerStory) {', 'if (false) {'],
  ['any job state counts as a failure', T, 'j.story_sha256 === sha && FAILED_JOB.has(j.state)).length;', 'j.story_sha256 === sha && true).length;'],
  ['failures of other stories count', T, 'j.job_type === jobType && j.story_sha256 === sha && FAILED_JOB.has(j.state)).length;', 'j.job_type === jobType && FAILED_JOB.has(j.state)).length;'],
  ['failed jobs of the other kind count', T, 'view.jobs.filter((j) => j.job_type === jobType && j.story_sha256 === sha && FAILED_JOB.has(j.state)).length;', 'view.jobs.filter((j) => j.story_sha256 === sha && FAILED_JOB.has(j.state)).length;'],
  ['cancelled jobs count as failures', T, 'const FAILED_JOB = new Set(["failed", "editorial_action_required"]);', 'const FAILED_JOB = new Set(["failed", "cancelled", "editorial_action_required"]);'],
  ['the failure limit is far too high', Y, 'failedJobsPerStory: 3,', 'failedJobsPerStory: 30,'],
  ['the failure refusal does not say nothing was started', T, 'NOTHING was started. Read why with job_status on the last one,', 'Read why with job_status on the last one,'],
  ['the oversized story gives no way out', S, 'Make the story smaller than 256 KB: shorten long texts, leave out clips you do not need, or split the film into two projects, then send the whole story again.', 'Send the whole story as one JSON object under 256 KB.'],
  ['the oversized story does not say nothing was saved', S, ' Nothing was saved.`, "story_size"', '`, "story_size"'],
];

// How many copies of each fault's "from" text its target file has today (11-20 audit, CC1 MEDIUM 2). The planted fault replaces the FIRST copy, so a later copy could move it to another tool; a fault whose count is not what is written here (default 1) is refused as BROKEN, in words, and must be looked at.
const COPIES = {};
const wantCopies = (name, i) => { const w = COPIES[name]; return Array.isArray(w) ? w[i] : (w ?? 1); };
const copiesProblem = (src, from, name, i) => { const have = src.split(from).length - 1, want = wantCopies(name, i); return have === want ? null : (have ? `BROKEN MUTANT (${have} copies of the text, expected ${want}): ${name}` : `BROKEN MUTANT (text not found): ${name}`); };
function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
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
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const problem = copiesProblem(src, from, name, 0);
  if (problem) { console.log(problem); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
