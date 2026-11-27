// The Perfect City PANEL in the AI chat (CONNECT 11-27): the page that draws what perfect_city_summary returned, and the one switch that shows it.
// Against the connector's own code and its in-memory stand-in world; the page is run in a tiny fake DOM (the real-browser look is not run here: this PC's Chrome crashes in the repo's browser checks).
// The structured data the page draws is the REAL answer of the tool for each state, never hand-made, except where a test plants a hostile or broken shape on purpose. Every place, number and name is made up.
// Must-fails are in tests/connect_perfect_city_card_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld, madeUpPerfectCityAnswer } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp, toolList } from '../supabase/functions/connect-core/mcp.ts';
import { CARD_URI, MCP_APP_MIME, UI_TOOL_URIS, readResource, resourceList } from '../supabase/functions/connect-core/mcp_app.ts';
import { COMPILATION_URI } from '../supabase/functions/connect-core/compilation_card.ts';
import { PERFECT_CITY_BUILD, PERFECT_CITY_CARD_PAGE, PERFECT_CITY_CARD_WORDS, PERFECT_CITY_MAX_BYTES, PERFECT_CITY_URI, isPerfectCityUri, perfectCityHtml } from '../supabase/functions/connect-core/perfect_city_card.ts';
import { PC_BUSINESS_TYPES, PC_OFF_WORDS, PC_PLACES, PC_RINGS_KM, PERFECT_CITY_PAGE } from '../supabase/functions/connect-core/perfect_city.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const APP = 'https://uselai.com/app/';
const DOMAIN = 'c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com';
const ON = { enabled: true, uiDomain: DOMAIN, appUrl: APP };
const SUM = { place: 'montgomery_oh', business_type: 'fast_food', lat: 39.7589, lon: -84.1916 };
const Q1 = '“', Q2 = '”';

function server(mcpApp, { switches = ['perfectCity'] } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId, ['read', 'write', 'render_free']);
  w.users.get(A.userId).switches = switches;
  w.issue('tok-a', A);
  const deps = { data: null, policy: w.policy(), deps: { compile }, verifyToken: w.verifyToken, dataFor: () => w.data(A.userId), resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource', ...(mcpApp === undefined ? {} : { mcpApp }) };
  const post = (method, params, token = 'tok-a') => handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps);
  const rpc = async (method, params, token) => JSON.parse(await (await post(method, params, token)).text());
  const policy = w.policy();
  const call = (name, args = SUM, wrap = {}) => callTool(name, args, A, { data: { ...w.data(A.userId), ...wrap }, policy, deps: { compile } });
  return { w, rpc, post, call };
}
const strip = (tools) => tools.map(({ _meta, ...t }) => t);
const err = (message, code) => Object.assign(new Error(message), { code });
const answer = async (over = (d) => d, args = SUM) => { const s = server(ON); s.w.perfectCityAnswer = (q) => over(madeUpPerfectCityAnswer(q)); const r = await s.call('perfect_city_summary', args); return { s, r }; };
const noPlaces = (d) => ({ ...d, places_loaded: { count: 0, basis: 'calculated' }, nearest: [], rings: d.rings.map((x) => ({ ...x, places: { count: 0, basis: 'calculated' } })) });

// ------------------------------------------------------------------------------------------------ the switch: OFF is the connector as it was
for (const [name, cfg] of [['no setting at all', undefined], ['enabled: false', { enabled: false, uiDomain: DOMAIN, appUrl: APP }]]) {
  test(`OFF (${name}): perfect_city_summary carries no _meta, nothing about the panel is listed, and its page is not served`, async () => {
    const s = server(cfg);
    const list = (await s.rpc('tools/list', {})).result.tools;
    const t = list.find((x) => x.name === 'perfect_city_summary');
    assert.ok(t, 'the tool itself is still there');
    assert.ok(!('_meta' in t), 'no link to a page');
    assert.ok(!JSON.stringify(list).includes('ui://') && !JSON.stringify(list).includes('outputTemplate'));
    for (const m of ['resources/list', 'resources/read']) {
      const r = await s.rpc(m, { uri: PERFECT_CITY_URI });
      assert.equal(r.error.code, -32601, m); assert.equal(r.result, undefined);
    }
    assert.ok(!('_meta' in toolList().find((x) => x.name === 'perfect_city_summary')), 'the REST face list never carries _meta');
  });
}

test('ON: perfect_city_summary gets its page link exactly where the other panel tools get theirs; every other tool and every word of the list is as it was', async () => {
  const off = server(undefined), on = server(ON);
  const a = (await off.rpc('tools/list', {})).result.tools, b = (await on.rpc('tools/list', {})).result.tools;
  assert.deepEqual(strip(b), strip(a), 'everything but _meta is identical (the tool list text is unchanged)');
  assert.deepEqual(b.filter((t) => '_meta' in t).map((t) => t.name).sort(), ['get_compilation_status', 'list_projects', 'perfect_city_summary', 'whoami_and_credits']);
  const t = b.find((x) => x.name === 'perfect_city_summary');
  assert.deepEqual(t._meta, { ui: { resourceUri: PERFECT_CITY_URI }, 'openai/outputTemplate': PERFECT_CITY_URI });
  assert.equal(UI_TOOL_URIS.perfect_city_summary, PERFECT_CITY_URI);
  assert.equal(UI_TOOL_URIS.get_compilation_status, COMPILATION_URI, 'the compilation panel keeps its own page');
  assert.equal(Object.keys(UI_TOOL_URIS).length, 4, 'no other tool was given a page');
  assert.equal(t.annotations.readOnlyHint, true);
  for (const n of ['list_perfect_city_options', 'open_perfect_city']) assert.ok(!('_meta' in b.find((x) => x.name === n)), n + ' has no page: it draws no numbers');
  const withAll = (await server({ ...ON, chatEditor: true, homePanel: true }).rpc('tools/list', {})).result.tools.find((x) => x.name === 'perfect_city_summary');
  assert.equal(withAll._meta.ui.resourceUri, PERFECT_CITY_URI, 'the panel never changes with the other switches');
});

test('ON: the tool answers exactly as it did (same text, same structured data, same error flag), for an answer, a refusal and a switch that is off', async () => {
  for (const [args, switches] of [[SUM, ['perfectCity']], [{ ...SUM, business_type: 'grocery', place: 'greene_oh' }, ['perfectCity']], [SUM, []]]) {
    const off = server(undefined, { switches }), on = server(ON, { switches });
    const [x, y] = await Promise.all([off, on].map(async (s) => (await s.rpc('tools/call', { name: 'perfect_city_summary', arguments: args })).result));
    assert.equal(y.content[0].text, x.content[0].text);
    assert.deepEqual(y.structuredContent, x.structuredContent);
    assert.equal(y.isError, x.isError);
  }
});

test('ON: the page is listed, readable at its address, as the app mime type, with no network and no frames, and within its byte cap', async () => {
  const s = server(ON);
  const l = (await s.rpc('resources/list', {})).result.resources;
  const mine = l.filter((r) => r.uri === PERFECT_CITY_URI);
  assert.equal(mine.length, 1); assert.equal(mine[0].mimeType, MCP_APP_MIME);
  assert.ok(l.some((r) => r.uri === CARD_URI) && l.some((r) => r.uri === COMPILATION_URI), 'the other pages are still listed');
  const r = (await s.rpc('resources/read', { uri: PERFECT_CITY_URI })).result.contents;
  assert.equal(r.length, 1); assert.equal(r[0].uri, PERFECT_CITY_URI); assert.equal(r[0].mimeType, MCP_APP_MIME);
  assert.equal(r[0].text, perfectCityHtml(APP));
  assert.deepEqual(r[0]._meta.ui, { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false, domain: DOMAIN });
  assert.ok(!('frameDomains' in r[0]._meta.ui.csp));
  assert.ok(Buffer.byteLength(r[0].text) <= PERFECT_CITY_MAX_BYTES, `${Buffer.byteLength(r[0].text)} bytes`);
  assert.equal(readResource(PERFECT_CITY_URI, { enabled: true, appUrl: APP }).contents[0].text, perfectCityHtml(APP));
  assert.ok(resourceList(undefined).some((x) => x.uri === PERFECT_CITY_URI));
});

test('ON: any other address is "does not exist" and is never echoed; an address of this page\'s own shape from an earlier build is answered with the CURRENT page', async () => {
  const s = server(ON);
  for (const uri of ['ui://ryagram/perfect-city', 'ui://ryagram/perfect-city-', 'ui://ryagram/perfect-city-xyz', 'ui://ryagram/perfect-city-0123456789AB', 'ui://ryagram/perfect-city-0123456789abc', 'ui://ryagram/Perfect-City-0123456789ab', 'ui://ryagram/perfectcity-0123456789ab', 'file:///etc/passwd', null, 7, [PERFECT_CITY_URI]]) {
    const r = await s.rpc('resources/read', { uri });
    assert.equal(r.error.code, -32002, JSON.stringify(uri)); assert.equal(r.error.message, 'That page does not exist.');
  }
  const old = 'ui://ryagram/perfect-city-000000000000';
  const c = (await s.rpc('resources/read', { uri: old })).result.contents[0];
  assert.equal(c.uri, old); assert.equal(c.text, perfectCityHtml(APP));
  assert.match(PERFECT_CITY_URI, /^ui:\/\/ryagram\/perfect-city-[0-9a-f]{12}$/); assert.equal(PERFECT_CITY_URI, 'ui://ryagram/perfect-city-' + PERFECT_CITY_BUILD);
  assert.ok(isPerfectCityUri(PERFECT_CITY_URI) && !isPerfectCityUri('ui://ryagram/card') && !isPerfectCityUri(COMPILATION_URI) && !isPerfectCityUri(5));
});

test('ON: the page is for signed-in connections only, like every resource', async () => {
  const s = server(ON);
  for (const token of ['', 'tok-wrong']) {
    const res = await s.post('resources/read', { uri: PERFECT_CITY_URI }, token);
    assert.equal(res.status, 401); assert.ok(!(await res.text()).includes('<html'));
  }
});

test('the page address is a build id of the page: a change to the page or its words changes it', () => {
  assert.notEqual(PERFECT_CITY_BUILD, '000000000000');
  assert.notEqual(PERFECT_CITY_URI, COMPILATION_URI);
  assert.equal(perfectCityHtml('').includes('data-app-url=""'), true);
  assert.notEqual(perfectCityHtml('').length, 0);
});

test('the config address is used only when it is a plain https address, and the page fragment is the Perfect City page the tools name', async () => {
  for (const bad of ['http://uselai.com/app/', 'javascript:alert(1)', 'https://uselai.com/app/" onload="x', "https://uselai.com/'><script>", 'https://', '//uselai.com/app/', 'https://user:pw@uselai.com/', 'https://uselai.com/a b', 'https://uselai.com/app/#/x']) {
    assert.match(perfectCityHtml(bad), /data-app-url=""/, bad);
  }
  assert.match(perfectCityHtml(APP), new RegExp(`data-app-url="${APP}"`));
  assert.equal(PERFECT_CITY_CARD_PAGE, '#/d/geo_intelligence'); assert.equal(PERFECT_CITY_CARD_PAGE, PERFECT_CITY_PAGE);
  const open = await server(ON).call('open_perfect_city', {});
  assert.equal(open.data.page, PERFECT_CITY_CARD_PAGE, 'open_perfect_city names the same page');
  const site = fs.readFileSync(new URL('../assets/app-departments.js', import.meta.url), 'utf8');
  assert.ok(site.includes('geo_intelligence'), 'the site knows the department the fragment names');
});

// ------------------------------------------------------------------------------------------------ the page itself
const HTML = perfectCityHtml(APP);
const SCRIPT = HTML.slice(HTML.indexOf('<script>') + 8, HTML.indexOf('</script>'));
const STYLE = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'));

test('the page is self-contained: one inline script, no network, no markup from text, no inline event, ES5, no framework', () => {
  assert.equal((HTML.match(/<script/g) || []).length, 1, 'one script, inline');
  const noUrl = HTML.replace(`data-app-url="${APP}"`, '');
  assert.ok(!/https?:\/\//i.test(noUrl) && !/\/\/[a-z]/i.test(noUrl.replace(/<\/?[a-z]/gi, '')), 'no address anywhere but the one config value');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'localStorage', 'sessionStorage', 'document.cookie', 'importScripts', 'import(', '<link', '@import', 'url(', ' src=', '<iframe', '<img', '<form', 'srcdoc', 'location', 'window.open', 'target=', 'ui/message', 'tools/call', 'setAttribute(\'on', 'javascript:']) {
    assert.ok(!HTML.includes(bad), `the page does not use ${bad}`);
  }
  assert.ok(!/\son[a-z]+\s*=/i.test(HTML.replace(SCRIPT, '')), 'no inline event handler in the markup');
  assert.ok(!/=>|\blet\b|\bconst\b|`|\bclass\s+\w|\basync\b|\bawait\b|\bPromise\b|\.\.\./.test(SCRIPT.replace(/'[^'\n]*'/g, "''")), 'ES5 only');
  new vm.Script(SCRIPT);                                                                                  // it parses
  assert.match(HTML, /<meta charset="utf-8">/); assert.match(HTML, /name="viewport" content="width=device-width,initial-scale=1"/);
  assert.ok(!/<meta[^>]+http-equiv/i.test(HTML), 'the page\'s limits come from the resource\'s own CSP (empty lists), not from a tag the host could ignore');
  assert.ok(!/[^\x00-\x7f]/.test(HTML), 'the page itself is plain ASCII: no invisible or look-alike character can hide in it');
});

test('the look: the connector\'s newer one (Georgia wordmark, 18px card, orange pill button with dark ink), a phone width with no sideways scroll, buttons at least 44px', () => {
  for (const x of ['font:400 24px/1 Georgia', 'border-radius:18px', 'background:#ff8a3d', 'color:#14141a', 'border-radius:999px', 'min-height:44px', 'max-width:640px', 'min-width:0', 'overflow-wrap:anywhere', '@media (max-width:360px)']) assert.ok(STYLE.includes(x), x);
  assert.ok(!/overflow-x\s*:\s*scroll|[;{]width:\s*\d{3,}px|min-width:\s*[1-9]\d{2,}px/.test(STYLE), 'nothing fixed wide');
  assert.ok(STYLE.includes('.row{display:grid;grid-template-columns:96px minmax(0,1fr)'), 'a long value can shrink');
  assert.ok(STYLE.includes('.tr{display:grid;grid-template-columns:52px minmax(0,1fr) minmax(0,1.3fr)'), 'the ring table columns can shrink');
  assert.ok(STYLE.includes('.tr{grid-template-columns:44px minmax(0,1fr) minmax(0,1.3fr)'), 'and also in the phone-width rule');
  assert.ok(STYLE.includes('.row{grid-template-columns:76px minmax(0,1fr)'));
  assert.ok(!/\bpx\s*;?\s*white-space\s*:\s*nowrap|white-space\s*:\s*nowrap/.test(STYLE), 'no line that cannot wrap');
});

// A tiny DOM: only what the page uses. innerHTML is a trap: setting it fails the test.
class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._t = ''; this.listeners = {}; this.attrs = {}; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._t; }
  set textContent(v) { this.children = []; this._t = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }
  getAttribute(n) { return this.attrs[n] ?? null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  set innerHTML(_v) { throw new Error('innerHTML was used'); }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}
function load(appUrl = APP) {
  const sent = [];
  const host = { postMessage: (m, target) => sent.push({ m: JSON.parse(JSON.stringify(m)), target }) };
  const other = { postMessage: () => assert.fail('wrote to a window that is not the host') };
  const root = new Node_('main'); const body = new Node_('body'); body.attrs['data-app-url'] = appUrl;
  let rect = { height: 120, width: 400 };
  const listeners = {};
  const win = { parent: host, addEventListener: (n, f) => { (listeners[n] ||= []).push(f); } };
  const doc = { getElementById: (id) => (id === 'pc' ? root : null), body, createElement: (t) => new Node_(t), documentElement: { getBoundingClientRect: () => rect } };
  vm.runInNewContext(SCRIPT, { window: win, document: doc, String, Array, Math, isFinite, Object }, { timeout: 2000 });
  const fire = (data, source = host) => listeners.message.forEach((f) => f({ source, data }));
  return { sent, host, other, root, fire, setRect: (r) => { rect = r; } };
}
const leaves = (root) => root.all().filter((n) => n.children.length === 0).map((n) => n.textContent);
const RESULT = (sc) => ({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'x' }], structuredContent: sc } });
const buttons = (root) => root.all().filter((n) => n.tag === 'button');
const rowOf = (root, k) => { const r = root.all().find((n) => n.className === 'row' && n.children[0].textContent === k); return r ? r.children[1].textContent : null; };
const loadedLine = (root) => (root.all().find((n) => n.className === 'loaded') || { textContent: null }).textContent;
const tableRows = (root) => root.all().filter((n) => n.className === 'tr').map((r) => r.children.map((c) => c.textContent));
const lists = (root) => root.all().filter((n) => n.tag === 'ul').map((u) => u.children.map((li) => li.textContent));
const heads = (root) => root.all().filter((n) => n.tag === 'h2').map((n) => n.textContent);
const hints = (root) => root.all().filter((n) => n.className === 'hint').map((n) => n.textContent);
const drawn = (sc) => { const p = load(); p.fire(RESULT(sc)); return p; };
const TAGS = ['main', 'div', 'span', 'h1', 'h2', 'p', 'ul', 'li', 'button'];

test('the page starts the handshake with its host, says it is ready after the answer, and reports its height (the host\'s size-changed)', async () => {
  const p = load();
  const init = p.sent.find((s) => s.m.method === 'ui/initialize');
  assert.ok(init); assert.equal(init.m.jsonrpc, '2.0'); assert.equal(typeof init.m.id, 'number'); assert.equal(init.m.params.protocolVersion, '2026-01-26');
  assert.ok(!p.sent.some((s) => s.m.method === 'ui/notifications/initialized'), 'not ready before the host answers');
  p.fire({ jsonrpc: '2.0', id: init.m.id, result: { protocolVersion: '2026-01-26', hostContext: {} } });
  assert.ok(p.sent.some((s) => s.m.method === 'ui/notifications/initialized'));
  const size = p.sent.filter((s) => s.m.method === 'ui/notifications/size-changed');
  assert.ok(size.length >= 1 && size.at(-1).m.params.height === 120 && size.at(-1).m.params.width === 400);
  p.setRect({ height: 520, width: 400 });
  p.fire(RESULT((await server(ON).call('perfect_city_summary')).data));
  assert.ok(p.sent.some((s) => s.m.method === 'ui/notifications/size-changed' && s.m.params.height === 520), 'a taller page is reported again');
  assert.deepEqual(leaves(p.root).slice(0, 2), ['Ryagram', 'Perfect City'], 'the wordmark heading');
});

// ------------------------------------------------------------------------------------------------ a full answer, drawn from what the TOOL returns
test('a full answer with places loaded: place, kind, spot, the count, the nearest places, a three-row ring table, the method once, what is not known, the credits, and one button', async () => {
  const s = server(ON);
  const r = await s.call('perfect_city_summary');
  assert.equal(r.isError, undefined, r.text);
  const p = drawn(r.data);
  assert.equal(rowOf(p.root, 'Place'), 'Montgomery County, Ohio (Dayton)');
  assert.equal(rowOf(p.root, 'Kind of business'), 'Fast food');
  assert.equal(rowOf(p.root, 'Spot'), '39.7589, -84.1916');
  assert.equal(loadedLine(p.root), 'Places of this kind loaded: 12 (calculated)');
  const [near, notKnown, credits] = lists(p.root);
  assert.deepEqual(near, ['1. 0.41 km (calculated)', '2. 0.93 km (calculated)', '3. 1.7 km (calculated)']);
  assert.deepEqual(tableRows(p.root), [
    ['Ring', 'Similar places', 'People about'],
    ['1 km', '2 (calculated)', 'not given for this ring (estimated)'],
    ['2 km', '3 (calculated)', 'not given for this ring (estimated)'],
    ['5 km', '9 (calculated)', 'about 61200 people (estimated)'],
  ]);
  assert.deepEqual(hints(p.root).filter((t) => /^How the people/.test(t)), ['How the people are estimated: ' + r.data.rings[2].people_about.method], 'the method sentence once');
  assert.deepEqual(notKnown, r.data.not_known); assert.deepEqual(credits, r.data.credits);
  assert.deepEqual(heads(p.root), ['Nearest places (straight line)', 'Within each ring around the spot', 'What this does not know', 'Where the data comes from']);
  assert.ok(hints(p.root).includes(PERFECT_CITY_CARD_WORDS.noscore));
  assert.deepEqual(buttons(p.root).map((b) => b.textContent), ['Open on the site']);
  assert.ok(p.root.all().every((n) => TAGS.includes(n.tag)), 'only the page\'s own kinds of element');
  // the panel is the tool's own answer: every number it draws is in the tool's text, next to the same word
  for (const piece of ['1. 0.41 km', '2. 0.93 km', '3. 1.7 km', '2 similar places (calculated)', '3 similar places (calculated)', '9 similar places (calculated)', 'about 61200 people (estimated)', 'Places of this kind loaded for Montgomery County, Ohio (Dayton): 12', '39.7589, -84.1916']) assert.ok(r.text.includes(piece), piece);
});

test('every number is drawn next to its basis word, and the word is the one the tool returned (calculated for counts and distances, estimated for people)', async () => {
  const { r } = await answer();
  const p = drawn(r.data);
  const numbered = [loadedLine(p.root), ...lists(p.root)[0], ...tableRows(p.root).slice(1).flatMap((x) => x.slice(1))];
  assert.equal(numbered.length, 1 + 3 + 6);
  for (const t of numbered) assert.match(t, /\((calculated|estimated|observed)\)$/, t);
  assert.ok(lists(p.root)[0].every((t) => /\(calculated\)$/.test(t)));
  assert.ok(tableRows(p.root).slice(1).every((x) => /\(calculated\)$/.test(x[1]) && /\(estimated\)$/.test(x[2])));
  // the word follows the data, never a fixed word: a word the tool did not return is not invented, and a word outside the three is not drawn
  const d = JSON.parse(JSON.stringify(r.data)); d.rings[2].people_about.basis = 'observed'; d.nearest[0].basis = 'estimated'; d.rings[0].places.basis = 'observed'; d.rings[1].places.basis = 'estimated';
  const q = drawn(d);
  assert.equal(tableRows(q.root)[3][2], 'about 61200 people (observed)'); assert.equal(lists(q.root)[0][0], '1. 0.41 km (estimated)');
  assert.deepEqual(tableRows(q.root).slice(1, 3).map((x) => x[1]), ['2 (observed)', '3 (estimated)'], 'the places word follows the data too');
});

test('the rings are the tool\'s three (1, 2 and 5 km), in order, as rows of a table with its own header', async () => {
  const { r } = await answer();
  const p = drawn(r.data);
  assert.deepEqual([...PC_RINGS_KM], [1, 2, 5]);
  assert.deepEqual(tableRows(p.root).slice(1).map((x) => x[0]), PC_RINGS_KM.map((k) => k + ' km'));
  const tbl = p.root.all().find((n) => n.getAttribute('role') === 'table');
  assert.ok(tbl && tbl.getAttribute('aria-label'), 'a labelled table');
  assert.deepEqual(tbl.children.map((row) => row.getAttribute('role')), ['row', 'row', 'row', 'row']);
  assert.deepEqual(tbl.children[0].children.map((c) => c.getAttribute('role')), ['columnheader', 'columnheader', 'columnheader']);
  assert.deepEqual(tbl.children[1].children.map((c) => c.getAttribute('role')), ['cell', 'cell', 'cell']);
});

test('the place and kind are the tool\'s own labels, for every place and kind the tool covers', async () => {
  for (const place of PC_PLACES) for (const kind of place.business_types) {
    const { r } = await answer((d) => d, { ...SUM, ...(place.id === 'greene_oh' ? { lat: 39.6, lon: -83.9 } : {}), place: place.id, business_type: kind });
    assert.equal(r.isError, undefined, r.text);
    const p = drawn(r.data);
    assert.equal(rowOf(p.root, 'Place'), place.label); assert.equal(rowOf(p.root, 'Kind of business'), PC_BUSINESS_TYPES.find((b) => b.id === kind).label);
    assert.ok(r.text.includes(rowOf(p.root, 'Place')) && r.text.includes(rowOf(p.root, 'Kind of business')), 'the tool says the same words');
  }
});

test('nothing is rounded, summed or repaired: a spot with many decimals, a distance, a people figure with a fraction, and a big count are drawn exactly as returned', () => {
  const D = { ok: true, looked_up: true, place: 'greene_oh', business_type: 'pizza', spot: { lat: 39.123456789, lon: -83.987654321 }, places_loaded: 1234567,
    nearest: [{ rank: 1, km: 0.4123456, basis: 'calculated' }, { rank: 2, km: 999.5, basis: 'calculated' }],
    rings: [{ km: 1, places: { value: 7, basis: 'calculated' }, people_about: { value: null, basis: 'estimated', note: 'n' } }, { km: 2, places: { value: 1234567, basis: 'calculated' }, people_about: { value: 0, basis: 'estimated', method: 'm' } },
      { km: 5, places: { value: 0, basis: 'calculated' }, people_about: { value: 61250.5, basis: 'estimated', method: 'm' } }], not_known: ['a'], credits: ['b'], score_given: false, ranking_given: false };
  const p = drawn(D);
  assert.equal(rowOf(p.root, 'Spot'), '39.123456789, -83.987654321');
  assert.equal(loadedLine(p.root), 'Places of this kind loaded: 1234567 (calculated)');
  assert.deepEqual(lists(p.root)[0], ['1. 0.4123456 km (calculated)', '2. 999.5 km (calculated)']);
  assert.deepEqual(tableRows(p.root).slice(1), [['1 km', '7 (calculated)', 'not given for this ring (estimated)'], ['2 km', '1234567 (calculated)', 'about 0 people (estimated)'], ['5 km', '0 (calculated)', 'about 61250.5 people (estimated)']]);
  assert.deepEqual(hints(p.root).filter((t) => /^How the/.test(t)), ['How the people are estimated: m'], 'the same method on two rings is said once');
});

test('two different methods are each said once', () => {
  const D = { ok: true, looked_up: true, place: 'greene_oh', business_type: 'pizza', spot: { lat: 39.5, lon: -83.9 }, places_loaded: 3, nearest: [],
    rings: [{ km: 1, places: { value: 1, basis: 'calculated' }, people_about: { value: 10, basis: 'estimated', method: 'first way' } }, { km: 2, places: { value: 2, basis: 'calculated' }, people_about: { value: 20, basis: 'estimated', method: 'second way' } },
      { km: 5, places: { value: 3, basis: 'calculated' }, people_about: { value: 30, basis: 'estimated', method: 'first way' } }], not_known: ['a'], credits: ['b'], score_given: false, ranking_given: false };
  const p = drawn(D);
  assert.deepEqual(hints(p.root).filter((t) => /^How the/.test(t)), ['How the people are estimated: first way', 'How the people are estimated: second way']);
  assert.deepEqual(hints(p.root).filter((t) => /^No nearest/.test(t)), [PERFECT_CITY_CARD_WORDS.nonear], 'places are loaded but none came back near the spot: said so');
});

test('no places of this kind loaded: the count says 0, the plain sentence is the tool\'s, there is no nearest list and no count of places, and the people numbers are still drawn', async () => {
  const { r } = await answer(noPlaces);
  assert.equal(r.isError, undefined, r.text); assert.equal(r.data.places_loaded, 0);
  const p = drawn(r.data);
  assert.equal(loadedLine(p.root), 'Places of this kind loaded: 0 (calculated)');
  assert.ok(hints(p.root).includes(PERFECT_CITY_CARD_WORDS.noload));
  assert.ok(r.text.includes(PERFECT_CITY_CARD_WORDS.noload), 'the tool says the same sentence');
  assert.ok(!heads(p.root).includes('Nearest places (straight line)'));
  assert.equal(lists(p.root).length, 2, 'only what is not known and the credits');
  assert.deepEqual(tableRows(p.root).slice(1).map((x) => x[1]), ['businesses not loaded', 'businesses not loaded', 'businesses not loaded']);
  assert.equal(tableRows(p.root)[3][2], 'about 61200 people (estimated)');
  assert.deepEqual(buttons(p.root).map((b) => b.textContent), ['Open on the site']);
  assert.ok(!/similar places/.test(p.root.textContent) && !/\(calculated\)\s*$/.test(lists(p.root)[0].join('')), 'no place count or distance is drawn');
  assert.ok(!p.root.textContent.includes('(calculated)') || /^Places of this kind loaded: 0 \(calculated\)/.test(loadedLine(p.root)));
});

test('no places loaded but a nearest place or a count in the data: not drawn at all', async () => {
  const { r } = await answer(noPlaces);
  const withNear = JSON.parse(JSON.stringify(r.data)); withNear.nearest = [{ rank: 1, km: 0.4, basis: 'calculated' }];
  const withCount = JSON.parse(JSON.stringify(r.data)); withCount.rings[0].places = { value: 2, basis: 'calculated' };
  for (const d of [withNear, withCount]) { const p = drawn(d); assert.deepEqual(leaves(p.root).slice(2), [PERFECT_CITY_CARD_WORDS.none]); assert.equal(buttons(p.root).length, 0); }
});

// ------------------------------------------------------------------------------------------------ refused states, said in plain words
test('the switch is off: the tool\'s own owner-only sentence, nothing else, and no button', async () => {
  const s = server(ON, { switches: ['compilations'] });
  const r = await s.call('perfect_city_summary');
  assert.equal(r.isError, true); assert.equal(r.code, 'not_available'); assert.equal(r.text, PC_OFF_WORDS);
  const p = drawn(r.data);
  assert.deepEqual(leaves(p.root).slice(2), [PC_OFF_WORDS]); assert.equal(PERFECT_CITY_CARD_WORDS.off, r.text);
  assert.equal(buttons(p.root).length, 0); assert.equal(tableRows(p.root).length, 0); assert.equal(lists(p.root).length, 0);
});

test('the account\'s switches cannot be read just now: the tool\'s sentence, no numbers, no button', async () => {
  const s = server(ON);
  const r = await s.call('perfect_city_summary', SUM, { switches: async () => { throw new Error('boom'); } });
  assert.equal(r.isError, true); assert.equal(r.code, 'unavailable');
  const p = drawn(r.data);
  assert.deepEqual(leaves(p.root).slice(2), [r.text]); assert.equal(r.text, PERFECT_CITY_CARD_WORDS.gate);
  assert.equal(buttons(p.root).length, 0);
});

test('the daily cap (the database\'s 54000): a plain sentence for the person, none of the database\'s numbers, no button', async () => {
  const s = server(ON);
  const r = await s.call('perfect_city_summary', SUM, { perfectCitySummary: async () => { throw err('Perfect City has answered 300 questions for this account today, the most it gives in a day. Try again tomorrow.', '54000'); } });
  assert.equal(r.code, 'rate'); assert.equal(r.data.retry_after_seconds, 86400);
  const p = drawn(r.data);
  assert.deepEqual(leaves(p.root).slice(2), [PERFECT_CITY_CARD_WORDS.daily]);
  assert.match(PERFECT_CITY_CARD_WORDS.daily, /^Perfect City has answered all it gives this account for today\./);
  assert.ok(r.text.startsWith('Perfect City has answered all it gives this account for today.'), 'the tool starts with the same words');
  assert.ok(!/300/.test(p.root.textContent)); assert.equal(buttons(p.root).length, 0);
});

test('the hourly limit: its own sentence (no number the tool did not return in its data), no button', async () => {
  const s = server(ON);
  s.w.counters.set(A.userId + '|perfect_city', LIMITS.perfectCitySummariesPerHourPerUser);
  const r = await s.call('perfect_city_summary');
  assert.equal(r.code, 'rate'); assert.equal(r.data.retry_after_seconds, 3600);
  const p = drawn(r.data);
  assert.deepEqual(leaves(p.root).slice(2), [PERFECT_CITY_CARD_WORDS.hourly]); assert.ok(!/\d/.test(PERFECT_CITY_CARD_WORDS.hourly));
  assert.equal(buttons(p.root).length, 0);
});

test('not available just now, a kind not covered, a spot outside the county, a database error: one plain sentence that sends the person to the conversation, no button, nothing claimed that the tool did not say', async () => {
  const s = server(ON);
  const cases = [
    await s.call('perfect_city_summary', SUM, { perfectCitySummary: undefined }),
    await s.call('perfect_city_summary', { ...SUM, place: 'greene_oh', business_type: 'grocery' }),
    await s.call('perfect_city_summary', SUM, { perfectCitySummary: async () => { throw err('That spot is outside the county.', '22023'); } }),
    await s.call('perfect_city_summary', SUM, { perfectCitySummary: async () => { throw err('Not available yet.', 'PT503'); } }),
    await s.call('perfect_city_summary', { ...SUM, place: 'nowhere_xx' }),
  ];
  for (const r of cases) {
    assert.equal(r.isError, true); assert.equal(r.data.ok, false); assert.equal(r.data.looked_up, false);
    const p = drawn(r.data);
    assert.deepEqual(leaves(p.root).slice(2), [PERFECT_CITY_CARD_WORDS.other], r.text);
    assert.ok(/Nothing was looked up/.test(PERFECT_CITY_CARD_WORDS.other) && /conversation above/.test(PERFECT_CITY_CARD_WORDS.other));
    assert.ok(/Nothing was looked up/.test(r.text), 'the tool says it too');
    assert.equal(buttons(p.root).length, 0); assert.equal(tableRows(p.root).length, 0);
  }
});

test('an answer the tool itself refused as not in its shape has no structured data: "Numbers not available"', async () => {
  const s = server(ON);
  s.w.perfectCityAnswer = (q) => ({ ...madeUpPerfectCityAnswer(q), not_known: [] });
  const r = await s.call('perfect_city_summary');
  assert.equal(r.code, 'bad_report'); assert.equal(r.data, undefined);
  const p = load(); p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: r.text }] } });
  assert.deepEqual(leaves(p.root).slice(2), [PERFECT_CITY_CARD_WORDS.none]); assert.equal(buttons(p.root).length, 0);
});

// ------------------------------------------------------------------------------------------------ anything else is not drawn
async function broken() {
  const { r } = await answer();
  const base = r.data;
  const mut = (f) => { const d = JSON.parse(JSON.stringify(base)); f(d); return [f.toString().replace(/^\(?d\)?\s*=>\s*/, '').slice(0, 70), d]; };
  return [
    mut((d) => { delete d.not_known; }), mut((d) => { d.not_known = []; }), mut((d) => { d.not_known = ['']; }), mut((d) => { d.not_known = 'x'; }), mut((d) => { d.not_known = new Array(13).fill('x'); }), mut((d) => { d.not_known = [7]; }),
    mut((d) => { delete d.credits; }), mut((d) => { d.credits = []; }),
    mut((d) => { d.rings = d.rings.slice(0, 2); }), mut((d) => { d.rings[1].km = 3; }), mut((d) => { d.rings.reverse(); }), mut((d) => { d.rings = null; }), mut((d) => { d.rings[0] = 'x'; }),
    mut((d) => { d.rings[0].places.basis = 'guess'; }), mut((d) => { d.rings[0].places.basis = 'constructor'; }), mut((d) => { delete d.rings[0].places.basis; }), mut((d) => { d.rings[2].people_about.basis = 'sure'; }),
    mut((d) => { d.rings[0].places.value = 2.5; }), mut((d) => { d.rings[0].places.value = -1; }), mut((d) => { d.rings[0].places.value = '2'; }), mut((d) => { d.rings[0].places.value = null; }), mut((d) => { d.rings[0].places.value = 1e8; }), mut((d) => { d.rings.push(JSON.parse(JSON.stringify(d.rings[2]))); }), mut((d) => { d.rings[0].places = null; }),
    mut((d) => { d.rings[2].people_about.value = '61200'; }), mut((d) => { d.rings[2].people_about.value = -5; }), mut((d) => { d.rings[2].people_about.value = 1e11; }), mut((d) => { delete d.rings[2].people_about.method; }), mut((d) => { d.rings[2].people_about = null; }),
    mut((d) => { delete d.rings[2].people_about.value; }),
    mut((d) => { d.nearest[0].basis = 'maybe'; }), mut((d) => { d.nearest.reverse(); }), mut((d) => { d.nearest[0].rank = 2; }), mut((d) => { delete d.nearest[0].rank; }), mut((d) => { d.nearest = new Array(6).fill(0).map((_, i) => ({ rank: i + 1, km: i, basis: 'calculated' })); }),
    mut((d) => { d.nearest[0].km = '0.4'; }), mut((d) => { d.nearest[0].km = -1; }), mut((d) => { d.nearest[0].name = 5; }), mut((d) => { d.nearest = 'x'; }), mut((d) => { d.nearest[1] = null; }),
    mut((d) => { d.score_given = true; }), mut((d) => { d.ranking_given = true; }), mut((d) => { delete d.score_given; }), mut((d) => { delete d.ranking_given; }),
    mut((d) => { d.place = 'nowhere_xx'; }), mut((d) => { d.place = 'toString'; }), mut((d) => { d.business_type = 'constructor'; }), mut((d) => { delete d.business_type; }),
    mut((d) => { d.spot.lat = 91; }), mut((d) => { d.spot.lon = -181; }), mut((d) => { d.spot.lon = 'x'; }), mut((d) => { delete d.spot; }), mut((d) => { d.spot = []; }),
    mut((d) => { d.places_loaded = 1.5; }), mut((d) => { d.places_loaded = 1e8; }), mut((d) => { d.nearest[0].km = 2.5; }), mut((d) => { d.places_loaded = -1; }), mut((d) => { d.places_loaded = '12'; }), mut((d) => { d.places_loaded = { count: 12, basis: 'calculated' }; }),
    mut((d) => { d.ok = 'true'; }), mut((d) => { delete d.ok; }), mut((d) => { d.looked_up = false; }), mut((d) => { delete d.looked_up; }),
  ];
}

const CASES = await broken();
test('there are more than fifty broken answers below, each its own test', () => assert.ok(CASES.length >= 50, String(CASES.length)));
for (const [name, d] of CASES) {
  test(`a changed answer is "Numbers not available", never drawn: ${name}`, () => {
    const p = drawn(d);
    assert.deepEqual(leaves(p.root).slice(2), [PERFECT_CITY_CARD_WORDS.none]);
    assert.equal(buttons(p.root).length, 0, 'nothing to press when there is nothing to draw');
    assert.equal(tableRows(p.root).length + lists(p.root).length, 0);
  });
}

test('data that is not an object, and results with no data, are "Numbers not available"', () => {
  for (const sc of [undefined, null, 'text', 7, [], [{ ok: true }], {}, { ok: true }, { ok: false }, { ok: 'false', looked_up: false }, { looked_up: true }]) {
    const p = drawn(sc);
    assert.deepEqual(leaves(p.root).slice(2), [PERFECT_CITY_CARD_WORDS.none], JSON.stringify(sc)); assert.equal(buttons(p.root).length, 0);
  }
  const p = load(); p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {} });
  assert.deepEqual(leaves(p.root).slice(2), [PERFECT_CITY_CARD_WORDS.none]);
});

test('a refusal shape the panel does not know is never turned into a stronger claim: ok false alone, or a switch word that is not ours, says nothing about the switch', () => {
  assert.deepEqual(leaves(drawn({ ok: false }).root).slice(2), [PERFECT_CITY_CARD_WORDS.none]);
  for (const sc of [{ ok: false, looked_up: false, switch: 'games', on: false, owner_only: true }, { ok: false, looked_up: false, on: false }, { ok: false, looked_up: false, owner_only: true }, { ok: false, looked_up: false, retry_after_seconds: 5 }, { ok: false, looked_up: false, switch: 'perfectCity' }, { ok: false, looked_up: false, switch: 'perfectCity', on: false }, { ok: false, looked_up: false, switch: 'perfectCity', owner_only: true }]) {
    const t = leaves(drawn(sc).root).slice(2);
    assert.deepEqual(t, [PERFECT_CITY_CARD_WORDS.other], JSON.stringify(sc));
  }
  assert.deepEqual(leaves(drawn({ ok: false, available: false, switch: 'games' }).root).slice(2), [PERFECT_CITY_CARD_WORDS.none], 'an unavailable-switch answer for another switch is not drawn');
});

// ------------------------------------------------------------------------------------------------ hostile words stay text
test('a business name that comes through the real tool stays text, in quotes, with one line that says names are plain text; a name the tool itself refuses to pass on is drawn as the tool says', async () => {
  const odd = 'Joe\'s "onerror=alert(1)" &lt;b&gt; {x} ${x}';
  const { r } = await answer((d) => ({ ...d, nearest: d.nearest.map((n, i) => (i === 0 ? { ...n, name: odd } : i === 1 ? { ...n, name: '<img src=x onerror=alert(1)>' } : n)) }));
  assert.equal(r.isError, undefined, r.text);
  const p = drawn(r.data);
  assert.equal(lists(p.root)[0][0], '1. ' + Q1 + odd + Q2 + ': 0.41 km (calculated)', 'an entity is not decoded: it stays the characters it was');
  assert.equal(lists(p.root)[0][1], '2. ' + Q1 + '(name not shown)' + Q2 + ': 0.93 km (calculated)', 'the tool passes on no markup: it says the name is not shown');
  assert.equal(lists(p.root)[0][2], '3. 1.7 km (calculated)', 'a place with no name is drawn with rank and km only');
  assert.ok(hints(p.root).includes(PERFECT_CITY_CARD_WORDS.names));
  assert.ok(p.root.all().every((n) => TAGS.includes(n.tag)), 'only the page\'s own kinds of element');
  assert.equal(buttons(p.root).length, 1);
  const none = (await answer()).r; assert.ok(!hints(drawn(none.data).root).includes(PERFECT_CITY_CARD_WORDS.names), 'no names, no line about names');
});

test('names, sentences and credits from the data are only ever TEXT: control and direction characters are removed, a name is cut at 80, a sentence at 600, and nothing becomes an element', async () => {
  const { r } = await answer();
  const d = JSON.parse(JSON.stringify(r.data));
  d.nearest[0].name = 'a\u0000b\u202ec\u2066d\u200fe\u009ff\ng' + 'z'.repeat(500);
  d.not_known = ['<b>bold</b> & &lt;i&gt;', 'k\u202ex'.repeat(2) + 'y'.repeat(900)];
  d.credits = ['<img src=x onerror=alert(1)>'];
  d.rings[2].people_about.method = '<script>alert(3)</script> ' + 'm'.repeat(900);
  const p = drawn(d);
  const near = lists(p.root)[0][0];
  assert.ok(near.includes('a b c d e f g'), near); assert.ok(near.includes('z'.repeat(67)) && !near.includes('z'.repeat(68)), 'cut at 80 characters');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f]/.test(p.root.textContent), 'no control or direction character is drawn');
  const [notKnown, credits] = lists(p.root).slice(1);
  assert.equal(notKnown[0], '<b>bold</b> & &lt;i&gt;', 'markup and entities stay the characters they were');
  assert.equal(notKnown[1].length, 600); assert.equal(credits[0], '<img src=x onerror=alert(1)>');
  const m = hints(p.root).find((t) => /^How the people/.test(t));
  assert.equal(m, 'How the people are estimated: ' + ('<script>alert(3)</script> ' + 'm'.repeat(900)).slice(0, 600));
  assert.ok(p.root.all().every((n) => TAGS.includes(n.tag)));
});

test('a name that is empty or not text in the data is drawn the way the tool draws it: an empty one as "no name in the map data", markup planted in the data as plain text', async () => {
  const { r } = await answer((d) => ({ ...d, nearest: d.nearest.map((n, i) => (i === 0 ? { ...n, name: 'Caf\u00e9 One' } : i === 1 ? { ...n, name: '' } : n)) }));
  assert.equal(r.isError, undefined, r.text);
  const p = drawn(r.data);
  assert.equal(lists(p.root)[0][0], '1. ' + Q1 + 'Caf\u00e9 One' + Q2 + ': 0.41 km (calculated)');
  assert.equal(lists(p.root)[0][1], '2. ' + Q1 + '(no name in the map data)' + Q2 + ': 0.93 km (calculated)');
  const d = JSON.parse(JSON.stringify(r.data)); d.nearest[0].name = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const q = drawn(d);
  assert.equal(lists(q.root)[0][0], '1. ' + Q1 + '<img src=x onerror=alert(1)><script>alert(2)</script>' + Q2 + ': 0.41 km (calculated)');
  assert.ok(q.root.all().every((n) => TAGS.includes(n.tag)));
});

// ------------------------------------------------------------------------------------------------ messages
test('only the host is listened to, and only proper messages', async () => {
  const { r } = await answer();
  const p = load();
  p.fire(RESULT(r.data));
  const first = p.root.textContent;
  const other = JSON.parse(JSON.stringify(r.data)); other.rings[2].people_about.value = 999;
  p.fire(RESULT(other), p.other); p.fire({ ...RESULT(other), jsonrpc: '1.0' }); p.fire('a string'); p.fire(null); p.fire([RESULT(other)]); p.fire({ jsonrpc: '2.0', method: 7 });
  assert.equal(p.root.textContent, first);
  const before = p.sent.length; p.fire({ jsonrpc: '2.0', id: 99, result: {} }, p.other); assert.equal(p.sent.length, before);
});

test('the host\'s teardown request is answered, any other request is refused the JSON-RPC way, an unknown notification is ignored', () => {
  const p = load(); const n = p.sent.length;
  p.fire({ jsonrpc: '2.0', id: 7, method: 'ui/resource-teardown', params: { reason: 'closed' } });
  p.fire({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'perfect_city_summary' } });
  p.fire({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } });
  const out = p.sent.slice(n).map((s) => s.m);
  assert.deepEqual(out.find((m) => m.id === 7), { jsonrpc: '2.0', id: 7, result: {} });
  assert.equal(out.find((m) => m.id === 8).error.code, -32601);
  assert.equal(out.length, 2);
});

// ------------------------------------------------------------------------------------------------ the one button
test('the one button opens exactly the app address plus the fixed Perfect City fragment, and nothing the data says can change it', async () => {
  const { r } = await answer();
  const p = drawn(r.data);
  const b = buttons(p.root); assert.equal(b.length, 1); assert.equal(b[0].textContent, 'Open on the site'); assert.equal(b[0].type, 'button');
  b[0].listeners.click[0]();
  const open = p.sent.filter((s) => s.m.method === 'ui/open-link');
  assert.equal(open.length, 1); assert.deepEqual(open[0].m.params, { url: APP + '#/d/geo_intelligence' });
  assert.equal(open[0].target, '*');
  const steer = { ...JSON.parse(JSON.stringify(r.data)), url: 'https://evil.example/', page: '#/evil', link: 'https://evil.example/', open_url: 'https://evil.example/', app_url: 'https://evil.example/' };
  steer.nearest[0].name = 'https://evil.example/x'; steer.nearest[0].url = 'https://evil.example/'; steer.credits = ['https://evil.example/', '#/d/games'];
  const q = drawn(steer);
  buttons(q.root).forEach((x) => x.listeners.click[0]());
  assert.deepEqual(q.sent.filter((s) => s.m.method === 'ui/open-link').map((s) => s.m.params), [{ url: APP + '#/d/geo_intelligence' }]);
  const z = load(''); z.fire(RESULT(r.data));
  assert.equal(buttons(z.root).length, 0, 'a body whose address is not a plain https one (the page builder never writes one) gets no button');
});

test('a host that will not open the link: the address is said in words, once, as an alert; a host that opens it says nothing more', async () => {
  const { r } = await answer();
  const p = drawn(r.data);
  buttons(p.root)[0].listeners.click[0]();
  const id = p.sent.find((s) => s.m.method === 'ui/open-link').m.id;
  p.fire({ jsonrpc: '2.0', id, result: {} });
  assert.ok(!leaves(p.root).some((t) => /did not open/.test(t)), 'opened: nothing more is said');
  buttons(p.root)[0].listeners.click[0]();
  const id2 = p.sent.filter((s) => s.m.method === 'ui/open-link')[1].m.id;
  p.fire({ jsonrpc: '2.0', id: id2, error: { code: -32000, message: 'nope' } });
  assert.deepEqual(leaves(p.root).filter((t) => /did not open/.test(t)), ['Your chat app did not open it. Open this address in your browser: ' + APP + '#/d/geo_intelligence']);
  assert.equal(p.root.all().find((n) => n.getAttribute('role') === 'alert').tag, 'p');
  buttons(p.root)[0].listeners.click[0]();
  const id3 = p.sent.filter((s) => s.m.method === 'ui/open-link')[2].m.id;
  p.fire({ jsonrpc: '2.0', id: id3, result: { isError: true } });
  assert.equal(leaves(p.root).filter((t) => /did not open/.test(t)).length, 1, 'said once');
});

test('the page asks its host for nothing but the handshake, its size and that one link; no message carries a name, a number or a sentence from the answer', async () => {
  const { r } = await answer((d) => ({ ...d, nearest: d.nearest.map((n, i) => (i === 0 ? { ...n, name: 'secret-name' } : n)), credits: ['secret-credit'] }));
  const p = load();
  p.setRect({ height: 700, width: 400 });
  p.fire(RESULT(r.data));
  buttons(p.root).forEach((b) => b.listeners.click[0]());
  assert.deepEqual([...new Set(p.sent.map((s) => s.m.method))].sort(), ['ui/initialize', 'ui/notifications/size-changed', 'ui/open-link']);
  for (const s of p.sent) assert.equal(s.m.jsonrpc, '2.0');
  const wire = JSON.stringify(p.sent.map((s) => s.m));
  for (const x of ['secret-name', 'secret-credit', '61200', '0.41', '39.7589', 'Montgomery']) assert.ok(!wire.includes(x), x);
});

// ------------------------------------------------------------------------------------------------ the words
test('the words the panel adds say nothing about price, credit, free, a date, a verdict or advice', () => {
  const added = [...Object.values(PERFECT_CITY_CARD_WORDS).filter((w) => w !== PC_OFF_WORDS), ...SCRIPT.match(/'[^'\n]{8,}'/g).filter((x) => x !== "'2026-01-26'")].join('\n');
  for (const bad of [/\$\s?\d/, /\bcredit/i, /\bfree\b/i, /\b20\d\d\b/, /\bprice/i, /\bbest\b|\bideal\b|\bprofitable\b|\bsuccess|\brecommend|\bwill do well|\bshould\b|\bpredict/i, /\bpaid\b|\bcost/i]) assert.ok(!bad.test(added), String(bad));
  assert.match(PERFECT_CITY_CARD_WORDS.noscore, /no score and no ranking/);
  for (const w of Object.values(PERFECT_CITY_CARD_WORDS)) assert.ok(!/[^\x00-\x7f]/.test(w) || w === PC_OFF_WORDS, w);
});

test('every basis word the page can draw is one of the three the tool uses, and every place and kind label in the page is the tool\'s own', () => {
  assert.ok(SCRIPT.includes('var BASIS={observed:1,calculated:1,estimated:1};'));
  for (const p of PC_PLACES) assert.ok(SCRIPT.includes(JSON.stringify(p.label)), p.id);
  for (const b of PC_BUSINESS_TYPES) assert.ok(SCRIPT.includes(JSON.stringify(b.label)), b.id);
  assert.ok(SCRIPT.includes('var PAGE="#/d/geo_intelligence"'));
});
