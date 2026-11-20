// The Ryagram HOME PANEL in the AI chat (CONNECT, 2026-11-13; CC1's item 4 on Ryan's 07:05 order: "a Ryagram home panel in the chat to browse departments and open each one").
// What it is: one tool the AI can call (open_ryagram_home) whose result is the list of the person's departments, and one small page (an MCP App resource) that draws that list: what works today with a button that puts a
// starting line into the chat and a button that opens the site page; what is coming soon with its one honest line and nothing to press. OFF unless CONNECT_HOME_PANEL=on (and CONNECT_MCP_APP=on).
// WHICH departments exist and whether each WORKS for this person is the database's rule, the same one the site's top bar uses (connect_my_departments, a token-checked twin of my_departments()): a 'working' department the
// words below have no page for is NOT shown (never a dead link), a 'soon' one with no words is NOT shown (never an empty card), exactly the site's own rule (assets/app-departments.js normalize()).
// The words are ONE table here, equal to the site's for the departments the site has words for (tests/connect-home-panel.test.mjs compares them), except Geographic Intelligence, whose line GEO's paper replaces
// (proposals/GEO-HOME-PANEL-ENTRY-1113.md: the site's draft promised "where would a new shop do well", which GEO's own tools refuse to claim). Nothing here is a price, a date or a score.
// The page makes NO network request, uses textContent only, and is ES5 with no library (like the card page). Pure functions: no dependencies.

import type { DepartmentRow } from "./types.ts";
import { CHAT_SHARED_CSS, CHAT_UI_CSS } from "./chat_look.ts";

export const HOME_MAX_BYTES = 24 * 1024;      // was 16 KB: the look now carries the site's shared tokens and components (chat_look.ts, built from WEB's design files)

export interface HomeWords { label: string; line: string; rules?: string[]; notYet?: string[]; starts?: string[]; page?: string }
/** The site's order. An id this table does not know is not shown. */
export const HOME_ORDER = ["data_films", "compilations", "geo_intelligence", "games", "animation_studio", "studio"] as const;
export const HOME_WORDS: Readonly<Record<string, HomeWords>> = Object.freeze({
  data_films: { label: "Data films", line: "Questions answered with public data, drawn as a short animated film, with every source shown.",
    starts: ["Make me a short film from public data: how adult obesity changed in each state."], page: "#/d/data_films" },
  compilations: { label: "Compilations", line: "Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. Soon it will turn your clips into songs, too." },
  geo_intelligence: { label: "Opportunity Map", line: "Ask about places with free public data: who lives near a spot, what is close by, and how counties have changed. Every number says whether it was counted, calculated or estimated.",
    rules: ["It counts places, jobs, wages, permits and people. It has no sales data, so it does not say where a business would do well.", "No score and no ranking of places."],
    notYet: ["Not part of Ryagram's first release. Testers are trying an early version. No price and no date."] },
  games: { label: "Games", line: "Play with your own data and footage in small games you can share." },
  animation_studio: { label: "Animation Studio", line: "Simple cartoons you direct: characters you can pose, with mouths that move to your voice." },
  // Studio: the public wording is Ryan's own (Q639, yes 2026-11-17 22:4x), word for word; the one not-built sentence is from his fuller words. Nothing to start, nothing to open: it is not built.
  studio: { label: "Studio", line: "Your podcast’s camera crew and editor in one: Ryagram works with your cameras, cuts to the right camera as people talk, and finds the moments worth sharing.",
    notYet: ["Not built yet: none of this works today, there is no price and no date."] },
});
/** "My films" is not a department row: it is the person's own films, always there. */
export const MY_FILMS = Object.freeze({ id: "my_films", label: "My films", line: "Your films, and where each one stands.", starts: ["Show me my films."], page: "#/", pageOn: "#/films" });

export interface HomeEntry { id: string; label: string; status: "working" | "soon"; line: string; rules: string[]; not_yet: string[]; starts: string[]; page: string | null }
export interface HomeView { text: string; data: { departments: HomeEntry[]; coming_soon: string[]; note: string } }

const PAGE = /^#\/[A-Za-z0-9_\/-]{0,40}$/;

/** The database's rows become what the panel shows: only ids this file has words for, only the two statuses, each once, the site's order. `switches` is the person's own switch list: the My films link follows the site's rule
 *  (assets/app-departments.js: #/films when the account's myFilms switch is on, #/ when not); a list that could not be read is an empty one. */
export function homeEntries(rows: unknown, switches: unknown = []): HomeEntry[] {
  const out: HomeEntry[] = [];
  const filmsOn = Array.isArray(switches) && switches.includes("myFilms");
  const mine: HomeEntry = { id: MY_FILMS.id, label: MY_FILMS.label, status: "working", line: MY_FILMS.line, rules: [], not_yet: [], starts: [...MY_FILMS.starts], page: filmsOn ? MY_FILMS.pageOn : MY_FILMS.page };
  const byId = new Map<string, DepartmentRow>();
  if (Array.isArray(rows)) for (const r of rows as DepartmentRow[]) { if (r && typeof r.id === "string" && !byId.has(r.id)) byId.set(r.id, r); }
  const working: HomeEntry[] = [], soon: HomeEntry[] = [];
  for (const id of HOME_ORDER) {
    const r = byId.get(id), w = HOME_WORDS[id];
    if (!r || !w) continue;
    const label = w.label;                                   // ONE name everywhere (Ryan 2026-11-13, Q601: Opportunity Map): the panel says its own word, whatever the database row still says
    if (r.status === "working" && w.page && PAGE.test(w.page)) working.push({ id, label, status: "working", line: w.line, rules: [...(w.rules ?? [])], not_yet: [...(w.notYet ?? [])], starts: [...(w.starts ?? [])], page: w.page });
    else if (r.status === "soon") soon.push({ id, label, status: "soon", line: w.line, rules: [...(w.rules ?? [])], not_yet: [...(w.notYet ?? [])], starts: [], page: null });
  }
  out.push(...working, mine, ...soon);
  return out;
}

/** The result of open_ryagram_home: the words for a host with no panel, and the same list as data for the panel. */
export function homeView(rows: unknown, switches: unknown = []): HomeView {
  const deps = homeEntries(rows, switches);
  const works = deps.filter((d) => d.status === "working"), soon = deps.filter((d) => d.status === "soon");
  const text = ["Ryagram's departments for this person.",
    ...works.map((d) => `- ${d.label} (works today): ${d.line}${d.starts[0] ? ` To start: say "${d.starts[0]}"` : ""}`),
    ...(soon.length ? ["Coming soon (not built yet, nothing to start):", ...soon.map((d) => `- ${d.label}: ${d.line}${d.rules.length ? " " + d.rules.join(" ") : ""}${d.not_yet.length ? " " + d.not_yet.join(" ") : ""}`)] : []),
    "The panel below shows the same list with a button for each; the person can also just say what they want."].join("\n");
  return { text, data: { departments: deps, coming_soon: soon.map((d) => d.id), note: "Coming soon departments are shown for information only; there is nothing to start in them yet." } };
}

// ---------------------------------------------------------------------------------------------- the page
// The look is the site's own (tokens, button, badge, flip) from chat_look.ts, built by tools/build-chat-look.mjs from WEB's design files, plus the chat layout; nothing is written here.
const STYLE = [":root{color-scheme:dark}", CHAT_SHARED_CSS, CHAT_UI_CSS].join("");

const SCRIPT = [
  "(function(){",
  "var host=window.parent,pend={},nid=0,root=document.getElementById('home'),appUrl=document.body.getAttribute('data-app-url')||'';",
  "function post(m){m.jsonrpc='2.0';host.postMessage(m,'*');}",
  "function ask(method,params,done){var id=++nid;pend[id]=done;post({id:id,method:method,params:params});}",
  "function note(method,params){post({method:method,params:params});}",
  "var BAD=/[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069\\u200e\\u200f]/g;",
  "function clean(s,n){return String(s==null?'':s).replace(BAD,' ').slice(0,n||200);}",
  "var PAGE=/^#\\/[A-Za-z0-9_\\/-]{0,40}$/;",
  "function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}",
  "function btn(label,cls,fn){var b=el('button','btn small'+(cls?' '+cls:''),label);b.type='button';b.addEventListener('click',fn);return b;}",
  "var caps=null,Q1=String.fromCharCode(8220),Q2=String.fromCharCode(8221);",
  "function canSend(){return !(caps&&typeof caps==='object'&&!caps.message);}",
  "function refused(r){return !!(r&&(r.error||(r.result&&r.result.isError===true)));}",
  "function said(r){var e=r&&r.error;if(e&&typeof e==='object')return clean(e.message,120)+(e.code!=null?' ('+clean(e.code,12)+')':'');return 'it could not deliver the message';}",
  "function pick(x,q){try{var s=window.getSelection(),g=document.createRange();g.selectNodeContents(q);s.removeAllRanges();s.addRange(g);}catch(e){}}",
  "function copyLine(x,b,text){",
  " var q=x.querySelector('.said');",
  " function done(){b.textContent='Copied';}",
  " function hold(){var h=x.querySelector('.hold');if(!h){h=el('p','hold');x.insertBefore(h,x.querySelector('.diag'));}h.textContent='Press Ctrl+C (Cmd+C on a Mac) to copy it.';size();}",
  " function viaSelect(){pick(x,q);var ok=false;try{ok=document.execCommand('copy');}catch(e){}if(ok)done();else hold();}",
  " try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,viaSelect);return;}}catch(e){}",
  " viaSelect();",
  "}",
  "function example(box,text,why,diag){",
  " var old=box.querySelector('.example');if(old)old.remove();",
  " var x=el('div','example'),q=el('p','quote'),w=el('span','said',text),b;",
  " x.appendChild(el('p','why',why));x.appendChild(el('p','label','Example:'));",
  " q.appendChild(document.createTextNode(Q1));q.appendChild(w);q.appendChild(document.createTextNode(Q2));x.appendChild(q);",
  " b=btn('Copy','quiet',function(){copyLine(x,b,text);});x.appendChild(b);",
  " if(diag)x.appendChild(el('p','diag',diag));",
  " box.appendChild(x);size();",
  "}",
  "function startLine(box,text){",
  " if(!canSend()){example(box,text,'Your chat app does not let this panel type for you.','');return;}",
  " function got(r,again){",
  "  if(!refused(r))return;",
  "  var e=r.error;",
  "  if(again&&e&&typeof e==='object'&&(e.code===-32602||/invalid|format/i.test(String(e.message||'')))){ask('ui/message',{role:'user',content:{type:'text',text:text}},function(r2){got(r2,false);});return;}",
  "  try{console.warn('ryagram-home: ui/message refused: '+JSON.stringify(r.error||r.result).slice(0,300));}catch(x){}",
  "  example(box,text,'Your chat app did not let this panel type for you.','The chat app answered: '+said(r));",
  " }",
  " ask('ui/message',{role:'user',content:[{type:'text',text:text}]},function(r){got(r,true);});",
  "}",
  // a host that will not open a link says so; the address is then given in words, once, to open by hand (the chat editor does the same)
  "function openFailed(url){var n=root.querySelector('.openfail');if(!n){n=el('p','hint openfail');n.setAttribute('role','alert');root.appendChild(n);}n.textContent='Your chat app did not open it. Open this address in your browser: '+url;size();}",
  "function openPage(page){if(appUrl&&PAGE.test(page||'')){ask('ui/open-link',{url:appUrl+page},function(r){if(refused(r))openFailed(appUrl+page);});}}",
  "function dept(d){",
  " var box=el('section','dept rc-card'),h=el('h3','',clean(d.label,60));",
  " h.appendChild(d.status==='soon'?el('span','badge soon tag','Coming soon'):el('span','badge ok','Works today'));",
  " box.appendChild(h);box.appendChild(el('p','line rc-line',clean(d.line,400)));",
  " var rs=Array.isArray(d.rules)?d.rules:[],ns=Array.isArray(d.not_yet)?d.not_yet:[];",
  " for(var i=0;i<rs.length&&i<4;i++)box.appendChild(el('p','rule rc-rule',clean(rs[i],240)));",
  " for(var j=0;j<ns.length&&j<2;j++)box.appendChild(el('p','rule rc-rule',clean(ns[j],240)));",
  " if(d.status==='working'){",
  "  var acts=el('div','acts rc-actions'),st=Array.isArray(d.starts)?d.starts:[];",
  "  if(st.length&&typeof st[0]==='string'){(function(t){acts.appendChild(btn(canSend()?'Start this in the chat':'Show what to say','primary',function(){startLine(box,t);}));})(clean(st[0],200));}",
  "  if(typeof d.page==='string'&&appUrl&&PAGE.test(d.page)){(function(p){acts.appendChild(btn('Open on the site','',function(){openPage(p);}));})(d.page);}",
  "  if(acts.childNodes.length)box.appendChild(acts);",
  " }",
  " return box;",
  "}",
  // the flip (the site's own carousel, in ES5): one department in view, arrows and tabs and dots and swipe; its window is as tall as the department in view
  "var fitters=[];",
  "function flip(items){",
  " var wrap=el('div','flip'),bar=el('div','flip-bar'),tabs=el('div','flip-tabs'),prev=el('button','flip-arrow'),next=el('button','flip-arrow'),vp=el('div','flip-viewport'),track=el('div','flip-track'),dots=el('div','flip-dots'),T=[],P=[],D=[],cur=0,x0=null;",
  " tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Departments');",
  " prev.type='button';next.type='button';prev.setAttribute('aria-label','Previous department');next.setAttribute('aria-label','Next department');",
  " prev.setAttribute('data-glyph',String.fromCharCode(8249));next.setAttribute('data-glyph',String.fromCharCode(8250));",
  " function fit(){var c=P[cur]&&P[cur].firstChild;if(c&&c.offsetHeight)vp.style.height=(c.offsetHeight+4)+'px';}",
  " function go(n){",
  "  cur=Math.max(0,Math.min(P.length-1,n));track.style.transform='translateX('+(-cur*100)+'%)';",
  "  for(var k=0;k<P.length;k++){",
  "   T[k].setAttribute('aria-selected',String(k===cur));T[k].tabIndex=k===cur?0:-1;",
  "   if(k===cur)D[k].setAttribute('aria-current','true');else D[k].removeAttribute('aria-current');",
  "   P[k].setAttribute('aria-hidden',String(k!==cur));P[k].inert=k!==cur;",
  "  }",
  "  prev.disabled=cur===0;next.disabled=cur===P.length-1;",
  "  try{tabs.scrollLeft=T[cur].offsetLeft-16;}catch(e){}",
  "  fit();size();",
  " }",
  " for(var i=0;i<items.length;i++)(function(n,it){",
  "  var t=el('button','flip-tab',it.label),p=el('div','flip-panel'),dt=el('button','flip-dot');",
  "  t.type='button';t.setAttribute('role','tab');t.addEventListener('click',function(){go(n);});",
  "  dt.type='button';dt.setAttribute('aria-label',it.label);dt.addEventListener('click',function(){go(n);});",
  "  p.setAttribute('role','tabpanel');p.appendChild(it.node);",
  "  tabs.appendChild(t);track.appendChild(p);dots.appendChild(dt);T.push(t);P.push(p);D.push(dt);",
  " })(i,items[i]);",
  " prev.addEventListener('click',function(){go(cur-1);});next.addEventListener('click',function(){go(cur+1);});",
  " wrap.addEventListener('keydown',function(e){if(e.key==='ArrowRight'){go(cur+1);e.preventDefault();}else if(e.key==='ArrowLeft'){go(cur-1);e.preventDefault();}});",
  " vp.addEventListener('touchstart',function(e){x0=e.touches[0].clientX;},{passive:true});",
  " vp.addEventListener('touchend',function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>50)go(cur+(dx<0?1:-1));x0=null;},{passive:true});",
  " bar.appendChild(prev);bar.appendChild(tabs);bar.appendChild(next);vp.appendChild(track);",
  " wrap.appendChild(bar);wrap.appendChild(vp);wrap.appendChild(dots);",
  " fitters.push(fit);go(0);",
  " return wrap;",
  "}",
  "function paint(sc){",
  " fitters=[];",
  " var top=el('div','rc-brand');top.appendChild(el('b','',\"L'Ai\"));top.appendChild(el('span','','Ryagram'));",
  " var kids=[top],ds=sc&&typeof sc==='object'&&Array.isArray(sc.departments)?sc.departments:null;",
  " if(!ds||!ds.length){kids.push(el('p','hint','Your Ryagram departments are listed in the conversation above.'));}",
  " else{",
  "  kids.push(el('h1','rc-title','What would you like to make?'));kids.push(el('p','rc-lede','Pick a department. Each one says whether it works today.'));",
  "  var w=[],s=[];for(var i=0;i<ds.length&&i<12;i++){var d=ds[i];if(!d||typeof d!=='object')continue;if(d.status==='working')w.push(d);else if(d.status==='soon')s.push(d);}",
  "  var all=w.concat(s),items=[];for(var a=0;a<all.length;a++)items.push({label:clean(all[a].label,60),node:dept(all[a])});",
  "  if(items.length)kids.push(flip(items));",
  " }",
  " root.textContent='';for(var k=0;k<kids.length;k++)root.appendChild(kids[k]);size();",
  "}",
  "var last=0;",
  "function size(){for(var f=0;f<fitters.length;f++)fitters[f]();var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h&&h!==last){last=h;note('ui/notifications/size-changed',{width:Math.ceil(document.documentElement.getBoundingClientRect().width),height:h});}}",
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
  "paint(null);",
  "if(typeof ResizeObserver==='function')new ResizeObserver(size).observe(document.body);",
  "ask('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'ryagram-home',version:'1'},appCapabilities:{availableDisplayModes:['inline']}},function(r){var c=r&&r.result&&r.result.hostCapabilities;caps=c&&typeof c==='object'?c:null;note('ui/notifications/initialized',{});size();});",
  "})();",
].join("\n");

const APP_URL = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/;

/** The built page. `appUrl` is a config value (checked here, never request data); the pages it may open are fixed fragments checked again in the page. */
export function homeHtml(appUrl?: string): string {
  const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Ryagram home</title><style>" + STYLE + "</style></head><body data-app-url=\"" + link + "\">" +
    "<main class=\"home rc rc-hero\" id=\"home\" aria-live=\"polite\"><div class=\"rc-brand\"><b>L'Ai</b><span>Ryagram</span></div><p class=\"hint\">Opening Ryagram...</p></main>" +
    "<script>" + SCRIPT + "</script></body></html>";
}

/** A short build id: a hash of the page made with no address, so the page's address changes whenever the page or its words do (a host that keeps pages by address never shows an old one). */
function buildId(): string {
  const s = homeHtml("") + JSON.stringify(HOME_WORDS) + JSON.stringify(MY_FILMS);
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0; b = Math.imul(b + s.charCodeAt(i) + i, 0x85ebca6b) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }      // unsigned: a signed b printed as '-45f...' and the address no longer matched its own shape (found by WEB-8's words change)
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
}
export const HOME_BUILD = buildId();
export const HOME_URI = "ui://ryagram/home-" + HOME_BUILD;
const HOME_ADDRESS = /^ui:\/\/ryagram\/home-[0-9a-f]{12}$/;
/** Any address of this shape (an earlier build a host still holds) is answered with the CURRENT page. */
export const isHomeUri = (u: unknown): boolean => typeof u === "string" && HOME_ADDRESS.test(u);
