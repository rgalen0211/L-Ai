// The live editor inside the AI chat (CONNECT, 2026-11-05; plan: Ryagram-logs/proposals/CONNECT-MCP-APP-PLAN-1105.md section 5): the generated page and its host seam, offline.
// The real-browser check is tools/check-chat-editor.py. Must-fails are in tests/connect_chat_editor_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { build, html, JS, OUT, POLICY } from '../tools/build-chat-editor.mjs';
import { EDITOR_HTML } from '../supabase/functions/connect-core/editor_page.ts';

const NAMES = ['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat'];
const HOST_SRC = fs.readFileSync(new URL('../tools/chat-editor/live-host.js', import.meta.url), 'utf8');
const PROJECT = '00000000-0000-4000-8000-0000000000a1';
const plain = (x) => JSON.parse(JSON.stringify(x));          // objects made inside the fake window are not this realm's objects

// ------------------------------------------------------------------------------------------------ the generated page
test('the committed page is exactly what the generator writes from the website\'s own editor files (it cannot drift)', () => {
  const have = fs.readFileSync(new URL('../' + OUT, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(have, build());
  assert.equal(EDITOR_HTML, html());
  assert.deepEqual(JS.slice(0, -1), ['assets/app-editor-core.js', 'assets/app-editor-progress.js', 'assets/app-editor-draft.js', 'assets/preview/text-layout.js', 'assets/app-editor.js'], 'the same editor files as the maker\'s page');
  assert.equal(JS.at(-1), 'tools/chat-editor/live-host.js');
});

test('the page is one self-contained file under 300 KB that loads nothing and uses no way to reach out', () => {
  assert.ok(Buffer.byteLength(EDITOR_HTML) <= 300 * 1024, `${Buffer.byteLength(EDITOR_HTML)} bytes`);
  assert.equal((EDITOR_HTML.match(/<script/g) || []).length, 1);
  assert.equal((EDITOR_HTML.match(/<\/script/g) || []).length, 1);
  assert.equal((EDITOR_HTML.match(/<style/g) || []).length, 1);
  const noNs = EDITOR_HTML.replace(/http:\/\/www\.w3\.org\/\d+\/svg/g, '');
  assert.ok(!/https?:\/\//i.test(noNs), 'no web address (the SVG namespace aside)');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'localStorage', 'sessionStorage', 'document.cookie', 'indexedDB', 'eval(', 'new Function', 'innerHTML', 'outerHTML',
    'insertAdjacentHTML', 'document.write', 'importScripts', 'window.open', 'Worker(', '<link', '@import', 'url(', '<iframe', ' src=', 'srcdoc', 'location.', 'history.']) {
    assert.ok(!EDITOR_HTML.includes(bad), `the page does not use ${bad}`);
  }
});

test('the page carries its own strict policy: nothing may be fetched, framed or submitted', () => {
  assert.ok(EDITOR_HTML.includes(`content="${POLICY}"`));
  for (const want of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "img-src data:"]) assert.ok(POLICY.includes(want), want);
  assert.ok(!/script-src[^;]*(https?:|\*)/.test(POLICY) && !/'unsafe-eval'/.test(POLICY));
});

test('the chat panel hides what only the computer page may offer (the build and render button, the "Kept on this computer" pill) and says where saving happens', () => {
  assert.ok(EDITOR_HTML.includes('.le-pill,.le-top .button.primary{display:none}'));
  assert.ok(EDITOR_HTML.includes('Changes here are drafts that Ryagram keeps. Save or build the film in the Ryagram app.'));
});

test('the page has no non-ASCII character (the file is escaped) and no control character', () => {
  const src = fs.readFileSync(new URL('../' + OUT, import.meta.url), 'utf8');
  assert.ok(!/[^\x20-\x7e\r\n\t]/.test(src));
});

// ------------------------------------------------------------------------------------------------ the host seam, run in a fake window
function load() {
  const sent = [], listeners = {};
  const parent = { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) };
  const other = { postMessage: () => assert.fail('wrote to a window that is not the host') };
  const win = { parent };
  const ctx = { window: win, addEventListener: (n, f) => { (listeners[n] ||= []).push(f); }, setTimeout, clearTimeout, Promise, Error, JSON, Number, Math, Map, String, Array, Object, RegExp,
    document: { getElementById: () => null, createElement: () => ({}), body: {}, documentElement: { getBoundingClientRect: () => ({ height: 400, width: 600 }) } } };
  vm.runInNewContext(HOST_SRC, ctx, { timeout: 2000 });
  const fire = (data, source = parent) => (listeners.message || []).forEach((f) => f({ source, data }));
  const reply = (id, rest) => fire({ jsonrpc: '2.0', id, ...rest });
  const last = (method) => sent.filter((s) => s.method === method).at(-1);
  return { sent, parent, other, win, host: win.ryagramLiveHost, fire, reply, last, rpc: (n, a) => win.ryagramLiveHost.rpc(n, a) };
}
const calls = (p) => p.sent.filter((s) => s.method === 'tools/call');
const ok = (data) => ({ result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { data } } });
const bad = (error) => ({ result: { isError: true, content: [{ type: 'text', text: 'no' }], structuredContent: { error } } });

test('the host seam offers exactly the five editor names and asks for nothing else', () => {
  const m = /const NAMES = (\[[^\]]*\])/.exec(HOST_SRC);
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), NAMES);
});

test('an unknown name is refused before anything is sent', async () => {
  const p = load();
  for (const name of ['set_look', 'request_full_render', 'ui/message', 'editor_apply_ops ', '__proto__']) {
    await assert.rejects(p.rpc(name, {}), /Not an editor call/);
  }
  assert.equal(calls(p).length, 0);
});

test('the panel starts the handshake, says it is ready only after the host answers, and reports its height', () => {
  const p = load();
  const init = p.last('ui/initialize');
  assert.equal(init.params.protocolVersion, '2026-01-26');
  assert.deepEqual(init.params.appCapabilities.availableDisplayModes, ['inline', 'fullscreen']);
  assert.ok(!p.last('ui/notifications/initialized'));
  p.reply(init.id, { result: { protocolVersion: '2026-01-26', hostContext: { availableDisplayModes: ['inline'] } } });
  return new Promise((r) => setTimeout(r, 20)).then(() => {
    assert.ok(p.last('ui/notifications/initialized'));
    assert.equal(p.last('ui/notifications/size-changed').params.height, 400);
  });
});

test('a call is one tools/call with the name and arguments as given, and the answer is read as data', async () => {
  const p = load();
  const pr = p.rpc('editor_apply_ops', { p_project: PROJECT, p_mode: 'compilation', p_base_revision: 2, p_ops: [{ op: 'move_clip', id: 'v1', start: 1 }] });
  const c = calls(p)[0];
  assert.deepEqual(c.params, { name: 'editor_apply_ops', arguments: { p_project: PROJECT, p_mode: 'compilation', p_base_revision: 2, p_ops: [{ op: 'move_clip', id: 'v1', start: 1 }] } });
  p.reply(c.id, ok({ revision: 3 }));
  assert.deepEqual(plain(await pr), { data: { revision: 3 }, error: null });
});

test('a refusal keeps its code and its words, cleaned and cut; a bad or missing answer reads as "did not answer"', async () => {
  let p = load();
  let pr = p.rpc('editor_apply_ops', { p_project: PROJECT });
  p.reply(calls(p)[0].id, bad({ code: 'PT409', message: 'Stale\u0000 \u202eby\nnow' + 'x'.repeat(400) }));
  let r = plain(await pr);
  assert.equal(r.data, null); assert.equal(r.error.code, 'PT409');
  assert.ok(r.error.message.startsWith('Stale   by now') && r.error.message.length === 300 && !/[\u0000-\u001f\u202e]/.test(r.error.message));
  for (const odd of [{ result: {} }, { result: { structuredContent: 'x' } }, { result: { structuredContent: null } }, { error: { code: -32601, message: 'Tool is not visible' } }, { result: 'text' }]) {
    p = load(); pr = p.rpc('my_edit_ops_since', { p_project: PROJECT });
    p.reply(calls(p)[0].id, odd);
    r = plain(await pr);
    assert.equal(r.data, null); assert.equal(r.error.code, null); assert.match(r.error.message, /did not answer/, JSON.stringify(odd));
  }
  p = load(); pr = p.rpc('my_edit_ops_since', { p_project: PROJECT });
  p.reply(calls(p)[0].id, bad({ code: { x: 1 }, message: 7 }));
  r = plain(await pr);
  assert.equal(r.error.code, null); assert.equal(typeof r.error.message, 'string');
});

test('only the host is believed: an answer from another window or a wrong version does not settle a call', async () => {
  const p = load();
  const pr = p.rpc('editor_heartbeat', { p_project: PROJECT });
  const id = calls(p)[0].id;
  let done = false; pr.then(() => { done = true; });
  p.fire({ jsonrpc: '2.0', id, ...ok({ forged: true }) }, p.other);
  p.fire({ jsonrpc: '1.0', id, ...ok({ forged: true }) });
  p.fire('x'); p.fire(null); p.fire([1]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done, false);
  p.reply(id, ok(null));
  assert.deepEqual(plain(await pr), { data: null, error: null });
});

test('the AI is told ONCE, in one short line without the person\'s words, after a burst of changes (not on every poll or heartbeat)', async () => {
  const p = load();
  const b = p.rpc('editor_undo', { p_project: PROJECT, p_op_id: 'x' }); p.reply(calls(p)[0].id, ok({ revision: 6 })); await b;
  const hb = p.rpc('editor_heartbeat', { p_project: PROJECT }); p.reply(calls(p)[1].id, ok(null)); await hb;
  const po = p.rpc('my_edit_ops_since', { p_project: PROJECT }); p.reply(calls(p)[2].id, ok({ revision: 6, ops: [] })); await po;
  const a = p.rpc('editor_apply_ops', { p_project: PROJECT, p_ops: [{ op: 'set_clip_text', id: 't1', text: 'SECRET words' }, { op: 'move_clip', id: 'v1', start: 2 }] });
  p.reply(calls(p)[3].id, ok({ revision: 7 })); await a;
  await new Promise((r) => setTimeout(r, 1000));
  const told = p.sent.filter((s) => s.method === 'ui/update-model-context');
  assert.equal(told.length, 1, 'one line for the whole burst');
  const t = told[0].params.content[0].text;
  assert.match(t, /editing in the Ryagram panel/); assert.match(t, /2 changes so far/); assert.match(t, /set_clip_text, move_clip/); assert.match(t, /Revision 7/); assert.match(t, /get_edit_state/);
  assert.ok(!t.includes('SECRET') && !t.includes('t1') && t.length < 400);
  assert.ok(!p.sent.some((s) => s.method === 'ui/message'), 'never a chat message');
});

test('this panel own edits come back from the log as the person, so the page does not apply them twice; another AI edits stay the AI', async () => {
  const p = load();
  const pr = p.rpc('my_edit_ops_since', { p_project: PROJECT, p_mode: 'compilation', p_revision: 0 });
  p.reply(calls(p)[0].id, ok({ revision: 5, mirrored: true, ops: [
    { id: 1, revision: 1, actor: 'ai', client: 'Ryagram panel', op: { op: 'move_clip' } },
    { id: 2, revision: 2, actor: 'ai', client: 'Claude', op: { op: 'set_clip_text' } },
    { id: 3, revision: 3, actor: 'person', client: null, op: { op: 'trim_clip' } },
    { id: 4, revision: 4, actor: 'person', client: 'Ryagram panel', op: { op: 'trim_clip' } },
    { id: 5, revision: 5, actor: 'ai', client: 'ryagram panel', op: { op: 'delete_clip' } }, null, 7] }));
  const r = plain(await pr);
  assert.deepEqual(r.data.ops.slice(0, 5).map((o) => [o.id, o.actor]), [[1, 'person'], [2, 'ai'], [3, 'person'], [4, 'person'], [5, 'ai']]);
  assert.equal(r.data.revision, 5); assert.equal(r.data.mirrored, true);
  assert.deepEqual(r.data.ops.slice(5), [null, 7]);
});

test('only the log read is rewritten: an answer to any other call keeps its rows as they are', async () => {
  const p = load();
  const pr = p.rpc('editor_apply_ops', { p_project: PROJECT, p_ops: [{ op: 'move_clip' }] });
  p.reply(calls(p)[0].id, ok({ revision: 2, ops: [{ id: 1, actor: 'ai', client: 'Ryagram panel' }] }));
  assert.equal(plain(await pr).data.ops[0].actor, 'ai');
});

test('an undo is reported as an undo', async () => {
  const p = load();
  const b = p.rpc('editor_undo', { p_project: PROJECT, p_op_id: 'x' }); p.reply(calls(p)[0].id, ok({ revision: 8 })); await b;
  await new Promise((r) => setTimeout(r, 1000));
  const t = p.sent.filter((s) => s.method === 'ui/update-model-context')[0].params.content[0].text;
  assert.match(t, /an undo/); assert.match(t, /Revision 8/);
});

test('a refused change is not reported to the AI as a change', async () => {
  const p = load();
  const a = p.rpc('editor_apply_ops', { p_project: PROJECT, p_ops: [{ op: 'move_clip', id: 'v1', start: 2 }] });
  p.reply(calls(p)[0].id, bad({ code: 'PT409', message: 'stale' })); await a;
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(p.sent.filter((s) => s.method === 'ui/update-model-context').length, 0);
});

test('the opening result names the film: a proper id is used, a bad one is not, a title is cleaned, and a second result does not move the panel to another film', () => {
  for (const id of ['../../etc', '', 'short', 'a'.repeat(65), 'has space ok1234', 7, null, { a: 1 }]) {
    const p = load();
    p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { project_id: id, mode: 'data', title: 'x' } } });
    assert.equal(p.host.project, '', JSON.stringify(id));
  }
  const p = load();
  p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { project_id: PROJECT, mode: 'weird', title: 'T\u0000i\u202etle' + 'y'.repeat(200) } } });
  assert.equal(p.host.project, PROJECT); assert.equal(p.host.mode, 'compilation');
  assert.ok(p.host.title.startsWith('T i tle') && p.host.title.length === 80 && !/[\u0000-\u001f\u202e]/.test(p.host.title));
  const other = '00000000-0000-4000-8000-0000000000b2';
  p.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { project_id: other, mode: 'data' } } });
  assert.equal(p.host.project, PROJECT);
  const q = load();
  q.fire({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { project_id: PROJECT, mode: 'data' } } });
  assert.equal(q.host.mode, 'data');
});

test('the build call starts nothing: it answers with a sentence that says where the film is built', async () => {
  const p = load();
  const r = await p.host.render();
  assert.deepEqual(Object.keys(r), ['error']); assert.match(r.error, /built in the Ryagram app/);
  assert.equal(calls(p).length, 0);
  assert.equal(p.host.frame, undefined); assert.equal(p.host.textRules, undefined);
});

test('the host\'s requests are answered: teardown with {}, anything else refused the JSON-RPC way', () => {
  const p = load(); const n = p.sent.length;
  p.fire({ jsonrpc: '2.0', id: 5, method: 'ui/resource-teardown', params: {} });
  p.fire({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'request_full_render' } });
  const out = p.sent.slice(n);
  assert.deepEqual(out.find((m) => m.id === 5), { jsonrpc: '2.0', id: 5, result: {} });
  assert.equal(out.find((m) => m.id === 6).error.code, -32601);
});

test('the seam never calls a tool by any name but the five, and never sends a chat message, a link or a model-context update except the one line', () => {
  const methods = new Set([...HOST_SRC.matchAll(/(?:request|notify)\('([a-z/-]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...methods].sort(), ['tools/call', 'ui/initialize', 'ui/notifications/initialized', 'ui/notifications/size-changed', 'ui/request-display-mode', 'ui/update-model-context']);
  assert.ok(!/ui\/message|ui\/open-link/.test(HOST_SRC));
  assert.equal((HOST_SRC.match(/request\('tools\/call'/g) || []).length, 1, 'one place makes a tool call, and it is guarded by the name list');
});
