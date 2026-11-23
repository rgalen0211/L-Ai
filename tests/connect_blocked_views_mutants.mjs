// Must-fail proof for tests/connect-blocked-views.test.mjs (dataset_info offers only the views that work): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_blocked_views_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-blockedviews');
const SUITE = 'connect-blocked-views.test.mjs';
const TL = 'supabase/functions/connect-core/tools.ts', BV = 'supabase/functions/_shared/blocked_views.ts', JS = 'tools/data/engine-catalog-block-list-1123.json';
const mutants = [
  ['dataset_info ignores the block list', TL, '(d.views.includes(v) && !failing.has(v))', '(d.views.includes(v))'],
  ['dataset_info no longer says which views fail', TL, '${knownBad.length ? ` A ${knownBad.join(" or ")} view is known to FAIL for this dataset: do not offer it.` : ""}', ''],
  ['the line is never offered', TL, 'v === "line" || (d.views', 'v !== "line" && (d.views'],
  ['the generated list drops a blocked view (drift from the JSON)', BV, '"bps_county_permits": ["bars", "map", "paired", "panel", "shares"],', '"bps_county_permits": ["map", "paired", "panel", "shares"],'],
  ['the generated list is missing a dataset', BV, '  "bls_state_unemployment": ["bars", "paired", "panel", "shares"],\n', ''],
  ['the JSON list gains a pair the TypeScript list does not have', JS, '"bars",\n  "paired",\n  "panel"\n ],\n "bls_state_unemployment"', '"bars",\n  "paired",\n  "panel",\n  "shares"\n ],\n "bls_state_unemployment"'],
];

function run(cwd) { return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
  for (const f of [JS]) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(scratch, f)); }
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
