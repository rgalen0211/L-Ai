// Must-fail proof for tests/connect-get-story.test.mjs (NEXT-CONNECT 156): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_get_story_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-gs');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-get-story.test.mjs'];
const HEAD = 'name: "get_story", title: "Read back a project\'s saved story", scope: "read", readOnly: true';
const mutants = [
  ['get_story needs the write scope', C + 'tools.ts', HEAD, HEAD.replace('scope: "read"', 'scope: "write"')],
  ['get_story is announced as not read-only', C + 'tools.ts', HEAD, HEAD.replace('readOnly: true', 'readOnly: false')],
  ['the version argument is ignored (always the newest)', C + 'tools.ts', 'const wanted = a.version === undefined ? all[all.length - 1] : all.find((v) => v.number === Number(a.version));', 'const wanted = all[all.length - 1];'],
  ['the story is put in the text without the untrusted wrapper', C + 'tools.ts', 'untrusted("saved-story", body)', 'body'],
  ['another person\'s project answers like an empty project instead of not found', C + 'tools.ts',
    '    if (!(await ctx.data.currentVersionId(projectId))) return NOT_YOURS("project");     // the database answers null for a project that is not the person\'s\n    const all = await ctx.data.listVersions(projectId);\n    if (!all.length) return NOT_YOURS("project");',
    '    const all = await ctx.data.listVersions(projectId);\n    if (!all.length) return ok("No story has been saved in this project yet.", { story: null, versions: [] });'],
  ['the structured result leaves the story out', C + 'tools.ts', 'story: empty ? null : story, versions };', 'story: null, versions };'],
  ['a version that does not exist is not refused (the newest is shown)', C + 'tools.ts', 'if (!wanted) return refuse(', 'if (false) return refuse('],
  ['the tool is not in the registry', C + 'tools.ts', 'listProjects, getStory, createProject', 'listProjects, createProject'],
  ['an empty version claims a story', C + 'tools.ts', 'const empty = Object.keys(story).length === 0;', 'const empty = false;'],
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
const base = run(scratch).status;
if (base) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
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
