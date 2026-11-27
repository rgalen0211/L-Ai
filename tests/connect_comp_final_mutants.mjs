// Must-fail proof for the final Compilations gate and the AI-tool words of 11-27 (tests/connect-comp-final-1127.test.mjs and tests/connect-compilations-dept.test.mjs): each mutant breaks ONE thing in a scratch copy
// and at least one of the two suites must then FAIL. A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_comp_final_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-compfinal');
const SUITES = ['connect-comp-final-1127.test.mjs', 'connect-compilations-dept.test.mjs'];
const TL = 'supabase/functions/connect-core/tools.ts';
const MG = 'supabase/migrations/20261127000400_connect_compilation_status.sql', RB = 'supabase/rollbacks/20261127000400_connect_compilation_status_rollback.sql', CK = 'supabase/live-steps/66_connect_compilation_status_check.sql';
const TESTER = 'coalesce((select s.local_compute from public.account_settings s where s.owner_id = p_person), false)';
const mutants = [
  // THE GATE: the tester door, the administrator door, the open fallback, the lookup
  ['the tester door is open again after his function exists', MG, 'return coalesce(is_open, false);', 'return coalesce(is_open, false) or ' + TESTER + ';'],
  ['an administrator door is added once his function exists', MG, 'return coalesce(is_open, false);', 'return coalesce(is_open, false) or exists (select 1 from public.app_admins a where a.user_id = p_person);'],
  ['his maybe (null) is read as a yes', MG, 'return coalesce(is_open, false);', 'return coalesce(is_open, true);'],
  ['the fallback has an administrator door again', MG, 'return ' + TESTER + ';\nend $$;', 'return ' + TESTER + ' or exists (select 1 from public.app_admins a where a.user_id = p_person);\nend $$;'],
  ['the fallback is open to everyone', MG, 'return ' + TESTER + ';\nend $$;', 'return true;\nend $$;'],
  ['the fallback no longer asks the tester flag', MG, 'return ' + TESTER + ';\nend $$;', 'return false;\nend $$;'],
  ['the gate stops looking for his function', MG, "if to_regprocedure('ryagram_private.compilations_on(uuid)') is not null then", 'if false then'],
  ['the gate calls his function by another name', MG, "execute 'select ryagram_private.compilations_on($1)' into is_open", "execute 'select ryagram_private.department_switch_on($1)' into is_open"],
  ['the reader no longer asks the gate', MG, "  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');\n  req_json jsonb; req_sha text; req_at timestamptz;\n  run jsonb := null;\nbegin\n  if not ryagram_private.connect_compilations_open(me) then", "  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');\n  req_json jsonb; req_sha text; req_at timestamptz;\n  run jsonb := null;\nbegin\n  if false then"],
  ['the writer no longer asks the gate', MG, "sha text; why text;\nbegin\n  if not ryagram_private.connect_compilations_open(me) then", "sha text; why text;\nbegin\n  if false then"],
  ['the gate becomes callable by the connector login', MG, 'revoke all on function ryagram_private.connect_compilations_open(uuid) from public, anon, authenticated, service_role;', 'grant execute on function ryagram_private.connect_compilations_open(uuid) to connect_runner;'],
  // the header and the after-check
  ['the header stops saying the tester door is closed', MG, "FINAL VERSION (CC1's ruling 09:45: the tester door is CLOSED)", 'FINAL VERSION'],
  ['the header stops saying what BUILDER\'s function does not cover', MG, 'does NOT cover an invited tester (local_compute) and does NOT cover an administrator', 'covers everyone'],
  ['the after-check accepts an administrator door', CK, "p.prosrc not like '%app_admins%'", "p.prosrc like '%app_admins%'"],
  ['the rollback leaves the gate helper behind', RB, 'drop function if exists ryagram_private.connect_compilations_open(uuid);', ''],
  // the AI tool's words and limits
  ['a report for an earlier version reads as a bare waiting line again', TL, 'if (!current) return "The last report from the person\'s computer was for an earlier version of this request, so it is not shown. Waiting', 'if (!current) return "Waiting'],
  ['the earlier-version line is also said when there is no report', TL, 'if (!run || !RUN_STATES.has(run.state)) return "Waiting for the Ryagram app', 'if (!run || !RUN_STATES.has(run.state)) return "The last report from the person\'s computer was for an earlier version of this request, so it is not shown. Waiting for the Ryagram app'],
  ['the request takes 10 folders again', TL, 'const MAX_FOLDERS = 8;', 'const MAX_FOLDERS = 10;'],
];

function run(cwd) {
  let status = 0;
  for (const s of SUITES) { const r = noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', s)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); if (r.status) status = r.status; }
  return { status };
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
  for (const f of [MG, RB, CK]) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(scratch, f)); }
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  for (const s of SUITES) fs.copyFileSync(path.join(root, 'tests', s), path.join(scratch, 'tests', s));
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
