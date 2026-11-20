// Ryagram inside the AI chat: the MCP App face (CONNECT, 2026-11-05; plan: Ryagram-logs/proposals/CONNECT-MCP-APP-PLAN-1105.md).
// OFF unless the function is configured with CONNECT_MCP_APP=on. OFF is byte-for-byte the connector as it was (tests/connect-mcp-app.test.mjs compares it).
// What this adds when ON: a `resources` capability, two read-only methods (resources/list, resources/read) that serve ONE built page, and `_meta.ui` on the tools that show it.
// A host that does not know MCP Apps ignores all of that and shows the tool's text, which is unchanged.
// Spec: MCP Apps extension (modelcontextprotocol/ext-apps, 2026-01-26): tool `_meta.ui.resourceUri`, resource mimeType `text/html;profile=mcp-app`, resource `_meta.ui` { csp, domain, prefersBorder }.

import { EDITOR_BUILD, EDITOR_HTML } from "./editor_page.ts";
import { HOME_URI, homeHtml, isHomeUri } from "./home_panel.ts";
import { probeCsp, probePage, probeResources } from "./probe.ts";
import { chatCss } from "./chat_look.ts";

export const CARD_URI = "ui://ryagram/card";
/** The editor page's address changes with every build of the page (EDITOR_BUILD is a hash of everything it is made from). A host that keeps pages by address (Claude fetches a connector's pages once, then reuses them) can then never show a stale page under the new address. */
export const EDITOR_URI = "ui://ryagram/editor-" + EDITOR_BUILD;
/** The address before 11-08, and any address of the same shape from an earlier build. A host that still holds an old tools list asks for one of them; it is answered with the CURRENT page (never an old one) under the address it asked for, and only they are not listed. */
export const EDITOR_URI_LEGACY = "ui://ryagram/editor";
const EDITOR_ADDRESS = /^ui:\/\/ryagram\/editor-[0-9a-f]{12}$/;
export const isEditorUri = (u: unknown): boolean => u === EDITOR_URI_LEGACY || (typeof u === "string" && EDITOR_ADDRESS.test(u));
export const MCP_APP_MIME = "text/html;profile=mcp-app";
/** The most the card page may weigh. A test fails above it: the card is a glance, not an app. */
export const CARD_MAX_BYTES = 12 * 1024;

export interface McpAppConfig {
  enabled: boolean;
  /** Claude's sandbox origin for this server (see claudeUiDomain); absent = the field is left out and the host reports it if it wants one. */
  uiDomain?: string;
  /** The address of the Ryagram app, for the card's one link. Absent = no link. */
  appUrl?: string;
  /** The live editor inside the chat (a second switch, with enabled): serves ui://ryagram/editor and lists its tools. Absent or false = none of it exists. */
  chatEditor?: boolean;
  /** The Ryagram home panel (a third switch, with enabled): serves ui://ryagram/home-<build> and lists its tool. Absent or false = none of it exists. */
  homePanel?: boolean;
  /** The Q520 probe panel (its own switch, off by default; probe.ts): serves its throwaway test pages and tools. Absent or false = none of it exists. */
  probe?: boolean;
}

/** Which tools show which page. The tool's text and structured data are exactly what they were. */
export const UI_TOOL_URIS: Readonly<Record<string, string>> = Object.freeze({ whoami_and_credits: CARD_URI, list_projects: CARD_URI });

/** Claude's rule for `_meta.ui.domain`: the first 32 hex characters of the SHA-256 of the server URL, then `.claudemcpcontent.com` (Claude's "Get started with MCP Apps"). */
export async function claudeUiDomain(serverUrl: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serverUrl)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32) + ".claudemcpcontent.com";
}
export const UI_DOMAIN = /^[a-f0-9]{32}\.claudemcpcontent\.com$/;
const APP_URL = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?(#[A-Za-z0-9._~\/-]*)?$/;

/** What a tool in the list says about its page. The ChatGPT alias is the one OpenAI documents as honoured. */
export const toolUiMeta = (uri: string) => ({ ui: { resourceUri: uri }, "openai/outputTemplate": uri });

/** The page. ES5 on purpose (no build step, no template literal, no library). It makes NO network request: it draws what the host hands it as the tool's result, with textContent only. */
// The look is the site's own (tokens, button, badge) from chat_look.ts (tools/build-chat-look.mjs, built from WEB's design files) plus the chat layout; nothing is written here.
const CARD_STYLE = ":root{color-scheme:dark}" + chatCss("tokens", "controls", "base", "card");

const CARD_SCRIPT = [
  "(function(){",
  "var host=window.parent,pend={},nid=0,card=document.getElementById('card'),appUrl=document.body.getAttribute('data-app-url')||'';",
  "function post(m){m.jsonrpc='2.0';host.postMessage(m,'*');}",
  "function ask(method,params,done){var id=++nid;pend[id]=done;post({id:id,method:method,params:params});}",
  "function note(method,params){post({method:method,params:params});}",
  "var BAD=/[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069\\u200e\\u200f]/g;",
  "function clean(s,n){return String(s==null?'':s).replace(BAD,' ').slice(0,n||80);}",
  "function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}",
  "function row(k,v){var r=el('div','rc-acct');r.appendChild(el('span','k',k));r.appendChild(el('span','v',v));return r;}",
  "function stat(n,l){var s=el('div','rc-stat');s.appendChild(el('span','rc-n',n));s.appendChild(el('span','rc-l',l));return s;}",
  "function whole(n){return typeof n==='number'&&isFinite(n)?String(Math.round(n)):null;}",
  "function head(){var t=el('div','rc-brand');t.appendChild(el('b','',\"L'Ai\"));t.appendChild(el('h1','','Ryagramming'));return t;}",
  // a host that will not open a link says so; the address is then given in words, once, to open by hand (the chat editor does the same)
  "function openFailed(){var n=card.querySelector('.openfail');if(!n){n=el('p','hint openfail');n.setAttribute('role','alert');card.appendChild(n);}n.textContent='Your chat app did not open it. Open this address in your browser: '+appUrl;size();}",
  "function paint(sc){",
  " var kids=[head()],any=false;",
  " if(sc&&typeof sc==='object'){",
  "  var a=whole(sc.credits_available),h=whole(sc.credits_held);",
  "  if(a!==null||h!==null){var st=el('div','rc-stats');if(a!==null)st.appendChild(stat(a,'Credits available'));if(h!==null)st.appendChild(stat(h,'Held for running jobs'));kids.push(st);any=true;}",
  "  if(typeof sc.account==='string'){kids.push(row('Account',clean(sc.account)));any=true;}",
  "  if(Array.isArray(sc.projects)){",
  "   var ps=sc.projects;any=true;",
  "   if(!ps.length)kids.push(el('p','hint','No projects yet.'));",
  "   else{kids.push(el('p','rc-h','Your films'));var ls=el('div','rc-list');",
  "    for(var i=0;i<ps.length&&i<3;i++){var p=ps[i];if(p&&typeof p==='object'){var li=el('div','rc-li');li.appendChild(el('span','',clean(p.title,60)));ls.appendChild(li);}}",
  "    kids.push(ls);}",
  "   if(ps.length>3)kids.push(el('p','hint','and '+(ps.length-3)+' more'));",
  "  }",
  " }",
  " if(!any)kids.push(el('p','hint','Your Ryagram details are in the conversation above.'));",
  " if(appUrl){var b=el('button','btn primary small','Open Ryagram');b.type='button';b.addEventListener('click',function(){ask('ui/open-link',{url:appUrl},function(r){if(r&&(r.error||(r.result&&r.result.isError===true)))openFailed();});});kids.push(b);}",
  " card.textContent='';for(var j=0;j<kids.length;j++)card.appendChild(kids[j]);",
  " size();",
  "}",
  "var last=0;",
  "function size(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h&&h!==last){last=h;note('ui/notifications/size-changed',{width:Math.ceil(document.documentElement.getBoundingClientRect().width),height:h});}}",
  "window.addEventListener('message',function(ev){",
  " if(ev.source!==host)return;",
  " var m=ev.data;if(!m||typeof m!=='object'||m.jsonrpc!=='2.0')return;",
  " if(typeof m.method==='string'){",
  "  if(m.method==='ui/notifications/tool-result'){paint(m.params&&m.params.structuredContent);return;}",
  "  if(m.id!==undefined){",
  "   if(m.method==='ui/resource-teardown'){post({id:m.id,result:{}});return;}",
  "   post({id:m.id,error:{code:-32601,message:'Method not found'}});return;",
  "  }",
  "  return;",
  " }",
  " if(m.id!==undefined&&pend[m.id]){var f=pend[m.id];delete pend[m.id];f(m);}",
  "});",
  "paint(null);",
  "if(typeof ResizeObserver==='function')new ResizeObserver(size).observe(document.body);",
  "ask('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'ryagram-card',version:'1'},appCapabilities:{availableDisplayModes:['inline']}},function(){note('ui/notifications/initialized',{});size();});",
  "})();",
].join("\n");

/** The editor page as a host READS it. The built page (EDITOR_HTML) names no web address; the site's address is a config value (checked here, never request data) put on the page's root when the page is read, so the page's
 *  own address and build id do not change with it. The page uses it for one button, "See the real frames on the site" (tools/chat-editor/live-host.js), and checks it again before it does. */
export function editorHtml(appUrl?: string): string {
  const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";
  const root = '<main id="live-root"';
  if (!link || EDITOR_HTML.split(root).length !== 2) return EDITOR_HTML;
  return EDITOR_HTML.replace(root, root + ' data-app-url="' + link + '"');
}

/** The built page. `appUrl` is a config value, checked here, never request data. */
export function cardHtml(appUrl?: string): string {
  const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Ryagram</title><style>" + CARD_STYLE + "</style></head><body data-app-url=\"" + link + "\">" +
    "<main class=\"card rc\" id=\"card\" aria-live=\"polite\"><div class=\"rc-brand\"><b>L'Ai</b><h1>Ryagramming</h1></div><p class=\"hint\">Opening Ryagram...</p></main>" +
    "<script>" + CARD_SCRIPT + "</script></body></html>";
}

export function resourceList(cfg?: McpAppConfig) {
  return [{ uri: CARD_URI, name: "Ryagram card", description: "A small card showing the Ryagram account and projects the AI is working with.", mimeType: MCP_APP_MIME },
    ...(cfg?.chatEditor ? [{ uri: EDITOR_URI, name: "Ryagram editor", description: "The Ryagram live editor for one of the person's films.", mimeType: MCP_APP_MIME }] : []),
    ...(cfg?.homePanel ? [{ uri: HOME_URI, name: "Ryagram home", description: "The person's Ryagram departments, with what works today and what is coming soon.", mimeType: MCP_APP_MIME }] : []),
    ...probeResources(!!cfg?.probe, MCP_APP_MIME)];
}

/** null = no such page. */
export function readResource(uri: unknown, cfg: McpAppConfig) {
  const probe = cfg.probe ? probePage(uri) : null;
  if (probe !== null) {
    const csp = probeCsp(), ui: Record<string, unknown> = { csp, prefersBorder: true };
    const dom = cfg.uiDomain;
    if (dom && UI_DOMAIN.test(dom)) ui.domain = dom;
    // the same list in OpenAI's own spelling too, so a host that reads only that one still has the declared origin
    return { contents: [{ uri: uri as string, mimeType: MCP_APP_MIME, text: probe, _meta: { ui, "openai/widgetCSP": { connect_domains: csp.connectDomains, resource_domains: csp.resourceDomains } } }] };
  }
  const editor = isEditorUri(uri);
  const home = isHomeUri(uri);
  if (uri !== CARD_URI && !(editor && cfg.chatEditor) && !(home && cfg.homePanel)) return null;
  const ui: Record<string, unknown> = { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false };
  if (cfg.uiDomain && UI_DOMAIN.test(cfg.uiDomain)) ui.domain = cfg.uiDomain;
  return { contents: [{ uri: uri as string, mimeType: MCP_APP_MIME, text: editor ? editorHtml(cfg.appUrl) : home ? homeHtml(cfg.appUrl) : cardHtml(cfg.appUrl), _meta: { ui } }] };
}
