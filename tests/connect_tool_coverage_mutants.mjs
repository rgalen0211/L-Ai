// Must-fail proof for tests/connect-tool-coverage-1127.test.mjs (CONNECT 11-27): each mutant breaks ONE guard of the one gate every tool passes (or one tool's own scope/schema helper) in a scratch copy of the
// connector, and the suite must then FAIL. A baseline run on the unbroken copy must PASS first, so "caught" means the suite really noticed. Run ALONE:  node tests/connect_tool_coverage_mutants.mjs  (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-toolcov');
const D = 'supabase/functions/connect-core/';
const SUITES = ['connect-tool-coverage-1127.test.mjs'];
const ALLSCOPES = '["read", "write", "render_free", "render_final", "edit", "fetch_data", "submit_data"]';
const mutants = [
  ['(b) a person with no connection is let in with every scope', D + 'dispatch.ts', 'if (!grant) return refused(NO_GRANT, "no_grant");', 'if (!grant) grant = { scopes: ' + ALLSCOPES + ' };'],
  ['(b) the refusal for no connection carries the token hash', D + 'dispatch.ts', 'if (!grant) return refused(NO_GRANT, "no_grant");', 'if (!grant) return refused(NO_GRANT + " " + principal.tokenHash, "no_grant");'],
  ['(c) the scope is never checked', D + 'dispatch.ts', 'if (!grant.scopes.includes(tool.scope)) {', 'if (false) {'],
  ['(c) any connection that can read passes the scope check', D + 'dispatch.ts', 'if (!grant.scopes.includes(tool.scope)) {', 'if (!grant.scopes.includes("read")) {'],
  ['(c) request_download is moved to the write scope', D + 'tools.ts', 'name: "request_download", title: "Ask to download a public data file", scope: "fetch_data",', 'name: "request_download", title: "Ask to download a public data file", scope: "write",'],
  ['(c) set_look is moved to the read scope', D + 'tools.ts', 'name: "set_look", title: "Change the look in the person\'s open editor", scope: "edit",', 'name: "set_look", title: "Change the look in the person\'s open editor", scope: "read",'],
  ['(c) make_preview is moved to the final-render scope', D + 'tools.ts', 'name: "make_preview", title: "Make a preview", scope: "render_free",', 'name: "make_preview", title: "Make a preview", scope: "render_final",'],
  ['(e) the arguments are never checked against the schema', D + 'dispatch.ts', 'if (problems.length) return refused(', 'if (false) return refused('],
  ['(e) the shared schema helper stops closing its schemas', D + 'tools.ts', '({ type: "object", properties, required, additionalProperties: false });', '({ type: "object", properties, required, additionalProperties: true });'],
  ['(d) a tool of a switched-off chat editor still answers', D + 'dispatch.ts', '(found.chatEditor && !env.chatEditor) || ', ''],
  ['(d) a tool of a switched-off home panel still answers', D + 'dispatch.ts', '(found.homePanel && !env.homePanel) || ', ''],
  ['(d) a tool of a switched-off prepared-data door still answers', D + 'dispatch.ts', '(found.preparedData && !env.preparedData) || ', ''],
  ['(g) get_film_link no longer checks the project is the person\'s own', D + 'tools.ts', 'const pv = await projectVersion(ctx, String(a.project_id));\n    if (!pv) return NOT_YOURS("project");\n    if (!(await ctx.policy.hit(ctx.principal, "links"', 'const pv = await projectVersion(ctx, String(a.project_id));\n    if (false) return NOT_YOURS("project");\n    if (!(await ctx.policy.hit(ctx.principal, "links"'],
  ['(f) get_film_link has no daily limit', D + 'tools.ts', 'if (!(await ctx.policy.hit(ctx.principal, "links", LIMITS.linksPerDayPerUser, 86400))) {', 'if (false) {'],
  ['(f) get_film_link counts links against every account together', D + 'tools.ts', 'if (!(await ctx.policy.hit(ctx.principal, "links", LIMITS.linksPerDayPerUser, 86400))) {', 'if (!(await ctx.policy.hit({ ...ctx.principal, userId: "u-alice" }, "links", LIMITS.linksPerDayPerUser, 86400))) {'],
  ['(spend) request_full_render says it started something', D + 'tools.ts', 'refused: true, code: "not_available", data: { ok: false, allowed: false, started: false,', 'code: "ok", data: { ok: true, allowed: true, started: true,'],
  ['whoami says a full render is enabled', D + 'tools.ts', 'full_render_enabled: false });', 'full_render_enabled: true });'],
  ['(f) the per-connection minute limit is gone', D + 'dispatch.ts', 'if (!panelCall && !(await policy.hit(principal, "calls", LIMITS.callsPerMinutePerClient, 60))) {', 'if (false) {'],
  ['(f) the per-account minute limit is gone', D + 'dispatch.ts', 'if (!panelCall && !(await policy.hit(principal, "calls_acct", LIMITS.callsPerMinutePerAccount, 60))) {', 'if (false) {'],
  ['(f) the limit refusal does not name which limit it was', D + 'dispatch.ts', 'data: { ok: false, code: "rate", limit: which,', 'data: { ok: false, code: "rate", limit: "x",'],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((f) => path.join('tests', f))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  for (const f of SUITES) fs.copyFileSync(path.join(root, 'tests', f), path.join(scratch, 'tests', f));
}
fresh();
const base = run(scratch);
if (base.status !== 0) { console.log('BASELINE FAILS (nothing proved):\n' + base.stdout.slice(-800)); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8');
  const crlf = src.includes('\r\n');
  const text = src.replace(/\r\n/g, '\n');
  const n = text.split(from).length - 1;
  if (n !== 1) { console.log(`BROKEN MUTANT (${n} copies of the text, expected 1): ${name}`); missed++; continue; }
  const out = text.replace(from, () => to);
  fs.writeFileSync(target, crlf ? out.replace(/\n/g, '\r\n') : out);
  const r = run(scratch);
  if (r.status === 0) { console.log('MISSED  ' + name); missed++; } else console.log('caught  ' + name);
}
console.log(missed ? `${missed} of ${mutants.length} not caught` : `all ${mutants.length} mutants caught`);
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(missed ? 1 : 0);
