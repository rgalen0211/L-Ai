// Must-fail proof for tests/connect-chat-editor-server.test.mjs (the live editor in the AI chat, server side): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_chat_editor_server_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-chsrv');
const C = 'supabase/functions/connect-core/';
const D = C + 'dispatch.ts', E = C + 'editor_tools.ts', M = C + 'mcp.ts', A = C + 'mcp_app.ts', F = C + 'fake.ts', DB = 'supabase/functions/connect/db.ts';
const SUITES = ['connect-chat-editor-server.test.mjs'];
const mutants = [
  // the switch
  ['the editor tools exist when the switch is off', D, 'const tool = found && ((found.chatEditor && !env.chatEditor) || (found.homePanel && !env.homePanel)) ? undefined : found;', 'const tool = found;'],
  ['the list ignores the switch', M, '(!t.chatEditor || chatEditor)', 'true'],
  ['every call is told the switch is on', M, 'chatEditor: chatEditorOn(deps.mcpApp), homePanel: homePanelOn(deps.mcpApp) };', 'chatEditor: true, homePanel: homePanelOn(deps.mcpApp) };'],
  ['the editor switch works without the app face', M, 'export const chatEditorOn = (a?: McpAppConfig) => !!(a?.enabled && a.chatEditor);', 'export const chatEditorOn = (a?: McpAppConfig) => !!a?.chatEditor;'],
  ['the editor page is served when the switch is off', A, '!(editor && cfg.chatEditor)', '!(editor)'],
  ['the editor page is listed when the switch is off', A, '...(cfg?.chatEditor ? [', '...(true ? ['],
  ['the editor page may open a network origin', A, "const ui: Record<string, unknown> = { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false };", "const ui: Record<string, unknown> = { csp: { connectDomains: ['https://api.example.com'], resourceDomains: [] }, prefersBorder: false };"],
  // visibility
  ['a panel tool is shown to the model', M, '{ ui: { visibility: ["app"] } }', '{ ui: { visibility: ["model", "app"] } }'],
  ['a panel tool is given the editor page', M, '{ ui: { visibility: ["app"] } }', 'toolUiMeta(EDITOR_URI)'],
  // who may call
  ['a panel call needs only read permission', E, 'name, title, scope: "edit", readOnly, idempotent: readOnly, chatEditor: "app"', 'name, title, scope: "read", readOnly, idempotent: readOnly, chatEditor: "app"'],
  ['open_editor needs only read permission', E, 'name: "open_editor", title: "Open the Ryagram editor", scope: "edit"', 'name: "open_editor", title: "Open the Ryagram editor", scope: "read"'],
  ["another person's film opens", E, 'if (!st) return refuse("That film was not found among your projects.", "not_found");', ''],
  ['a clip film opens without the track list being shared', E, 'if (mode === "compilation" && !st.compilation.shared) {', 'if (false) {'],
  ['a film title goes into the words as written', E, '${untrusted("project-title", title)}', '${title}'],
  // the schemas
  ['any mode is accepted', E, 'enum: ["data", "compilation"], description: "data', 'enum: ["data", "compilation", "video"], description: "data'],
  ['more than 20 changes pass the schema', E, 'maxItems: 20, items: { type: "object" }', 'items: { type: "object" }'],
  // the answers
  ["a refusal is shown in the database's raw words", E, 'const message = friendly(e);', 'const message = String((e as Error)?.message ?? "");'],
  ['a code of any form is passed on', E, 'const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code).slice(0, 16) : null;', 'const code = ((e as { code?: unknown })?.code ?? null) as string | null;'],
  ['a refusal is not marked as an error', E, 'return { text: JSON.stringify({ error }), isError: true, code: code ?? "error", data: { error } };', 'return { text: JSON.stringify({ error }), isError: false, code: code ?? "error", data: { error } };'],
  ['a refusal reaches a text-only host as prose, not as the same JSON', E, 'return { text: JSON.stringify({ error }), isError: true, code: code ?? "error", data: { error } };', 'return { text: message, isError: true, code: code ?? "error", data: { error } };'],
  ['an answer reaches a text-only host as the word Done, not as the data', E, 'return ok(JSON.stringify(body), body);', 'return ok("Done.", body);'],
  ['a missing migration is not said', E, 'if (!call) { const error = { code: null, message: "The editor panel is not available yet." }; return { text: JSON.stringify({ error }), isError: true,', 'if (!call) { const error = { code: null, message: "The editor panel is not available yet." }; return { text: JSON.stringify({ error }), isError: false,'],
  // the buckets
  ['panel calls count against the AI\'s calls', D, 'const panelCall = tool.chatEditor === "app";', 'const panelCall = false;'],
  ['panel calls are also counted against the AI\'s calls', D, 'if (!panelCall && !(await policy.hit(principal, "calls", LIMITS.callsPerMinutePerClient, 60))) {', 'if (!(await policy.hit(principal, "calls", LIMITS.callsPerMinutePerClient, 60))) {'],
  ['the panel has no call limit of its own', D, 'if (panelCall && !(await policy.hit(principal, "panel", LIMITS.panelCallsPerMinutePerClient, 60))) {', 'if (false) {'],
  // the stand-in obeys the same rules as the SQL
  ['a panel change is recorded under another name', F, '"Ryagram panel", Number(a.p_base_revision)', '"Claude", Number(a.p_base_revision)'],
  ['a clip film is open to the panel without the track list being shared', F, 'if (mode === "compilation" && !d.ai_visible) throw err(\'The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app.\', "PT403");\n        if (name === "editor_apply_ops")', 'if (false) throw err("x", "PT403");\n        if (name === "editor_apply_ops")'],
  ["an undo by id reaches the person's own edits", F, 'o.id === a.p_op_id && o.actor === "ai"', 'o.id === a.p_op_id'],
  ["undo-all in the panel takes back a click made in the panel", F, 'd.ops.filter((o) => o.actor === "ai" && o.client !== "Ryagram panel" && (o.status === "applied" || o.status === "pending")).map((o) => o.id), Date.now(), "ai");\n        if (name === "my_edit_ops_since")', 'd.ops.filter((o) => o.actor === "ai" && (o.status === "applied" || o.status === "pending")).map((o) => o.id), Date.now(), "ai");\n        if (name === "my_edit_ops_since")'],
  ["the AI's own undo takes back a click made in the panel", F, 'o.actor === "ai" && o.client !== "Ryagram panel" && (o.status === "applied" || o.status === "pending"));        // never a click made in the panel', 'o.actor === "ai" && (o.status === "applied" || o.status === "pending"));        // never a click made in the panel'],
  ["undo-all takes back the person's own edits", F, 'd.ops.filter((o) => o.actor === "ai" && o.client !== "Ryagram panel" && (o.status === "applied" || o.status === "pending")).map((o) => o.id), Date.now(), "ai");\n        if (name === "my_edit_ops_since")', 'd.ops.filter((o) => (o.status === "applied" || o.status === "pending")).map((o) => o.id), Date.now(), "ai");\n        if (name === "my_edit_ops_since")'],
  ['the log read ignores the revision', F, 'const since = Math.max(Number(a.p_revision) || 0, 0);', 'const since = 0;'],
  // the real database layer
  ['apply goes to the wrong function', DB, 'self.fn("connect_editor_apply", ["text", "uuid", "text", "bigint", "jsonb"]', 'self.fn("connect_edit_ops", ["text", "uuid", "text", "bigint", "jsonb"]'],
  ['the log read sends its arguments in the wrong order', DB, '[h, a.p_project, a.p_mode, a.p_revision]', '[h, a.p_mode, a.p_project, a.p_revision]'],
  ['a jsonb array is sent as a Postgres array literal', DB, '(types[i] === "jsonb" ? (v === null || v === undefined ? null : JSON.stringify(v)) : wire(v))', 'wire(v)'],
  ['an unknown editor call reaches the database', DB, 'return Promise.reject(Object.assign(new Error("There is no such editor call."), { code: "22023" }));', 'return self.fn("connect_editor_heartbeat", ["text", "uuid", "text"], [h, a.p_project, a.p_mode]);'],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
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
