// The Ryagram HOME PANEL in the chat (CONNECT, 2026-11-13; CC1's item 4): open_ryagram_home and the page that draws it. Against the in-memory stand-in; invented accounts.
// What this pins: the tool exists only with its own switch (OFF is the connector as it was); the list is the database's rule and the site's rule (a working department with no page is not shown, a soon one with no words is
// not shown, each once, the site's order); the words equal the site's where the site has them and say nothing GEO's rules forbid; a coming-soon department has nothing to start; the page is small, makes no request, builds
// from text nodes only, and opens only fixed fragments of the app address. The real-Chrome behaviour is tools/check-home-panel.py. Must-fails: tests/connect_home_panel_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { handleMcp, toolList } from '../supabase/functions/connect-core/mcp.ts';
import { HOME_BUILD, HOME_MAX_BYTES, HOME_ORDER, HOME_URI, HOME_WORDS, homeEntries, homeHtml, homeView, isHomeUri } from '../supabase/functions/connect-core/home_panel.ts';
import { readResource, resourceList } from '../supabase/functions/connect-core/mcp_app.ts';

const GEO_LINE = 'Ask about places with free public data: who lives near a spot, what is close by, and how counties have changed. Every number says whether it was counted, calculated or estimated.';
const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
function world() {
  const w = new FakeWorld(); w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId);
  const call = (name, args, home = true) => callTool(name, args, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile }, homePanel: home });
  return { w, call };
}
const rows = (...r) => r.map(([id, status, label]) => ({ id, status, label: label ?? HOME_WORDS[id]?.label ?? id }));

test('the tool exists only with its own switch: off it is "no such tool" and not in the list, on it is listed with its page', async () => {
  const { call } = world();
  const off = await call('open_ryagram_home', {}, false);
  assert.equal(off.isError ?? off.refused, true, off.text); assert.match(off.text, /no tool called/);
  assert.ok(!toolList(true, true, false).some((t) => t.name === 'open_ryagram_home'), 'not listed off');
  const on = toolList(true, false, true).find((t) => t.name === 'open_ryagram_home');
  assert.ok(on, 'listed on'); assert.equal(on.annotations.readOnlyHint, true); assert.deepEqual(on._meta.ui, { resourceUri: HOME_URI }); assert.equal(on._meta['openai/outputTemplate'], HOME_URI);
  const t = TOOLS.find((x) => x.name === 'open_ryagram_home');
  assert.equal(t.scope, 'read'); assert.equal(t.readOnly, true); assert.equal(t.homePanel, true);
  assert.equal(toolList(true, true, false).length, toolList(true, true, true).length - 1, 'exactly one tool more with the switch on');
});

test('on, it answers with the person\'s departments: the words for a host with no panel and the same list as data', async () => {
  const { w, call } = world();
  const r = await call('open_ryagram_home', {});
  assert.equal(r.isError, undefined, r.text);
  assert.match(r.text, /Data films \(works today\)/); assert.match(r.text, /My films \(works today\)/); assert.match(r.text, /Coming soon \(not built yet, nothing to start\)/);
  const ids = r.data.departments.map((d) => d.id);
  assert.deepEqual(ids, ['data_films', 'my_films', 'compilations', 'geo_intelligence', 'games', 'animation_studio']);
  assert.deepEqual(r.data.coming_soon, ['compilations', 'geo_intelligence', 'games', 'animation_studio']);
  assert.ok(!/<|>|javascript:/.test(r.text));
  w.users.get(A.userId).departments = rows(['data_films', 'working'], ['compilations', 'working'], ['games', 'soon']);          // a promoted department without a page is NOT shown as working
  const r2 = await call('open_ryagram_home', {});
  assert.deepEqual(r2.data.departments.map((d) => d.id), ['data_films', 'my_films', 'games']);
});

test('the list follows the site\'s rule: only ids with words, only the two statuses, each once, in the site order, a working one only with a page', () => {
  const e = homeEntries([{ id: 'games', status: 'soon', label: 'Games' }, { id: 'data_films', status: 'working', label: 'Data films' }, { id: 'data_films', status: 'soon', label: 'Again' },
    { id: 'nobody_knows', status: 'working', label: 'x' }, { id: 'animation_studio', status: 'broken', label: 'x' }, { id: 'compilations', status: 'working', label: 'Compilations' }, null, 7, { id: 5 }]);
  assert.deepEqual(e.map((d) => d.id + ':' + d.status), ['data_films:working', 'my_films:working', 'games:soon']);
  assert.deepEqual(homeEntries(null).map((d) => d.id), ['my_films'], 'a failed read still shows the person\'s own films');
  assert.deepEqual(HOME_ORDER, ['data_films', 'compilations', 'geo_intelligence', 'games', 'animation_studio']);
  assert.equal(homeEntries([{ id: 'data_films', status: 'working', label: 'x'.repeat(61) }])[0].label, 'Data films', 'a label over 60 characters is replaced by ours');
});

test('My films opens the site\'s page by the site\'s own rule: #/films when the account\'s myFilms switch is on, the projects page otherwise (and when the list could not be read)', async () => {
  const films = (sw) => homeEntries(rows(['data_films', 'working']), sw).find((x) => x.id === 'my_films').page;
  assert.equal(films(['myFilms']), '#/films'); assert.equal(films(['other', 'myFilms']), '#/films');
  for (const off of [[], ['otherSwitch'], undefined, null, 'myFilms', { myFilms: true }]) assert.equal(films(off), '#/', JSON.stringify(off));
  const cfg = fs.readFileSync(new URL('../assets/ryagram-config.js', import.meta.url), 'utf8');
  assert.match(cfg, /\bmyFilms: 'account'/, 'the site reads My films from the account\'s own list only while its setting is the word account: if that setting changes, this rule must be rethought');
  const { w, call } = world();
  w.users.get(A.userId).switches = ['myFilms'];
  assert.equal((await call('open_ryagram_home', {})).data.departments.find((d) => d.id === 'my_films').page, '#/films');
  w.users.get(A.userId).switches = [];
  assert.equal((await call('open_ryagram_home', {})).data.departments.find((d) => d.id === 'my_films').page, '#/');
  const data = w.data(A.userId); data.switches = async () => { throw new Error('boom'); };
  const r = await callTool('open_ryagram_home', {}, A, { data, policy: w.policy(), deps: { compile }, homePanel: true });
  assert.equal(r.data.departments.find((d) => d.id === 'my_films').page, '#/', 'a switch list that cannot be read fails closed: the projects page');
});

test('a coming-soon department has nothing to start and nothing to open; a working one has one starting line and one page', () => {
  const e = homeEntries(rows(['data_films', 'working'], ['geo_intelligence', 'soon'], ['games', 'soon']));
  for (const d of e.filter((x) => x.status === 'soon')) { assert.deepEqual(d.starts, [], d.id); assert.equal(d.page, null, d.id); }
  const df = e.find((x) => x.id === 'data_films'); assert.equal(df.starts.length, 1); assert.equal(df.page, '#/d/data_films');
  const mf = e.find((x) => x.id === 'my_films'); assert.equal(mf.page, '#/'); assert.deepEqual(mf.starts, ['Show me my films.']);
  for (const d of e) { assert.ok(d.page === null || /^#\/[A-Za-z0-9_\/-]{0,40}$/.test(d.page), d.id); for (const s of d.starts) assert.ok(s.length <= 200 && !/[<>]/.test(s)); }
});

test('the words equal the site\'s where the site has them (assets/app-departments.js), except the one line GEO replaced', () => {
  const src = fs.readFileSync(new URL('../assets/app-departments.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const a = src.indexOf('const KNOWN = {'), b = src.indexOf('\n  };', a);
  const KNOWN = new Function('return ' + src.slice(a + 'const KNOWN = '.length, b + 4))();
  for (const id of HOME_ORDER) {
    const site = KNOWN[id], ours = HOME_WORDS[id];
    assert.ok(site, `${id} is a department the site knows`);
    assert.equal(ours.label, site.label, `${id}: the label`);
    if (id === 'geo_intelligence') { assert.equal(ours.line, GEO_LINE, 'the panel says GEO\'s paper line (proposals/GEO-HOME-PANEL-ENTRY-1113.md), whatever the site says now: the test holds in either landing order with the site\'s change'); continue; }
    assert.equal(ours.line, site.line ?? site.sentence, `${id}: the line`);
  }
});

test('nothing the panel says is a price, a date, a score, a ranking, or a promise of where a business would do well', () => {
  const all = [...Object.values(HOME_WORDS).flatMap((w) => [w.line, ...(w.rules ?? []), ...(w.notYet ?? []), ...(w.starts ?? [])])].join('\n');
  const said = all.replace('so it does not say where a business would do well', '').replace('No score and no ranking of places.', '');          // the two sentences that REFUSE the claims
  for (const bad of [/\$\s?\d/, /\b20\d\d\b/, /\b(best|top|ideal|optimal|winner)\b/i, /do well/i, /succeed|success/i, /\bscore/i]) assert.ok(!bad.test(said), String(bad));
  assert.ok(!/\brank/i.test(said), 'ranking only in the rule that refuses it');
  assert.match(all, /No score and no ranking of places\./, 'the rule that refuses a score and a ranking is there');
  assert.match(HOME_WORDS.geo_intelligence.rules.join(' '), /no sales data, so it does not say where a business would do well/);
  assert.match(HOME_WORDS.geo_intelligence.notYet.join(' '), /No price and no date/);
});

test('the page is small, makes no request, builds from text nodes only, and opens only fixed fragments of the app address', () => {
  const html = homeHtml('https://uselai.com/app/');
  assert.ok(Buffer.byteLength(html) <= HOME_MAX_BYTES, `${Buffer.byteLength(html)} bytes is over the ${HOME_MAX_BYTES} budget`);
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|importScripts|sendBeacon|eval\(|new Function|document\.write|innerHTML|outerHTML|insertAdjacentHTML/.test(html), 'no network, no code from text, no markup from text');
  assert.ok(!/<script[^>]*\bsrc=|<link|<img|<iframe|@import|url\(/i.test(html), 'nothing loaded from anywhere');
  assert.ok(html.includes("ask('ui/open-link',{url:appUrl+page}"), 'only the app address plus a checked fragment is opened');
  assert.ok(html.includes("function openPage(page){if(appUrl&&PAGE.test(page||'')){"), 'a page is opened only when there is an app address AND the fragment is plain');
  assert.ok(html.includes("if(r&&r.error){"), 'a host that answers the message with an error gets the fallback');
  assert.ok(html.includes("var PAGE=/^#\\/[A-Za-z0-9_\\/-]{0,40}$/;"), 'the fragment is checked in the page too');
  assert.ok(html.includes("ask('ui/message',{role:'user',content:{type:'text',text:text}}"), 'a starting line goes through the host\'s own message call');
  assert.ok(html.includes("var p=el('p','copy','Say this to your AI: '+text)") || html.includes("el('p','copy','Say this to your AI: '+text)"), 'a host that refuses the message gets the line to say');
  assert.match(html, /data-app-url="https:\/\/uselai\.com\/app\/"/);
  assert.match(homeHtml('http://evil.example/'), /data-app-url=""/, 'an address that is not https is never put in the page');
  assert.match(homeHtml('https://x.example/"><script>'), /data-app-url=""/);
});

test('the page has a stable address that changes when the page or its words change, and any address of its shape is answered with the current page', () => {
  assert.match(HOME_URI, /^ui:\/\/ryagram\/home-[0-9a-f]{12}$/); assert.equal(HOME_URI, 'ui://ryagram/home-' + HOME_BUILD);
  assert.ok(isHomeUri(HOME_URI) && isHomeUri('ui://ryagram/home-000000000000') && !isHomeUri('ui://ryagram/home') && !isHomeUri('ui://ryagram/home-xyz') && !isHomeUri('ui://ryagram/editor-000000000000') && !isHomeUri(5));
  const on = { enabled: true, homePanel: true, appUrl: 'https://uselai.com/app/' };
  assert.ok(resourceList(on).some((r) => r.uri === HOME_URI));
  assert.ok(!resourceList({ enabled: true }).some((r) => r.uri === HOME_URI), 'off: not listed');
  assert.equal(readResource(HOME_URI, { enabled: true }), null, 'off: not served');
  const r = readResource('ui://ryagram/home-000000000000', on);
  assert.equal(r.contents[0].uri, 'ui://ryagram/home-000000000000'); assert.equal(r.contents[0].text, homeHtml('https://uselai.com/app/'));
  assert.deepEqual(r.contents[0]._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
});

function server(mcpApp) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId, ['read', 'write', 'render_free']);
  w.issue('tok-a', A);
  const deps = { data: null, policy: w.policy(), deps: { compile }, verifyToken: w.verifyToken, dataFor: () => w.data(A.userId), resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource', ...(mcpApp === undefined ? {} : { mcpApp }) };
  const rpc = async (method, params) => JSON.parse(await (await handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer tok-a' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps)).text());
  return { w, rpc };
}
const APP = 'https://uselai.com/app/';

test('over the MCP wire: the switch off (or the app face off) is the connector as it was; on it lists the tool, serves the page and answers the call', async () => {
  const names = async (cfg) => (await server(cfg).rpc('tools/list', {})).result.tools.map((t) => t.name);
  const plain = await names({ enabled: true, appUrl: APP }), nothing = await names(undefined), homeButNoApp = await names({ enabled: false, homePanel: true });
  for (const n of [plain, nothing, homeButNoApp]) assert.ok(!n.includes('open_ryagram_home'));
  assert.deepEqual(plain, nothing, 'the app face alone changes no tool');
  const on = server({ enabled: true, homePanel: true, appUrl: APP });
  const tools = (await on.rpc('tools/list', {})).result.tools;
  const t = tools.find((x) => x.name === 'open_ryagram_home');
  assert.ok(t, 'listed'); assert.equal(t._meta.ui.resourceUri, HOME_URI); assert.equal(tools.length, plain.length + 1, 'exactly one tool more');
  assert.ok((await on.rpc('resources/list', {})).result.resources.some((r) => r.uri === HOME_URI));
  const page = (await on.rpc('resources/read', { uri: HOME_URI })).result.contents[0];
  assert.equal(page.mimeType, 'text/html;profile=mcp-app'); assert.match(page.text, /Ryagram home/); assert.ok(page.text.includes('data-app-url="' + APP + '"'));
  const call = (await on.rpc('tools/call', { name: 'open_ryagram_home', arguments: {} })).result;
  assert.equal(call.isError, false); assert.ok(call.structuredContent.departments.length >= 2); assert.match(call.content[0].text, /works today/);
  const off = server({ enabled: true, appUrl: APP });
  const refused = (await off.rpc('tools/call', { name: 'open_ryagram_home', arguments: {} })).result;
  assert.equal(refused.isError, true, 'off: there is no such tool');
  assert.equal((await off.rpc('resources/read', { uri: HOME_URI })).error.code, -32002, 'off: the page is not served');
});

test('a database that cannot answer is said in words, not thrown', async () => {
  const { w, call } = world();
  const data = w.data(A.userId); data.departments = async () => { throw new Error('boom'); };
  const r = await callTool('open_ryagram_home', {}, A, { data, policy: w.policy(), deps: { compile }, homePanel: true });
  assert.equal(r.isError, true); assert.equal(r.code, 'unavailable'); assert.match(r.text, /not available just now/);
});
