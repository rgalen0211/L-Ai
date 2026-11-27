// Must-fail proof for tests/connect-dept-flip-1127.test.mjs and tests/connect-hard-rule-1127.test.mjs (CONNECT 11-27): each mutant breaks ONE thing in a scratch copy of the connector and the named suite must then FAIL.
// A baseline run of both suites on the unbroken copy must PASS first. Run ALONE:  node tests/connect_dept_flip_mutants.mjs   (exit 0 only when every mutant is caught; 2 = the baseline failed, nothing was proved).
// It deletes nothing: the scratch copy (.mut-flip, untracked) is copied once, each fault is written over one file, and the original text is written back before the next.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-flip');
const C = 'supabase/functions/connect-core/';
const G = C + 'games_tools.ts', T = C + 'tools.ts';
const FLIP = 'connect-dept-flip-1127.test.mjs', HARD = 'connect-hard-rule-1127.test.mjs';
const SUITES = [FLIP, HARD];
const mutants = [
  // ---- Games
  [FLIP, 'Games: the switch is not checked at all', G, 'if (on) return null;', 'return null;'],
  [FLIP, 'Games: a differently cased switch opens it', G, 'sw.includes("games")', 'sw.some((s) => String(s).toLowerCase() === "games")'],
  [FLIP, 'Games: a coming-soon department counts as open', G, 'r.id === "games" && r.status === "working"', 'r.id === "games" && r.status !== "xx"'],
  [FLIP, 'Games: any department saying working opens it', G, 'r.id === "games" && r.status === "working"', 'r.status === "working"'],
  [FLIP, 'Games: when neither list can be read the tools answer anyway', G, 'if (rows === null && sw === null) return refuse(', 'if (rows === null && sw === null) return null; if (false) return refuse('],
  [FLIP, 'Games: a switch list that is a string still opens it', G, '(Array.isArray(sw) && sw.includes("games"))', '(sw as unknown as string).includes("games")'],
  [FLIP, 'Games: list_games is not listed', G, 'title: "See the games", scope: "read", readOnly: true,', 'title: "See the games", scope: "read", listed: false, readOnly: true,'],
  [FLIP, 'Games: the closed answer carries the game list', G, '{ ok: false, reason: "games_not_open" }', '{ ok: false, reason: "games_not_open", games: GAMES_OFFERED }'],
  // ---- Compilations
  [FLIP, 'Compilations: any switch at all opens it', T, 'if (Array.isArray(switches) && switches.includes("compilations")) return true;', 'if (Array.isArray(switches) && switches.length > 0) return true;'],
  [FLIP, 'Compilations: any department saying working opens it', T, 'r.id === "compilations" && r.status === "working"', 'r.status === "working"'],
  [FLIP, 'Compilations: everyone counts as having the desktop app', T, 'return !!w && w.desktop_app === true;', 'return true;'],
  [FLIP, 'Compilations: an unreadable switch list counts as the switch being on', T, 'const switches = await ctx.data.switches().catch(() => [] as string[]);\n  if (Array.isArray(switches) && switches.includes("compilations"))', 'const switches = await ctx.data.switches().catch(() => ["compilations"] as string[]);\n  if (Array.isArray(switches) && switches.includes("compilations"))'],
  [FLIP, 'Compilations: get_compilation_status skips the gate', T, 'inputSchema: obj({ project_id: uuid }, ["project_id"]),\n  async run(a, ctx) {\n    if (!(await compilationsOpen(ctx))) return closedResult();', 'inputSchema: obj({ project_id: uuid }, ["project_id"]),\n  async run(a, ctx) {'],
  [FLIP, 'Compilations: open_compilations_page skips the gate', T, 'inputSchema: obj(),\n  async run(_a, ctx) {\n    if (!(await compilationsOpen(ctx))) return closedResult();', 'inputSchema: obj(),\n  async run(_a, ctx) {'],
  [FLIP, 'Compilations: the closed answer carries the page address', T, '{ ok: false, looked_up: false, reason: "compilations_not_open" }', '{ ok: false, looked_up: false, reason: "compilations_not_open", page: COMPILATIONS_PAGE }'],
  [FLIP, 'Compilations: set_compilation_request starts being gated by the switch (a deliberate change must update the pin)', T, 'if (w.desktop_app !== false) return null;', 'if (w.desktop_app !== false) return null; if (what === "A compilation request") return null;'],
  // ---- the inventory and the tripwire
  // ---- hard rule
  [HARD, 'make_preview becomes a write tool (a render ladder tool with write scope)', T, 'name: "make_preview", title: "Make a preview", scope: "render_free"', 'name: "make_preview", title: "Make a preview", scope: "write"'],
  [HARD, 'create_project (a write tool) gains an amount argument', T, 'description: "Starts a new, empty film project. Free. If a project with the same title already exists it is returned instead of making a second one.",\n  inputSchema: obj({', 'description: "Starts a new, empty film project. Free. If a project with the same title already exists it is returned instead of making a second one.",\n  inputSchema: obj({ amount: { type: "number" },'],
  [HARD, 'a department tool reports credits used', G, 'const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data });', 'const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data, credits: 5 });'],
  [HARD, 'the status answer says credits were used', T, 'film_stays_on_the_persons_computer: true, credits: 0, looked_up: true', 'film_stays_on_the_persons_computer: true, credits: 5, looked_up: true'],
  [HARD, 'a department answer holds a path on the person\'s computer', G, 'export const PLAYERS_PAGE_PATH = "/game-phone/";', 'export const PLAYERS_PAGE_PATH = "/Users/alice/game-phone/";'],
  [HARD, 'a department answer holds a drive letter path', T, 'export const COMPILATIONS_PAGE = "#/d/compilations";', 'export const COMPILATIONS_PAGE = "C:/Users/a/#/d/compilations";'],
  [HARD, 'a department answer holds a backslash path', G, 'export const GAMES_PAGE_PATH = "/app/#/d/games";', 'export const GAMES_PAGE_PATH = "\\\\\\\\host\\\\share";'],
  [HARD, 'a new tool is both a write tool and can spend (request_full_render becomes write scope)', T, 'title: "Full film render (not available from an AI connection)", scope: "read"', 'title: "Full film render (not available from an AI connection)", scope: "write"'],
];
const run = (suite) => spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', suite)], { encoding: 'utf8', cwd: scratch, timeout: 300000, killSignal: 'SIGKILL' });
const hung = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: a suite did not end in 5 minutes'); return r; };

fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
for (const s of SUITES) fs.copyFileSync(path.join(root, 'tests', s), path.join(scratch, 'tests', s));
if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));

for (const s of SUITES) {
  const base = hung(run(s));
  if (base.status !== 0) { console.log(`BASELINE FAILS for ${s} (nothing proved):\n` + String(base.stdout).slice(-1500)); process.exit(2); }
}
console.log('baseline passes (both suites)');
let missed = 0;
for (const [suite, name, file, from, to] of mutants) {
  const target = path.join(scratch, file);
  const original = fs.readFileSync(path.join(root, file), 'utf8');              // always the real file's text, so a faulted copy can never carry over
  const src = original.replace(/\r\n/g, '\n');
  const copies = src.split(from).length - 1;
  if (copies !== 1) { console.log(`BROKEN MUTANT (${copies} copies of the text, expected 1): ${name}`); missed++; fs.writeFileSync(target, original); continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = hung(run(suite)).status !== 0;
  fs.writeFileSync(target, original);                                           // put it back before the next one
  console.log(`${caught ? 'caught ' : 'MISSED '} [${suite.replace('connect-', '').replace('-1127.test.mjs', '')}] ${name}`);
  if (!caught) missed++;
}
for (const s of SUITES) {
  if (hung(run(s)).status !== 0) { console.log('RESTORE CHECK FAILS: the scratch copy no longer passes after the last fault was put back'); process.exit(2); }
}
console.log(missed ? `${missed} of ${mutants.length} not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
