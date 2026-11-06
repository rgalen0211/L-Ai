// Ryagram inside the AI chat, step 1: the inline Ryagram card (CONNECT, 2026-11-05; plan: Ryagram-logs/proposals/CONNECT-MCP-APP-PLAN-1105.md).
// Offline, against the connector's own code and its stand-in world, plus the card page run in a tiny fake DOM (the real-browser check is tools/check-mcp-app-card.py).
// Must-fails are in tests/connect_mcp_app_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp, toolList } from '../supabase/functions/connect-core/mcp.ts';
import { CARD_MAX_BYTES, CARD_URI, MCP_APP_MIME, UI_TOOL_URIS, cardHtml, claudeUiDomain } from '../supabase/functions/connect-core/mcp_app.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const APP = 'https://uselai.com/app/';
const DOMAIN = 'c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com';

function server(mcpApp) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId, ['read', 'write', 'render_free']);
  w.issue('tok-a', A);
  const deps = { data: null, policy: w.policy(), deps: { compile }, verifyToken: w.verifyToken, dataFor: () => w.data(A.userId), resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource', ...(mcpApp === undefined ? {} : { mcpApp }) };
  const post = (method, params, token = 'tok-a') => handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps);
  const rpc = async (method, params, token) => JSON.parse(await (await post(method, params, token)).text());
  return { w, rpc, post };
}
const ON = { enabled: true, uiDomain: DOMAIN, appUrl: APP };
const strip = (tools) => tools.map(({ _meta, ...t }) => t);

// ------------------------------------------------------------------------------------------------ OFF is the connector as it was
for (const [name, cfg] of [['no setting at all', undefined], ['enabled: false', { enabled: false, uiDomain: DOMAIN, appUrl: APP }]]) {
  test(`OFF (${name}): the same capabilities, no _meta on any tool, and no resources`, async () => {
    const s = server(cfg);
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
    const list = (await s.rpc('tools/list', {})).result.tools;
    assert.equal(list.length, toolList().length);
    assert.ok(list.length > 10);
    assert.ok(list.every((t) => !('_meta' in t)), 'no tool carries _meta');
    assert.ok(!JSON.stringify(list).includes('ui://') && !JSON.stringify(list).includes('outputTemplate'));
    for (const m of ['resources/list', 'resources/read']) {
      const r = await s.rpc(m, { uri: CARD_URI });
      assert.equal(r.error.code, -32601, m);
      assert.match(r.error.message, /Method not found/);
      assert.equal(r.result, undefined);
    }
    assert.ok(toolList().every((t) => !('_meta' in t)), 'the REST face list is unchanged');
  });
}

// ------------------------------------------------------------------------------------------------ ON: what is added, and only that
test('ON: the server says it has resources, and the tool list is the same list plus _meta on exactly the two card tools', async () => {
  const off = server(undefined), on = server(ON);
  const init = await on.rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false }, resources: {} });
  const a = (await off.rpc('tools/list', {})).result.tools, b = (await on.rpc('tools/list', {})).result.tools;
  assert.deepEqual(strip(b), strip(a), 'everything but _meta is identical');
  const withMeta = b.filter((t) => '_meta' in t).map((t) => t.name).sort();
  assert.deepEqual(withMeta, ['list_projects', 'whoami_and_credits']);
  for (const t of b.filter((x) => x._meta)) assert.deepEqual(t._meta, { ui: { resourceUri: CARD_URI }, 'openai/outputTemplate': CARD_URI });
  assert.deepEqual(Object.keys(UI_TOOL_URIS).sort(), withMeta);
  assert.ok(toolList().every((t) => !('_meta' in t)), 'the REST face list never carries _meta');
});

test('ON: a tool answers exactly as it did (same text, same structured data)', async () => {
  const off = server(undefined), on = server(ON);
  for (const name of ['whoami_and_credits', 'list_projects']) {
    const x = (await off.rpc('tools/call', { name, arguments: {} })).result, y = (await on.rpc('tools/call', { name, arguments: {} })).result;
    assert.deepEqual(y, x, name);
  }
});

test('ON: one page is listed, and reading it gives the card with no network and no border', async () => {
  const s = server(ON);
  const l = (await s.rpc('resources/list', {})).result.resources;
  assert.deepEqual(l.map((r) => [r.uri, r.mimeType]), [[CARD_URI, MCP_APP_MIME]]);
  const r = (await s.rpc('resources/read', { uri: CARD_URI })).result.contents;
  assert.equal(r.length, 1);
  assert.equal(r[0].uri, CARD_URI); assert.equal(r[0].mimeType, 'text/html;profile=mcp-app');
  assert.equal(r[0].text, cardHtml(APP));
  assert.deepEqual(r[0]._meta.ui, { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false, domain: DOMAIN });
  assert.ok(!('frameDomains' in r[0]._meta.ui.csp), 'no frames');
});

test('ON: the sandbox domain is left out unless it has the exact form, and the page address unless it is a plain https address', async () => {
  for (const bad of ['evil.example.com', `${DOMAIN}.evil.com`, `x${DOMAIN}`, '', DOMAIN.toUpperCase(), 'c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com/x']) {
    const s = server({ enabled: true, uiDomain: bad, appUrl: APP });
    const c = (await s.rpc('resources/read', { uri: CARD_URI })).result.contents[0];
    assert.ok(!('domain' in c._meta.ui), `domain "${bad}" is not used`);
  }
  for (const bad of ['http://uselai.com/app/', 'javascript:alert(1)', 'https://uselai.com/app/" onload="x', "https://uselai.com/'><script>", 'https://', '//uselai.com/app/', 'https://user:pw@uselai.com/', 'https://uselai.com/a b']) {
    assert.match(cardHtml(bad), /data-app-url=""/, bad);
  }
  assert.match(cardHtml(APP), new RegExp(`data-app-url="${APP}"`));
});

test('ON: any other page, or a request for the page without a proper address, is "does not exist" and the address is never echoed', async () => {
  const s = server(ON);
  for (const uri of ['ui://ryagram/editor', 'ui://ryagram/card/', 'ui://ryagram/CARD', 'file:///etc/passwd', 'https://evil.example/x', '../card', '', null, 7, { a: 1 }, ['ui://ryagram/card']]) {
    const r = await s.rpc('resources/read', { uri });
    assert.equal(r.error.code, -32002, JSON.stringify(uri));
    assert.equal(r.error.message, 'That page does not exist.');
    assert.equal(r.result, undefined);
  }
  const none = await s.rpc('resources/read', undefined);
  assert.equal(none.error.code, -32002);
});

test('ON: resources are for signed-in connections only, exactly like tools (no token, a wrong token: 401 with the sign-in challenge)', async () => {
  const s = server(ON);
  for (const token of ['', 'tok-wrong']) {
    for (const m of ['resources/list', 'resources/read', 'tools/list']) {
      const res = await s.post(m, { uri: CARD_URI }, token);
      assert.equal(res.status, 401, `${m} with token "${token}"`);
      assert.match(res.headers.get('www-authenticate') ?? '', /resource_metadata=/);
      assert.ok(!(await res.text()).includes('<html'), 'no page is sent');
    }
  }
});

test('the claude domain follows Claude\'s documented rule (the example in their guide)', async () => {
  assert.equal(await claudeUiDomain('https://example.com/mcp'), DOMAIN);
  assert.notEqual(await claudeUiDomain('https://example.com/mcp/'), DOMAIN, 'the exact address matters');
});

// ------------------------------------------------------------------------------------------------ the page itself
const HTML = cardHtml(APP);
const SCRIPT = HTML.slice(HTML.indexOf('<script>') + 8, HTML.indexOf('</script>'));

test('the page is small, self-contained and makes no request', () => {
  assert.ok(Buffer.byteLength(HTML) <= CARD_MAX_BYTES, `${Buffer.byteLength(HTML)} bytes is over the ${CARD_MAX_BYTES} budget`);
  assert.equal((HTML.match(/<script/g) || []).length, 1, 'one script, inline');
  const noUrl = HTML.replace(`data-app-url="${APP}"`, '');
  assert.ok(!/https?:\/\//i.test(noUrl) && !/\/\/[a-z]/i.test(noUrl.replace(/<\/?[a-z]/gi, '')), 'no address anywhere but the one config value');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'localStorage', 'sessionStorage', 'document.cookie', 'importScripts', 'import(', '<link', '@import', 'url(', ' src=', '<iframe', '<img', '<form', 'srcdoc', 'location', 'window.open', 'target=']) {
    assert.ok(!HTML.includes(bad), `the page does not use ${bad}`);
  }
  assert.match(HTML, /<meta charset="utf-8">/);
  assert.match(HTML, /name="viewport"/);
});

// A tiny DOM: only what the card uses. innerHTML is a trap: setting it fails the test.
class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._t = ''; this.listeners = {}; this.attrs = {}; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._t; }
  set textContent(v) { this.children = []; this._t = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }
  getAttribute(n) { return this.attrs[n] ?? null; }
  set innerHTML(_v) { throw new Error('innerHTML was used'); }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}
function load(appUrl = APP) {
  const sent = [];
  const host = { postMessage: (m, target) => sent.push({ m: JSON.parse(JSON.stringify(m)), target }) };
  const other = { postMessage: () => assert.fail('wrote to a window that is not the host') };
  const card = new Node_('main'); const body = new Node_('body'); body.attrs['data-app-url'] = appUrl;
  let rect = { height: 120, width: 400 };
  const listeners = {};
  const win = { parent: host, addEventListener: (n, f) => { (listeners[n] ||= []).push(f); } };
  const doc = { getElementById: (id) => (id === 'card' ? card : null), body, createElement: (t) => new Node_(t), documentElement: { getBoundingClientRect: () => rect } };
  vm.runInNewContext(SCRIPT, { window: win, document: doc }, { timeout: 2000 });
  const fire = (data, source = host) => listeners.message.forEach((f) => f({ source, data }));
  return { sent, host, other, card, fire, setRect: (r) => { rect = r; } };
}
const texts = (card) => card.all().filter((n) => n.children.length === 0).map((n) => n.textContent);
const RESULT = (sc) => ({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'x' }], structuredContent: sc } });

test('the page starts the handshake with its host, says it is ready after the answer, and reports its height', () => {
  const p = load();
  const init = p.sent.find((s) => s.m.method === 'ui/initialize');
  assert.ok(init, 'asks the host to initialize'); assert.equal(init.m.jsonrpc, '2.0'); assert.equal(typeof init.m.id, 'number');
  assert.equal(init.m.params.protocolVersion, '2026-01-26');
  assert.ok(!p.sent.some((s) => s.m.method === 'ui/notifications/initialized'), 'not ready before the host answers');
  p.fire({ jsonrpc: '2.0', id: init.m.id, result: { protocolVersion: '2026-01-26', hostContext: {} } });
  assert.ok(p.sent.some((s) => s.m.method === 'ui/notifications/initialized'));
  const size = p.sent.filter((s) => s.m.method === 'ui/notifications/size-changed');
  assert.ok(size.length >= 1 && size.at(-1).m.params.height === 120 && size.at(-1).m.params.width === 400);
});

test('before any result the card still says what it is, and with a result that has nothing to show it points to the conversation', () => {
  const p = load();
  assert.ok(texts(p.card).includes('Ryagramming'));
  p.fire(RESULT({}));
  assert.ok(texts(p.card).some((t) => /conversation above/.test(t)));
  assert.ok(texts(p.card).includes('Ryagramming'));
});

test('a whoami result shows the account and the credits; a projects result shows up to three titles and counts the rest', () => {
  const p = load();
  p.fire(RESULT({ account: 'alice@example.test', credits_available: 100, credits_held: 3, full_render_enabled: false }));
  let t = texts(p.card);
  for (const x of ['Account', 'alice@example.test', 'Credits available', '100', 'Held for running jobs', '3']) assert.ok(t.includes(x), x);
  p.fire(RESULT({ projects: [1, 2, 3, 4, 5].map((i) => ({ id: `id${i}`, title: `Film ${i}` })) }));
  t = texts(p.card);
  assert.deepEqual(t.filter((x) => /^Film /.test(x)), ['Film 1', 'Film 2', 'Film 3']);
  assert.ok(t.includes('and 2 more'));
  p.fire(RESULT({ projects: [] }));
  assert.ok(texts(p.card).includes('No projects yet.'));
});

test('text from a result is only ever TEXT: markup stays markup, control and direction characters are removed, long titles are cut', () => {
  const p = load();
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  p.fire(RESULT({ account: evil, projects: [{ id: 'a', title: evil }, { id: 'b', title: 'a\u0000b\u202ec\u2066d\u200fe\u009ff\nx' }, { id: 'c', title: 'z'.repeat(500) }] }));
  const all = p.card.all();
  assert.ok(all.every((n) => ['main', 'div', 'span', 'h1', 'p', 'button'].includes(n.tag)), 'no element but the card\'s own kinds was made');
  assert.ok(texts(p.card).includes(evil.slice(0, 80)), 'the account label is shown as written, as text');
  assert.ok(texts(p.card).includes(evil.slice(0, 60)), 'a title is shown as written, as text');
  const cleaned = texts(p.card).find((t) => t.startsWith('a b'));
  assert.equal(cleaned, 'a b c d e f x');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f]/.test(cleaned));
  assert.equal(texts(p.card).find((t) => /^z+$/.test(t)).length, 60);
});

test('numbers must be numbers: a credit count that is text, markup, NaN or infinite is not shown; long counts are whole numbers', () => {
  const p = load();
  p.fire(RESULT({ credits_available: '<b>9</b>', credits_held: NaN }));
  assert.ok(!texts(p.card).includes('Credits available') && !texts(p.card).includes('Held for running jobs'));
  p.fire(RESULT({ credits_available: Infinity, credits_held: null }));
  assert.ok(!texts(p.card).includes('Credits available'));
  p.fire(RESULT({ credits_available: 12.6, credits_held: 0 }));
  assert.ok(texts(p.card).includes('13') && texts(p.card).includes('0'));
});

test('only the host is listened to, and only proper messages: another window, a wrong version, a result with no data change nothing', () => {
  const p = load();
  p.fire(RESULT({ account: 'first' }));
  p.fire(RESULT({ account: 'from-another-window' }), p.other);
  p.fire({ ...RESULT({ account: 'old-version' }), jsonrpc: '1.0' });
  p.fire('a string'); p.fire(null); p.fire([RESULT({ account: 'array' })]); p.fire({ jsonrpc: '2.0', method: 7 });
  assert.ok(texts(p.card).includes('first'));
  for (const bad of ['from-another-window', 'old-version', 'array']) assert.ok(!texts(p.card).includes(bad));
  const before = p.sent.length;
  p.fire({ jsonrpc: '2.0', id: 99, result: {} }, p.other);                // an answer to nothing we asked
  assert.equal(p.sent.length, before);
});

test('the host\'s teardown request is answered, any other request is refused in the JSON-RPC way, and a notification we do not know is ignored', () => {
  const p = load();
  const n = p.sent.length;
  p.fire({ jsonrpc: '2.0', id: 7, method: 'ui/resource-teardown', params: { reason: 'closed' } });
  p.fire({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'request_full_render' } });
  p.fire({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } });
  const out = p.sent.slice(n).map((s) => s.m);
  assert.deepEqual(out.find((m) => m.id === 7), { jsonrpc: '2.0', id: 7, result: {} });
  assert.equal(out.find((m) => m.id === 8).error.code, -32601);
  assert.equal(out.length, 2);
});

test('the card never asks the host to call a tool, send a message, or change the model\'s context: its only requests are the handshake and the link', () => {
  const p = load();
  p.fire(RESULT({ account: 'a', projects: [{ id: 'x', title: 'T' }] }));
  p.card.all().filter((n) => n.tag === 'button').forEach((b) => b.listeners.click.forEach((f) => f()));
  const methods = new Set(p.sent.map((s) => s.m.method));
  assert.deepEqual([...methods].sort(), ['ui/initialize', 'ui/notifications/size-changed', 'ui/open-link']);
});

test('the one link: present only with a configured address, and it asks the host to open exactly that address', () => {
  const p = load();
  p.fire(RESULT({ account: 'a' }));
  const b = p.card.all().filter((n) => n.tag === 'button');
  assert.equal(b.length, 1); assert.equal(b[0].textContent, 'Open Ryagram'); assert.equal(b[0].type, 'button');
  b[0].listeners.click[0]();
  const open = p.sent.find((s) => s.m.method === 'ui/open-link');
  assert.deepEqual(open.m.params, { url: APP });
  const q = load('');
  q.fire(RESULT({ account: 'a' }));
  assert.equal(q.card.all().filter((n) => n.tag === 'button').length, 0);
});

test('every message the page sends is JSON-RPC 2.0 to its host window, and none carries account or project data', () => {
  const p = load();
  p.setRect({ height: 200, width: 400 });                                    // the card grew, so it reports its size again, after the data is on it
  p.fire(RESULT({ account: 'secret-label', credits_available: 5, projects: [{ id: 'p1', title: 'secret-title' }] }));
  p.card.all().filter((n) => n.tag === 'button').forEach((b) => b.listeners.click[0]());
  assert.ok(p.sent.some((s) => s.m.method === 'ui/notifications/size-changed' && s.m.params.height === 200), 'the second size report happened');
  assert.ok(p.sent.length >= 3);
  for (const s of p.sent) { assert.equal(s.m.jsonrpc, '2.0'); }
  const wire = JSON.stringify(p.sent.map((s) => s.m));
  assert.ok(!wire.includes('secret-label') && !wire.includes('secret-title') && !wire.includes('p1'));
});

// ------------------------------------------------------------------------------------------------ a hostile-result sweep of the card (CONNECT, overnight 11-06)
// Whatever the host puts in a tool result, the card must not throw, must make only its own kinds of element, must show only clean TEXT of a bounded length, and must ask the host for nothing but its handshake, its height and (when
// configured) the one link. A fixed-seed generator builds 500 results from the fields the card reads, with values of every wrong type and shape.
function mulberryC(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const NASTY = ['', ' ', 'x'.repeat(20000), '<img src=x onerror=alert(1)>', '</script><script>alert(1)</script>', 'a' + String.fromCharCode(0, 0x202e, 0x2066, 0x200f, 0x9f) + 'b' + String.fromCharCode(10) + 'c', String.fromCharCode(92) + 'u0041', '__proto__', 'constructor', 'javascript:alert(1)', 'https://evil.example/'];
const NUMS = [null, true, 0, -1, 1.5, 2 ** 53, 1e308, -1e308, Infinity, '12', '<b>9</b>', NaN, [], {}, [1], { valueOf: 1 }];
function junkC(r, depth = 0) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  if (depth > 3 || r() < 0.3) return r() < 0.5 ? pick(NASTY) : pick(NUMS);
  if (r() < 0.25) return Array.from({ length: Math.floor(r() * 12) }, () => junkC(r, depth + 1));
  const o = {};
  for (const k of ['account', 'credits_available', 'credits_held', 'projects', 'id', 'title', '__proto__', 'constructor', 'count', 'more']) if (r() < 0.45) o[k] = junkC(r, depth + 1);
  return o;
}
test('500 hostile results never throw, make only the card\'s own elements, show only clean bounded text, and ask the host for nothing beyond the handshake, the height and the one link', () => {
  const r = mulberryC(20261106);
  const p = load();
  const before = p.sent.length;
  for (let i = 0; i < 500; i++) {
    let sc = junkC(r);
    try { sc = JSON.parse(JSON.stringify(sc)); } catch { continue; }
    assert.doesNotThrow(() => p.fire(RESULT(sc)), 'result ' + i + ' threw');
    const all = p.card.all();
    assert.ok(all.every((n) => ['main', 'div', 'span', 'h1', 'p', 'button'].includes(n.tag)), 'an element of another kind was made at result ' + i);
    for (const t of texts(p.card)) {
      assert.ok(t.length <= 400, 'a text of ' + t.length + ' characters at result ' + i);
      assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f]/.test(t), 'a control or direction character was shown at result ' + i);
    }
  }
  for (const s of p.sent.slice(before)) assert.ok(['ui/notifications/size-changed', 'ui/open-link'].includes(s.m.method), 'the card sent ' + s.m.method);
  assert.ok(p.sent.every((s) => s.target === '*' || typeof s.target === 'string' || s.target === undefined));
  p.fire(RESULT({ account: 'after the storm', credits_available: 7 }));
  assert.ok(texts(p.card).includes('after the storm'), 'a good result is shown after all of them');
});
