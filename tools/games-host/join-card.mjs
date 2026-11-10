// The games JOIN CARD (CONNECT, 2026-11-10; the page behind ui://ryagram-games/join, which open_room and join_card point at; contract tools/games-host-contract.mjs).
// A small sealed page the local games server serves as a resource and the chat host shows inline: the room's 4-letter join code, big, and who has joined so far. It draws ONLY what the host hands it as the tool's result
// (structuredContent: { code, players: [{ name }] }), with textContent only, so a player's name is text and never markup. It makes NO network request, shows NO address of any kind (the TV shows where to go), has NO button and
// NO link, and holds no script from anywhere else. ES5 on purpose (no build step, no library). Built the same sealed way as the connector's own card (supabase/functions/connect-core/mcp_app.ts).
//
//   node tools/games-host/join-card.mjs --write      writes tools/games-host/join-card.html (the file the games server reads); a test fails if the committed file differs from this builder
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const JOIN_CARD_URI = 'ui://ryagram-games/join';

const STYLE = [
  ':root{color-scheme:dark}',
  '*{box-sizing:border-box}',
  'html,body{margin:0;background:transparent}',
  'body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f2f2ef}',
  '.card{background:#1b1b23;border:1px solid #3a3a44;border-radius:12px;padding:14px 16px;max-width:560px;min-width:0}',
  '.top{display:flex;align-items:center;gap:10px;margin:0 0 10px}',
  '.mark{flex:none;background:#0e0e13;color:#6fd1bd;border:1px solid #3a3a44;border-radius:8px;padding:3px 8px;font-weight:700;letter-spacing:.02em}',
  'h1{margin:0;font-size:16px;font-weight:650;color:#f2f2ef}',
  '.code{display:flex;gap:8px;justify-content:center;margin:6px 0 4px}',
  '.ch{min-width:44px;padding:6px 8px;text-align:center;font:700 32px/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#8fe0cf;background:#0e0e13;border:1px solid #3a3a44;border-radius:10px}',
  '.hint{margin:8px 0 0;color:#b6b5ae;font-size:13px}',
  '.sub{margin:12px 0 6px;color:#b6b5ae;font-size:13px}',
  '.who{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}',
  '.who li{background:#0e0e13;border:1px solid #3a3a44;border-radius:999px;padding:3px 10px;color:#f2f2ef;overflow-wrap:anywhere;min-width:0}',
  '@media (max-width:360px){.card{padding:12px}.ch{min-width:38px;font-size:28px}}',
].join('');

// the script, as plain text (String.raw keeps every backslash as written)
const SCRIPT = String.raw`(function(){
var host=window.parent,pend={},nid=0,card=document.getElementById('card'),last=0;
function post(m){m.jsonrpc='2.0';host.postMessage(m,'*');}
function ask(method,params,done){var id=++nid;pend[id]=done;post({id:id,method:method,params:params});}
function note(method,params){post({method:method,params:params});}
var BAD=new RegExp('['+String.fromCharCode(0)+'-'+String.fromCharCode(31)+String.fromCharCode(127)+'-'+String.fromCharCode(159)+String.fromCharCode(8203)+'-'+String.fromCharCode(8207)+String.fromCharCode(8232)+'-'+String.fromCharCode(8238)+String.fromCharCode(8294)+'-'+String.fromCharCode(8297)+String.fromCharCode(65279)+']','g');
function clean(s,n){return String(s==null?'':s).replace(BAD,' ').replace(/\s+/g,' ').trim().slice(0,n||24);}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
function head(){var t=el('div','top');t.appendChild(el('span','mark',"L'Ai"));t.appendChild(el('h1','','Join the game'));return t;}
function size(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h&&h!==last){last=h;note('ui/notifications/size-changed',{width:Math.ceil(document.documentElement.getBoundingClientRect().width),height:h});}}
function paint(sc){
 var kids=[head()],code=sc&&typeof sc==='object'&&typeof sc.code==='string'&&/^[A-Z]{4}$/.test(sc.code)?sc.code:null;
 if(code){
  var c=el('div','code');c.setAttribute('role','img');c.setAttribute('aria-label','Join code '+code.split('').join(' '));
  for(var i=0;i<4;i++)c.appendChild(el('span','ch',code.charAt(i)));
  kids.push(c);
  kids.push(el('p','hint','Open the game on your phone and enter this code.'));
  var ps=Array.isArray(sc.players)?sc.players:[],names=[];
  for(var j=0;j<ps.length&&names.length<20;j++){var p=ps[j],n=p&&typeof p==='object'?clean(p.name):(typeof p==='string'?clean(p):'');if(n)names.push(n);}
  var total=ps.length;
  kids.push(el('p','sub',total?('Players so far: '+total):'No one has joined yet.'));
  if(names.length){var u=el('ul','who');for(var k=0;k<names.length;k++)u.appendChild(el('li','',names[k]));kids.push(u);}
  if(total>names.length)kids.push(el('p','hint','and '+(total-names.length)+' more'));
 }else{
  kids.push(el('p','hint','The room code is in the conversation above.'));
 }
 card.textContent='';for(var m=0;m<kids.length;m++)card.appendChild(kids[m]);
 size();
}
window.addEventListener('message',function(ev){
 if(ev.source!==host)return;
 var m=ev.data;if(!m||typeof m!=='object'||m.jsonrpc!=='2.0')return;
 if(typeof m.method==='string'){
  if(m.method==='ui/notifications/tool-result'){paint(m.params&&m.params.structuredContent);return;}
  if(m.id!==undefined){
   if(m.method==='ui/resource-teardown'){post({id:m.id,result:{}});return;}
   post({id:m.id,error:{code:-32601,message:'Method not found'}});return;
  }
  return;
 }
 if(m.id!==undefined&&pend[m.id]){var f=pend[m.id];delete pend[m.id];f(m);}
});
paint(null);
if(typeof ResizeObserver==='function')new ResizeObserver(size).observe(document.body);
ask('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'ryagram-games-join',version:'1'},appCapabilities:{availableDisplayModes:['inline']}},function(){note('ui/notifications/initialized',{});size();});
})();`;

/** The built page. */
export function joinCardHtml() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Join the game</title><style>' + STYLE + '</style></head><body>' +
    '<main class="card" id="card" aria-live="polite"><div class="top"><span class="mark" aria-hidden="true">L\'Ai</span><h1>Join the game</h1></div><p class="hint">Opening the room...</p></main>' +
    '<script>' + SCRIPT + '</script></body></html>\n';
}

/** What a games server must say about this page when it lists the resource (the MCP Apps rules: the page may not reach anywhere). */
export const JOIN_CARD_RESOURCE = Object.freeze({ uri: JOIN_CARD_URI, name: 'Ryagram games join card', mimeType: 'text/html;profile=mcp-app',
  _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } } });

if (process.argv[2] === '--write') {
  const out = fileURLToPath(new URL('./join-card.html', import.meta.url));
  fs.writeFileSync(out, joinCardHtml());
  console.log('wrote', out);
}
