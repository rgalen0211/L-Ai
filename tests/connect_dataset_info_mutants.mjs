// Must-fail proof for tests/connect-dataset-info.test.mjs (NEXT-CONNECT 158): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_dataset_info_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-di');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-dataset-info.test.mjs'];
const T = C + 'tools.ts';
const HEAD = 'name: "dataset_info", title: "What a dataset covers", scope: "read", readOnly: true';
const mutants = [
  ['dataset_info needs the write scope', T, HEAD, HEAD.replace('scope: "read"', 'scope: "write"')],
  ['dataset_info is announced as not read-only', T, HEAD, HEAD.replace('readOnly: true', 'readOnly: false')],
  ['an unknown id is not refused', T, 'if (!d) {', 'if (false) {'],
  ['the answer is not wrapped as untrusted data', T, 'ok(untrusted("dataset-info", text),', 'ok(text,'],
  ['a dataset the catalog cannot draw says it can', T, 'const usable = Object.prototype.hasOwnProperty.call(DATASETS, id);', 'const usable = true;'],
  ['a missing source address is not flagged', T, 'if (!d.url) problems.push(', 'if (false) problems.push('],
  ['the years are shown wrong', T, 'Years: ${d.periods.from} to ${d.periods.to}', 'Years: ${d.periods.from} to ${d.periods.from}'],
  ['the area changes are left out', T, 'if (ch.length) {', 'if (false) {'],
  ['the adoption years are left out', T, 'if (ad.length) L.push(', 'if (false) L.push('],
  ['the licence is left out of the text', T, 'Licence: ${d.licence || "not recorded"}.', ''],
  ['the id pattern allows anything', T, '"^[a-z0-9_]{1,100}$"', '".*"'],
  ['the vendored TS module is edited by hand', C + '../_shared/dataset_info.ts', '"licence":"U.S. Government work, public domain (Bureau of Economic Analysis); cite BEA."', '"licence":"Anyone may use this freely."'],
  ['the vendored JSON is edited by hand (the recorded SHA-256 no longer matches)', C + '../_shared/dataset-info.json', '"licence": "U.S. Government work, public domain (Bureau of Economic Analysis); cite BEA."', '"licence": "Anyone may use this freely."'],
];

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
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
