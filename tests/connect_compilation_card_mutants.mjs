// Must-fail proof for tests/connect-compilation-card.test.mjs (the Compilations status panel in the chat, CONNECT 11-27): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once (a text that moved is "broken", not "caught"). Run ALONE:  node tests/connect_compilation_card_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed"
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-ccard');
const C = 'supabase/functions/connect-core/';
const M = C + 'mcp.ts', A = C + 'mcp_app.ts', K = C + 'compilation_card.ts';
const SUITES = ['connect-compilation-card.test.mjs'];
const mutants = [
  // the switch: OFF must be the connector as it was
  ['resources/list answers when the switch is OFF', M, 'case "resources/list": {\n      if (!deps.mcpApp?.enabled) return', 'case "resources/list": {\n      if (false) return'],
  ['resources/read answers when the switch is OFF', M, 'case "resources/read": {\n      if (!deps.mcpApp?.enabled) return', 'case "resources/read": {\n      if (false) return'],
  ['the tool list carries the page link when the switch is OFF', M, 'toolList(!!deps.mcpApp?.enabled, chatEditorOn(deps.mcpApp), homePanelOn(deps.mcpApp), preparedDataOn(deps.mcpApp))', 'toolList(true, chatEditorOn(deps.mcpApp), homePanelOn(deps.mcpApp), preparedDataOn(deps.mcpApp))'],
  ['the REST face list carries the page link', M, 'export const toolList = (mcpApp = false, chatEditor = false, homePanel = false, preparedData = false)', 'export const toolList = (mcpApp = true, chatEditor = false, homePanel = false, preparedData = false)'],
  ['every tool is given a page', M, 'mcpApp && UI_TOOL_URIS[t.name] ?', 'mcpApp ?'],
  ['the tool is not given its page', A, 'get_compilation_status: COMPILATION_URI, ', ''],
  ['another tool is given the compilation page', A, 'list_projects: CARD_URI }', 'list_projects: CARD_URI, open_compilations_page: COMPILATION_URI }'],
  ['the page is not listed', A, '{ uri: COMPILATION_URI, name: "Ryagram compilation status"', '{ uri: COMPILATION_URI + "-x", name: "Ryagram compilation status"'],
  ['the page is served with a network origin allowed', A, 'csp: { connectDomains: [], resourceDomains: [] }', 'csp: { connectDomains: ["https://api.example.com"], resourceDomains: [] }'],
  ['the page is served with a border it did not ask for', A, 'prefersBorder: false', 'prefersBorder: true'],
  ['the page is served with the card\'s text', A, 'text: compilationHtml(cfg.appUrl) }', 'text: cardHtml(cfg.appUrl) }'],
  ['the page is served without its address check', K, 'const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";', 'const link = appUrl ?? "";'],
  ['any address of any shape is taken for the page', K, 'compilations-[0-9a-f]{12}$/;', 'compilations-[0-9a-f]{12}/;'],
  ['the build id stops following the page', K, 'export const COMPILATION_BUILD = buildId();', 'export const COMPILATION_BUILD = "000000000000";'],
  ['a tool answer is changed when the panel is on', M, 'if (r.data) result.structuredContent = r.data;', 'if (r.data) result.structuredContent = deps.mcpApp?.enabled ? { ...r.data, panel: true } : r.data;'],
  // the page's limits
  ['a second script is added from outside', K, '"<script>" + SCRIPT', '"<script src=\\"https://evil.example/x.js\\"></script><script>" + SCRIPT'],
  ['the page makes a network request', K, '"var last=0;",', '"var last=0;fetch(\'https://evil.example/\');",'],
  ['the page grows past its budget', K, '"@media (max-width:360px){.cc{padding:12px}.row{grid-template-columns:76px minmax(0,1fr);gap:8px}}",', '"@media (max-width:360px){.cc{padding:12px}.row{grid-template-columns:76px minmax(0,1fr);gap:8px}}" + "/*" + "x".repeat(20000) + "*/",'],
  ['text is set as markup', K, 'if(text!=null)e.textContent=text;return e;', 'if(text!=null)e.innerHTML=text;return e;'],
  ['an inline event handler is written', K, '<main class=\\"cc\\" id=\\"cc\\" aria-live', '<main class=\\"cc\\" id=\\"cc\\" onclick=\\"x()\\" aria-live'],
  ['a modern arrow function is used', K, '"function post(m){m.jsonrpc=\'2.0\';host.postMessage(m,\'*\');}",', '"var post=(m)=>{m.jsonrpc=\'2.0\';host.postMessage(m,\'*\');};",'],
  // the look and the phone width
  ['a button is under 44px', K, 'button{min-height:44px;', 'button{min-height:40px;'],
  ['the long phrase column cannot shrink', K, 'grid-template-columns:88px minmax(0,1fr);gap:12px;padding:6px 0', 'grid-template-columns:88px 1fr;gap:12px;padding:6px 0'],
  ['the old card look comes back', K, 'border-radius:18px', 'border-radius:12px'],
  ['the heading loses its serif wordmark', K, 'h1{margin:0;font:400 24px/1 Georgia,Times New Roman,serif', 'h1{margin:0;font:400 24px/1 system-ui'],
  // what the page believes and draws
  ['messages from any window are believed', K, 'if(ev.source!==host)return;', 'if(false)return;'],
  ['the protocol version is not checked', K, "m.jsonrpc!=='2.0')return;", "false)return;"],
  ['control and direction characters are kept', K, "replace(BAD,' ').slice", 'slice'],
  ['a phrase is not cut', K, "q.phrase:'',200)", "q.phrase:'',900000)"],
  ['a folder name is not cut', K, 'clean(q.folders[i],80)', 'clean(q.folders[i],90000)'],
  ['an unknown run state is drawn', K, '||!STATES.hasOwnProperty(r.state))return null;', ')return null;'],
  ['a result that is not the tool\'s is drawn', K, ' if(sc.looked_up!==true)return null;', ''],
  ['not open is said as "not available"', K, "if(sc.looked_up===false&&sc.reason==='compilations_not_open')return {kind:'closed'};", ''],
  ['a count is not clamped', K, 'Math.min(Math.round(v),max)', 'Math.round(v)'],
  ['a count that is not a number is drawn', K, "typeof v==='number'&&isFinite(v)&&v>=0?", 'v!=null?'],
  ['a stop reason is shown as its code', K, '(WHY.hasOwnProperty(r.code)?WHY[r.code]:OTHER)', '(r.code||OTHER)'],
  ['a reason is missing from the panel\'s words', K, '  crash: "something went wrong on your computer",\n', ''],
  ['a report for an earlier request is drawn as current', K, 'if(sc.run_is_for_an_earlier_request===true)v.run=null;', ''],
  ['the strip fills every step', K, "i<=step?'seg on':'seg'", "'seg on'"],
  ['the done words lose where the film is', K, " The film is on your computer: open the Ryagram app to see it.'}", "'}"],
  // the one button
  ['the button opens another address', K, "ask('ui/open-link',{url:url}", "ask('ui/open-link',{url:'https://evil.example/'}"],
  ['the button opens a different page of the site', K, 'export const COMPILATION_PAGE = "#/d/compilations";', 'export const COMPILATION_PAGE = "#/d/games";'],
  ['the data can change the address', K, '"function paint(sc){",', '"function paint(sc){if(sc&&typeof sc.url===\'string\')appUrl=sc.url;",'],
  ['not open is given a button', K, "'Compilations are not open for this Ryagram account yet.'));}", "'Compilations are not open for this Ryagram account yet.'));if(appUrl){var a1=el('div','acts');a1.appendChild(btn('Open on the site',openPage));kids.push(a1);}}"],
  ['a second button is added', K, "a.appendChild(btn('Open on the site',openPage));kids.push(a);}", "a.appendChild(btn('Open on the site',openPage));a.appendChild(btn('Open',openPage));kids.push(a);}"],
  ['the page talks into the conversation', K, '"var last=0;",', '"var last=0;ask(\'ui/message\',{role:\'user\',content:{type:\'text\',text:\'hello\'}},function(){});",'],
  ['the page sends the phrase to the host', K, "note('ui/notifications/size-changed',{width:", "note('ui/notifications/size-changed',{who:root.textContent,width:"],
  ['the host is never told the height', K, 'if(h&&h!==last){last=h;note(', 'if(false){last=h;note('],
  ['the host is never told the page is ready', K, "function(){note('ui/notifications/initialized',{});size();}", 'function(){size();}'],
  ['the teardown request is not answered', K, 'post({id:m.id,result:{}});return;', 'return;'],
  ['an unknown request from the host is not refused', K, "post({id:m.id,error:{code:-32601,message:'Method not found'}});return;", 'return;'],
  ['a host that will not open the link is not told to the person', K, 'if(refused(r))openFailed(url);', ''],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
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
