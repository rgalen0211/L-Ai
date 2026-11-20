// Must-fail proof for tests/connect-tools.test.mjs: each mutant deletes ONE check from a scratch copy of the connect code
// and the suite must then FAIL. A baseline run on the unbroken copy must PASS first, and every text must occur EXACTLY once (a text that moved is "broken", never "caught").
// Run:  node tests/connect_mutants.mjs   (exit 0 only when every mutant is caught)
// 11-20 audit: this runner had NO baseline and its scratch copy held only supabase/functions and the four suite files, but four tests in those suites read tools/, docs/, the migrations and the app files; they failed on the
// UNBROKEN copy, so every fault below was "caught" by that, whatever it did. The scratch now holds what the suites read, and the baseline is checked.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut');
const D = 'supabase/functions/connect-core/';
const SUITES = ['connect-tools.test.mjs', 'connect-oauth.test.mjs', 'connect-mcp-sdk.test.mjs', 'connect-oauth-guard.test.mjs'];
const mutants = [
  ['no invitation/consent check', D + 'dispatch.ts', 'if (!grant) return refused(NO_GRANT, "no_grant");', 'grant = grant ?? { scopes: ["read", "write", "render_free", "render_final"] };'],
  ['no scope check', D + 'dispatch.ts', 'if (!grant.scopes.includes(tool.scope)) {', 'if (false) {'],
  ['no argument check', D + 'dispatch.ts', 'if (problems.length) return refused(`The call was not understood', 'if (false) return refused(`The call was not understood'],
  ['no per-client rate limit', D + 'dispatch.ts', 'if (!panelCall && !(await policy.hit(principal, "calls"', 'if (false && !panelCall && !(await policy.hit(principal, "calls"'],
  ['no render-ladder rate limit', D + 'dispatch.ts', 'if (tool.ladder && !(await policy.hit', 'if (false && !(await policy.hit'],
  ['set_story saves despite failed checks', D + 'tools.ts', 'if (!chk.ok) {\n      // A RESULT', 'if (false) {\n      // A RESULT'],
  ['a sheet or preview that costs credits is started', D + 'tools.ts', 'if (q.credits > 0) {\n    return refuse(`${label} would cost', 'if (false) {\n    return refuse(`${label} would cost'],
  ['a full render is started from a connection', D + 'tools.ts', '  async run() {\n    // No lookup, no flag, no ladder', "  async run() { return { text: 'ok' };\n    // No lookup, no flag, no ladder"],
  ['a second identical job is queued', D + 'tools.ts', 'if (running) return ok(`${label} for this story is already', 'if (false) return ok(`${label} for this story is already'],
  ['project titles not marked untrusted', D + 'tools.ts', 'untrusted("project-title", p.title)', 'p.title'],
  ['errors leak tokens', D + 'tools.ts', String.raw`.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/g, "[removed]")`, ''],
  ['MCP answers without a valid token', D + 'mcp.ts', 'if (!principal) return json(401, { error: "Sign in to Ryagram to use this connection." }', 'if (false) return json(401, { error: "Sign in to Ryagram to use this connection." }'],
  ['MCP does not cap the request size', D + 'mcp.ts', 'if (buf.byteLength > LIMITS.maxBodyBytes) return json(413, { error: "That request is too large." });\n  const raw', 'const raw'],
  ['a database outage looks like a bad token (401)', D + 'mcp.ts', 'if ("down" in auth) return unavailable();', ''],
  ['REST answers without a valid token', D + 'rest.ts', 'if (!principal) return json(401', 'if (false) return json(401'],
  ['REST does not cap the request size', D + 'rest.ts', 'if (buf.byteLength > LIMITS.maxBodyBytes) return json(413', 'if (false) return json(413'],
  ['a client secret is accepted at /token', D + 'oauth.ts', 'if (p.get("client_secret") ||', 'if (false && p.get("client_secret") ||'],
  ['response_type is not checked at /authorize', D + 'oauth.ts', 'if (u.get("response_type") !== "code") return text(400', 'if (false) return text(400'],
  ['the resource (RFC 8707) is not checked', D + 'oauth.ts', 'if (resource && resource !== `${d.baseUrl}/mcp` && resource !== d.baseUrl) return text', 'if (false) return text'],
  ['no per-caller limit on the open endpoints', D + 'oauth.ts', 'if (!ok) return json(429', 'if (false) return json(429'],
  ['the caller key uses the FIRST forwarded address', D + 'oauth.ts', 'hops[hops.length - 1]', 'hops[0]'],
  ['the issuer is not passed for the redirect (RFC 9207)', D + 'oauth.ts', ', issuer: d.baseUrl });', ", issuer: 'https://x.invalid' });"],
  ['a missing grant_type is not refused', D + 'oauth.ts', 'if (!grant) return json(400', 'if (false) return json(400'],
  ['the OpenID-shaped discovery document is not served', D + 'oauth.ts', 'route.startsWith("/.well-known/openid-configuration")', 'route.startsWith("/.well-known/openid-configuration-off")'],
  ['the token endpoint returns the token in the clear to the store', D + 'oauth.ts', 'accessHash: aHash, refreshHash: rHash', 'accessHash: access, refreshHash: refresh'],
  ['story size cap removed', D + 'story_check.ts', 'if (size > LIMITS.maxStoryBytes) return one(', 'if (false) return one('],
  ['unknown dataset allowed', D + 'story_check.ts', 'typeof c.dataset === "string" && !Object.hasOwn(DATASETS, c.dataset)', 'false'],
  ['calls are not logged', D + 'dispatch.ts', 'await policy.log(principal, {', 'void ({'],
  ['the refusing render tool is listed again', D + 'mcp.ts', 'TOOLS.filter((t) => t.listed !== false && (!t.chatEditor || chatEditor) && (!t.homePanel || homePanel)).map', 'TOOLS.map'],
  ['every tool says it is not destructive', D + 'mcp.ts', 'destructiveHint: t.destructive === true', 'destructiveHint: false'],
  ['every tool says it is idempotent', D + 'mcp.ts', 'idempotentHint: t.idempotent ?? t.readOnly', 'idempotentHint: true'],
  ['set_story is not marked as replacing', D + 'tools.ts', 'title: "Save the story", scope: "write", readOnly: false, destructive: true,', 'title: "Save the story", scope: "write", readOnly: false,'],
  ['the project list shows a timestamp again', D + 'tools.ts', '{ projects: rows.map((p) => ({ id: p.id, title: p.title }))', '{ projects: rows.map((p) => ({ id: p.id, title: p.title, updated_at: p.updated_at }))'],
  ['a description orders the AI again', D + 'tools.ts', 'It needs no arguments and changes nothing.', 'Call it first.'],
  ['a preview starts with no finished contact sheet (PUNCH P3)', D + 'tools.ts', 'if (jobType === "preview") {\n    const sheets', 'if (false) {\n    const sheets'],
  ['a preview is not told the sheet is still running', D + 'tools.ts', '      if (live) {\n', '      if (false) {\n'],
  ['a finished sheet of an EARLIER story counts for a preview', D + 'tools.ts', 'j.job_type === "contact_sheet" && j.story_sha256 === sha', 'j.job_type === "contact_sheet"'],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((f) => path.join('tests', f))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase', 'tools', 'docs', 'tests', 'assets', 'app']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');          // this checkout may have CRLF line endings
  const n = src.split(from).length - 1;
  if (n !== 1 || from === to) { console.log(`BROKEN MUTANT (text found ${n} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
