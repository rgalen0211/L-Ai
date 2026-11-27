// Must-fail proof for the data hand-over's own switch (tests/connect-prepared-data.test.mjs, connect-prepared-guide.test.mjs, directory-manifests.test.mjs): each mutant breaks ONE thing in a scratch copy and the suites must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_prepared_switch_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-prepsw');
const C = 'supabase/functions/connect-core/';
const T = C + 'tools.ts', DI = C + 'dispatch.ts', M = C + 'mcp.ts', RE = C + 'rest.ts', OA = C + 'oauth.ts', IX = 'supabase/functions/connect/index.ts', GC = 'assets/ryagram-config.js', GUIDE = 'connect-ai/index.html', MAN = 'supabase/directory/tools.json';
const SUITES = ['connect-prepared-data.test.mjs', 'connect-prepared-guide.test.mjs', 'directory-manifests.test.mjs', 'connect-oauth.test.mjs'];
const mutants = [
  ['submit_prepared_data loses the switch', T, 'scope: "submit_data", readOnly: false, idempotent: false, preparedData: true,', 'scope: "submit_data", readOnly: false, idempotent: false,'],
  ['list_my_data loses the switch', T, 'scope: "read", readOnly: true, idempotent: true, preparedData: true,', 'scope: "read", readOnly: true, idempotent: true,'],
  ['a call is answered while the switch is off', DI, ' || (found.preparedData && !env.preparedData) || (env.listedOnly', ' || (env.listedOnly'],
  ['the list shows the tools while the switch is off', M, ' && (!t.preparedData || preparedData))', ')'],
  ['the MCP list is always told the switch is on', M, 'homePanelOn(deps.mcpApp), preparedDataOn(deps.mcpApp))', 'homePanelOn(deps.mcpApp), true)'],
  ['the MCP call is always told the switch is on', M, 'preparedData: preparedDataOn(deps.mcpApp), listedOnly: true };', 'preparedData: true, listedOnly: true };'],
  ['the switch needs the MCP App face as well', M, 'export const preparedDataOn = (a?: McpAppConfig) => !!a?.preparedData;', 'export const preparedDataOn = (a?: McpAppConfig) => !!(a?.enabled && a.preparedData);'],
  ['the OpenAPI document offers the tools while the switch is off', RE, ' && !x.homePanel && !x.preparedData)', ' && !x.homePanel)'],
  ['the scope is advertised while the switch is off', OA, 'preparedData ? SCOPES : SCOPES.filter((s) => s !== "submit_data");', 'SCOPES;'],
  ['the scope is never advertised', OA, 'preparedData ? SCOPES : SCOPES.filter((s) => s !== "submit_data");', 'SCOPES.filter((s) => s !== "submit_data");'],
  ['the authorization metadata is built without the switch', OA, 'authorizationServerMetadata(d.baseUrl, !!d.cimd, !!d.preparedData)', 'authorizationServerMetadata(d.baseUrl, !!d.cimd)'],
  ['the protected-resource document is built without the switch', OA, 'protectedResourceDoc(d.baseUrl, !!d.preparedData)', 'protectedResourceDoc(d.baseUrl)'],
  ['the function turns the switch on for any value', IX, '(Deno.env.get("CONNECT_PREPARED_DATA") ?? "").trim().toLowerCase() === "on";', '(Deno.env.get("CONNECT_PREPARED_DATA") ?? "") !== "";'],
  ['the function leaves the switch out of the OAuth deps', IX, '      preparedData: preparedDataOn,\n', ''],
  ['the function leaves the switch out of the MCP config', IX, 'probe: Deno.env.get("CONNECT_MAP_PROBE") === "on", preparedData: preparedDataOn,', 'probe: Deno.env.get("CONNECT_MAP_PROBE") === "on",'],
  // the three that flip together
  ['uploads goes on and the guide says nothing', GC, '  uploads: false,', '  uploads: true,'],
  ['the manifest offers the data tools while uploads is off', MAN, '"tool_count": 20,', '"tool_count": 22,'],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  for (const d of ['supabase', 'tests', 'assets', 'connect-ai', 'tools']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
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
