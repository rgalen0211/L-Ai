// Must-fail proof for tests/connect-map-probe.test.mjs (the Q520 probe panel): each mutant breaks ONE rule in a scratch copy and the suites must then FAIL. A baseline run on the unbroken copy must PASS first,
// and every text must occur exactly once (a pattern that no longer matches is reported as BROKEN, never as caught).
// Run:  node tests/connect_map_probe_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-probe');
const P = 'supabase/functions/connect-core/probe.ts', MA = 'supabase/functions/connect-core/mcp_app.ts', M = 'supabase/functions/connect-core/mcp.ts', D = 'supabase/functions/connect-core/dispatch.ts', IX = 'supabase/functions/connect/index.ts';
const SUITES = ['connect-map-probe.test.mjs', 'connect-mcp-app.test.mjs', 'connect-chat-editor-server.test.mjs'];
const mutants = [
  // the switch
  ['the probe tools exist when the probe switch is off', P, 'export const probeTool = (name: unknown, on?: boolean): ToolDef | undefined => (on && typeof name === "string" ? BY_NAME.get(name) : undefined);', 'export const probeTool = (name: unknown, on?: boolean): ToolDef | undefined => (typeof name === "string" ? BY_NAME.get(name) : undefined);'],
  ['the probe switch works without the app face', P, 'export const probeOn = (a?: { enabled: boolean; probe?: boolean }) => !!(a?.enabled && a.probe);', 'export const probeOn = (a?: { enabled: boolean; probe?: boolean }) => !!a?.probe;'],
  ['the tool list carries the probe tools when the switch is off', P, 'if (!probeOn(a)) return list;', 'if (false) return list;'],
  ['the resource list names the probe pages when the switch is off', P, 'export const probeResources = (on: boolean, mime: string) => on ? PROBE_URIS.map(', 'export const probeResources = (on: boolean, mime: string) => true ? PROBE_URIS.map('],
  ['the pages are served when the probe switch is off', MA, 'const probe = cfg.probe ? probePage(uri) : null;', 'const probe = probePage(uri);'],
  ['every call is told the probe is off', M, 'probe: probeOn(deps.mcpApp),', 'probe: false,'],
  ['every call is told the probe is on', M, 'probe: probeOn(deps.mcpApp),', 'probe: true,'],
  ['the function never reads the probe switch', IX, 'probe: Deno.env.get("CONNECT_MAP_PROBE") === "on", ', ''],
  ['the dispatcher never looks at the probe tools', D, 'TOOL_BY_NAME.get(name) ?? probeTool(name, env.probe);', 'TOOL_BY_NAME.get(name);'],
  // what the page declares
  ['the page declares the origin it should have tested as undeclared', P, 'export const probeCsp = () => ({ connectDomains: [DECLARED_ORIGIN], resourceDomains: [] as string[] });', 'export const probeCsp = () => ({ connectDomains: [DECLARED_ORIGIN, UNDECLARED_ORIGIN], resourceDomains: [] as string[] });'],
  ['the page declares no origin at all', P, 'export const probeCsp = () => ({ connectDomains: [DECLARED_ORIGIN], resourceDomains: [] as string[] });', 'export const probeCsp = () => ({ connectDomains: [] as string[], resourceDomains: [] as string[] });'],
  ['the OpenAI spelling of the list is left out', MA, ', "openai/widgetCSP": { connect_domains: csp.connectDomains, resource_domains: csp.resourceDomains }', ''],
  ['the sandbox domain is left off the page', MA, 'if (dom && UI_DOMAIN.test(dom)) ui.domain = dom;', ''],
  ['the sandbox domain is used without checking its form', MA, 'if (dom && UI_DOMAIN.test(dom)) ui.domain = dom;', 'if (dom) ui.domain = dom;'],
  // the address and the build
  ['the page address does not carry the build', P, 'export const PROBE_URI = "ui://ryagram/probe-" + PROBE_BUILD;', 'export const PROBE_URI = "ui://ryagram/probe";'],
  ['the build is not a hash of the page', P, 'export const PROBE_BUILD = build12(raw("", 0));', 'export const PROBE_BUILD = "000000000000";'],
  // the test data
  ['the test data has a wrong checksum', P, 'return { probe: 1, kb, length: n, check: fnv32(fill), fill };', 'return { probe: 1, kb, length: n, check: fnv32(fill + "x"), fill };'],
  ['the test data is cut short', P, 'const fill = chars.join("");', 'const fill = chars.join("").slice(0, -1);'],
  ['the tool takes any size', P, 'if (!(PAYLOAD_KB as readonly number[]).includes(kb)) return', 'if (false) return'],
  ['the padded page is not padded', P, 'const pad = padKb ? "<!--" + "x".repeat(padKb * 1024) + "-->" : "";', 'const pad = "";'],
  ['the padding comes after the script', P, [['</div></main>" + pad +\n    "<script>"', '</div></main>" +\n    "<script>"'], ['"</script></body></html>";', '"</script>" + pad + "</body></html>";']]],
  // the page's own rules
  ['the page also fetches Ryagram', P, 'var DECL=\'__DECL__\',UNDECL=\'__UNDECL__\'', 'var DECL=\'__DECL__\',UNDECL=\'https://uselai.com/probe.json\''],
  ['the page builds markup from data', P, "out.textContent=l.join('\\n');size();}", "out.innerHTML=l.join('\\n');size();}"],
  ['the page sends credentials with its fetch', P, "var t0=performance.now(),o={cache:'no-store'};", "var t0=performance.now(),o={cache:'no-store',credentials:'include'};"],
  ['an undeclared fetch that is allowed is called blocked', P, "(v.length?'ANSWERED although a policy report fired (report-only?)':'ALLOWED: the host does NOT restrict connections to the declared list')", "(v.length?'ANSWERED although a policy report fired (report-only?)':'BLOCKED by the page policy, as designed')"],
  ['a cut tool result is called whole', P, "return (okLen&&okSum?'WHOLE':'DAMAGED')", "return ('WHOLE')"],
  ['the checksum is not compared', P, 'var okLen=sc.fill.length===sc.length,okSum=fnv(sc.fill)===sc.check;', 'var okLen=sc.fill.length===sc.length,okSum=true;'],
  ['the preflight check sends no header', P, "return net(DECL,{'X-Ryagram-Probe':'1'})", 'return net(DECL)'],
  ['the worker check does not wait for the worker to fetch', P, 'if(got.length>=2)end(', 'if(got.length>=1)end('],
  ['a host that never answers the handshake stops the checks', P, "if(m.timeout){set('host','NO answer to ui/initialize in 3 s');runAll();return;}", "if(m.timeout){set('host','NO answer to ui/initialize in 3 s');return;}"],
  ['the report is sent to the chat with more than its text', P, "ask('ui/update-model-context',{content:[{type:'text',text:out.textContent}]}", "ask('ui/update-model-context',{content:[{type:'text',text:out.textContent}],structuredContent:{uri:location.href}}"],
  ['direction characters pass through the page', P, 'var BAD=/[\\u0000-\\u001f\\u007f-\\u009f\\u2028-\\u202e\\u2066-\\u2069\\u200e\\u200f]/g;', 'var BAD=/[\\u0000-\\u001f]/g;'],
  ['the tool is write-capable', P, 'name: "map_probe", title: "Ryagram probe page", scope: "read", readOnly: true,', 'name: "map_probe", title: "Ryagram probe page", scope: "write", readOnly: true,'],
  ['the tool list says the probe tools are not read-only', P, 'annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: meta(t.probe as string)', 'annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: meta(t.probe as string)'],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tests']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
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
  const pairs = Array.isArray(from) ? from : [[from, to]];
  let out = src, bad = null;
  for (const [a, b] of pairs) {
    const f = a.replace(/\r\n/g, '\n'), n = out.split(f).length - 1;
    if (n !== 1 || f === b) { bad = n; break; }
    out = out.replace(f, () => b.replace(/\r\n/g, '\n'));
  }
  if (bad !== null) { console.log(`BROKEN MUTANT (text found ${bad} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, out);
  const r = run(scratch);
  const caught = r.status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught or broken` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
