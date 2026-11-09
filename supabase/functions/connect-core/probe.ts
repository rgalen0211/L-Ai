// The Q520 probe panel (CONNECT, 2026-11-09; paper: Ryagram-logs/proposals/CONNECT-MAP-PROBE-1109.md, which says what each check answers and how Ryan runs it).
// THROWAWAY. It answers what the interactive map needs to know before anything is built, by measuring it inside the real hosts (Claude, ChatGPT, a phone):
//   does the host honour a page's declared connection list (csp.connectDomains) and block an undeclared origin, can the page start a blob Worker (and can the Worker fetch), is WebGL there,
//   does a big tool result reach the page whole, how big a page does the host accept.
// It is OFF unless the function is configured with CONNECT_MAP_PROBE=on (and CONNECT_MCP_APP=on). OFF is byte-for-byte the connector as it was: the probe tools are NOT in the main tool list
// (so not in tools/list, not in the REST/OpenAPI document), no resource is listed or served, and a call to one is "no such tool".
// Everything in it is read-only and costs nothing: its tools only hand the page test bytes. The page makes requests to TWO public script hosts (unpkg, jsDelivr) for one tiny public file and nothing to Ryagram.
// This file imports TYPES only, so mcp.ts, mcp_app.ts and dispatch.ts can use it without a cycle.
import type { ToolDef } from "./types.ts";

/** The origin the page DECLARES (csp.connectDomains) and the one it does not. Both serve the same tiny public file with CORS open (checked 2026-11-09); the DECLARED one (unpkg) also answers a preflight for a custom header, which jsDelivr does not, so check 3 measures the host and not the file server, so a difference in what a host allows is the host's rule, not the file's. */
export const DECLARED_ORIGIN = "https://unpkg.com";
export const UNDECLARED_ORIGIN = "https://cdn.jsdelivr.net";
export const PROBE_FILE = "/is-number@7.0.0/package.json";
export const DECLARED_URL = DECLARED_ORIGIN + PROBE_FILE;
export const UNDECLARED_URL = UNDECLARED_ORIGIN + "/npm" + PROBE_FILE;

/** The padded copies of the page: how big a page does a host accept (the editor page is 146 KB now and about 240 KB with the real drawer). */
export const PAD_KB = [300, 600, 1200] as const;
/** The test-data sizes the tool can hand the page. ChatGPT also shows structuredContent to the model, so the largest is deliberately modest. */
export const PAYLOAD_KB = [10, 100, 250] as const;
export const DEFAULT_PAYLOAD_KB = 100;

/** A 32-bit FNV-1a over the characters (the page computes the same one to prove the data arrived whole). */
export function fnv32(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8);
}
/** 12 hex characters from two differently seeded 32-bit hashes: the page's build, so a host's old copy of an older probe page can never be mistaken for this one. */
export function build12(s: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a ^= c; a = Math.imul(a, 16777619) >>> 0; b = (Math.imul(b, 33) + c) >>> 0; }
  return (("0000000" + a.toString(16)).slice(-8) + ("0000000" + b.toString(16)).slice(-8)).slice(0, 12);
}

/** The test data: deterministic filler, so the page can tell a whole answer from a cut one. */
export function payloadFor(kb: number): Record<string, unknown> {
  const n = kb * 1024;
  const chars: string[] = new Array(n);
  for (let i = 0; i < n; i++) chars[i] = String.fromCharCode(97 + ((i * 7 + (i >> 5)) % 26));
  const fill = chars.join("");
  return { probe: 1, kb, length: n, check: fnv32(fill), fill };
}

const STYLE = [
  ":root{color-scheme:dark}", "*{box-sizing:border-box}", "html,body{margin:0;background:transparent}",
  "body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f2f2ef}",
  ".card{background:#1b1b23;border:1px solid #3a3a44;border-radius:12px;padding:14px 16px;max-width:760px;min-width:0}",
  "h1{margin:0 0 6px;font-size:16px;font-weight:650}",
  ".hint{margin:0 0 10px;color:#b6b5ae;font-size:13px}",
  "pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12.5px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:#e6e6e0;background:#0e0e13;border:1px solid #2c2c36;border-radius:8px;padding:10px}",
  ".bar{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}",
  "button{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid #6fd1bd;background:#0e0e13;color:#8fe0cf;font:inherit;font-weight:600;cursor:pointer}",
  "button:focus-visible{outline:2px solid #8fe0cf;outline-offset:2px}",
].join("");

/** The page's script. ES5 plus Promise/fetch, no template literals, no library, ASCII only. It writes with textContent only and sends nothing to Ryagram. */
const SCRIPT = String.raw`(function(){
var DECL='__DECL__',UNDECL='__UNDECL__',host=window.parent,pend={},nid=0,out=document.getElementById('out'),body=document.body;
var BUILD=body.getAttribute('data-build')||'',PAD=body.getAttribute('data-pad-kb')||'0';
var rep={},calls=[],viol=[],started=false,last=0;
var ORDER=['env','host','toolresult','calls','declared','undeclared','preflight','worker','webgl','page','context'];
var LABEL={env:'This page',host:'Host handshake',toolresult:'Test data handed over with the tool result',calls:'Test data the page asked for',declared:'1. Declared origin ('+DECL.split('/')[2]+')',undeclared:'2. Undeclared origin ('+UNDECL.split('/')[2]+')',preflight:'3. Declared origin with a request header',worker:'4. Blob Worker',webgl:'5. WebGL',page:'6. This page itself',context:'7. Put the report in the chat'};
var BAD=/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\u200e\u200f]/g;
function clean(s,n){return String(s==null?'':s).replace(BAD,' ').slice(0,n||100);}
function post(m){m.jsonrpc='2.0';host.postMessage(m,'*');}
function ask(method,params,done,ms){var id=++nid,t=null;pend[id]=function(m){if(t)clearTimeout(t);done(m);};if(ms){t=setTimeout(function(){if(pend[id]){delete pend[id];done({timeout:true});}},ms);}post({id:id,method:method,params:params});}
function note(method,params){post({method:method,params:params});}
function size(){var r=document.documentElement.getBoundingClientRect(),h=Math.ceil(r.height);if(h&&h!==last){last=h;note('ui/notifications/size-changed',{width:Math.ceil(r.width),height:h});}}
function render(){var l=['Ryagram probe, build '+BUILD+', page padding '+PAD+' KB'],i;for(i=0;i<ORDER.length;i++){var k=ORDER[i];if(rep[k]!==undefined)l.push((LABEL[k]||k)+': '+rep[k]);}out.textContent=l.join('\n');size();}
function set(k,v){rep[k]=v;render();}
function fnv(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return ('0000000'+(h>>>0).toString(16)).slice(-8);}
function judge(sc,ms){
 if(!sc||typeof sc!=='object')return 'NO structured data arrived';
 if(sc.probe!==1||typeof sc.fill!=='string')return 'something arrived but not the test data (keys: '+clean(Object.keys(sc).slice(0,6).join(','),60)+')';
 var okLen=sc.fill.length===sc.length,okSum=fnv(sc.fill)===sc.check;
 return (okLen&&okSum?'WHOLE':'DAMAGED')+': asked '+sc.kb+' KB, got '+sc.fill.length+' of '+sc.length+' characters, checksum '+(okSum?'matches':'DOES NOT match')+(ms!=null?', '+ms+' ms':'');
}
document.addEventListener('securitypolicyviolation',function(e){viol.push(clean(e.violatedDirective,40)+' blocked '+clean(e.blockedURI,70));});
function net(url,headers){
 var t0=performance.now(),o={cache:'no-store'};if(headers)o.headers=headers;
 var run=fetch(url,o).then(function(r){return r.text().then(function(t){return {ok:r.ok,status:r.status,bytes:t.length,ms:Math.round(performance.now()-t0),text:t};});},function(e){return {err:clean((e&&e.name||'Error')+': '+(e&&e.message||''),80),ms:Math.round(performance.now()-t0)};});
 var cap=new Promise(function(res){setTimeout(function(){res({err:'no answer in 6 s',ms:6000});},6000);});
 return Promise.race([run,cap]);
}
function pause(ms){return new Promise(function(r){setTimeout(r,ms);});}
function says(r){return r.err?('FAILED ('+r.err+', '+r.ms+' ms)'):('answered '+r.status+', '+r.bytes+' bytes, '+r.ms+' ms');}
function checkEnv(){
 var bits=[];try{bits.push('origin '+clean(location.origin,80));}catch(e){bits.push('origin unreadable');}
 bits.push('secure '+(window.isSecureContext===true?'yes':'no'),'window '+window.innerWidth+'x'+window.innerHeight,'pixel ratio '+(window.devicePixelRatio||1));
 bits.push('window.openai '+typeof window.openai,'OffscreenCanvas '+typeof OffscreenCanvas,'SharedArrayBuffer '+typeof SharedArrayBuffer);
 set('env',bits.join('; ')+'. Browser: '+clean(navigator.userAgent,140));
}
function checkDeclared(){
 var res=[],p=Promise.resolve();
 [0,1,2].forEach(function(i){p=p.then(function(){return net(DECL).then(function(r){res.push(r);});});});
 return p.then(function(){
  var first=res[0],ok=!first.err&&first.status===200;
  var parsed='';try{parsed=ok?' (file says: '+clean(JSON.parse(first.text).name,30)+')':'';}catch(e){parsed=' (not JSON)';}
  set('declared',(ok?'ALLOWED. ':'NOT ALLOWED / FAILED. ')+res.map(says).join(' | ')+parsed);
 });
}
function checkUndeclared(){
 var from=viol.length;
 return net(UNDECL).then(function(r){return pause(400).then(function(){
  var v=viol.slice(from).filter(function(x){return /connect/.test(x);});
  var s=r.err?(v.length?'BLOCKED by the page policy, as designed':'FAILED with no policy report (network, CORS, or the host blocks silently)'):(v.length?'ANSWERED although a policy report fired (report-only?)':'ALLOWED: the host does NOT restrict connections to the declared list');
  set('undeclared',s+'. fetch: '+says(r)+(v.length?'. Policy reports: '+v.join('; '):'. No policy report.'));
 });});
}
function checkPreflight(){
 var from=viol.length;
 return net(DECL,{'X-Ryagram-Probe':'1'}).then(function(r){return pause(300).then(function(){
  var v=viol.slice(from);
  set('preflight',(r.err?'FAILED':'ALLOWED')+'. fetch: '+says(r)+(v.length?'. Policy reports: '+v.join('; '):'. No policy report.')+' (If it failed with no policy report, the script host refused the header, not the chat host; read it with check 1.)');
 });});
}
function checkWorker(){
 return new Promise(function(done){
  var w=null,t=null,fin=false,from=viol.length;
  function end(s){if(fin)return;fin=true;if(t)clearTimeout(t);try{if(w)w.terminate();}catch(e){}var v=viol.slice(from);set('worker',s+(v.length?'. Policy reports: '+v.join('; '):''));done();}
  try{
   var src='var o="started";postMessage("alive; fetch is "+typeof fetch);fetch("'+DECL+'",{cache:"no-store"}).then(function(r){return r.text();}).then(function(x){postMessage("worker fetch of the declared origin OK, "+x.length+" bytes");},function(e){postMessage("worker fetch of the declared origin FAILED ("+e.name+")");});';
   var u=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
   w=new Worker(u);var got=[];
   w.onmessage=function(e){got.push(clean(e.data,80));if(got.length>=2)end('RAN. '+got.join('. '));};
   w.onerror=function(e){end('FAILED to run ('+clean(e&&e.message||'error event',80)+')');};
   t=setTimeout(function(){end(got.length?'RAN but incomplete: '+got.join('. ')+' (no second answer in 4 s)':'NO ANSWER in 4 s (blocked, or too slow)');},4000);
  }catch(e){end('REFUSED ('+clean(e&&e.name,30)+': '+clean(e&&e.message,80)+')');}
 });
}
function checkWebgl(){
 try{
  var c=document.createElement('canvas'),kind='webgl2',gl=c.getContext('webgl2');
  if(!gl){kind='webgl';gl=c.getContext('webgl');}
  if(!gl){set('webgl','NOT AVAILABLE (no context)');return;}
  var ext=gl.getExtension('WEBGL_debug_renderer_info'),name=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  set('webgl','AVAILABLE ('+kind+'; max texture '+gl.getParameter(gl.MAX_TEXTURE_SIZE)+'; renderer '+clean(name,60)+')');
 }catch(e){set('webgl','FAILED ('+clean(e&&e.name,30)+': '+clean(e&&e.message,80)+')');}
}
function checkPage(){set('page','arrived and ran. Its own HTML is '+document.documentElement.outerHTML.length+' characters; padding declared '+PAD+' KB.');}
function runAll(){
 if(started)return;started=true;
 checkEnv();checkPage();checkWebgl();
 checkDeclared().then(checkUndeclared).then(checkPreflight).then(checkWorker).then(function(){set('context',rep.context||'not tried yet (press the button)');}).catch(function(e){set('declared',rep.declared||'the checks stopped: '+clean(e&&e.message,80));});
}
function callKb(kb){
 var t0=performance.now();calls.push(kb+' KB: asked...');set('calls',calls.join(' | '));var at=calls.length-1;
 ask('tools/call',{name:'map_probe',arguments:{kb:kb}},function(m){
  var ms=Math.round(performance.now()-t0);
  calls[at]=kb+' KB: '+(m.timeout?'no answer in 20 s':m.error?'the host answered with an error ('+clean(m.error.message||m.error.code,80)+')':judge((m.result||{}).structuredContent,ms)+((m.result||{}).isError?' (isError)':''));
  set('calls',calls.join(' | '));
 },20000);
}
function btn(text,fn){var b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);return b;}
var bar=document.getElementById('bar');
[10,100,250].forEach(function(kb){bar.appendChild(btn('Ask for '+kb+' KB',function(){callKb(kb);}));});
bar.appendChild(btn('Put this report in the chat',function(){
 ask('ui/update-model-context',{content:[{type:'text',text:out.textContent}]},function(m){set('context',m.timeout?'no answer in 8 s':m.error?'the host refused ('+clean(m.error.message||m.error.code,80)+')':'the host accepted it');},8000);
}));
bar.appendChild(btn('Run the checks again',function(){started=false;viol.length=0;runAll();}));
window.addEventListener('message',function(ev){
 if(ev.source!==host)return;
 var m=ev.data;if(!m||typeof m!=='object'||m.jsonrpc!=='2.0')return;
 if(typeof m.method==='string'){
  if(m.method==='ui/notifications/tool-result'){var p=m.params||{},c=p.content;set('toolresult',judge(p.structuredContent,null)+(Array.isArray(c)?'; text parts '+c.length:'; no text parts'));return;}
  if(m.id!==undefined){if(m.method==='ui/resource-teardown'){post({id:m.id,result:{}});return;}post({id:m.id,error:{code:-32601,message:'Method not found'}});}
  return;
 }
 if(m.id!==undefined&&pend[m.id]){var f=pend[m.id];delete pend[m.id];f(m);}
});
set('toolresult','waiting for the host to hand it over');
set('calls','press a button');
render();
if(typeof ResizeObserver==='function')new ResizeObserver(size).observe(document.body);
ask('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'ryagram-probe',version:'1'},appCapabilities:{availableDisplayModes:['inline']}},function(m){
 if(m.timeout){set('host','NO answer to ui/initialize in 3 s');runAll();return;}
 if(m.error){set('host','the host refused ui/initialize ('+clean(m.error.message||m.error.code,80)+')');runAll();return;}
 var r=m.result||{},hi=r.hostInfo||{},hc=r.hostContext||{},bits=[];
 bits.push('host '+clean(hi.name,30)+' '+clean(hi.version,20),'protocol '+clean(r.protocolVersion,20));
 if(hc.displayMode)bits.push('display mode '+clean(hc.displayMode,20));
 if(Array.isArray(hc.availableDisplayModes))bits.push('modes '+clean(hc.availableDisplayModes.join(','),40));
 if(hc.platform)bits.push('platform '+clean(hc.platform,20));
 if(hc.theme)bits.push('theme '+clean(hc.theme,10));
 if(r.hostCapabilities&&typeof r.hostCapabilities==='object')bits.push('capabilities '+clean(Object.keys(r.hostCapabilities).join(','),80));
 set('host',bits.join('; '));note('ui/notifications/initialized',{});size();runAll();
},3000);
})();`;

/** The page with its build left blank (the build is a hash of exactly this), at one padding size. */
function raw(build: string, padKb: number): string {
  const pad = padKb ? "<!--" + "x".repeat(padKb * 1024) + "-->" : "";
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Ryagram probe</title><style>" + STYLE + "</style></head>" +
    "<body data-build=\"" + build + "\" data-pad-kb=\"" + padKb + "\"><main class=\"card\"><h1>Ryagram probe (a throwaway test page)</h1>" +
    "<p class=\"hint\">It checks what this chat can do and nothing else. It changes nothing in Ryagram. Wait about 15 seconds, then read the lines below back to Ryan, or press the last button but one.</p>" +
    "<pre id=\"out\" aria-live=\"polite\">Starting...</pre><div class=\"bar\" id=\"bar\"></div></main>" + pad +
    "<script>" + SCRIPT.replace("__DECL__", DECLARED_URL).replace("__UNDECL__", UNDECLARED_URL) + "</script></body></html>";
}
/** What the build is a hash of: the page with no build and no padding. Changing anything the page does changes this (and so the page's address). */
export const PROBE_BUILD = build12(raw("", 0));
export const PROBE_URI = "ui://ryagram/probe-" + PROBE_BUILD;
export const padUri = (kb: number) => "ui://ryagram/probe-pad" + kb + "-" + PROBE_BUILD;
export const PROBE_URIS: readonly string[] = [PROBE_URI, ...PAD_KB.map(padUri)];

/** The page at this address, or null when the address is not one of the probe's. */
export function probePage(uri: unknown): string | null {
  if (uri === PROBE_URI) return raw(PROBE_BUILD, 0);
  for (const kb of PAD_KB) if (uri === padUri(kb)) return raw(PROBE_BUILD, kb);
  return null;
}

/** The same connection list in both spellings: `_meta.ui.csp` (the MCP Apps spec) and `openai/widgetCSP` (OpenAI's own key). */
export const probeCsp = () => ({ connectDomains: [DECLARED_ORIGIN], resourceDomains: [] as string[] });

const MODEL_NOTE = "It is a throwaway test page for Ryagram's developers. Call it ONLY when the person asks you to run the Ryagram probe. It changes nothing, costs nothing and starts nothing.";
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

export const PROBE_TOOLS: ToolDef[] = [
  {
    name: "map_probe", title: "Ryagram probe page", scope: "read", readOnly: true, idempotent: true, probe: PROBE_URI,
    description: "Opens a test page inside this conversation and hands it some test data. " + MODEL_NOTE + " The optional kb argument is how many KB of test data to hand over (10, 100 or 250; the default is 100).",
    inputSchema: obj({ kb: { type: "integer", enum: [...PAYLOAD_KB], description: "KB of test data (10, 100 or 250)." } }, []),
    async run(a) {
      const kb = a.kb === undefined ? DEFAULT_PAYLOAD_KB : Number(a.kb);
      if (!(PAYLOAD_KB as readonly number[]).includes(kb)) return { text: "kb must be 10, 100 or 250.", isError: true, code: "args" };
      return { text: `Probe page opened with ${kb} KB of test data. Nothing else happened.`, data: payloadFor(kb) };
    },
  },
  ...PAD_KB.map((kb): ToolDef => ({
    name: "map_probe_page_" + kb, title: "Ryagram probe page, " + kb + " KB", scope: "read", readOnly: true, idempotent: true, probe: padUri(kb),
    description: "Opens the same test page padded to about " + kb + " KB, to see how large a page this chat accepts. " + MODEL_NOTE,
    inputSchema: obj({}, []),
    async run() { return { text: `Probe page (${kb} KB) opened. Nothing else happened.`, data: payloadFor(10) }; },
  })),
];
const BY_NAME = new Map(PROBE_TOOLS.map((t) => [t.name, t]));
export const probeOn = (a?: { enabled: boolean; probe?: boolean }) => !!(a?.enabled && a.probe);

/** The tool the dispatcher finds: the probe's own tools exist only when the probe switch is on. (They are not in TOOLS, so the OpenAPI document and the main list never see them.) */
export const probeTool = (name: unknown, on?: boolean): ToolDef | undefined => (on && typeof name === "string" ? BY_NAME.get(name) : undefined);

/** tools/list with the probe's tools appended when the probe is on; with it off the very same array comes back. */
export function withProbeTools<T extends Record<string, unknown>>(list: T[], a: { enabled: boolean; probe?: boolean } | undefined, meta: (uri: string) => Record<string, unknown>): Array<T | Record<string, unknown>> {
  if (!probeOn(a)) return list;
  return [...list, ...PROBE_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: meta(t.probe as string) }))];
}

/** resources/list entries for the probe, when it is on. */
export const probeResources = (on: boolean, mime: string) => on ? PROBE_URIS.map((uri) => ({ uri, name: "Ryagram probe", description: "A throwaway test page for Ryagram's developers.", mimeType: mime })) : [];
