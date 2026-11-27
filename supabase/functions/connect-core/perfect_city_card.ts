// The Perfect City PANEL in the AI chat (CONNECT, 2026-11-27; the same pattern as the Compilations status panel, compilation_card.ts).
// What it is: one small page (an MCP App resource) that draws what the tool perfect_city_summary returned for ONE spot: the place and the kind of business, the spot, how many places of that kind are loaded, the nearest places (rank and
// straight-line km), a three-row table for the rings (1, 2 and 5 km: how many places, about how many people), the method sentence once, what is not known and where the data comes from, and ONE button, "Open on the site", that asks the host
// to open the app's Perfect City page. The tool, its text and its data are not changed by it.
// It never works anything out: every number is drawn exactly as the tool returned it (no rounding, no sum, no ranking, no score), next to the basis word the tool returned with it (calculated, estimated or observed).
// A refused answer (the switch is off, the daily cap, the checks could not be read) is drawn as the plain sentence for it, and has no button.
// It is shown under the connector's ONE panel switch (CONNECT_MCP_APP, exactly like the account card): with the switch off nothing about it is listed or served.
// The page makes NO network request, is ES5 with no library, uses textContent only (a business name is always text, never markup), draws only the structuredContent the tool itself returned (its shape is checked in the page: anything
// else is "Numbers not available"), and opens ONLY the configured app address plus the fixed fragment below.
// The look is the connector's newer one (home_panel.ts, compilation_card.ts): Georgia wordmark, 18px card, orange pill button with dark ink, buttons at least 44px.
// Words and ids come from perfect_city.ts (the label of every place and kind, the switch word, the owner-only sentence, the page fragment); this file adds only what is said around them. All new words are drafts for Ryan's yes.
import { PC_BUSINESS_TYPES, PC_OFF_WORDS, PC_PLACES, PC_RINGS_KM, PERFECT_CITY_PAGE, PERFECT_CITY_SWITCH } from "./perfect_city.ts";

export const PERFECT_CITY_MAX_BYTES = 20 * 1024;
/** The one page the button may open: the site's Perfect City department (geo_intelligence). The tools open_perfect_city and the department list name the same fragment (tests compare). */
export const PERFECT_CITY_CARD_PAGE = PERFECT_CITY_PAGE;

/** The sentences drawn for a refused answer (no numbers, no button). The first is the tool's own sentence when the switch is off. */
export const PERFECT_CITY_CARD_WORDS = Object.freeze({
  off: PC_OFF_WORDS,
  gate: "Whether Perfect City is on for this account could not be read just now, so nothing was looked up. Try again in a minute.",
  daily: "Perfect City has answered all it gives this account for today. Try again tomorrow. Nothing was looked up.",
  hourly: "The hourly limit of Perfect City checks is reached. Try again later. Nothing was looked up.",
  other: "Perfect City could not give numbers for this question just now. Nothing was looked up. The reason is in the conversation above.",
  none: "Numbers not available. The answer is in the conversation above.",
  noload: "The businesses for this place and kind are not loaded yet, so there is no distance and no count of businesses. The people numbers below do not depend on them.",
  nonear: "No nearest places came back for this spot.",
  noscore: "Counts and distances only: no score and no ranking.",
  names: "Names come from the map data and are shown as plain text.",
});

const STYLE = [
  ":root{color-scheme:dark}", "*{box-sizing:border-box}", "html,body{margin:0;background:transparent}",
  "body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f2f2ef}",
  ".cc{background:#1b1b23;border:1px solid #3a3a44;border-radius:18px;padding:14px 16px;max-width:640px;min-width:0}",
  ".top{display:flex;align-items:baseline;gap:10px;margin:0 0 10px;flex-wrap:wrap}",
  "h1{margin:0;font:400 24px/1 Georgia,Times New Roman,serif;letter-spacing:.01em}",
  ".sub{color:#b6b5ae;font-size:13px;font-weight:650}",
  "h2{margin:14px 0 6px;font-size:13px;font-weight:700;color:#b6b5ae;letter-spacing:.02em;overflow-wrap:anywhere}",
  ".row{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px;padding:6px 0;border-top:1px solid #2c2c36}",
  ".k{color:#b6b5ae}", ".v{color:#f2f2ef;overflow-wrap:anywhere;min-width:0}",
  ".stat{margin:12px 0 0;padding-top:10px;border-top:1px solid #2c2c36}",
  ".loaded{margin:0 0 6px;font-size:15px;font-weight:650;overflow-wrap:anywhere}",
  ".tbl{border-top:1px solid #2c2c36}",
  ".tr{display:grid;grid-template-columns:52px minmax(0,1fr) minmax(0,1.3fr);gap:10px;padding:6px 0;border-bottom:1px solid #2c2c36}",
  ".th{color:#b6b5ae;font-size:12px;font-weight:700}", ".td{min-width:0;overflow-wrap:anywhere}",
  "ul{margin:0;padding:0 0 0 18px}", "li{margin:0 0 4px;overflow-wrap:anywhere}",
  ".hint{margin:8px 0 0;color:#b6b5ae;font-size:13px;overflow-wrap:anywhere}", ".openfail{overflow-wrap:anywhere}",
  ".acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}",
  "button{min-height:44px;padding:0 18px;border-radius:999px;border:1px solid #ff8a3d;background:#ff8a3d;color:#14141a;font:inherit;font-weight:800;cursor:pointer}",
  "button:focus-visible{outline:2px solid #ff8a3d;outline-offset:2px}",
  "@media (max-width:360px){.cc{padding:12px}.row{grid-template-columns:76px minmax(0,1fr);gap:8px}.tr{grid-template-columns:44px minmax(0,1fr) minmax(0,1.3fr);gap:6px;font-size:13px}}",
].join("");

const LABELS = (list: readonly { id: string; label: string }[]) => Object.fromEntries(list.map((x) => [x.id, x.label]));

const SCRIPT = [
  "(function(){",
  "var host=window.parent,pend={},nid=0,root=document.getElementById('pc'),appUrl=document.body.getAttribute('data-app-url')||'',failNode=null;",
  "var PAGE=" + JSON.stringify(PERFECT_CITY_CARD_PAGE) + ",SW=" + JSON.stringify(PERFECT_CITY_SWITCH) + ",RINGS=" + JSON.stringify(PC_RINGS_KM) + ";",
  "var PLACES=" + JSON.stringify(LABELS(PC_PLACES)) + ",KINDS=" + JSON.stringify(LABELS(PC_BUSINESS_TYPES)) + ",W=" + JSON.stringify(PERFECT_CITY_CARD_WORDS) + ";",
  "var BASIS={observed:1,calculated:1,estimated:1};",
  "function post(m){m.jsonrpc='2.0';host.postMessage(m,'*');}",
  "function ask(method,params,done){var id=++nid;pend[id]=done;post({id:id,method:method,params:params});}",
  "function note(method,params){post({method:method,params:params});}",
  "var BAD=/[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069\\u200e\\u200f]/g;",
  "function clean(s,n){return String(s==null?'':s).replace(BAD,' ').slice(0,n||80);}",
  "function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}",
  "function row(k,v){var r=el('div','row');r.appendChild(el('span','k',k));r.appendChild(el('span','v',v));return r;}",
  "function has(o,k){return Object.prototype.hasOwnProperty.call(o,k);}",
  "function isObj(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}",
  // a number the tool returned, exactly as it is: not a number, or out of its range, is not drawn at all (nothing is rounded or repaired)
  "function num(v,min,max){return typeof v==='number'&&isFinite(v)&&v>=min&&v<=max?v:null;}",
  "function whole(v,max){var n=num(v,0,max);return n!==null&&Math.floor(n)===n?n:null;}",
  "function basis(v){return typeof v==='string'&&has(BASIS,v)?v:null;}",
  "function lines(v){if(!Array.isArray(v)||v.length<1||v.length>12)return null;var o=[];for(var i=0;i<v.length;i++){if(typeof v[i]!=='string'||!v[i])return null;o.push(clean(v[i],600));}return o;}",
  "var Q1=String.fromCharCode(8220),Q2=String.fromCharCode(8221);",
  // a refused answer: the sentence for it, or null when the data is not a refusal this panel knows
  "function refusal(sc){",
  " if(sc.looked_up===false&&sc.switch===SW&&sc.on===false&&sc.owner_only===true)return {kind:'refused',text:W.off};",
  " if(sc.available===false&&sc.switch===SW)return {kind:'refused',text:W.gate};",
  " if(sc.looked_up!==false)return null;",
  " if(sc.retry_after_seconds===86400)return {kind:'refused',text:W.daily};",
  " if(sc.retry_after_seconds===3600)return {kind:'refused',text:W.hourly};",
  " return {kind:'refused',text:W.other};",
  "}",
  // what the tool returned, checked: null = not something this panel can draw ('Numbers not available')
  "function view(sc){",
  " if(!isObj(sc))return null;",
  " if(sc.ok===false)return refusal(sc);",
  " if(sc.ok!==true||sc.looked_up!==true||sc.score_given!==false||sc.ranking_given!==false)return null;",
  " if(typeof sc.place!=='string'||!has(PLACES,sc.place)||typeof sc.business_type!=='string'||!has(KINDS,sc.business_type))return null;",
  " if(!isObj(sc.spot))return null;",
  " var lat=num(sc.spot.lat,-90,90),lon=num(sc.spot.lon,-180,180),loaded=whole(sc.places_loaded,10000000);",
  " if(lat===null||lon===null||loaded===null)return null;",
  " var v={kind:'answer',place:PLACES[sc.place],biz:KINDS[sc.business_type],lat:lat,lon:lon,loaded:loaded,nearest:[],rings:[],notKnown:null,credits:null,hasNames:false};",
  " if(!Array.isArray(sc.nearest)||sc.nearest.length>5||(loaded===0&&sc.nearest.length>0))return null;",
  " var prev=0;",
  " for(var i=0;i<sc.nearest.length;i++){",
  "  var n=sc.nearest[i],b=isObj(n)?basis(n.basis):null,km=isObj(n)?num(n.km,0,1000):null;",
  "  if(b===null||km===null||km<prev||n.rank!==i+1)return null;",
  "  prev=km;var nm=null;",
  "  if(has(n,'name')){if(typeof n.name!=='string')return null;nm=clean(n.name,80);v.hasNames=true;}",
  "  v.nearest.push({rank:n.rank,name:nm,km:km,basis:b});",
  " }",
  " if(!Array.isArray(sc.rings)||sc.rings.length!==RINGS.length)return null;",
  " for(var j=0;j<RINGS.length;j++){",
  "  var r=sc.rings[j];if(!isObj(r)||r.km!==RINGS[j]||!isObj(r.people_about))return null;",
  "  var pa=r.people_about,pb=basis(pa.basis),pv=pa.value===null?null:num(pa.value,0,10000000000);",
  "  if(pb===null||(pa.value!==null&&pv===null))return null;",
  "  var places=null;",
  "  if(loaded===0){if(r.places!==null)return null;}",
  "  else{if(!isObj(r.places))return null;var c=whole(r.places.value,10000000),cb=basis(r.places.basis);if(c===null||cb===null)return null;places={value:c,basis:cb};}",
  "  var m=typeof pa.method==='string'&&pa.method?clean(pa.method,600):null;",
  "  if(pv!==null&&m===null)return null;",
  "  v.rings.push({km:r.km,places:places,people:pv,pbasis:pb,method:pv!==null?m:null});",
  " }",
  " v.notKnown=lines(sc.not_known);v.credits=lines(sc.credits);",
  " if(v.notKnown===null||v.credits===null)return null;",
  " return v;",
  "}",
  "function list(items){var u=el('ul','');for(var i=0;i<items.length;i++)u.appendChild(el('li','',items[i]));return u;}",
  "function cells(cls,a,b,c){var t=el('div','tr');t.setAttribute('role','row');var x=[a,b,c];for(var i=0;i<3;i++){var d=el('div',cls+' td',x[i]);d.setAttribute('role',cls==='th'?'columnheader':'cell');t.appendChild(d);}return t;}",
  "function btn(label,fn){var b=el('button','',label);b.type='button';b.addEventListener('click',fn);return b;}",
  "function refused(r){return !!(r&&(r.error||(r.result&&r.result.isError===true)));}",
  // a host that will not open a link says so; the address is then given in words, once, to open by hand (the home panel does the same)
  "function openFailed(url){if(!failNode){failNode=el('p','hint openfail');failNode.setAttribute('role','alert');root.appendChild(failNode);}failNode.textContent='Your chat app did not open it. Open this address in your browser: '+url;size();}",
  "function openPage(){if(appUrl){var url=appUrl+PAGE;ask('ui/open-link',{url:url},function(r){if(refused(r))openFailed(url);});}}",
  "function paint(sc){",
  " var v=view(sc),kids=[],top=el('div','top');top.appendChild(el('h1','','Ryagram'));top.appendChild(el('span','sub','Perfect City'));kids.push(top);failNode=null;",
  " if(!v){kids.push(el('p','hint',W.none));}",
  " else if(v.kind==='refused'){kids.push(el('p','hint',v.text));}",
  " else{",
  "  kids.push(row('Place',v.place));kids.push(row('Kind of business',v.biz));kids.push(row('Spot',v.lat+', '+v.lon));",
  "  var st=el('div','stat');",
  "  st.appendChild(el('p','loaded','Places of this kind loaded: '+v.loaded+' (calculated)'));",
  "  if(v.loaded===0){st.appendChild(el('p','hint',W.noload));}",
  "  else{",
  "   st.appendChild(el('h2','','Nearest places (straight line)'));",
  "   if(!v.nearest.length)st.appendChild(el('p','hint',W.nonear));",
  "   else{var ns=[];for(var i=0;i<v.nearest.length;i++){var n=v.nearest[i];ns.push(n.rank+'. '+(n.name===null?'':Q1+n.name+Q2+': ')+n.km+' km ('+n.basis+')');}st.appendChild(list(ns));if(v.hasNames)st.appendChild(el('p','hint',W.names));}",
  "  }",
  "  kids.push(st);",
  "  var tb=el('div','tbl');tb.setAttribute('role','table');tb.setAttribute('aria-label','Within each ring around the spot');",
  "  tb.appendChild(cells('th','Ring','Similar places','People about'));",
  "  var seen=[];",
  "  for(var k=0;k<v.rings.length;k++){var g=v.rings[k];",
  "   tb.appendChild(cells('tc',g.km+' km',g.places===null?'businesses not loaded':g.places.value+' ('+g.places.basis+')',g.people===null?'not given for this ring ('+g.pbasis+')':'about '+g.people+' people ('+g.pbasis+')'));",
  "   if(g.method!==null&&seen.indexOf(g.method)<0)seen.push(g.method);",
  "  }",
  "  kids.push(el('h2','','Within each ring around the spot'));kids.push(tb);",
  "  for(var q=0;q<seen.length;q++)kids.push(el('p','hint','How the people are estimated: '+seen[q]));",
  "  kids.push(el('h2','','What this does not know'));kids.push(list(v.notKnown));",
  "  kids.push(el('h2','','Where the data comes from'));kids.push(list(v.credits));",
  "  kids.push(el('p','hint',W.noscore));",
  "  if(appUrl){var a=el('div','acts');a.appendChild(btn('Open on the site',openPage));kids.push(a);}",
  " }",
  " root.textContent='';for(var z=0;z<kids.length;z++)root.appendChild(kids[z]);size();",
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
  "ask('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'ryagram-perfect-city',version:'1'},appCapabilities:{availableDisplayModes:['inline']}},function(){note('ui/notifications/initialized',{});size();});",
  "})();",
].join("\n");

const APP_URL = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/;

/** The built page. `appUrl` is a config value (checked here, never request data); the one page it may open is the fixed fragment, checked by being a constant in the page. */
export function perfectCityHtml(appUrl?: string): string {
  const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Ryagram Perfect City</title><style>" + STYLE + "</style></head><body data-app-url=\"" + link + "\">" +
    "<main class=\"cc\" id=\"pc\" aria-live=\"polite\"><div class=\"top\"><h1>Ryagram</h1><span class=\"sub\">Perfect City</span></div><p class=\"hint\">Opening the numbers...</p></main>" +
    "<script>" + SCRIPT + "</script></body></html>";
}

/** A short build id: a hash of the page made with no address, so the page's address changes whenever the page or its words do (a host that keeps pages by address never shows an old one). */
function buildId(): string {
  const s = perfectCityHtml("");
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0; b = Math.imul(b + s.charCodeAt(i) + i, 0x85ebca6b) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
}
export const PERFECT_CITY_BUILD = buildId();
export const PERFECT_CITY_URI = "ui://ryagram/perfect-city-" + PERFECT_CITY_BUILD;
const PERFECT_CITY_ADDRESS = /^ui:\/\/ryagram\/perfect-city-[0-9a-f]{12}$/;
/** Any address of this shape (an earlier build a host still holds) is answered with the CURRENT page. */
export const isPerfectCityUri = (u: unknown): boolean => typeof u === "string" && PERFECT_CITY_ADDRESS.test(u);
