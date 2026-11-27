// The Compilations STATUS PANEL in the AI chat (CONNECT 11-27): the page that draws what get_compilation_status returned, and the one switch that shows it.
// Against the connector's own code and its in-memory stand-in world; the page is run in a tiny fake DOM (the real-browser look is not run here: this PC's Chrome crashes in the repo's browser checks).
// The structured data the page draws is the REAL answer of the tool for each state, never hand-made, except where a test plants a hostile or broken shape on purpose.
// Must-fails are in tests/connect_compilation_card_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp, toolList } from '../supabase/functions/connect-core/mcp.ts';
import { CARD_URI, MCP_APP_MIME, UI_TOOL_URIS, readResource, resourceList } from '../supabase/functions/connect-core/mcp_app.ts';
import { COMPILATION_BUILD, COMPILATION_MAX_BYTES, COMPILATION_PAGE, COMPILATION_REASONS, COMPILATION_STEPS, COMPILATION_URI, compilationHtml, isCompilationUri } from '../supabase/functions/connect-core/compilation_card.ts';
import { COMPILATIONS_PAGE, COMPILATION_STOPPED } from '../supabase/functions/connect-core/tools.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const APP = 'https://uselai.com/app/';
const DOMAIN = 'c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com';
const ON = { enabled: true, uiDomain: DOMAIN, appUrl: APP };

function server(mcpApp, { open = true } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId, ['read', 'write', 'render_free']);
  if (open) w.users.get(A.userId).switches = ['compilations'];
  w.issue('tok-a', A);
  const deps = { data: null, policy: w.policy(), deps: { compile }, verifyToken: w.verifyToken, dataFor: () => w.data(A.userId), resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource', ...(mcpApp === undefined ? {} : { mcpApp }) };
  const post = (method, params, token = 'tok-a') => handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps);
  const rpc = async (method, params, token) => JSON.parse(await (await post(method, params, token)).text());
  const call = (name, args) => callTool(name, args, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile } });
  return { w, rpc, post, call };
}
const strip = (tools) => tools.map(({ _meta, ...t }) => t);
async function asked(s, extra = {}) {
  const id = (await s.call('create_project', { title: 'Compilation' })).data.project_id;
  const r = await s.call('set_compilation_request', { project_id: id, phrase: 'great news', folders: ['My Videos', 'Holiday'], ...extra });
  assert.equal(r.isError, undefined, r.text);
  return id;
}

// ------------------------------------------------------------------------------------------------ the switch: OFF is the connector as it was
for (const [name, cfg] of [['no setting at all', undefined], ['enabled: false', { enabled: false, uiDomain: DOMAIN, appUrl: APP }]]) {
  test(`OFF (${name}): get_compilation_status carries no _meta, nothing about the panel is listed, and its page is not served`, async () => {
    const s = server(cfg);
    const list = (await s.rpc('tools/list', {})).result.tools;
    const t = list.find((x) => x.name === 'get_compilation_status');
    assert.ok(t, 'the tool itself is still there');
    assert.ok(!('_meta' in t), 'no link to a page');
    assert.ok(!JSON.stringify(list).includes('ui://') && !JSON.stringify(list).includes('outputTemplate'));
    for (const m of ['resources/list', 'resources/read']) {
      const r = await s.rpc(m, { uri: COMPILATION_URI });
      assert.equal(r.error.code, -32601, m); assert.equal(r.result, undefined);
    }
    assert.ok(!('_meta' in toolList().find((x) => x.name === 'get_compilation_status')), 'the REST face list never carries _meta');
  });
}

test('ON: get_compilation_status gets its page link exactly where the card tools get theirs; every other tool and every word of the list is as it was', async () => {
  const off = server(undefined), on = server(ON);
  const a = (await off.rpc('tools/list', {})).result.tools, b = (await on.rpc('tools/list', {})).result.tools;
  assert.deepEqual(strip(b), strip(a), 'everything but _meta is identical (the tool list text is unchanged)');
  assert.deepEqual(b.filter((t) => '_meta' in t).map((t) => t.name).sort(), ['get_compilation_status', 'list_projects', 'whoami_and_credits']);
  const t = b.find((x) => x.name === 'get_compilation_status');
  assert.deepEqual(t._meta, { ui: { resourceUri: COMPILATION_URI }, 'openai/outputTemplate': COMPILATION_URI });
  assert.equal(UI_TOOL_URIS.get_compilation_status, COMPILATION_URI);
  assert.equal(Object.keys(UI_TOOL_URIS).length, 3, 'no other tool was given a page');
  assert.equal(t.annotations.readOnlyHint, true);
  // the panel never changes with the other switches: a tool with the card has the card, this one has its own
  const withAll = (await server({ ...ON, chatEditor: true, homePanel: true }).rpc('tools/list', {})).result.tools.find((x) => x.name === 'get_compilation_status');
  assert.equal(withAll._meta.ui.resourceUri, COMPILATION_URI);
});

test('ON: the tool answers exactly as it did (same text, same structured data), for a request with and without a report', async () => {
  for (const run of [undefined, { state: 'matching', matches: 3, current: true }, { state: 'done', clips: 5, film_seconds: 40, current: true }]) {
    const off = server(undefined), on = server(ON);
    const [x, y] = await Promise.all([off, on].map(async (s) => { const id = await asked(s); if (run) s.w.setCompilationRun(A.userId, id, run); return { id, r: (await s.rpc('tools/call', { name: 'get_compilation_status', arguments: { project_id: id } })).result }; }));
    assert.equal(y.r.content[0].text.replaceAll(y.id, 'ID'), x.r.content[0].text.replaceAll(x.id, 'ID'));
    assert.deepEqual(JSON.parse(JSON.stringify(y.r.structuredContent).replaceAll(y.id, 'ID')), JSON.parse(JSON.stringify(x.r.structuredContent).replaceAll(x.id, 'ID')));
    assert.equal(y.r.isError, x.r.isError);
  }
});

test('ON: the page is listed, readable at its address, as the app mime type, with no network and no frames, and within its byte cap', async () => {
  const s = server(ON);
  const l = (await s.rpc('resources/list', {})).result.resources;
  const mine = l.filter((r) => r.uri === COMPILATION_URI);
  assert.equal(mine.length, 1); assert.equal(mine[0].mimeType, MCP_APP_MIME);
  assert.ok(l.some((r) => r.uri === CARD_URI), 'the card is still listed');
  const r = (await s.rpc('resources/read', { uri: COMPILATION_URI })).result.contents;
  assert.equal(r.length, 1); assert.equal(r[0].uri, COMPILATION_URI); assert.equal(r[0].mimeType, MCP_APP_MIME);
  assert.equal(r[0].text, compilationHtml(APP));
  assert.deepEqual(r[0]._meta.ui, { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false, domain: DOMAIN });
  assert.ok(!('frameDomains' in r[0]._meta.ui.csp));
  assert.ok(Buffer.byteLength(r[0].text) <= COMPILATION_MAX_BYTES, `${Buffer.byteLength(r[0].text)} bytes`);
  assert.ok(resourceList(undefined).every((x) => x.uri !== undefined));
  assert.equal(readResource(COMPILATION_URI, { enabled: true, appUrl: APP }).contents[0].text, compilationHtml(APP));
});

test('ON: any other address is "does not exist" and is never echoed; an address of this page\'s own shape from an earlier build is answered with the CURRENT page', async () => {
  const s = server(ON);
  for (const uri of ['ui://ryagram/compilations', 'ui://ryagram/compilations-', 'ui://ryagram/compilations-xyz', 'ui://ryagram/compilations-0123456789AB', 'ui://ryagram/compilations-0123456789abc', 'ui://ryagram/Compilations-0123456789ab', 'file:///etc/passwd', null, 7, ['ui://ryagram/card']]) {
    const r = await s.rpc('resources/read', { uri });
    assert.equal(r.error.code, -32002, JSON.stringify(uri)); assert.equal(r.error.message, 'That page does not exist.');
  }
  const old = 'ui://ryagram/compilations-000000000000';
  const c = (await s.rpc('resources/read', { uri: old })).result.contents[0];
  assert.equal(c.uri, old); assert.equal(c.text, compilationHtml(APP));
  assert.match(COMPILATION_URI, /^ui:\/\/ryagram\/compilations-[0-9a-f]{12}$/); assert.equal(COMPILATION_URI, 'ui://ryagram/compilations-' + COMPILATION_BUILD);
  assert.ok(isCompilationUri(COMPILATION_URI) && !isCompilationUri('ui://ryagram/card') && !isCompilationUri(5));
});

test('ON: the page is for signed-in connections only, like every resource', async () => {
  const s = server(ON);
  for (const token of ['', 'tok-wrong']) {
    const res = await s.post('resources/read', { uri: COMPILATION_URI }, token);
    assert.equal(res.status, 401); assert.ok(!(await res.text()).includes('<html'));
  }
});

test('the page address is a build id of the page: a change to the page or its words changes it', () => {
  assert.notEqual(COMPILATION_BUILD, '000000000000');
  assert.equal(compilationHtml('').includes('data-app-url=""'), true);
  assert.deepEqual([...COMPILATION_STEPS], ['Waiting', 'Planning', 'Matching', 'Building', 'Done'], 'five steps');
});

test('the config address is used only when it is a plain https address, and the page fragment equals the tool\'s own page', () => {
  for (const bad of ['http://uselai.com/app/', 'javascript:alert(1)', 'https://uselai.com/app/" onload="x', "https://uselai.com/'><script>", 'https://', '//uselai.com/app/', 'https://user:pw@uselai.com/', 'https://uselai.com/a b', 'https://uselai.com/app/#/x']) {
    assert.match(compilationHtml(bad), /data-app-url=""/, bad);
  }
  assert.match(compilationHtml(APP), new RegExp(`data-app-url="${APP}"`));
  assert.equal(COMPILATION_PAGE, '#/d/compilations'); assert.equal(COMPILATION_PAGE, COMPILATIONS_PAGE, 'the tool open_compilations_page names the same page');
});

// ------------------------------------------------------------------------------------------------ the page itself
const HTML = compilationHtml(APP);
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
});

test('the look: the connector\'s newer one (Georgia wordmark, 18px card, orange pill button with dark ink), a phone width with no sideways scroll, buttons at least 44px', () => {
  for (const x of ['font:400 24px/1 Georgia', 'border-radius:18px', 'background:#ff8a3d', 'color:#14141a', 'border-radius:999px', 'min-height:44px', 'max-width:640px', 'min-width:0', 'overflow-wrap:anywhere', '@media (max-width:360px)']) assert.ok(STYLE.includes(x), x);
  assert.ok(!/overflow-x\s*:\s*scroll|[;{]width:\s*\d{3,}px|min-width:\s*[1-9]\d{2,}px/.test(STYLE), 'nothing fixed wide');
  assert.ok(STYLE.includes('minmax(0,1fr)'), 'the long phrase column can shrink');
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
  const doc = { getElementById: (id) => (id === 'cc' ? root : null), body, createElement: (t) => new Node_(t), documentElement: { getBoundingClientRect: () => rect } };
  vm.runInNewContext(SCRIPT, { window: win, document: doc, String, Array, Math, isFinite }, { timeout: 2000 });
  const fire = (data, source = host) => listeners.message.forEach((f) => f({ source, data }));
  return { sent, host, other, root, fire, setRect: (r) => { rect = r; } };
}
const leaves = (root) => root.all().filter((n) => n.children.length === 0).map((n) => n.textContent);
const RESULT = (sc) => ({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'x' }], structuredContent: sc } });
const buttons = (root) => root.all().filter((n) => n.tag === 'button');
const stepLine = (root) => (root.all().find((n) => n.className === 'step') || { textContent: null }).textContent;
const segs = (root) => root.all().filter((n) => /^seg/.test(n.className)).map((n) => n.className === 'seg on');
const rowOf = (root, k) => { const r = root.all().find((n) => n.className === 'row' && n.children[0].textContent === k); return r ? r.children[1].textContent : null; };
const Q = (s) => '“' + s + '”';

test('the page starts the handshake with its host, says it is ready after the answer, and reports its height (the host\'s size-changed)', () => {
  const p = load();
  const init = p.sent.find((s) => s.m.method === 'ui/initialize');
  assert.ok(init); assert.equal(init.m.jsonrpc, '2.0'); assert.equal(typeof init.m.id, 'number'); assert.equal(init.m.params.protocolVersion, '2026-01-26');
  assert.ok(!p.sent.some((s) => s.m.method === 'ui/notifications/initialized'), 'not ready before the host answers');
  p.fire({ jsonrpc: '2.0', id: init.m.id, result: { protocolVersion: '2026-01-26', hostContext: {} } });
  assert.ok(p.sent.some((s) => s.m.method === 'ui/notifications/initialized'));
  const size = p.sent.filter((s) => s.m.method === 'ui/notifications/size-changed');
  assert.ok(size.length >= 1 && size.at(-1).m.params.height === 120 && size.at(-1).m.params.width === 400);
  p.setRect({ height: 260, width: 400 });
  p.fire(RESULT({ looked_up: true, has_request: false }));
  assert.ok(p.sent.some((s) => s.m.method === 'ui/notifications/size-changed' && s.m.params.height === 260), 'a taller page is reported again');
  assert.ok(leaves(p.root).includes('Ryagram'), 'the wordmark heading');
});

// ------------------------------------------------------------------------------------------------ every state, drawn from what the TOOL returns
const FIXTURES = [
  ['no report yet (the app has not picked it up)', undefined, 0, 'Waiting for the Ryagram app on your computer to pick it up.'],
  ['a report for an earlier request', { state: 'matching', matches: 9, current: false }, 0, 'Waiting for the Ryagram app on your computer to pick it up.'],
  ['planning', { state: 'planning', current: true }, 1, 'Planning: the Ryagram app on your computer has the request and is planning the film.'],
  ['matching, no count yet', { state: 'matching', current: true }, 2, 'Matching: the app is looking through your clips.'],
  ['matching with a count', { state: 'matching', matches: 14, current: true }, 2, 'Matching: found 14 places so far.'],
  ['matching with one place', { state: 'matching', matches: 1, current: true }, 2, 'Matching: found 1 place so far.'],
  ['building, no count', { state: 'building', current: true }, 3, 'Building: the film is being made on your computer.'],
  ['building with clips', { state: 'building', clips: 6, current: true }, 3, 'Building: 6 clips so far.'],
  ['done with clips and seconds', { state: 'done', clips: 12, film_seconds: 48, current: true }, 4, 'Done: 12 clips, 48 seconds. The film is on your computer: open the Ryagram app to see it.'],
  ['done with one clip, one second', { state: 'done', clips: 1, film_seconds: 1, current: true }, 4, 'Done: 1 clip, 1 second. The film is on your computer: open the Ryagram app to see it.'],
  ['done with no numbers', { state: 'done', current: true }, 4, 'Done. The film is on your computer: open the Ryagram app to see it.'],
  ['stopped by the person', { state: 'cancelled', current: true }, -1, 'Stopped: you stopped it on your computer.'],
  ['failed with a known reason', { state: 'failed', error_code: 'not_said', current: true }, -1, 'Stopped: your videos do not say it.'],
  ['failed with a reason the panel has no words for', { state: 'failed', error_code: 'something_new', current: true }, -1, 'Stopped: the Ryagram app reported a problem it has no plain words for.'],
  ['failed with no reason', { state: 'failed', current: true }, -1, 'Stopped: the Ryagram app reported a problem it has no plain words for.'],
];
for (const [name, run, step, sentence] of FIXTURES) {
  test(`state "${name}": the tool's own answer is drawn as the request in words, one step line, the strip, and one button`, async () => {
    const s = server(ON);
    const id = await asked(s, { search: 'every', rules: [{ phrase: 'great news', picture: 'cheer.png', seconds: 2, mode: 'full' }] });
    if (run) s.w.setCompilationRun(A.userId, id, run);
    const r = await s.call('get_compilation_status', { project_id: id });
    assert.equal(r.isError, undefined, r.text);
    const p = load();
    p.fire(RESULT(r.data));
    assert.equal(rowOf(p.root, 'Words'), Q('great news'));
    assert.equal(rowOf(p.root, 'Looks for'), 'Every time it is said');
    assert.equal(rowOf(p.root, 'Folders'), 'My Videos, Holiday');
    assert.equal(rowOf(p.root, 'Also'), '1 picture rule');
    assert.equal(stepLine(p.root), sentence);
    assert.deepEqual(segs(p.root), COMPILATION_STEPS.map((_, i) => step >= 0 && i <= step), 'a five-step strip, filled up to the step (none when it stopped)');
    assert.deepEqual(p.root.all().filter((n) => n.className === 'lab' || n.className === 'lab now').map((n) => n.textContent), [...COMPILATION_STEPS]);
    assert.equal(p.root.all().filter((n) => n.className === 'lab now').length, step >= 0 ? 1 : 0);
    assert.deepEqual(buttons(p.root).map((b) => b.textContent), ['Open on the site']);
    // the sentence is the tool's own state, said to the person: the same numbers and the same stage as the tool's words
    const tool = r.text.split('Where it stands: ')[1].split('\n')[0];
    for (const n of sentence.match(/\d+/g) ?? []) assert.ok(tool.includes(n), `${n} is in the tool's sentence "${tool}"`);
    assert.equal(/Stopped/.test(sentence), /Stopped/.test(tool), 'stopped or not agrees with the tool');
    assert.equal(/^Done/.test(sentence), /^Done/.test(tool)); assert.equal(/^Matching/.test(sentence), /^Matching/.test(tool)); assert.equal(/^Building|building/.test(sentence), /^Building|building/.test(tool));
  });
}

test('every reason the tool can report has words in the panel (the two lists have the same keys), and none promises more than the tool says', async () => {
  assert.deepEqual(Object.keys(COMPILATION_REASONS).sort(), Object.keys(COMPILATION_STOPPED).sort());
  const s = server(ON); const id = await asked(s);
  for (const code of Object.keys(COMPILATION_STOPPED)) {
    s.w.setCompilationRun(A.userId, id, { state: 'failed', error_code: code, current: true });
    const r = await s.call('get_compilation_status', { project_id: id });
    const p = load(); p.fire(RESULT(r.data));
    assert.equal(stepLine(p.root), 'Stopped: ' + COMPILATION_REASONS[code] + '.', code);
    assert.ok(!/credit|price|\$|free/i.test(stepLine(p.root)));
  }
});

test('no request yet, and compilations not open: each said in plain words, from the tool\'s own answer; "not open" has no button', async () => {
  const s = server(ON);
  const id = (await s.call('create_project', { title: 'Empty' })).data.project_id;
  const none = await s.call('get_compilation_status', { project_id: id });
  assert.equal(none.data.has_request, false);
  const p = load(); p.fire(RESULT(none.data));
  assert.deepEqual(leaves(p.root).filter((t) => /request/.test(t)), ['No compilation request on this project yet.']);
  assert.deepEqual(buttons(p.root).map((b) => b.textContent), ['Open on the site']);
  assert.equal(p.root.all().filter((n) => /^seg/.test(n.className)).length, 0, 'no strip without a request');
  const closed = server(ON, { open: false }); closed.w.setDesktopApp(A.userId, false);
  const id2 = (await closed.call('create_project', { title: 'Closed' })).data.project_id;
  const no = await closed.call('get_compilation_status', { project_id: id2 });
  assert.equal(no.data.reason, 'compilations_not_open');
  const q = load(); q.fire(RESULT(no.data));
  assert.deepEqual(leaves(q.root).filter((t) => /open/.test(t)), ['Compilations are not open for this Ryagram account yet.']);
  assert.equal(buttons(q.root).length, 0);
});

test('anything else is "Status not available": an unknown state, a result that is not the tool\'s, a missing field, an error answer, no data at all', () => {
  const bad = [undefined, null, 'text', 7, [], [{ looked_up: true, has_request: false }], {}, { looked_up: false }, { looked_up: 'true', has_request: false }, { looked_up: true }, { looked_up: true, has_request: 'yes' },
    { looked_up: true, has_request: true }, { looked_up: true, has_request: true, request: [] }, { looked_up: true, has_request: true, request: 'x' },
    { looked_up: true, has_request: true, request: { phrase: 'a' }, run: { state: 'exploding' } }, { looked_up: true, has_request: true, request: { phrase: 'a' }, run: { state: 7 } },
    { looked_up: true, has_request: true, request: { phrase: 'a' }, run: 'done' }, { looked_up: true, has_request: true, request: { phrase: 'a' }, run: ['done'] },
    { looked_up: true, has_request: true, request: { phrase: 'a' }, run: { state: 'hasOwnProperty' } }, { looked_up: true, has_request: true, request: { phrase: 'a' }, run: { state: 'constructor' } },
    { ok: false, looked_up: false }, { ok: false, looked_up: false, reason: 'rate' }];
  for (const sc of bad) {
    const p = load(); p.fire(RESULT(sc));
    assert.ok(leaves(p.root).some((t) => /^Status not available\./.test(t)), JSON.stringify(sc));
    assert.equal(p.root.all().filter((n) => /^seg|^step/.test(n.className)).length, 0, 'no step, no strip');
    assert.equal(buttons(p.root).length, 0, 'nothing to press when there is nothing to draw');
  }
  const p = load(); p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {} });
  assert.ok(leaves(p.root).some((t) => /^Status not available/.test(t)), 'a result with no structured data');
});

test('numbers are clamped: counts that are text, negative, NaN or huge are not shown or are cut; seconds stop at a day; text counts become zero', () => {
  const base = { looked_up: true, has_request: true, request: { phrase: 'a', folders: ['f'], rules: 0, texts: 0, cards: 0 } };
  const draw = (run, request = {}) => { const p = load(); p.fire(RESULT({ ...base, request: { ...base.request, ...request }, run })); return p; };
  assert.equal(stepLine(draw({ state: 'building', clips: 1e12 }).root), 'Building: 1000000 clips so far.');
  assert.equal(stepLine(draw({ state: 'building', clips: -4 }).root), 'Building: the film is being made on your computer.');
  assert.equal(stepLine(draw({ state: 'building', clips: '<b>9</b>' }).root), 'Building: the film is being made on your computer.');
  assert.equal(stepLine(draw({ state: 'building', clips: NaN }).root), 'Building: the film is being made on your computer.');
  assert.equal(stepLine(draw({ state: 'building', clips: Infinity }).root), 'Building: the film is being made on your computer.');
  assert.equal(stepLine(draw({ state: 'matching', matches: 2.6 }).root), 'Matching: found 3 places so far.');
  assert.equal(stepLine(draw({ state: 'done', clips: 2, film_seconds: 9e9 }).root), 'Done: 2 clips, 86400 seconds. The film is on your computer: open the Ryagram app to see it.');
  const p = draw(null, { rules: '<i>3</i>', texts: -2, cards: 9999, folders: new Array(40).fill('x') });
  assert.equal(rowOf(p.root, 'Also'), '50 cards', 'a text count is not shown, a huge one stops at 50');
  assert.equal(rowOf(p.root, 'Folders').split(', ').length, 10, 'at most ten folder names');
});

test('words from the data are only ever TEXT: markup stays markup, control and direction characters are removed, long words are cut, and no element but the page\'s own kinds is made', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const p = load();
  p.fire(RESULT({ looked_up: true, has_request: true, request: { phrase: evil, search: 'words', folders: [evil, 'a\u0000b‮c⁦d‏e\u009ff\nx', 'z'.repeat(500)], rules: 1, texts: 0, cards: 0 }, run: { state: 'failed', error_code: '<b>x</b>' } }));
  assert.ok(p.root.all().every((n) => ['main', 'div', 'span', 'h1', 'p', 'button'].includes(n.tag)), 'only the page\'s own kinds of element');
  assert.equal(rowOf(p.root, 'Words'), Q(evil), 'the phrase is shown as written, as text');
  assert.ok(rowOf(p.root, 'Folders').includes(evil.slice(0, 80)));
  assert.ok(rowOf(p.root, 'Folders').includes('a b c d e f x'));
  assert.ok(!/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩‎‏]/.test(rowOf(p.root, 'Folders')));
  assert.ok(rowOf(p.root, 'Folders').includes('z'.repeat(80)) && !rowOf(p.root, 'Folders').includes('z'.repeat(81)), 'a folder name is cut at 80');
  assert.equal(stepLine(p.root), 'Stopped: the Ryagram app reported a problem it has no plain words for.', 'an error code that is not plain is never shown');
  const long = load(); long.fire(RESULT({ looked_up: true, has_request: true, request: { phrase: 'w'.repeat(900), folders: [], rules: 0, texts: 0, cards: 0 } }));
  assert.equal(rowOf(long.root, 'Words'), Q('w'.repeat(200)), 'the phrase is cut at 200');
  assert.equal(rowOf(long.root, 'Folders'), 'None named');
  assert.equal(rowOf(long.root, 'Looks for'), null, 'a search kind that is not one of the two is not shown');
});

test('a hostile phrase that comes through the real tool stays text: the page draws exactly the words, no element is made from them', async () => {
  const s = server(ON);
  const id = await asked(s, { note: 'x' });
  const hostile = '"><img src=x onerror=alert(1)> {{7*7}} ${x}';
  const r2 = await s.call('set_compilation_request', { project_id: id, phrase: hostile, folders: ['&lt;b&gt;Home &amp; Co onerror=alert(1)'] });
  assert.equal(r2.isError, undefined, r2.text);
  const r = await s.call('get_compilation_status', { project_id: id });
  const p = load(); p.fire(RESULT(r.data));
  assert.equal(rowOf(p.root, 'Words'), Q(hostile));
  assert.equal(rowOf(p.root, 'Folders'), '&lt;b&gt;Home &amp; Co onerror=alert(1)', 'an entity is not decoded: it stays the characters it was');
  assert.ok(p.root.all().every((n) => ['main', 'div', 'span', 'h1', 'p', 'button'].includes(n.tag)));
});

test('only the host is listened to, and only proper messages', () => {
  const p = load();
  p.fire(RESULT({ looked_up: true, has_request: true, request: { phrase: 'first', folders: [], rules: 0, texts: 0, cards: 0 } }));
  const mk = (w) => RESULT({ looked_up: true, has_request: true, request: { phrase: w, folders: [], rules: 0, texts: 0, cards: 0 } });
  p.fire(mk('from-another-window'), p.other); p.fire({ ...mk('old-version'), jsonrpc: '1.0' }); p.fire('a string'); p.fire(null); p.fire([mk('array')]); p.fire({ jsonrpc: '2.0', method: 7 });
  assert.equal(rowOf(p.root, 'Words'), Q('first'));
  const before = p.sent.length; p.fire({ jsonrpc: '2.0', id: 99, result: {} }, p.other); assert.equal(p.sent.length, before);
});

test('the host\'s teardown request is answered, any other request is refused the JSON-RPC way, an unknown notification is ignored', () => {
  const p = load(); const n = p.sent.length;
  p.fire({ jsonrpc: '2.0', id: 7, method: 'ui/resource-teardown', params: { reason: 'closed' } });
  p.fire({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'request_full_render' } });
  p.fire({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } });
  const out = p.sent.slice(n).map((s) => s.m);
  assert.deepEqual(out.find((m) => m.id === 7), { jsonrpc: '2.0', id: 7, result: {} });
  assert.equal(out.find((m) => m.id === 8).error.code, -32601);
  assert.equal(out.length, 2);
});

// ------------------------------------------------------------------------------------------------ the one button
const REQ = { looked_up: true, has_request: true, request: { phrase: 'great news', search: 'every', folders: ['My Videos'], rules: 0, texts: 0, cards: 0 }, run: null };

test('the one button opens exactly the app address plus the fixed Compilations fragment, and nothing the data says can change it', () => {
  const p = load();
  p.fire(RESULT(REQ));
  const b = buttons(p.root); assert.equal(b.length, 1); assert.equal(b[0].textContent, 'Open on the site'); assert.equal(b[0].type, 'button');
  b[0].listeners.click[0]();
  const open = p.sent.filter((s) => s.m.method === 'ui/open-link');
  assert.equal(open.length, 1); assert.deepEqual(open[0].m.params, { url: APP + '#/d/compilations' });
  assert.equal(open[0].target, '*');
  // data that tries to steer it: addresses in every field, a page, a link, a url
  const q = load();
  q.fire(RESULT({ ...REQ, url: 'https://evil.example/', page: '#/evil', link: 'https://evil.example/', open_url: 'https://evil.example/', app_url: 'https://evil.example/', request: { ...REQ.request, phrase: 'https://evil.example/x', folders: ['https://evil.example/', '#/d/games'], url: 'https://evil.example/' }, run: { state: 'done', clips: 1, film_seconds: 1, url: 'https://evil.example/' } }));
  buttons(q.root).forEach((x) => x.listeners.click[0]());
  assert.deepEqual(q.sent.filter((s) => s.m.method === 'ui/open-link').map((s) => s.m.params), [{ url: APP + '#/d/compilations' }]);
  // a body whose address is not a plain https one (the page builder never writes one) gets no button
  assert.equal(buttons((() => { const z = load(''); z.fire(RESULT(REQ)); return z.root; })()).length, 0);
});

test('a host that will not open the link: the address is said in words, once, as an alert; a host that opens it says nothing more', () => {
  const p = load(); p.fire(RESULT(REQ));
  buttons(p.root)[0].listeners.click[0]();
  const id = p.sent.find((s) => s.m.method === 'ui/open-link').m.id;
  p.fire({ jsonrpc: '2.0', id, result: {} });
  assert.ok(!leaves(p.root).some((t) => /did not open/.test(t)), 'opened: nothing more is said');
  buttons(p.root)[0].listeners.click[0]();
  const id2 = p.sent.filter((s) => s.m.method === 'ui/open-link')[1].m.id;
  p.fire({ jsonrpc: '2.0', id: id2, error: { code: -32000, message: 'nope' } });
  const said = leaves(p.root).filter((t) => /did not open/.test(t));
  assert.deepEqual(said, ['Your chat app did not open it. Open this address in your browser: ' + APP + '#/d/compilations']);
  buttons(p.root)[0].listeners.click[0]();
  const id3 = p.sent.filter((s) => s.m.method === 'ui/open-link')[2].m.id;
  p.fire({ jsonrpc: '2.0', id: id3, result: { isError: true } });
  assert.equal(leaves(p.root).filter((t) => /did not open/.test(t)).length, 1, 'said once');
});

test('the page asks its host for nothing but the handshake, its size and that one link; no message carries the phrase, a folder or a count', () => {
  const p = load();
  p.setRect({ height: 300, width: 400 });
  p.fire(RESULT({ ...REQ, request: { ...REQ.request, phrase: 'secret-phrase', folders: ['secret-folder'] }, run: { state: 'done', clips: 77, film_seconds: 31 } }));
  buttons(p.root).forEach((b) => b.listeners.click[0]());
  assert.deepEqual([...new Set(p.sent.map((s) => s.m.method))].sort(), ['ui/initialize', 'ui/notifications/size-changed', 'ui/open-link']);
  for (const s of p.sent) assert.equal(s.m.jsonrpc, '2.0');
  const wire = JSON.stringify(p.sent.map((s) => s.m));
  for (const x of ['secret-phrase', 'secret-folder', '77', '31']) assert.ok(!wire.includes(x), x);
});

test('the words the panel adds say nothing about price, credit, free, a date or a score', () => {
  const words = [...Object.values(COMPILATION_REASONS), ...SCRIPT.match(/'[^'\n]{12,}'/g)].join('\n');
  for (const bad of [/\$\s?\d/, /\bcredit/i, /\bfree\b/i, /\b20\d\d\b/, /\bscore/i, /\bprice/i]) assert.ok(!bad.test(words), String(bad));
});
