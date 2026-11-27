// The Compilations STATUS PANEL in the AI chat (CONNECT, 2026-11-27; Ryan's "double pace" order 08:36: "the in-chat editor panel" family, here for the Compilations department).
// What it is: one small page (an MCP App resource) that draws what the tool get_compilation_status returned: the request in words (the phrase as text, the folder NAMES, counts), a short step line for where the
// build stands on the person's own computer, a five-step strip, and ONE button, "Open on the site", that asks the host to open the app's Compilations page. The tool, its text and its data are not changed by it.
// It is shown under the connector's ONE panel switch (CONNECT_MCP_APP, exactly like the account card): with the switch off nothing about it is listed or served.
// The page makes NO network request, is ES5 with no library, uses textContent only (a phrase or a folder name is always text, never markup), draws only the structuredContent the tool itself returned
// (its shape is checked in the page: an unknown state or a missing field is "Status not available", numbers are clamped), and opens ONLY the configured app address plus the fixed fragment below.
// The look is the connector's newer one (home_panel.ts on branch connect-chat-look-1127): orange pill buttons with dark ink, a Georgia wordmark, an 18px card, an outlined second button.
// Pure functions: no dependencies (tools.ts is not imported; tests compare this file's words and fragment with the tool's).

export const COMPILATION_MAX_BYTES = 16 * 1024;
/** The one page the button may open: the site's Compilations department. The tool open_compilations_page names the same fragment (tests compare). */
export const COMPILATION_PAGE = "#/d/compilations";

/** What the person's own computer can report as the reason a build stopped, in words for the person themselves. The keys are the closed list get_compilation_status knows (tests compare the two lists). */
export const COMPILATION_REASONS: Readonly<Record<string, string>> = Object.freeze({
  request_invalid: "the request could not be read",
  song_request: "songs are made in the song tools, not in a compilation",
  folder_not_chosen: "you have not yet chosen where these videos are on your computer",
  folder_missing: "a folder you chose is not there any more",
  folder_empty: "a folder you chose has no videos",
  folders_overlap: "two of the folders hold the same videos",
  no_speech: "no speech was found in your videos",
  not_said: "your videos do not say it",
  edit_failed: "the draft could not be made into a film list",
  build_failed: "the film could not be built; nothing left your computer",
  crash: "something went wrong on your computer",
});
export const COMPILATION_REASON_OTHER = "the Ryagram app reported a problem it has no plain words for";
/** The five steps of the strip, in order. */
export const COMPILATION_STEPS = Object.freeze(["Waiting", "Planning", "Matching", "Building", "Done"]);

const STYLE = [
  ":root{color-scheme:dark}", "*{box-sizing:border-box}", "html,body{margin:0;background:transparent}",
  "body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f2f2ef}",
  ".cc{background:#1b1b23;border:1px solid #3a3a44;border-radius:18px;padding:14px 16px;max-width:640px;min-width:0}",
  ".top{display:flex;align-items:baseline;gap:10px;margin:0 0 10px;flex-wrap:wrap}",
  "h1{margin:0;font:400 24px/1 Georgia,Times New Roman,serif;letter-spacing:.01em}",
  ".sub{color:#b6b5ae;font-size:13px;font-weight:650}",
  ".row{display:grid;grid-template-columns:88px minmax(0,1fr);gap:12px;padding:6px 0;border-top:1px solid #2c2c36}",
  ".k{color:#b6b5ae}", ".v{color:#f2f2ef;overflow-wrap:anywhere;min-width:0}",
  ".stat{margin:12px 0 0;padding-top:10px;border-top:1px solid #2c2c36}",
  ".step{margin:0 0 8px;font-size:15px;font-weight:650;overflow-wrap:anywhere}",
  ".strip{display:flex;gap:4px;margin:0 0 4px}", ".seg{flex:1;min-width:0;height:8px;border-radius:999px;background:#2c2c36}", ".seg.on{background:#ff8a3d}",
  ".labs{display:flex;gap:4px}", ".lab{flex:1;min-width:0;text-align:center;font-size:11px;color:#9e9da6;overflow-wrap:anywhere}", ".lab.now{color:#f2f2ef;font-weight:700}",
  ".hint{margin:8px 0 0;color:#b6b5ae;font-size:13px}", ".openfail{overflow-wrap:anywhere}",
  ".acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}",
  "button{min-height:44px;padding:0 18px;border-radius:999px;border:1px solid #ff8a3d;background:#ff8a3d;color:#14141a;font:inherit;font-weight:800;cursor:pointer}",
  "button:focus-visible{outline:2px solid #ff8a3d;outline-offset:2px}",
  "@media (max-width:360px){.cc{padding:12px}.row{grid-template-columns:76px minmax(0,1fr);gap:8px}}",
].join("");

const SCRIPT = [
  "(function(){",
  "var host=window.parent,pend={},nid=0,root=document.getElementById('cc'),appUrl=document.body.getAttribute('data-app-url')||'',failNode=null;",
  "var PAGE=" + JSON.stringify(COMPILATION_PAGE) + ";",
  "var WHY=" + JSON.stringify(COMPILATION_REASONS) + ",OTHER=" + JSON.stringify(COMPILATION_REASON_OTHER) + ",STEPS=" + JSON.stringify(COMPILATION_STEPS) + ";",
  "var STATES={planning:1,matching:2,building:3,done:4,failed:-1,cancelled:-1};",
  "function post(m){m.jsonrpc='2.0';host.postMessage(m,'*');}",
  "function ask(method,params,done){var id=++nid;pend[id]=done;post({id:id,method:method,params:params});}",
  "function note(method,params){post({method:method,params:params});}",
  "var BAD=/[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069\\u200e\\u200f]/g;",
  "function clean(s,n){return String(s==null?'':s).replace(BAD,' ').slice(0,n||80);}",
  "function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}",
  "function row(k,v){var r=el('div','row');r.appendChild(el('span','k',k));r.appendChild(el('span','v',v));return r;}",
  "function int(v,max){return typeof v==='number'&&isFinite(v)&&v>=0?Math.min(Math.round(v),max):null;}",
  "function many(n,one,more){return n+' '+(n===1?one:more);}",
  "var Q1=String.fromCharCode(8220),Q2=String.fromCharCode(8221);",
  // what the tool returned, checked: null = not something this panel can draw ('Status not available')
  "function view(sc){",
  " if(!sc||typeof sc!=='object'||Array.isArray(sc))return null;",
  " if(sc.looked_up===false&&sc.reason==='compilations_not_open')return {kind:'closed'};",
  " if(sc.looked_up!==true)return null;",
  " if(sc.has_request===false)return {kind:'none'};",
  " var q=sc.request;if(sc.has_request!==true||!q||typeof q!=='object'||Array.isArray(q))return null;",
  " var v={kind:'request',phrase:clean(typeof q.phrase==='string'?q.phrase:'',200),search:q.search==='every'||q.search==='words'?q.search:null,folders:[],rules:int(q.rules,50)||0,texts:int(q.texts,50)||0,cards:int(q.cards,50)||0,run:null};",
  " if(Array.isArray(q.folders))for(var i=0;i<q.folders.length&&v.folders.length<10;i++){if(typeof q.folders[i]==='string'){var f=clean(q.folders[i],80);if(f)v.folders.push(f);}}",
  " var r=sc.run;",
  " if(r!==null&&r!==undefined){",
  "  if(typeof r!=='object'||Array.isArray(r)||typeof r.state!=='string'||!STATES.hasOwnProperty(r.state))return null;",
  "  v.run={state:r.state,matches:int(r.matches,1000000),clips:int(r.clips,1000000),secs:int(r.film_seconds,86400),code:typeof r.error_code==='string'&&/^[a-z0-9_]{1,40}$/.test(r.error_code)?r.error_code:''};",
  "  if(sc.run_is_for_an_earlier_request===true)v.run=null;",
  " }",
  " return v;",
  "}",
  // the step line and the strip position (0..4; -1 = stopped) for the run state
  "function words(r){",
  " if(!r)return {step:0,text:'Waiting for the Ryagram app on your computer to pick it up.'};",
  " switch(r.state){",
  "  case 'planning':return {step:1,text:'Planning: the Ryagram app on your computer has the request and is planning the film.'};",
  "  case 'matching':return {step:2,text:r.matches===null?'Matching: the app is looking through your clips.':'Matching: found '+many(r.matches,'place','places')+' so far.'};",
  "  case 'building':return {step:3,text:r.clips===null?'Building: the film is being made on your computer.':'Building: '+many(r.clips,'clip','clips')+' so far.'};",
  "  case 'done':{var p=[];if(r.clips!==null)p.push(many(r.clips,'clip','clips'));if(r.secs!==null)p.push(many(r.secs,'second','seconds'));return {step:4,text:'Done'+(p.length?': '+p.join(', '):'')+'. The film is on your computer: open the Ryagram app to see it.'};}",
  "  case 'cancelled':return {step:-1,text:'Stopped: you stopped it on your computer.'};",
  "  default:return {step:-1,text:'Stopped: '+(WHY.hasOwnProperty(r.code)?WHY[r.code]:OTHER)+'.'};",
  " }",
  "}",
  "function strip(step){",
  " var box=el('div',''),s=el('div','strip'),l=el('div','labs');",
  " box.setAttribute('role','img');box.setAttribute('aria-label',step<0?'Stopped':'Step '+(step+1)+' of '+STEPS.length+': '+STEPS[step]);",
  " for(var i=0;i<STEPS.length;i++){s.appendChild(el('div',i<=step?'seg on':'seg'));l.appendChild(el('div',i===step?'lab now':'lab',STEPS[i]));}",
  " box.appendChild(s);box.appendChild(l);return box;",
  "}",
  "function btn(label,fn){var b=el('button','',label);b.type='button';b.addEventListener('click',fn);return b;}",
  "function refused(r){return !!(r&&(r.error||(r.result&&r.result.isError===true)));}",
  // a host that will not open a link says so; the address is then given in words, once, to open by hand (the home panel does the same)
  "function openFailed(url){if(!failNode){failNode=el('p','hint openfail');failNode.setAttribute('role','alert');root.appendChild(failNode);}failNode.textContent='Your chat app did not open it. Open this address in your browser: '+url;size();}",
  "function openPage(){if(appUrl){var url=appUrl+PAGE;ask('ui/open-link',{url:url},function(r){if(refused(r))openFailed(url);});}}",
  "function paint(sc){",
  " var v=view(sc),kids=[],top=el('div','top');top.appendChild(el('h1','','Ryagram'));top.appendChild(el('span','sub','Compilation'));kids.push(top);failNode=null;",
  " if(!v){kids.push(el('p','hint','Status not available. Where it stands is in the conversation above.'));}",
  " else if(v.kind==='closed'){kids.push(el('p','hint','Compilations are not open for this Ryagram account yet.'));}",
  " else if(v.kind==='none'){kids.push(el('p','hint','No compilation request on this project yet.'));if(appUrl){var a0=el('div','acts');a0.appendChild(btn('Open on the site',openPage));kids.push(a0);}}",
  " else{",
  "  kids.push(row('Words',v.phrase?Q1+v.phrase+Q2:'(no words)'));",
  "  if(v.search)kids.push(row('Looks for',v.search==='every'?'Every time it is said':'The words in this order'));",
  "  kids.push(row('Folders',v.folders.length?v.folders.join(', '):'None named'));",
  "  var x=[];if(v.rules)x.push(many(v.rules,'picture rule','picture rules'));if(v.texts)x.push(many(v.texts,'text','texts'));if(v.cards)x.push(many(v.cards,'card','cards'));",
  "  if(x.length)kids.push(row('Also',x.join(', ')));",
  "  var w=words(v.run),st=el('div','stat');st.appendChild(el('p','step',w.text));st.appendChild(strip(w.step));kids.push(st);",
  "  if(appUrl){var a=el('div','acts');a.appendChild(btn('Open on the site',openPage));kids.push(a);}",
  " }",
  " root.textContent='';for(var k=0;k<kids.length;k++)root.appendChild(kids[k]);size();",
  "}",
  "var last=0;",
  "function size(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h&&h!==last){last=h;note('ui/notifications/size-changed',{width:Math.ceil(document.documentElement.getBoundingClientRect().width),height:h});}}",
  "window.addEventListener('message',function(ev){",
  " if(ev.source!==host)return;",
  " var m=ev.data;if(!m||typeof m!=='object'||m.jsonrpc!=='2.0')return;",
  " if(typeof m.method==='string'){",
  "  if(m.method==='ui/notifications/tool-result'){paint(m.params&&m.params.structuredContent);return;}",
  "  if(m.id!==undefined){if(m.method==='ui/resource-teardown'){post({id:m.id,result:{}});return;}post({id:m.id,error:{code:-32601,message:'Method not found'}});return;}",
  "  return;",
  " }",
  " if(m.id!==undefined&&pend[m.id]){var f=pend[m.id];delete pend[m.id];f(m);}",
  "});",
  "if(typeof ResizeObserver==='function')new ResizeObserver(size).observe(document.body);",
  "ask('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'ryagram-compilation',version:'1'},appCapabilities:{availableDisplayModes:['inline']}},function(){note('ui/notifications/initialized',{});size();});",
  "})();",
].join("\n");

const APP_URL = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/;

/** The built page. `appUrl` is a config value (checked here, never request data); the one page it may open is the fixed fragment, checked by being a constant in the page. */
export function compilationHtml(appUrl?: string): string {
  const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Ryagram compilation</title><style>" + STYLE + "</style></head><body data-app-url=\"" + link + "\">" +
    "<main class=\"cc\" id=\"cc\" aria-live=\"polite\"><div class=\"top\"><h1>Ryagram</h1><span class=\"sub\">Compilation</span></div><p class=\"hint\">Opening the status...</p></main>" +
    "<script>" + SCRIPT + "</script></body></html>";
}

/** A short build id: a hash of the page made with no address, so the page's address changes whenever the page or its words do (a host that keeps pages by address never shows an old one). */
function buildId(): string {
  const s = compilationHtml("");
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0; b = Math.imul(b + s.charCodeAt(i) + i, 0x85ebca6b) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
}
export const COMPILATION_BUILD = buildId();
export const COMPILATION_URI = "ui://ryagram/compilations-" + COMPILATION_BUILD;
const COMPILATION_ADDRESS = /^ui:\/\/ryagram\/compilations-[0-9a-f]{12}$/;
/** Any address of this shape (an earlier build a host still holds) is answered with the CURRENT page. */
export const isCompilationUri = (u: unknown): boolean => typeof u === "string" && COMPILATION_ADDRESS.test(u);
