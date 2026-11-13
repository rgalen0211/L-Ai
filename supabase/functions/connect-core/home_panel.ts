// The Ryagram HOME PANEL in the AI chat (CONNECT, 2026-11-13; CC1's item 4 on Ryan's 07:05 order: "a Ryagram home panel in the chat to browse departments and open each one").
// What it is: one tool the AI can call (open_ryagram_home) whose result is the list of the person's departments, and one small page (an MCP App resource) that draws that list: what works today with a button that puts a
// starting line into the chat and a button that opens the site page; what is coming soon with its one honest line and nothing to press. OFF unless CONNECT_HOME_PANEL=on (and CONNECT_MCP_APP=on).
// WHICH departments exist and whether each WORKS for this person is the database's rule, the same one the site's top bar uses (connect_my_departments, a token-checked twin of my_departments()): a 'working' department the
// words below have no page for is NOT shown (never a dead link), a 'soon' one with no words is NOT shown (never an empty card), exactly the site's own rule (assets/app-departments.js normalize()).
// The words are ONE table here, equal to the site's for the departments the site has words for (tests/connect-home-panel.test.mjs compares them), except Geographic Intelligence, whose line GEO's paper replaces
// (proposals/GEO-HOME-PANEL-ENTRY-1113.md: the site's draft promised "where would a new shop do well", which GEO's own tools refuse to claim). Nothing here is a price, a date or a score.
// The page makes NO network request, uses textContent only, and is ES5 with no library (like the card page). Pure functions: no dependencies.

import type { DepartmentRow } from "./types.ts";

export const HOME_MAX_BYTES = 16 * 1024;

export interface HomeWords { label: string; line: string; rules?: string[]; notYet?: string[]; starts?: string[]; page?: string }
/** The site's order. An id this table does not know is not shown. */
export const HOME_ORDER = ["data_films", "compilations", "geo_intelligence", "games", "animation_studio"] as const;
export const HOME_WORDS: Readonly<Record<string, HomeWords>> = Object.freeze({
  data_films: { label: "Data films", line: "Questions answered with public data, drawn as a short animated film, with every source shown.",
    starts: ["Make me a short film from public data: how adult obesity changed in each state."], page: "#/d/data_films" },
  compilations: { label: "Compilations", line: "Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. Soon it will turn your clips into songs, too." },
  geo_intelligence: { label: "Geographic Intelligence", line: "Ask about places with free public data: who lives near a spot, what is close by, and how counties have changed. Every number says whether it was counted, calculated or estimated.",
    rules: ["Every number is labelled: observed, calculated, estimated or simulated.", "It counts places, jobs, wages, permits and people. It has no sales data, so it does not say where a business would do well.", "No score and no ranking of places."],
    notYet: ["Not part of Ryagram's first release. Testers are trying an early version. No price and no date."] },
  games: { label: "Games", line: "Play with your own data and footage in small games you can share." },
  animation_studio: { label: "Animation Studio", line: "Simple cartoons you direct: characters you can pose, with mouths that move to your voice." },
});
/** "My films" is not a department row: it is the person's own films, always there. */
export const MY_FILMS = Object.freeze({ id: "my_films", label: "My films", line: "Your films, and where each one stands.", starts: ["Show me my films."], page: "#/" });

export interface HomeEntry { id: string; label: string; status: "working" | "soon"; line: string; rules: string[]; not_yet: string[]; starts: string[]; page: string | null }
export interface HomeView { text: string; data: { departments: HomeEntry[]; coming_soon: string[]; note: string } }

const PAGE = /^#\/[A-Za-z0-9_\/-]{0,40}$/;

/** The database's rows become what the panel shows: only ids this file has words for, only the two statuses, each once, the site's order. */
export function homeEntries(rows: unknown): HomeEntry[] {
  const out: HomeEntry[] = [];
  const mine: HomeEntry = { id: MY_FILMS.id, label: MY_FILMS.label, status: "working", line: MY_FILMS.line, rules: [], not_yet: [], starts: [...MY_FILMS.starts], page: MY_FILMS.page };
  const byId = new Map<string, DepartmentRow>();
  if (Array.isArray(rows)) for (const r of rows as DepartmentRow[]) { if (r && typeof r.id === "string" && !byId.has(r.id)) byId.set(r.id, r); }
  const working: HomeEntry[] = [], soon: HomeEntry[] = [];
  for (const id of HOME_ORDER) {
    const r = byId.get(id), w = HOME_WORDS[id];
    if (!r || !w) continue;
    const label = typeof r.label === "string" && r.label.trim() && r.label.length <= 60 ? r.label.trim() : w.label;
    if (r.status === "working" && w.page && PAGE.test(w.page)) working.push({ id, label, status: "working", line: w.line, rules: [...(w.rules ?? [])], not_yet: [...(w.notYet ?? [])], starts: [...(w.starts ?? [])], page: w.page });
    else if (r.status === "soon") soon.push({ id, label, status: "soon", line: w.line, rules: [...(w.rules ?? [])], not_yet: [...(w.notYet ?? [])], starts: [], page: null });
  }
  out.push(...working, mine, ...soon);
  return out;
}

/** The result of open_ryagram_home: the words for a host with no panel, and the same list as data for the panel. */
export function homeView(rows: unknown): HomeView {
  const deps = homeEntries(rows);
  const works = deps.filter((d) => d.status === "working"), soon = deps.filter((d) => d.status === "soon");
  const text = ["Ryagram's departments for this person.",
    ...works.map((d) => `- ${d.label} (works today): ${d.line}${d.starts[0] ? ` To start: say "${d.starts[0]}"` : ""}`),
    ...(soon.length ? ["Coming soon (not built yet, nothing to start):", ...soon.map((d) => `- ${d.label}: ${d.line}${d.rules.length ? " " + d.rules.join(" ") : ""}${d.not_yet.length ? " " + d.not_yet.join(" ") : ""}`)] : []),
    "The panel below shows the same list with a button for each; the person can also just say what they want."].join("\n");
  return { text, data: { departments: deps, coming_soon: soon.map((d) => d.id), note: "Coming soon departments are shown for information only; there is nothing to start in them yet." } };
}

// ---------------------------------------------------------------------------------------------- the page
const STYLE = [
  ":root{color-scheme:dark}", "*{box-sizing:border-box}", "html,body{margin:0;background:transparent}",
  "body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f2f2ef}",
  ".home{background:#1b1b23;border:1px solid #3a3a44;border-radius:12px;padding:14px 16px;max-width:640px;min-width:0}",
  ".top{display:flex;align-items:center;gap:10px;margin:0 0 10px}",
  ".mark{flex:none;background:#0e0e13;color:#6fd1bd;border:1px solid #3a3a44;border-radius:8px;padding:3px 8px;font-weight:700;letter-spacing:.02em}",
  "h1{margin:0;font-size:16px;font-weight:650}", "h2{margin:14px 0 4px;font-size:13px;font-weight:650;color:#b6b5ae;text-transform:none}",
  ".dept{border-top:1px solid #2c2c36;padding:9px 0}", ".dept h3{margin:0 0 2px;font-size:15px;font-weight:650;display:flex;gap:8px;align-items:center}",
  ".tag{font-size:11px;font-weight:600;color:#b6b5ae;border:1px solid #3a3a44;border-radius:6px;padding:1px 6px}",
  ".line{margin:2px 0;color:#d8d7d0}", ".rule{margin:2px 0 0;color:#b6b5ae;font-size:13px}", ".hint{margin:8px 0 0;color:#b6b5ae;font-size:13px}",
  ".acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}",
  "button{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid #6fd1bd;background:#0e0e13;color:#8fe0cf;font:inherit;font-weight:600;cursor:pointer}",
  "button.quiet{border-color:#3a3a44;color:#d8d7d0}", "button:focus-visible{outline:2px solid #8fe0cf;outline-offset:2px}",
  ".copy{margin:6px 0 0;padding:6px 8px;border:1px dashed #3a3a44;border-radius:8px;color:#d8d7d0;overflow-wrap:anywhere}",
  "@media (max-width:360px){.home{padding:12px}}",
].join("");

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
  "function btn(label,cls,fn){var b=el('button',cls||'',label);b.type='button';b.addEventListener('click',fn);return b;}",
  "function startLine(box,text){",
  " ask('ui/message',{role:'user',content:{type:'text',text:text}},function(r){",
  "  if(r&&r.error){var old=box.querySelector('.copy');if(old)old.remove();var c=el('p','copy','Say this to your AI: '+text);box.appendChild(c);size();}",
  " });",
  "}",
  "function openPage(page){if(appUrl&&PAGE.test(page||'')){ask('ui/open-link',{url:appUrl+page},function(){});}}",
  "function dept(d){",
  " var box=el('section','dept'),h=el('h3','',clean(d.label,60));",
  " if(d.status==='soon')h.appendChild(el('span','tag','Coming soon'));",
  " box.appendChild(h);box.appendChild(el('p','line',clean(d.line,400)));",
  " var rs=Array.isArray(d.rules)?d.rules:[],ns=Array.isArray(d.not_yet)?d.not_yet:[];",
  " for(var i=0;i<rs.length&&i<4;i++)box.appendChild(el('p','rule',clean(rs[i],240)));",
  " for(var j=0;j<ns.length&&j<2;j++)box.appendChild(el('p','rule',clean(ns[j],240)));",
  " if(d.status==='working'){",
  "  var acts=el('div','acts'),st=Array.isArray(d.starts)?d.starts:[];",
  "  if(st.length&&typeof st[0]==='string'){(function(t){acts.appendChild(btn('Start this in the chat','',function(){startLine(box,t);}));})(clean(st[0],200));}",
  "  if(typeof d.page==='string'&&appUrl&&PAGE.test(d.page)){(function(p){acts.appendChild(btn('Open on the site','quiet',function(){openPage(p);}));})(d.page);}",
  "  if(acts.childNodes.length)box.appendChild(acts);",
  " }",
  " return box;",
  "}",
  "function paint(sc){",
  " var top=el('div','top');top.appendChild(el('span','mark',\"L'Ai\"));top.appendChild(el('h1','','Ryagram'));",
  " var kids=[top],ds=sc&&typeof sc==='object'&&Array.isArray(sc.departments)?sc.departments:null;",
  " if(!ds||!ds.length){kids.push(el('p','hint','Your Ryagram departments are listed in the conversation above.'));}",
  " else{",
  "  var w=[],s=[];for(var i=0;i<ds.length&&i<12;i++){var d=ds[i];if(!d||typeof d!=='object')continue;if(d.status==='working')w.push(d);else if(d.status==='soon')s.push(d);}",
  "  if(w.length){kids.push(el('h2','','Works today'));for(var a=0;a<w.length;a++)kids.push(dept(w[a]));}",
  "  if(s.length){kids.push(el('h2','','Coming soon'));for(var b=0;b<s.length;b++)kids.push(dept(s[b]));}",
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
  "paint(null);",
  "if(typeof ResizeObserver==='function')new ResizeObserver(size).observe(document.body);",
  "ask('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'ryagram-home',version:'1'},appCapabilities:{availableDisplayModes:['inline']}},function(){note('ui/notifications/initialized',{});size();});",
  "})();",
].join("\n");

const APP_URL = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/;

/** The built page. `appUrl` is a config value (checked here, never request data); the pages it may open are fixed fragments checked again in the page. */
export function homeHtml(appUrl?: string): string {
  const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Ryagram home</title><style>" + STYLE + "</style></head><body data-app-url=\"" + link + "\">" +
    "<main class=\"home\" id=\"home\" aria-live=\"polite\"><div class=\"top\"><span class=\"mark\" aria-hidden=\"true\">L'Ai</span><h1>Ryagram</h1></div><p class=\"hint\">Opening Ryagram...</p></main>" +
    "<script>" + SCRIPT + "</script></body></html>";
}

/** A short build id: a hash of the page made with no address, so the page's address changes whenever the page or its words do (a host that keeps pages by address never shows an old one). */
function buildId(): string {
  const s = homeHtml("") + JSON.stringify(HOME_WORDS) + JSON.stringify(MY_FILMS);
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0; b = Math.imul(b + s.charCodeAt(i) + i, 0x85ebca6b) >>> 0; b ^= b >>> 13; }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
}
export const HOME_BUILD = buildId();
export const HOME_URI = "ui://ryagram/home-" + HOME_BUILD;
const HOME_ADDRESS = /^ui:\/\/ryagram\/home-[0-9a-f]{12}$/;
/** Any address of this shape (an earlier build a host still holds) is answered with the CURRENT page. */
export const isHomeUri = (u: unknown): boolean => typeof u === "string" && HOME_ADDRESS.test(u);
