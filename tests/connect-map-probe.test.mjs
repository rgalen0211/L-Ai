// The Q520 probe panel (CONNECT, 2026-11-09; paper: Ryagram-logs/proposals/CONNECT-MAP-PROBE-1109.md). A throwaway test page that measures, inside Claude, ChatGPT and a phone, what the interactive map needs to know
// before it is built: does the host honour a declared connection list, blob Workers, WebGL, big tool results, big pages. Offline here: the connector's own code and stand-in world, and the page's script run in a fake
// window whose host, network, Worker and canvas are scripted. Must-fails: tests/connect_map_probe_mutants.mjs. Nothing here calls a live host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp, toolList } from '../supabase/functions/connect-core/mcp.ts';
import { openApi } from '../supabase/functions/connect-core/rest.ts';
import { MCP_APP_MIME } from '../supabase/functions/connect-core/mcp_app.ts';
import { DECLARED_ORIGIN, DECLARED_URL, PAD_KB, PROBE_BUILD, PROBE_TOOLS, PROBE_URI, PROBE_URIS, UNDECLARED_ORIGIN, UNDECLARED_URL, build12, fnv32, padUri, payloadFor, probePage } from '../supabase/functions/connect-core/probe.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const DOMAIN = 'c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com';
const NAMES = ['map_probe', 'map_probe_page_300', 'map_probe_page_600', 'map_probe_page_1200'];

function server(mcpApp, { invite = true, scopes = ['read', 'write', 'render_free'] } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  if (invite) w.invite(A.userId, A.clientId, scopes);
  w.issue('tok-a', A);
  const deps = { data: null, policy: w.policy(), deps: { compile }, verifyToken: w.verifyToken, dataFor: () => w.data(A.userId), resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource', mcpApp };
  const post = (method, params, token = 'tok-a') => handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps);
  const rpc = async (method, params, token) => JSON.parse(await (await post(method, params, token)).text());
  return { w, rpc };
}
const BASE = { enabled: true, uiDomain: DOMAIN };
const PROBE_ON = { ...BASE, probe: true };

// ------------------------------------------------------------------------------------------------ OFF is the connector as it was
for (const [name, cfg] of [['no setting', undefined], ['the app face on, the probe not set', BASE], ['the probe set to false', { ...BASE, probe: false }], ['the probe set but the app face OFF', { enabled: false, probe: true }]]) {
  test(`OFF (${name}): the tool list, the resource list and every call are exactly what they were`, async () => {
    const s = server(cfg), ref = server(cfg === undefined ? undefined : { enabled: cfg.enabled, uiDomain: cfg.uiDomain });
    const a = (await s.rpc('tools/list', {})).result.tools, b = (await ref.rpc('tools/list', {})).result.tools;
    assert.deepEqual(a, b);
    assert.ok(!JSON.stringify(a).includes('map_probe') && !JSON.stringify(a).includes('probe'));
    if (cfg?.enabled) {
      const res = (await s.rpc('resources/list', {})).result.resources;
      assert.ok(res.every((r) => !r.uri.includes('probe')), 'no probe page is listed');
      for (const uri of PROBE_URIS) assert.equal((await s.rpc('resources/read', { uri })).error.code, -32002, `${uri} is not served when the probe is off`);
    }
    for (const n of NAMES) {
      const r = (await s.rpc('tools/call', { name: n, arguments: {} })).result;
      assert.equal(r.isError, true, n);
      assert.match(r.content[0].text, /There is no tool called/);
    }
  });
}

test('the probe tools are in NO main list: not the REST list, not the OpenAPI document, not the exported tool list', () => {
  const doc = JSON.stringify(openApi('https://x.example/connect')), list = JSON.stringify(toolList(true, true)), rest = JSON.stringify(toolList());
  for (const n of NAMES) for (const where of [doc, list, rest]) assert.ok(!where.includes(n), n);
});

// ------------------------------------------------------------------------------------------------ ON
test('ON: four probe tools are listed AFTER the normal ones, read-only, each pointing at its own page; the normal list is unchanged', async () => {
  const off = server(BASE), on = server(PROBE_ON);
  const a = (await off.rpc('tools/list', {})).result.tools, b = (await on.rpc('tools/list', {})).result.tools;
  assert.deepEqual(b.slice(0, a.length), a, 'the normal tools come first, untouched');
  const added = b.slice(a.length);
  assert.deepEqual(added.map((t) => t.name), NAMES);
  const uris = [PROBE_URI, ...PAD_KB.map(padUri)];
  added.forEach((t, i) => {
    assert.deepEqual(t.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.equal(t._meta.ui.resourceUri, uris[i]);
    assert.equal(t._meta['openai/outputTemplate'], uris[i]);
    assert.match(t.description, /ONLY when the person asks you to run the Ryagram probe/);
    assert.match(t.description, /changes nothing, costs nothing/);
    assert.equal(t.inputSchema.additionalProperties, false);
  });
});

test('ON: resources/list names the four addresses (each carries the build); resources/read serves exactly those, as the app mime type, with the declared origin in BOTH spellings and the sandbox domain', async () => {
  const s = server(PROBE_ON);
  const res = (await s.rpc('resources/list', {})).result.resources;
  assert.deepEqual(res.filter((r) => r.uri.includes('probe')).map((r) => r.uri), PROBE_URIS);
  for (const uri of PROBE_URIS) {
    assert.match(uri, new RegExp('^ui://ryagram/probe-(pad\\d+-)?' + PROBE_BUILD + '$'));
    const r = (await s.rpc('resources/read', { uri })).result.contents[0];
    assert.equal(r.uri, uri);
    assert.equal(r.mimeType, MCP_APP_MIME);
    assert.equal(r.text, probePage(uri));
    assert.deepEqual(r._meta.ui.csp, { connectDomains: [DECLARED_ORIGIN], resourceDomains: [] });
    assert.deepEqual(r._meta['openai/widgetCSP'], { connect_domains: [DECLARED_ORIGIN], resource_domains: [] });
    assert.equal(r._meta.ui.domain, DOMAIN);
    assert.ok(!JSON.stringify(r._meta).includes(UNDECLARED_ORIGIN), 'the undeclared origin is never declared');
  }
  for (const bad of ['ui://ryagram/probe', 'ui://ryagram/probe-000000000000', 'ui://ryagram/probe-pad300-000000000000', 'ui://ryagram/probe-pad999-' + PROBE_BUILD, PROBE_URI + '/', 7, null]) {
    assert.equal((await s.rpc('resources/read', { uri: bad })).error?.code, -32002, String(bad));
  }
});

test('the build is a hash of the page itself, worked out here from the page with the build blanked, and it is in the page and nowhere else', () => {
  const page = probePage(PROBE_URI);
  assert.match(PROBE_BUILD, /^[0-9a-f]{12}$/);
  assert.equal(build12(page.replace(`data-build="${PROBE_BUILD}"`, 'data-build=""')), PROBE_BUILD);
  assert.equal(page.split(PROBE_BUILD).length - 1, 1);
  assert.notEqual(build12('a'), build12('b'));
});

test('the pages: the base page is small and plain ASCII, the padded copies are the base plus the padding and nothing else', () => {
  const base = probePage(PROBE_URI);
  assert.ok(base.length < 24 * 1024, `${base.length} bytes`);
  assert.ok(!/[^\x00-\x7f]/.test(base), 'ASCII only');
  assert.match(base, /data-pad-kb="0"/);
  for (const kb of PAD_KB) {
    const p = probePage(padUri(kb));
    assert.match(p, new RegExp(`data-pad-kb="${kb}"`));
    assert.equal(p.length - base.length, kb * 1024 + '<!---->'.length + (`data-pad-kb="${kb}"`.length - 'data-pad-kb="0"'.length), `${kb} KB of padding`);
    assert.ok(p.indexOf('<!--xxx') < p.indexOf('<script>'), 'the padding comes BEFORE the script, so a page cut short never runs');
  }
  assert.equal(probePage('ui://ryagram/probe-x'), null);
});

test('the page never reaches Ryagram or anything but the two named test files, never builds markup from data, never stores anything', () => {
  const src = probePage(PROBE_URI);
  const script = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));
  for (const bad of ['innerHTML', 'outerHTML=', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'importScripts(', 'location.href=', 'window.open(', 'supabase', 'ryagram.com', 'uselai']) {
    assert.ok(!script.includes(bad), bad);
  }
  assert.deepEqual([...new Set(script.match(/https?:\/\/[A-Za-z0-9.\/@_-]+/g) || [])].sort(), [DECLARED_URL, UNDECLARED_URL].sort());
  assert.equal((script.match(/\bfetch\(/g) || []).length, 2, 'one fetch in the page, one in the worker text');
  assert.ok(!/\bfetch\(.*credentials/.test(script));
});

// ------------------------------------------------------------------------------------------------ the tool
test('the tool hands the page exact, checkable data at 10, 100 (the default) and 250 KB, and refuses any other size or any extra argument', async () => {
  const s = server(PROBE_ON);
  for (const [args, kb] of [[{}, 100], [{ kb: 10 }, 10], [{ kb: 100 }, 100], [{ kb: 250 }, 250]]) {
    const r = (await s.rpc('tools/call', { name: 'map_probe', arguments: args })).result;
    assert.equal(r.isError, false);
    const sc = r.structuredContent;
    assert.equal(sc.probe, 1); assert.equal(sc.kb, kb);
    assert.equal(sc.length, kb * 1024); assert.equal(sc.fill.length, kb * 1024);
    assert.equal(sc.check, fnv32(sc.fill));
    assert.match(r.content[0].text, new RegExp(`${kb} KB`));
    assert.ok(r.content[0].text.length < 120, 'the words the model reads stay short');
  }
  for (const args of [{ kb: 7 }, { kb: 1000 }, { kb: '100' }, { kb: 100, more: 1 }, { more: 1 }, []]) {
    const r = (await s.rpc('tools/call', { name: 'map_probe', arguments: args })).result;
    assert.equal(r.isError, true, JSON.stringify(args));
  }
  const pad = (await s.rpc('tools/call', { name: 'map_probe_page_600', arguments: {} })).result;
  assert.equal(pad.isError, false);
  assert.equal(pad.structuredContent.kb, 10);
  assert.ok(!('fill' in (payloadFor(10))) === false);
});

test('a connection that was never invited is refused the probe tool like every other tool', async () => {
  const s = server(PROBE_ON, { invite: false });
  const r = (await s.rpc('tools/call', { name: 'map_probe', arguments: {} })).result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not enabled for AI connections/);
});

test('the checksum is exact: one changed character, or one missing, is a different checksum', () => {
  const p = payloadFor(10);
  assert.equal(p.check, fnv32(p.fill));
  assert.notEqual(fnv32(p.fill.slice(0, -1)), p.check);
  assert.notEqual(fnv32('b' + p.fill.slice(1)), p.check);
  assert.equal(new Set(PROBE_TOOLS.map((t) => t.name)).size, 4);
});

// ------------------------------------------------------------------------------------------------ the page, run in a fake window with a scripted host
function run(opts = {}) {
  const src = probePage(PROBE_URI);
  const script = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));
  const sent = [], fetched = [], timers = [], listeners = {}, docListeners = {}, buttons = [];
  const parent = { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) };
  const out = { textContent: '' };
  const bar = { appendChild: (b) => buttons.push(b) };
  const el = (tag) => ({ tag, textContent: '', type: '', addEventListener(ev, fn) { this.click = fn; }, getContext: (k) => (opts.gl === false ? null : (k === 'webgl2' && opts.gl !== 'webgl1' ? glObj : (k === 'webgl' ? glObj : null))) });
  const glObj = { getExtension: () => null, getParameter: (p) => (p === 3379 ? 16384 : 'Fake GPU'), RENDERER: 7937, MAX_TEXTURE_SIZE: 3379 };
  let clock = 0;
  class FakeWorker {
    constructor(url) { this.url = url; opts.workers?.push(this); queueMicrotask(() => { if (opts.worker === 'error') this.onerror?.({ message: 'blocked' }); else if (opts.worker !== 'silent') { this.onmessage?.({ data: 'alive; fetch is function' }); this.onmessage?.({ data: opts.worker === 'nofetch' ? 'worker fetch of the declared origin FAILED (TypeError)' : 'worker fetch of the declared origin OK, 70 bytes' }); } }); }
    terminate() {}
  }
  const documentEl = { getBoundingClientRect: () => ({ width: 600, height: 300 }), get outerHTML() { return src; } };
  const doc = {
    getElementById: (id) => (id === 'out' ? out : id === 'bar' ? bar : null),
    body: { getAttribute: (k) => ({ 'data-build': PROBE_BUILD, 'data-pad-kb': '0' })[k] ?? null },
    documentElement: documentEl,
    createElement: el,
    addEventListener: (ev, fn) => { (docListeners[ev] ||= []).push(fn); },
  };
  const win = { parent, innerWidth: 600, innerHeight: 400, devicePixelRatio: 2, isSecureContext: true, addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); }, ...(opts.openai ? { openai: {} } : {}) };
  const fetchFake = async (url, o = {}) => {
    fetched.push({ url, headers: o.headers || null, credentials: o.credentials });
    if (url === UNDECLARED_URL) {
      if (opts.undeclared === 'allowed') return { ok: true, status: 200, text: async () => '{"name":"is-number"}' };
      if (opts.undeclared === 'silent') throw new TypeError('Failed to fetch');
      (docListeners.securitypolicyviolation || []).forEach((f) => f({ violatedDirective: 'connect-src', blockedURI: url }));
      throw new TypeError('Failed to fetch');
    }
    if (o.headers && opts.preflight === 'refused') throw new TypeError('Failed to fetch');
    if (opts.declared === 'blocked') {
      (docListeners.securitypolicyviolation || []).forEach((f) => f({ violatedDirective: 'connect-src', blockedURI: url }));
      throw new TypeError('Failed to fetch');
    }
    return { ok: true, status: 200, text: async () => '{"name":"is-number","version":"7.0.0"}' };
  };
  const ctx = { window: win, document: doc, fetch: fetchFake, performance: { now: () => (clock += 7) }, navigator: { userAgent: 'FakeBrowser/1 (test)' }, Worker: FakeWorker,
    URL: { createObjectURL: () => 'blob:fake' }, Blob: class {}, location: { origin: 'https://sandbox.example' },
    setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; }, clearTimeout: (t) => { if (t) t.live = false; },
    Promise, JSON, Math, Object, Array, String, Number, Date, parseInt, isFinite };
  vm.createContext(ctx);
  vm.runInContext(script, ctx, { timeout: 2000 });
  const tick = () => new Promise((r) => setImmediate(r));
  const flush = () => { for (const t of timers.splice(0)) if (t.live) { t.live = false; t.fn(); } };
  const settle = async (n = 30) => { for (let i = 0; i < n; i++) { await tick(); flush(); } };
  const fire = (data) => (listeners.message || []).forEach((f) => f({ source: parent, data }));
  const init = () => sent.filter((s) => s.method === 'ui/initialize').at(-1);
  const answerInit = (result = { protocolVersion: '2026-01-26', hostInfo: { name: 'FakeChat', version: '9' }, hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], platform: 'web', theme: 'dark' }, hostCapabilities: { openLinks: {}, serverTools: {} } }) => fire({ jsonrpc: '2.0', id: init().id, result });
  const text = () => out.textContent;
  const button = (label) => buttons.find((b) => b.textContent === label);
  return { sent, fetched, fire, answerInit, settle, flush, text, button, buttons, init, timers };
}
const line = (text, key) => text.split('\n').find((l) => l.startsWith(key)) ?? '';

test('page: the normal run in a host that honours the declared list: every line says what happened, in words', async () => {
  const p = run();
  p.answerInit();
  p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'x' }], structuredContent: payloadFor(100) } });
  await p.settle();
  const t = p.text();
  assert.match(t, new RegExp(`^Ryagram probe, build ${PROBE_BUILD}, page padding 0 KB`));
  assert.match(line(t, 'Host handshake'), /host FakeChat 9; protocol 2026-01-26; display mode inline; modes inline,fullscreen; platform web; theme dark; capabilities openLinks,serverTools/);
  assert.match(line(t, 'Test data handed over'), /WHOLE: asked 100 KB, got 102400 of 102400 characters, checksum matches; text parts 1/);
  assert.match(line(t, '1. Declared origin (unpkg.com)'), /^1\. Declared origin \(unpkg\.com\): ALLOWED\. answered 200, \d+ bytes, \d+ ms \| answered 200.* \| answered 200.* \(file says: is-number\)$/);
  assert.match(line(t, '2. Undeclared'), /BLOCKED by the page policy, as designed\. fetch: FAILED \(TypeError: Failed to fetch.*Policy reports: connect-src blocked https:\/\/cdn\.jsdelivr\.net/);
  assert.match(line(t, '3. Declared origin with a request header'), /ALLOWED\. fetch: answered 200/);
  assert.match(line(t, '4. Blob Worker'), /RAN\. alive; fetch is function\. worker fetch of the declared origin OK, 70 bytes/);
  assert.match(line(t, '5. WebGL'), /AVAILABLE \(webgl2; max texture 16384; renderer Fake GPU\)/);
  assert.match(line(t, '6. This page itself'), /arrived and ran\. Its own HTML is \d+ characters; padding declared 0 KB/);
  assert.match(line(t, 'This page'), /secure yes; window 600x400; pixel ratio 2; window\.openai undefined; OffscreenCanvas undefined/);
  // the network: three declared fetches, one undeclared, one with the header, and NOTHING else
  assert.deepEqual(p.fetched.map((f) => f.url), [DECLARED_URL, DECLARED_URL, DECLARED_URL, UNDECLARED_URL, DECLARED_URL]);
  assert.equal(JSON.stringify(p.fetched[4].headers), JSON.stringify({ 'X-Ryagram-Probe': '1' }));
  assert.ok(p.fetched.slice(0, 4).every((f) => f.headers === null));
  assert.ok(p.fetched.every((f) => f.credentials === undefined), 'no credentials are ever sent');
});

test('page: a host that does NOT restrict connections is reported as exactly that; one that fails silently is reported as an unknown', async () => {
  const open = run({ undeclared: 'allowed' }); open.answerInit(); await open.settle();
  assert.match(line(open.text(), '2. Undeclared'), /ALLOWED: the host does NOT restrict connections to the declared list\. fetch: answered 200.* No policy report\./);
  const silent = run({ undeclared: 'silent' }); silent.answerInit(); await silent.settle();
  assert.match(line(silent.text(), '2. Undeclared'), /FAILED with no policy report \(network, CORS, or the host blocks silently\)/);
  const blocked = run({ declared: 'blocked' }); blocked.answerInit(); await blocked.settle();
  assert.match(line(blocked.text(), '1. Declared origin'), /^1\. Declared origin \(unpkg\.com\): NOT ALLOWED \/ FAILED\. FAILED \(TypeError: Failed to fetch/);
  const refused = run({ preflight: 'refused' }); refused.answerInit(); await refused.settle();
  assert.match(line(refused.text(), '3. Declared origin with a request header'), /^3\. .*: FAILED\. fetch: FAILED .*\(If it failed with no policy report, the script host refused the header/);
});

test('page: a Worker that cannot start, one that never answers, one whose fetch fails, and no WebGL are each reported', async () => {
  const bad = run({ worker: 'error', gl: false }); bad.answerInit(); await bad.settle();
  assert.match(line(bad.text(), '4. Blob Worker'), /FAILED to run \(blocked\)/);
  assert.match(line(bad.text(), '5. WebGL'), /NOT AVAILABLE/);
  const silent = run({ worker: 'silent', gl: 'webgl1' }); silent.answerInit(); await silent.settle();
  assert.match(line(silent.text(), '4. Blob Worker'), /NO ANSWER in 4 s/);
  assert.match(line(silent.text(), '5. WebGL'), /AVAILABLE \(webgl;/);
  const nofetch = run({ worker: 'nofetch' }); nofetch.answerInit(); await nofetch.settle();
  assert.match(line(nofetch.text(), '4. Blob Worker'), /RAN\. alive; fetch is function\. worker fetch of the declared origin FAILED \(TypeError\)/);
});

test('page: a host that never answers the handshake still gets every check run, and says so', async () => {
  const p = run({ openai: true });
  await p.settle();
  assert.match(line(p.text(), 'Host handshake'), /NO answer to ui\/initialize in 3 s/);
  assert.match(line(p.text(), '1. Declared origin'), /ALLOWED/);
  assert.match(line(p.text(), 'This page'), /window\.openai object/);
  const refusing = run(); refusing.fire({ jsonrpc: '2.0', id: refusing.init().id, error: { code: -32000, message: 'no apps here' } }); await refusing.settle();
  assert.match(line(refusing.text(), 'Host handshake'), /the host refused ui\/initialize \(no apps here\)/);
  assert.match(line(refusing.text(), '1. Declared origin'), /ALLOWED/);
});

test('page: a cut, changed or missing tool result is DAMAGED or NOT THERE, never WHOLE', async () => {
  const cases = [
    [{ ...payloadFor(100), fill: payloadFor(100).fill.slice(0, 60000) }, /DAMAGED: asked 100 KB, got 60000 of 102400 characters, checksum DOES NOT match/],
    [{ ...payloadFor(10), fill: 'b' + payloadFor(10).fill.slice(1) }, /DAMAGED: .*checksum DOES NOT match/],
    [undefined, /NO structured data arrived/],
    [{ other: 1 }, /something arrived but not the test data \(keys: other\)/],
  ];
  for (const [sc, want] of cases) {
    const p = run(); p.answerInit();
    p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent: sc } });
    await p.settle();
    assert.match(line(p.text(), 'Test data handed over'), want);
  }
  const waiting = run(); waiting.answerInit(); await waiting.settle();
  assert.match(line(waiting.text(), 'Test data handed over'), /waiting for the host to hand it over/);
});

test('page: the buttons ask the host for 10, 100 and 250 KB through tools/call and judge what comes back; an error or silence is reported as such', async () => {
  const p = run(); p.answerInit(); await p.settle();
  assert.deepEqual(p.buttons.map((b) => b.textContent), ['Ask for 10 KB', 'Ask for 100 KB', 'Ask for 250 KB', 'Put this report in the chat', 'Run the checks again']);
  p.button('Ask for 100 KB').click();
  const call = p.sent.filter((s) => s.method === 'tools/call').at(-1);
  assert.deepEqual(call.params, { name: 'map_probe', arguments: { kb: 100 } });
  p.fire({ jsonrpc: '2.0', id: call.id, result: { isError: false, structuredContent: payloadFor(100) } });
  assert.match(line(p.text(), 'Test data the page asked for'), /100 KB: WHOLE: asked 100 KB, got 102400 of 102400 characters, checksum matches, \d+ ms/);
  p.button('Ask for 250 KB').click();
  const c2 = p.sent.filter((s) => s.method === 'tools/call').at(-1);
  p.fire({ jsonrpc: '2.0', id: c2.id, error: { code: -32000, message: 'too large for this host' } });
  assert.match(line(p.text(), 'Test data the page asked for'), /250 KB: the host answered with an error \(too large for this host\)/);
  p.button('Ask for 10 KB').click();
  await p.settle();
  assert.match(line(p.text(), 'Test data the page asked for'), /10 KB: no answer in 20 s/);
});

test('page: "Put this report in the chat" sends the report text (only that) through ui/update-model-context and says whether the host took it', async () => {
  const p = run(); p.answerInit(); await p.settle();
  p.button('Put this report in the chat').click();
  const m = p.sent.filter((s) => s.method === 'ui/update-model-context').at(-1);
  assert.equal(m.params.content.length, 1);
  assert.equal(m.params.content[0].type, 'text');
  assert.ok(m.params.content[0].text.startsWith(`Ryagram probe, build ${PROBE_BUILD}`));
  assert.deepEqual(Object.keys(m.params), ['content']);
  p.fire({ jsonrpc: '2.0', id: m.id, result: {} });
  assert.match(line(p.text(), '7. Put the report in the chat'), /the host accepted it/);
  p.button('Put this report in the chat').click();
  const m2 = p.sent.filter((s) => s.method === 'ui/update-model-context').at(-1);
  p.fire({ jsonrpc: '2.0', id: m2.id, error: { code: -32601, message: 'Method not found' } });
  assert.match(line(p.text(), '7. Put the report in the chat'), /the host refused \(Method not found\)/);
});

test('page: a hostile host or tool result cannot put control or direction characters, or markup, on the page', async () => {
  const p = run(); p.answerInit({ protocolVersion: '2026-01-26', hostInfo: { name: '\u202e<b>evil</b>\u0000', version: '1\u2028' }, hostContext: { displayMode: '\u202edark' } });
  p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { ['\u202ekey\u0000']: 1 } } });
  await p.settle();
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f\u2028\u2029]/.test(p.text()), 'no control or direction characters');
  assert.ok(p.text().includes('<b>evil</b>'), 'markup stays text (the page only ever uses textContent)');
  const reply = p.sent.find((s) => s.id === undefined && s.method === 'ui/notifications/initialized');
  assert.ok(reply);
  // a request from the host the page does not know is answered "method not found", teardown is answered ok
  p.fire({ jsonrpc: '2.0', id: 77, method: 'ui/unknown', params: {} });
  p.fire({ jsonrpc: '2.0', id: 78, method: 'ui/resource-teardown', params: {} });
  assert.deepEqual(p.sent.find((s) => s.id === 77).error.code, -32601);
  assert.deepEqual(p.sent.find((s) => s.id === 78).result, {});
});

test('the function reads the probe switch from its own setting, CONNECT_MAP_PROBE, and from no other', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../supabase/functions/connect/index.ts', import.meta.url), 'utf8');
  const m = /const mcpApp = \{([^}]*)\};/.exec(src);
  assert.ok(m, 'the app config is in the function');
  assert.match(m[1], /probe: Deno\.env\.get\("CONNECT_MAP_PROBE"\) === "on"/);
  assert.match(m[1], /enabled: Deno\.env\.get\("CONNECT_MCP_APP"\) === "on"/, 'it still needs the app face');
  assert.equal((src.match(/CONNECT_MAP_PROBE/g) || []).length, 1);
});

test('the probe tools need only the plain read permission (and no more): a read-only connection can run them, one without read cannot', async () => {
  const readOnly = server(PROBE_ON, { scopes: ['read'] });
  for (const n of NAMES) assert.equal((await readOnly.rpc('tools/call', { name: n, arguments: {} })).result.isError, false, n);
  const noRead = server(PROBE_ON, { scopes: ['write', 'render_free'] });
  const r = (await noRead.rpc('tools/call', { name: 'map_probe', arguments: {} })).result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not allowed to do that/);
  assert.ok(PROBE_TOOLS.every((t) => t.scope === 'read' && t.readOnly === true));
});

test('the tool itself refuses a size that is not on the list, even if the argument check did not (a second line of defence)', async () => {
  for (const kb of [7, 0, -1, 1000, 100.5, NaN]) {
    const r = await PROBE_TOOLS[0].run({ kb }, {});
    assert.equal(r.isError, true, String(kb));
    assert.equal(r.code, 'args');
    assert.ok(!r.data);
  }
});

test('a sandbox domain that is not of the documented form is never put on the probe page', async () => {
  const s = server({ enabled: true, probe: true, uiDomain: 'evil.example.com' });
  const r = (await s.rpc('resources/read', { uri: PROBE_URI })).result.contents[0];
  assert.ok(!('domain' in r._meta.ui));
  assert.ok(!JSON.stringify(r._meta).includes('evil.example.com'));
});
