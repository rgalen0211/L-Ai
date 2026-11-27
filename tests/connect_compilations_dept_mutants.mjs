// Must-fail proof for tests/connect-compilations-dept.test.mjs (the Compilations department in the connector): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_compilations_dept_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-compdept');
const SUITE = 'connect-compilations-dept.test.mjs';
const TL = 'supabase/functions/connect-core/tools.ts', DB = 'supabase/functions/connect/db.ts';
const HIT = 'if (!(await ctx.policy.hit(ctx.principal, "compilation_reads", LIMITS.compilationReadsPerHourPerUser, 3600))) {';
const GATE_STATUS = 'if (!(await compilationsOpen(ctx))) return closedResult();\n    if (!ctx.data.compilationGet)';
const GATE_PAGE = 'if (!(await compilationsOpen(ctx))) return closedResult();\n    ' + HIT + '\n      return refuse(`The limit of ${LIMITS.compilationReadsPerHourPerUser} compilation checks';
const mutants = [
  ['the status tool no longer asks whether Compilations is open', TL, GATE_STATUS, 'if (!ctx.data.compilationGet)'],
  ['the page tool no longer asks whether Compilations is open', TL, GATE_PAGE, GATE_PAGE.replace('if (!(await compilationsOpen(ctx))) return closedResult();\n    ', '')],
  ['an account with the desktop app is no longer open (the invited testers lose it)', TL, 'return !!w && w.desktop_app === true;', 'return false;'],
  ['every account counts as open', TL, 'return !!w && w.desktop_app === true;', 'return true;'],
  ['the account switch is no longer read', TL, 'switches.includes("compilations")) return true;', 'false) return true;'],
  ['any department row opens it, working or not', TL, 'r.id === "compilations" && r.status === "working"', 'r.id === "compilations"'],
  ['an unreadable switch list counts as open', TL, 'ctx.data.switches().catch(() => [] as string[]);\n  if (Array.isArray(switches) && switches.includes("compilations"))', 'ctx.data.switches().catch(() => ["compilations"] as string[]);\n  if (Array.isArray(switches) && switches.includes("compilations"))'],
  ['another person\'s project is no longer reported as not found', TL, 'if (!row) return NOT_YOURS("project");\n    const summary', 'if (!row) return ok("nothing", {});\n    const summary'],
  ['a folder that looks like a place is shown (both place checks removed)', TL, 'f && f.length <= 80 && !looksLikePlace(f) && !/[\\\\/:]/.test(f)', 'f && f.length <= 80'],
  ['a folder name over 80 characters is shown (cut, not dropped)', TL, 'f && f.length <= 80 && ', 'f && '],
  ['a phrase that is a place is shown', TL, '(s && !looksLikePlace(s) ? s : "")', '(s)'],
  ['the note is no longer cut at 200 characters', TL, 'note: safe(plainText(r.note, 200))', 'note: safe(plainText(r.note, 2000))'],
  ['an invented run state is believed', TL, 'rr && RUN_STATES.has(String(rr.state)) ? String(rr.state) : null', 'rr ? String(rr.state) : null'],
  ['a negative number is shown', TL, 'v >= 0 ? Math.min(Math.round(v), max) : null', 'true ? Math.min(Math.round(v), max) : null'],
  ['a huge number is shown', TL, 'Math.min(Math.round(v), max)', 'Math.round(v)'],
  ['a run for an earlier request is shown as the answer', TL, 'const current = rr?.current !== false;', 'const current = true;'],
  ['an unknown error code is shown as words', TL, '?? "the Ryagram app reported a problem it has no plain words for"}.`', '?? run.error_code}.`'],
  ['a done run no longer says the film stays on the computer', TL, ' It is never sent to Ryagram.', ''],
  ['an error code that is a path is kept as data', TL, '/^[a-z0-9_]{1,40}$/.test(rr.error_code) ? rr.error_code : null', 'true ? rr.error_code : null'],
  ['the whole request is shown, not the summary', TL, 'request: summary, request_sha256', 'request: row.request, request_sha256'],
  ['the whole run is shown, not five fields', TL, 'run: run && current ? { state: run.state, matches: run.matches, clips: run.clips, film_seconds: run.film_seconds, error_code: run.error_code } : null', 'run: row.run'],
  ['the status check is no longer counted in its hourly bucket', TL, '"compilation_reads", LIMITS.compilationReadsPerHourPerUser, 3600))) {\n      return refuse(`The limit of ${LIMITS.compilationReadsPerHourPerUser} compilation status', '"compilation_readz", LIMITS.compilationReadsPerHourPerUser, 3600))) {\n      return refuse(`The limit of ${LIMITS.compilationReadsPerHourPerUser} compilation status'],
  ['the page tool no longer says no credit is used', TL, 'never leave their computer, and no credit is used.', 'never leave their computer.'],
  ['the page tool hands out another page', TL, 'export const COMPILATIONS_PAGE = "#/d/compilations";', 'export const COMPILATIONS_PAGE = "#/d/games";'],
  ['the status tool is no longer in the registry', TL, 'setCompilationRequest, getCompilationStatus, openCompilationsPage,', 'setCompilationRequest, openCompilationsPage,'],
  ['the page tool is no longer read-only', TL, 'name: "open_compilations_page", title: "Where to make a compilation", scope: "read", readOnly: true', 'name: "open_compilations_page", title: "Where to make a compilation", scope: "read", readOnly: false'],
  ['the status tool needs the write permission', TL, 'name: "get_compilation_status", title: "Where a compilation stands", scope: "read"', 'name: "get_compilation_status", title: "Where a compilation stands", scope: "write"'],
  ['the database layer sends the read to another function', DB, '"connect_compilation_get", ["text", "uuid"], [h, projectId]', '"connect_compilation_get", ["text", "uuid"], [projectId, h]'],
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
