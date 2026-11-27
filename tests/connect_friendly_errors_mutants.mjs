// Must-fail proof for tests/connect-friendly-errors.test.mjs (what a connected AI is told when the database refuses a call): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_friendly_errors_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-friendlyerr');
const SUITE = 'connect-friendly-errors.test.mjs';
const TL = 'supabase/functions/connect-core/tools.ts';
const mutants = [
  ['PTCAP (the daily cap) is replaced again', TL, '|PTCAP|PTQUE|PTVEW|', '|PTQUE|PTVEW|'],
  ['PTQUE (films waiting) is replaced again', TL, '|PTCAP|PTQUE|PTVEW|', '|PTCAP|PTVEW|'],
  ['PTVEW (a film not available) is replaced again', TL, '|PTCAP|PTQUE|PTVEW|', '|PTCAP|PTQUE|'],
  ['every PT code of five letters passes (a pattern instead of names)', TL, 'PTCAP|PTQUE|PTVEW', 'PT[A-Z]{3}'],
  ['the three-digit PT codes stop passing', TL, String.raw`/^(PT\d{3}|PTCAP`, '/^(PTCAP'],
  ['a long message is passed', TL, 'if (!own || msg.length > 300)', 'if (!own || msg.length > 3000)'],
  ['a long message gets a special code', TL, 'if (msg.length > 300) return "error";', ''],
  ['a full queue gets the generic code again', TL, 'code === "PTQUE" ? "queue_full"', 'code === "PTQUE" ? "error"'],
  ['the daily cap gets the generic code again', TL, 'code === "PTCAP" ? "daily_credit_cap"', 'code === "PTCAP" ? "error"'],
  ['a blocked film gets the generic code again', TL, 'code === "PTVEW" ? "not_available"', 'code === "PTVEW" ? "error"'],
  ['the dispatcher ignores the distinct code', 'supabase/functions/connect-core/dispatch.ts', 'code: errorCodeOf(e) }', 'code: "error" }'],
  ['a Postgres-internal message is shown again (L6)', TL, 'if (DB_INTERNAL.test(msg)) return', 'if (false) return'],
  ['"permission denied for" is no longer treated as an internal (L6)', TL, 'const DB_INTERNAL = /permission denied for|', 'const DB_INTERNAL = /'],
  ['a key of the rgc kind is no longer removed', TL, '(sk|ryg|rga|rgr|rgc)', '(sk|ryg|rga|rgr)'],
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
