// Must-fail proof for tests/connect-edit-tools.test.mjs (NEXT-CONNECT 141): each mutant breaks ONE thing in a scratch copy of the connector code and the named suite(s) must then FAIL.
// A baseline run on the unbroken copy must PASS first (so a "caught" means the suite really noticed). Run:  node tests/connect_edit_mutants.mjs   (exit 0 only when every mutant is caught)
// Not here, because the SQL half is the authority and has its own mutants (supabase/tests/test_live_editor.py): the rate limits and the one-per-minute counters.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-edit');
const D = 'supabase/functions/connect-core/';
const EDIT = ['connect-edit-tools.test.mjs'];
const mutants = [
  ['the state tool needs the edit scope', D + 'tools.ts', 'title: "See the person\'s open editor", scope: "read"', 'title: "See the person\'s open editor", scope: "edit"'],
  ['set_look needs only read', D + 'tools.ts', 'title: "Change the look in the person\'s open editor", scope: "edit"', 'title: "Change the look in the person\'s open editor", scope: "read"'],
  ['edit_tracks needs only write', D + 'tools.ts', 'title: "Change the clip list of a compilation", scope: "edit"', 'title: "Change the clip list of a compilation", scope: "write"'],
  ['undo_my_changes needs only read', D + 'tools.ts', 'title: "Take back my last batch of changes", scope: "edit"', 'title: "Take back my last batch of changes", scope: "read"'],
  ['set_look says it is read-only', D + 'tools.ts', 'scope: "edit", readOnly: false,\n  description: "Changes look settings', 'scope: "edit", readOnly: true,\n  description: "Changes look settings'],
  ['unset is ignored', D + 'tools.ts', '...((a.unset as string[] | undefined) ?? []).map((k) => ({ op: "unset_look", key: k })),', ''],
  ['set_look sends a fixed revision, not the one read', D + 'tools.ts', 'editOps(String(a.project_id), "data", Number(a.base_revision), ops)', 'editOps(String(a.project_id), "data", 0, ops)'],
  ['a stale revision is accepted', D + 'edit_state.ts', 'if (base !== d.revision) throw', 'if (false) throw'],
  ['a stale revision gets another code', D + 'tools.ts', 'code === "PT409" ? "conflict"', 'code === "PT409" ? "stale"'],
  ['not-shared gets another code', D + 'tools.ts', 'code === "PT403" ? "not_shared"', 'code === "PT403" ? "args"'],
  ['the AI may change tracks the person did not share', D + 'edit_state.ts', 'if (d.mode === "compilation" && actor === "ai" && !d.ai_visible) throw', 'if (false) throw'],
  ['the AI may repeat what the person just undid', D + 'edit_state.ts', 'if (actor === "ai" && d.ops.some((x) => x.status === "undone"', 'if (false && d.ops.some((x) => x.status === "undone"'],
  ['markup is accepted in clip text', D + 'edit_state.ts', ' && !/[<>]/.test(t)', ''],
  ['the colour key list lost one key', D + 'edit_state.ts', '  { key: "state.fill", kind: "colour" },\n', ''],
  ['clip words are shown without the untrusted wrapper', D + 'tools.ts', 'untrusted("clip-text", c.text.slice(0, 200))', 'c.text.slice(0, 200)'],
  ['the answer claims everything was saved', D + 'tools.ts', 'nothing is saved until they press Save or Build', 'everything is saved'],
  ['what the person took back is not shown', D + 'tools.ts', 'if (s.recently_undone.length) {', 'if (false) {'],
  ['undo takes back the person\'s own changes too', D + 'fake.ts', 'o.actor === "ai" && (o.status === "applied"', '(o.status === "applied"'],
  ['another account\'s project can be edited', D + 'fake.ts', 'if (!u().projects.some((p) => p.id === pid)) throw err("That project was not found among your projects.", "PT404");', ''],
  ['the real database call names another function', 'supabase/functions/connect/db.ts', '"connect_edit_ops"', '"connect_edit_opss"', ['connect-oauth.test.mjs'], 'every SQL function the server names'],
  ['the edit scope is not advertised', D + 'rest.ts', 'edit: "Change the look and the clip list in your open editor, as drafts you can undo"', 'edit_off: "x"', ['connect-mcp-sdk.test.mjs'], 'every address the metadata advertises'],
];

function run(cwd, suites, pattern) {
  return spawnSync(process.execPath, ['--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...suites.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/migrations'), path.join(scratch, 'supabase/migrations'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
const base = [run(scratch, EDIT), run(scratch, ['connect-oauth.test.mjs'], 'every SQL function the server names'), run(scratch, ['connect-mcp-sdk.test.mjs'], 'every address the metadata advertises')].find((r) => r.status !== 0) ?? { status: 0 };
if (base.status !== 0) { console.log('BASELINE FAILS (nothing proved):\n' + base.stdout.slice(-800)); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to, suites, pattern] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch, suites ?? EDIT, pattern).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
