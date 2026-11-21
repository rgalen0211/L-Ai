// Must-fail proof for tests/connect-not-invited.test.mjs (what the server does for an account that is not invited to connect an AI): each mutant breaks ONE thing in a scratch copy of the migrations and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_not_invited_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-notinv');
const MIG = 'supabase/migrations/';
const LE = MIG + '20261027000400_live_editor.sql', DEP = MIG + '20261027000100_departments.sql', CON = MIG + '20261018000100_connect_ai.sql';
const SUITES = ['connect-not-invited.test.mjs'];
const mutants = [
  // the person's own editor must not need an AI invite
  ['editor_apply_ops needs the invite', LE, "  return ryagram_private.apply_edit_ops(me, p_project, p_mode, p_base_revision, 'person', null, p_ops);", "  if not ryagram_private.connect_person_ok(me) then raise exception 'x'; end if;\n  return ryagram_private.apply_edit_ops(me, p_project, p_mode, p_base_revision, 'person', null, p_ops);"],
  ['editor_undo needs the invite', LE, "  return ryagram_private.undo_edit_ops(me, p_project, p_mode, array[p_op_id], 'person');", "  if not ryagram_private.connect_person_ok(me) then raise exception 'x'; end if;\n  return ryagram_private.undo_edit_ops(me, p_project, p_mode, array[p_op_id], 'person');"],
  ['editor_heartbeat needs the invite', LE, "  if p_mode not in ('data', 'compilation') or not exists (select 1 from public.projects where id = p_project and owner_id = me) then", "  if not ryagram_private.connect_person_ok(me) then raise exception 'x'; end if;\n  if p_mode not in ('data', 'compilation') or not exists (select 1 from public.projects where id = p_project and owner_id = me) then"],
  ['my_edit_ops_since needs the invite', LE, "  select * into d from public.edit_drafts where project_id = p_project and mode = p_mode and owner_id = me;\n  if not found then return jsonb_build_object('revision', 0,", "  if not ryagram_private.connect_person_ok(me) then raise exception 'x'; end if;\n  select * into d from public.edit_drafts where project_id = p_project and mode = p_mode and owner_id = me;\n  if not found then return jsonb_build_object('revision', 0,"],
  ['the app session accepts a token that carries a client id', CON, "nullif(auth.jwt() ->> 'client_id', '')", "nullif('', '')"],
  // what "invited" means
  ['an administrator counts as invited', CON, "     and not exists (select 1 from public.app_admins ad where ad.user_id = p_owner)\n", ""],
  ['a worker counts as invited', CON, "     and not exists (select 1 from public.workers w where w.user_id = p_owner)\n", ""],
  ['a disabled list row counts as invited', CON, "where a.user_id = p_owner and a.enabled)", "where a.user_id = p_owner)"],
  ['the consent page stops saying invite-only', CON, "not enabled for AI assistants yet (invite-only for now).", "not enabled yet."],
  ['the departments helper is its own rule', DEP, "  return p_owner is not null and ryagram_private.connect_person_ok(p_owner);", "  return p_owner is not null;"],
  // "Tell me when it's ready"
  ['an account that is not invited gets the departments', DEP, "   where ryagram_private.department_person_ok(p_owner)\n$$;", "   where true\n$$;"],
  ['an account that is not invited may register interest', DEP, "  if not ryagram_private.department_person_ok(me) then raise exception 'This is for invited accounts for now.' using errcode = 'PT403'; end if;\n", ""],
  ['the refusal loses its words', DEP, "'This is for invited accounts for now.'", "'No.'"],
  ['a department that is not announced can be registered', DEP, "x.id = p_department and x.status = 'soon') then", "x.id = p_department) then"],
  ['the interest list is read for anyone', DEP, "i.owner_id = auth.uid() and ryagram_private.department_person_ok(auth.uid())", "i.owner_id = auth.uid()"],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, MIG), path.join(scratch, MIG), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests/connect-not-invited.test.mjs'), path.join(scratch, 'tests/connect-not-invited.test.mjs'));
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
