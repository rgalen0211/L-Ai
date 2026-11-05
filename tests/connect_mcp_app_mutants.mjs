// Must-fail proof for tests/connect-mcp-app.test.mjs (the inline Ryagram card): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once (a text that moved is "broken", not "caught"). Run:  node tests/connect_mcp_app_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-app');
const C = 'supabase/functions/connect-core/';
const M = C + 'mcp.ts', A = C + 'mcp_app.ts';
const SUITES = ['connect-mcp-app.test.mjs'];
const mutants = [
  // the switch: OFF must be the connector as it was
  ['resources/list answers when the switch is OFF', M, 'case "resources/list": {\n      if (!deps.mcpApp?.enabled) return', 'case "resources/list": {\n      if (false) return'],
  ['resources/read answers when the switch is OFF', M, 'case "resources/read": {\n      if (!deps.mcpApp?.enabled) return', 'case "resources/read": {\n      if (false) return'],
  ['the server claims resources when the switch is OFF', M, '...(deps.mcpApp?.enabled ? { resources: {} } : {})', 'resources: {}'],
  ['the tool list carries _meta when the switch is OFF', M, 'toolList(!!deps.mcpApp?.enabled)', 'toolList(true)'],
  ['the REST face list carries _meta', M, 'export const toolList = (mcpApp = false)', 'export const toolList = (mcpApp = true)'],
  ['every tool is given a page', M, 'mcpApp && UI_TOOL_URIS[t.name] ?', 'mcpApp ?'],
  ['the ChatGPT alias is dropped', A, '"openai/outputTemplate": uri', 'x: uri'],
  ['a third tool is given the card', A, 'list_projects: CARD_URI }', 'list_projects: CARD_URI, create_project: CARD_URI }'],
  ['resources are served without signing in', M, 'if (!principal) return json(401,', 'if (false) return json(401,'],
  // what is served
  ['any page address is answered with the card', A, 'if (uri !== CARD_URI) return null;', 'if (false) return null;'],
  ['a missing page echoes the address it was asked for', M, '"That page does not exist."', '`That page does not exist: ${String(msg.params?.uri)}`'],
  ['the sandbox domain is used without checking its form', A, 'if (cfg.uiDomain && UI_DOMAIN.test(cfg.uiDomain))', 'if (cfg.uiDomain)'],
  ['the page address is used without checking it', A, 'appUrl && APP_URL.test(appUrl) ? appUrl : ""', 'appUrl ?? ""'],
  ['the card is allowed to open a network origin', A, 'csp: { connectDomains: [], resourceDomains: [] }', 'csp: { connectDomains: ["https://api.example.com"], resourceDomains: [] }'],
  ['the card is allowed frames', A, 'csp: { connectDomains: [], resourceDomains: [] }', 'csp: { connectDomains: [], resourceDomains: [], frameDomains: ["https://x.example.com"] }'],
  ['the card is given a border it did not ask for', A, 'prefersBorder: false', 'prefersBorder: true'],
  ['a second script is added from outside', A, '"<script>" + CARD_SCRIPT', '"<script src=\\"https://evil.example/x.js\\"></script><script>" + CARD_SCRIPT'],
  ['the page grows past its budget', A, '"@media (max-width:360px){.card{padding:12px}}",', '"@media (max-width:360px){.card{padding:12px}}" + "/*" + "x".repeat(20000) + "*/",'],
  // the page's own behaviour
  ['text is set as markup', A, 'if(text!=null)e.textContent=text;return e;', 'if(text!=null)e.innerHTML=text;return e;'],
  ['messages from any window are believed', A, 'if(ev.source!==host)return;', 'if(false)return;'],
  ['the protocol version is not checked', A, "m.jsonrpc!=='2.0')return;", "false)return;"],
  ['control and direction characters are kept', A, "replace(BAD,' ').slice", 'slice'],
  ['long text is not cut', A, '.slice(0,n||80)', ''],
  ['a credit count is shown whatever it is', A, "typeof n==='number'&&isFinite(n)?String(Math.round(n)):null", "n==null?null:String(n)"],
  ['the host is never told the card is ready', A, "function(){note('ui/notifications/initialized',{});size();}", 'function(){size();}'],
  ['the teardown request is not answered', A, "post({id:m.id,result:{}});return;", 'return;'],
  ['an unknown request from the host is not refused', A, "post({id:m.id,error:{code:-32601,message:'Method not found'}});return;", 'return;'],
  ['the link opens another address', A, "ask('ui/open-link',{url:appUrl}", "ask('ui/open-link',{url:'https://evil.example/'}"],
  ['the card talks into the conversation', A, '"var last=0;",', '"var last=0;ask(\'ui/message\',{role:\'user\',content:{type:\'text\',text:\'hello\'}},function(){});",'],
  ['the card sends the account to the host', A, "note('ui/notifications/size-changed',{width:", "note('ui/notifications/size-changed',{who:card.textContent,width:"],
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
