// Must-fail proof for tests/connect.test.mjs: each mutant deletes ONE check from a scratch copy of the connect code
// and the suite must then FAIL. Run:  node tests/connect_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut');
const D = 'supabase/functions/connect-core/';
const mutants = [
  ['no invitation/consent check', D + 'dispatch.ts', 'if (!grant) return refused(NO_GRANT, "no_grant");', 'grant = grant ?? { scopes: ["read", "write", "render_free", "render_final"] };'],
  ['no scope check', D + 'dispatch.ts', 'if (!grant.scopes.includes(tool.scope)) {', 'if (false) {'],
  ['no argument check', D + 'dispatch.ts', 'if (problems.length) return refused(`The call was not understood', 'if (false) return refused(`The call was not understood'],
  ['no per-client rate limit', D + 'dispatch.ts', 'if (!(await policy.hit(principal, `calls:${principal.clientId}`', 'if (false && !(await policy.hit(principal, `calls:${principal.clientId}`'],
  ['no render-ladder rate limit', D + 'dispatch.ts', 'if (tool.ladder && !(await policy.hit', 'if (false && !(await policy.hit'],
  ['set_story saves despite failed checks', D + 'tools.ts', 'if (problems.length) {\n      return refuse(`The story was NOT saved', 'if (false) {\n      return refuse(`The story was NOT saved'],
  ['sheet/preview/render start without confirm', D + 'tools.ts', 'if (!confirm) {', 'if (false) {'],
  ['full render ignores confirm', D + 'tools.ts', 'if (a.confirm !== true) {', 'if (false) {'],
  ['full render ignores the on/off switch', D + 'tools.ts', 'if (!(await ctx.policy.finalRendersEnabled())) {', 'if (false) {'],
  ['full render ignores which preview was shown', D + 'tools.ts', 'if (l.preview!.id !== a.preview_job_id) {', 'if (false) {'],
  ['full render ignores the ladder', D + 'tools.ts', 'if (!l.ready) return refuse', 'if (false) return refuse'],
  ['no credit balance check', D + 'tools.ts', 'if (q.credits > q.available) {\n      return refuse(`${label} costs', 'if (false) {\n      return refuse(`${label} costs'],
  ['a second identical job is queued', D + 'tools.ts', 'if (running) return ok(`${label} for this story is already', 'if (false) return ok(`${label} for this story is already'],
  ['project titles not marked untrusted', D + 'tools.ts', 'untrusted("project-title", p.title)', 'p.title'],
  ['errors leak tokens', D + 'tools.ts', String.raw`.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/g, "[removed]")`, ''],
  ['MCP answers without a valid token', D + 'mcp.ts', 'if (!principal) return json(401, { error: "Sign in to Ryagram to use this connection." }', 'if (false) return json(401, { error: "Sign in to Ryagram to use this connection." }'],
  ['MCP does not cap the request size', D + 'mcp.ts', 'if (raw.length > LIMITS.maxBodyBytes) return json(413, { error: "That request is too large." });\n  let msg', 'let msg'],
  ['story size cap removed', D + 'story_check.ts', 'if (size > LIMITS.maxStoryBytes)', 'if (false)'],
  ['unknown dataset allowed', D + 'story_check.ts', 'typeof c.dataset === "string" && !DATASETS[c.dataset]', 'false'],
  ['calls are not logged', D + 'dispatch.ts', 'await policy.log({', 'void ({'],
];

let missed = 0;
for (const [name, file, from, to] of mutants) {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests/connect.test.mjs'), path.join(scratch, 'tests/connect.test.mjs'));
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(scratch, 'tests/connect.test.mjs')], { encoding: 'utf8' });
  const caught = r.status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
