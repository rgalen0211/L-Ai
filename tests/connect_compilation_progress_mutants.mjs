// Must-fail proof for tests/connect-compilation-progress.test.mjs (compilation progress, counts only, CONNECT 11-27 night): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once (a text that moved is "broken", not "caught"). Run ALONE:  node tests/connect_compilation_progress_mutants.mjs
// The scratch copy holds only the connector code and the few SQL files the suite reads (small); it is made and removed by this runner inside its own folder (.mut-cprog).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-cprog');
const C = 'supabase/functions/connect-core/';
const T = C + 'tools.ts', K = C + 'compilation_card.ts', F = C + 'fake.ts';
const MIG = 'supabase/migrations/20261128000200_connect_compilation_progress.sql';
const OLD = 'supabase/migrations/20261127000400_connect_compilation_status.sql';
const ROLL = 'supabase/rollbacks/20261128000200_connect_compilation_progress_rollback.sql';
const CHK = 'supabase/live-steps/86_connect_compilation_progress_check.sql';
const S66 = 'supabase/live-steps/66_connect_compilation_status_check.sql';
const SUITES = ['connect-compilation-progress.test.mjs'];
const mutants = [
  // ---- the tool: the numbers
  ['step_done above step_total is accepted', T, 'wholeIn(r.step_done, step_total), step_total', 'wholeIn(r.step_done, 1000), step_total'],
  ['step_done is accepted without a step_total', T, 'step_done: step_total === null ? null : wholeIn(r.step_done, step_total)', 'step_done: wholeIn(r.step_done, step_total ?? 1000)'],
  ['step_total up to 100000 is accepted', T, 'wholeIn(r.step_total, 1000)', 'wholeIn(r.step_total, 100000)'],
  ['a percent above 100 is accepted', T, 'wholeIn(r.percent, 100)', 'wholeIn(r.percent, 1000)'],
  ['a fraction is accepted', T, 'Number.isInteger(v) && v >= 0 && v <= max ? v : null', 'Number.isFinite(v) && v >= 0 && v <= max ? v : null'],
  ['a negative number is accepted', T, 'v >= 0 && v <= max ? v : null', 'v <= max ? v : null'],
  ['an out-of-range number is clamped instead of ignored', T, 'Number.isInteger(v) && v >= 0 && v <= max ? v : null', 'Number.isInteger(v) && v >= 0 ? Math.min(v, max) : null'],
  ['a number written as text is accepted', T, '(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null)', '(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : null)'],
  ['whatever the database sent is passed on raw', T, '(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null)', '((v as number) ?? null)'],
  ['an end state keeps its numbers', T, 'if (!r || !RUNNING_STATES.has(state)) return', 'if (!r) return'],
  ['matching is not a running state for progress', T, 'new Set(["planning", "matching", "building"])', 'new Set(["planning", "building"])'],
  ['done is a running state for progress', T, 'new Set(["planning", "matching", "building"])', 'new Set(["planning", "matching", "building", "done"])'],
  // ---- the tool: the words
  ['a clip is called a video', T, 'unit = state === "building" ? "clip" : "video"', 'unit = "video"'],
  ['matching is worded "Matching"', T, 'state === "matching" ? "Finding the matches"', 'state === "matching" ? "Matching"'],
  ['planning ignores the progress', T, 'return progressWords("planning", run) ?? "The Ryagram app', 'return "The Ryagram app'],
  ['building ignores the progress', T, 'case "building": return progressWords("building", run) ?? ', 'case "building": return '],
  ['matching loses its places count when it has progress', T, 'pw + (run.matches === null ? "" : ` Found ${n(run.matches, "place", "places")} so far.`)', 'pw'],
  ['step_done 0 is said as "video 0 of 3"', T, 'c.step_done === 0 ? "getting started" : ', 'false ? "getting started" : '],
  ['a total of 0 is said as a pair', T, 'c.step_total !== null && c.step_total >= 1 && c.step_done !== null', 'c.step_total !== null && c.step_done !== null'],
  ['the percent is worded another way', T, '`about ${c.percent}% overall`', '`${c.percent}% done`'],
  ['the structured run drops the three numbers', T, 'error_code: run.error_code, step_done: run.step_done, step_total: run.step_total, percent: run.percent } : null,', 'error_code: run.error_code } : null,'],
  ['the tool does not check the numbers before it keeps them', T, '...cleanProgress(state, rr) }', 'step_done: rr.step_done as number, step_total: rr.step_total as number, percent: rr.percent as number }'],
  ['a report for an earlier request shows its progress', T, 'run: run && current ? {', 'run: run ? {'],
  ['the tool description loses the progress sentence', T, "; while it runs, also which video or clip it is on, like 'video 2 of 3', and about how far along the whole build is, as a percent)", ')'],
  // ---- the card
  ['the card accepts a fraction', K, 'isFinite(v)&&Math.floor(v)===v&&v>=0&&v<=max?v:null', 'isFinite(v)&&v>=0&&v<=max?v:null'],
  ['the card accepts a negative number', K, 'Math.floor(v)===v&&v>=0&&v<=max?v:null', 'Math.floor(v)===v&&v<=max?v:null'],
  ['the card clamps instead of ignoring', K, 'Math.floor(v)===v&&v>=0&&v<=max?v:null', 'Math.floor(v)===v&&v>=0?Math.min(v,max):null'],
  ['the card accepts a number written as text', K, "typeof v==='number'&&isFinite(v)&&Math.floor(v)===v&&v>=0&&v<=max?v:null", 'isFinite(v)&&Math.floor(v)===Math.floor(v)&&v>=0&&v<=max?v:null'],
  ['the card accepts step_done above step_total', K, 'v.run.sd=t===null?null:whole(r.step_done,t);', 'v.run.sd=t===null?null:whole(r.step_done,1000);'],
  ['the card accepts a percent above 100', K, 'whole(r.percent,100)', 'whole(r.percent,1000)'],
  ['the card accepts a step_total above 1000', K, 'whole(r.step_total,1000)', 'whole(r.step_total,100000)'],
  ['the card words matching as "Matching"', K, "progress(r,'Finding the matches','video')", "progress(r,'Matching','video')"],
  ['the card calls a clip a video', K, "progress(r,'Building','clip')||", "progress(r,'Building','video')||"],
  ['the card says "video 0 of 3"', K, "r.sd===0?'getting started':", ''],
  ['the card words the percent another way', K, "'about '+r.pc+'% overall'", "r.pc+'%'"],
  ['the card drops the places count from matching', K, "pm+(r.matches===null?'':' Found '+many(r.matches,'place','places')+' so far.')", 'pm'],
  ['the card ignores the planning progress', K, "text:progress(r,'Planning','video')||", 'text:'],
  ['the card says a pair for a total of 0', K, 'r.st!==null&&r.st>=1&&r.sd!==null', 'r.st!==null&&r.sd!==null'],
  ['the card sets text as markup', K, 'if(text!=null)e.textContent=text;return e;', 'if(text!=null)e.innerHTML=text;return e;'],
  // ---- the stand-in database (it must answer like the SQL)
  ['the stand-in keeps the numbers in an end state', F, 'const st = running ? whole(r.step_total, 1000) : null;', 'const st = whole(r.step_total, 1000);'],
  ['the stand-in keeps the percent in an end state', F, 'percent: running ? whole(r.percent, 100) : null', 'percent: whole(r.percent, 100)'],
  // ---- the SQL text
  ['the SQL casts text behind an AND (a cast may run first)', MIG, "if case when st_text ~ '^[0-9]{1,4}$' then st_text::int <= 1000 else false end then", "if st_text ~ '^[0-9]{1,4}$' and st_text::int <= 1000 then"],
  ['the SQL allows a step_total up to 10000', MIG, 'st_text::int <= 1000', 'st_text::int <= 10000'],
  ['the SQL allows a percent up to 1000', MIG, 'pc_text::int <= 100', 'pc_text::int <= 1000'],
  ['the SQL allows step_done above step_total', MIG, 'then sd_text::int <= st else false', 'then sd_text::int <= 1000 else false'],
  ['the SQL keeps text for step_total', MIG, "st_text := case when jsonb_typeof(prog -> 'step_total') = 'number' then prog ->> 'step_total' end;", "st_text := prog ->> 'step_total';"],
  ['the SQL shows progress in every state', MIG, "if run ->> 'state' in ('planning', 'matching', 'building') then", 'if true then'],
  ['the SQL answers the three keys only when it has them', MIG, "run := run || jsonb_build_object('step_done', sd, 'step_total', st, 'percent', pc);", "if sd is not null then run := run || jsonb_build_object('step_done', sd); end if;"],
  ['the SQL leaks its helper key', MIG, "    run := run - 'progress';\n", ''],
  ['the SQL grants the function to signed-in people too', MIG, 'grant execute on function public.connect_compilation_get(text, uuid) to connect_runner;', 'grant execute on function public.connect_compilation_get(text, uuid) to connect_runner, authenticated;'],
  ['the SQL header stops saying it needs BUILDER first', MIG, "THIS FILE NEEDS BUILDER'S 20261128000100_compilation_progress.sql FIRST", 'THIS FILE IS STANDALONE'],
  ['the SQL function writes something', MIG, '  if run is not null then\n    prog :=', '  delete from public.compilation_runs where false;\n  if run is not null then\n    prog :='],
  ['the SQL function loses its empty search path', MIG, "language plpgsql security definer set search_path = '' as $$\ndeclare\n  me uuid", 'language plpgsql security definer as $$\ndeclare\n  me uuid'],
  ['the SQL progress reads a folder column', MIG, "''percent'', to_jsonb(c) -> ''percent'')) '", "''percent'', to_jsonb(c) -> ''percent'', ''folder'', to_jsonb(c) -> ''folder'')) '"],
  // ---- the earlier migration, the rollback and the check
  ['the earlier migration (806c847f) is edited', OLD, 'order by c.started_at desc nulls last, c.id desc limit 1', 'order by c.started_at desc nulls last, c.id desc limit 2'],
  ['the rollback body is not the old body', ROLL, "order by c.started_at desc nulls last, c.id desc limit 1'", "order by c.started_at desc nulls last, c.id desc limit 2'"],
  ['the rollback forgets the grant', ROLL, 'grant execute on function public.connect_compilation_get(text, uuid) to connect_runner;', ''],
  ['the rollback drops a column', ROLL, 'commit;\n', 'alter table public.compilation_runs drop column step_done;\ncommit;\n'],
  ['the check stops looking at one of the three columns', CHK, "c.column_name in ('step_done', 'step_total', 'percent')", "c.column_name in ('step_done', 'step_total')"],
  ['the check stops pinning the range', CHK, "p.prosrc like '%st_text::int <= 1000 else%'", "p.prosrc like '%st_text::int <= 9999 else%'"],
  ['step 66 stops pinning the token check this function keeps', S66, "p.prosrc like '%connect_actor(p_token_hash, ''read'')%' and p.proargnames", "p.prosrc like '%connect_actor(p_token_hash, ''write'')%' and p.proargnames"],
];

const run = (cwd) => noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  for (const f of [MIG, OLD, ROLL, CHK, S66]) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(scratch, f)); }
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
