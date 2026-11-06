// Must-fail proof for tests/connect-chat-editor.test.mjs (the live editor in the AI chat): each mutant breaks ONE thing in a scratch copy, the page is REGENERATED from the broken source (so the
// "committed page = generator" test cannot be the only thing that notices), and the suite must then FAIL. A baseline run on the unbroken copy must PASS first, and every text must occur exactly once.
// Run:  node tests/connect_chat_editor_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-chated');
const H = 'tools/chat-editor/live-host.js', CSS = 'tools/chat-editor/chat-extra.css', B = 'tools/build-chat-editor.mjs', DR = 'assets/app-editor-draft.js';
const SUITES = ['connect-chat-editor.test.mjs', 'live-editor-draft.test.mjs'];
const mutants = [
  ['a sixth name is allowed', H, "'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat'];", "'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat', 'set_look'];"],
  ['the name guard is gone', H, "if (!NAMES.includes(name)) throw new Error('Not an editor call.');", ''],
  ['messages from any window are believed', H, 'if (ev.source !== PARENT) return;', ''],
  ['the protocol version is not checked', H, "typeof m !== 'object' || m.jsonrpc !== '2.0') return;", "typeof m !== 'object') return;"],
  ['a null message from the host is not skipped', H, "if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return;", "if (typeof m !== 'object' || m.jsonrpc !== '2.0') return;"],
  ['a refusal is read as success', H, 'if (r.isError || sc.error) {', 'if (false) {'],
  ['a refusal\'s words are not cleaned or cut', H, "message: clean(e.message || 'Ryagram could not do that.', 300)", 'message: e.message'],
  ['a refusal\'s code is taken as it comes', H, "typeof e.code === 'string' ? e.code.slice(0, 16) : null", 'e.code'],
  ['the AI is told about heartbeats and polls too', H, "if (name === 'editor_apply_ops' || name === 'editor_undo' || name === 'editor_undo_all_ai') {", '{'],
  ['the line to the AI carries the person\'s ops', H, 'Read get_edit_state for the exact', '${JSON.stringify(args)} Read get_edit_state for the exact'],
  ['a chat message is sent for every edit', H, 'changes += 1;', "changes += 1; request('ui/message', { role: 'user', content: { type: 'text', text: 'edit' } }).catch(() => {});"],
  ['the build call starts a render', H, 'async function render() { return { error:', "async function render() { await request('tools/call', { name: 'request_full_render', arguments: {} }); return { error:"],
  ['the panel own edits are not read as the person', H, "o.actor === 'ai' && o.client === PANEL ? { ...o, actor: 'person' } : o", 'o'],
  ['every AI row is read as the person', H, "o.actor === 'ai' && o.client === PANEL ? { ...o, actor: 'person' } : o", "o.actor === 'ai' ? { ...o, actor: 'person' } : o"],
  ['rows of any call are rewritten', H, "if (name === 'my_edit_ops_since' && data", 'if (data'],
  ['the cached ask ignores the revision', H, "`${a0.p_project}|${a0.p_mode}|${a0.p_revision}`", "`${a0.p_project}|${a0.p_mode}`"],
  ['the cached ask never goes stale', H, 'Date.now() - poll.at < POLL_MS', 'Date.now() - poll.at < POLL_MS * 100000'],
  ['a change of ours does not clear the cached ask', H, "{ poll.at = 0; told(name, args, sc.data); }", "{ told(name, args, sc.data); }"],
  ['a frame feed is added to the seam', H, "window.ryagramLiveHost = { rpc, render, mode: 'compilation'", "window.ryagramLiveHost = { rpc, render, frame() {}, mode: 'compilation'"],
  ['a film id is used whatever its form', H, '&& /^[0-9A-Za-z-]{8,64}$/.test(sc.project_id)', ''],
  ['a second result moves the panel to another film', H, "if (mounted || !sc || typeof sc !== 'object') return;", "if (!sc || typeof sc !== 'object') return;"],
  ['the title is not cleaned', H, 'window.ryagramLiveHost.title = clean(sc.title, 80);', 'window.ryagramLiveHost.title = String(sc.title);'],
  ['the teardown request is not answered', H, "m.method === 'ui/resource-teardown' ? { result: {} } :", "m.method === 'ui/resource-teardown' ? { error: { code: -32601, message: 'x' } } :"],
  ['the panel opens a link from the host', H, 'const stops = [];', "const stops = []; request('ui/open-link', { url: 'https://evil.example/' }).catch(() => {});"],
  ['the policy lets the page reach out', B, "connect-src 'none'", 'connect-src *'],
  ['the policy lets the page run eval', B, "script-src 'unsafe-inline'", "script-src 'unsafe-inline' 'unsafe-eval'"],
  ['the footer about a final button is left in the chat', H, "    reword();\n    if (typeof MutationObserver", "    if (typeof MutationObserver"],
  ['the footer is reworded once and never again', H, "new MutationObserver(reword).observe(root, { childList: true, subtree: true, characterData: true });", ""],
  ['a panel click is read as the AI\'s change', DR, "if (o.actor === 'ai' && o.client === PANEL) {", 'if (false) {'],
  ['a panel click made on this page is applied a second time', DR, 'if (mine) mine.serverId = o.id;\n          else {', 'if (false) mine.serverId = o.id;\n          else {'],
  ['the build button is offered in the chat', CSS, '.le-pill,.le-top .button.primary{display:none}', '.le-pill{display:none}'],
  ['the pill that talks about the computer is offered in the chat', CSS, '.le-pill,.le-top .button.primary{display:none}', '.le-top .button.primary{display:none}'],
  ['the panel does not say drafts are kept by Ryagram', H, "'Changes here are drafts that Ryagram keeps. Save or build the film in the Ryagram app.'", "''"],
];

function run(cwd) {
  const gen = spawnSync(process.execPath, [path.join('tools', 'build-chat-editor.mjs')], { encoding: 'utf8', cwd });
  if (gen.status) return gen;
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tests', 'assets', 'tools/chat-editor', 'tools/maker-live']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  fs.copyFileSync(path.join(root, 'tools/build-chat-editor.mjs'), path.join(scratch, 'tools/build-chat-editor.mjs'));
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
  const r = run(scratch);
  const caught = r.status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
