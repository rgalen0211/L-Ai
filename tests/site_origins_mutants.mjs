// Must-fail proof for tests/site-origins-1127.test.mjs: each mutant breaks ONE thing in a scratch copy (supabase/functions + the test, on D:) and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every text must occur exactly once. A nonzero exit that is not a test failure is "ran badly", not "caught".
// Run: node tests/site_origins_mutants.mjs   (exit 0 only when every mutant is caught). One runner at a time per tree.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = process.env.MUT_SCRATCH || 'D:/Ryagram-scratch/CONNECT/mut-origins';
const M = 'supabase/functions/_shared/site_origins.ts';
const mutants = [
  ['the old www origin is dropped from the defaults', M, '["https://uselai.com", "https://www.uselai.com"];\nconst ORIGIN', '["https://uselai.com"];\nconst ORIGIN'],
  ['no setting no longer falls back to the old site address', M, '?? OLD_SITE_URL;', '?? "";'],
  ['a path is accepted (no end anchor)', M, '+$/;', '+/;'],
  ['http is accepted', M, '^https:\\/\\/', '^https?:\\/\\/'],
  ['EXTRA_SITE_ORIGINS is ignored', M, 'if (o) add(o); else refused = true;', 'refused = true;'],
  ['a SITE_URL setting replaces the old origins instead of adding', M, 'const out = [...OLD_ORIGINS];', 'const out = clean(env("SITE_URL")) ? [] : [...OLD_ORIGINS];'],
  ['case is not tidied', M, '.trim().toLowerCase()', '.trim()'],
  ['SITE_URL is not allowed as an origin', M, 'if (site) { add(site);', 'if (site) { '],
  ['a trailing slash is no longer tolerated', M, '.toLowerCase().replace(/' + String.fromCharCode(92) + '/$/, "")', '.toLowerCase()'],
  ['a refused EXTRA entry is silent', M, 'if (refused) log(', 'if (false) log('],
  ['a refused SITE_URL is silent', M, 'if (!site && (raw ?? "").trim() !== "") log(', 'if (false) log('],
  ['the log line echoes the value', M, 'log("EXTRA_SITE_ORIGINS: an entry was ignored (not a bare https origin: https://host, no path, no port)");', 'log("EXTRA_SITE_ORIGINS: an entry was ignored: " + env("EXTRA_SITE_ORIGINS"));'],
  ['join writes the old site address again', 'supabase/functions/join/index.ts', 'siteUrl: resolveSiteUrl(),', 'siteUrl: "https://uselai.com",'],
  ['stripe-checkout writes the old origins again', 'supabase/functions/stripe-checkout/index.ts', 'allowedOrigins: resolveSiteOrigins(),', 'allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],'],
  ['source-fetch loses its import of the module', 'supabase/functions/source-fetch/index.ts', 'import { resolveSiteOrigins } from "../_shared/site_origins.ts";', ''],
];

function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests', 'site-origins-1127.test.mjs'), path.join(scratch, 'tests', 'site-origins-1127.test.mjs'));
}
function run() {
  const r = spawnSync(process.execPath, ['--test', 'tests/site-origins-1127.test.mjs'], { cwd: scratch, encoding: 'utf8', timeout: 120000 });
  const out = String(r.stdout) + String(r.stderr);
  return { pass: r.status === 0, ranBadly: r.error || !/ℹ tests \d+/.test(out), out };
}

fresh();
const base = run();
if (!base.pass || base.ranBadly) { console.log('BASELINE FAILS (nothing proved)'); process.exit(2); }
let missed = 0;
for (const [name, rel, from, to] of mutants) {
  fresh();
  const f = path.join(scratch, rel);
  const s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const n = s.split(from).length - 1;
  if (n !== 1) { console.log(`BAD MUTANT (text occurs ${n} times): ${name}`); process.exit(2); }
  fs.writeFileSync(f, s.replace(from, to));
  const r = run();
  if (r.ranBadly) { console.log(`RAN BADLY: ${name}`); process.exit(2); }
  if (r.pass) { missed++; console.log(`MISSED  ${name}`); } else console.log(`caught  ${name}`);
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) MISSED` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
