// The connector's side of the signed read link (plan 5.3): open_editor hands the chat panel ONE link, in the result's _meta (for the app view, never the model's text), only when the secret and the function's
// address are both set, only for a data film, and never anywhere else. The link's own rules are tested in tests/connect-read-link.test.mjs; the database question in supabase/tests/test_editor_link.py.
// Must-fails: tests/connect_read_link_connector_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp } from '../supabase/functions/connect-core/mcp.ts';
import { verifyLink, ownerHash, LINK_MAX_SECONDS } from '../supabase/functions/editor-bundle/core.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
const R = { tokenHash: 'h-ro', userId: 'u-ro', clientId: 'client-ro' };
const SCOPES = ['read', 'write', 'render_free', 'edit'];
const KEY = 'connector-link-key-' + 'z9y8x7w6'.repeat(5);
const BASE = 'https://ref.functions.supabase.co/editor-bundle';
const T0 = 1_800_000_000;
const META = 'ryagram/editor_bundle';
const ON = { enabled: true, chatEditor: true, appUrl: 'https://uselai.com/app/' };

function world({ link = 'on' } = {}) {
  const w = new FakeWorld();
  for (const [p, mail] of [[A, 'alice'], [B, 'bob'], [R, 'ro']]) w.addUser(p.userId, `${mail}@example.test`, 100);
  w.invite(A.userId, A.clientId, SCOPES); w.invite(B.userId, B.clientId, SCOPES); w.invite(R.userId, R.clientId, ['read', 'write', 'render_free']);
  let n = 0;
  const editorLink = link === 'on' ? { secret: () => KEY, baseUrl: BASE, now: () => T0, jti: () => 'jti-connector-' + (++n) }
    : link === 'nosecret' ? { secret: () => undefined, baseUrl: BASE, now: () => T0, jti: () => 'jti-x-' + (++n) }
    : link === 'shortsecret' ? { secret: () => 'short', baseUrl: BASE, now: () => T0, jti: () => 'jti-x-' + (++n) }
    : link === 'nobase' ? { secret: () => KEY, baseUrl: undefined, now: () => T0, jti: () => 'jti-x-' + (++n) }
    : undefined;
  const env = (p, extra = {}) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile, ...(editorLink ? { editorLink } : {}) }, chatEditor: true, ...extra });
  const call = (p, name, args, extra) => callTool(name, args, p, env(p, extra));
  return { w, call, env };
}
const project = async (call, p = A) => (await call(p, 'create_project', { title: 'Editor' })).data.project_id;
const open = (call, id, p = A, mode = 'data') => call(p, 'open_editor', { project_id: id, mode });

test('OFF: with no link settings, or a missing secret, a missing address, a database without the function, or a secret too short to sign with, open_editor answers exactly as before: no _meta, and the call still works', async () => {
  const base = world({ link: 'off' });
  const id0 = await project(base.call);
  const plain = await open(base.call, id0);
  assert.equal(plain.isError, undefined); assert.equal(plain.meta, undefined);
  for (const link of ['nosecret', 'nobase', 'shortsecret']) {
    const w = world({ link });
    const id = await project(w.call);
    const r = await open(w.call, id);
    assert.equal(r.isError, undefined, link); assert.equal(r.meta, undefined, link);
    assert.equal(r.text.replace(id, 'ID'), plain.text.replace(id0, 'ID'), link + ': the same words'); assert.deepEqual(r.data, { ...plain.data, project_id: id });
  }
  const noFn = world();
  const id = await project(noFn.call);
  const env = noFn.env(A); const data = Object.create(env.data); data.editorLinkOwner = undefined;
  const r = await callTool('open_editor', { project_id: id, mode: 'data' }, A, { ...env, data });
  assert.equal(r.isError, undefined); assert.equal(r.meta, undefined, 'a database that does not have the function gives no link');
});

test('ON: a data film gets ONE link in _meta, good for 10 minutes for this project and this person, and the link is not in the words or the data', async () => {
  const { call } = world();
  const id = await project(call);
  const r = await open(call, id);
  assert.equal(r.isError, undefined);
  const link = r.meta[META];
  assert.deepEqual(Object.keys(link).sort(), ['expires_at', 'url']);
  assert.equal(link.expires_at, T0 + LINK_MAX_SECONDS);
  assert.ok(link.url.startsWith(BASE + '/'));
  const token = link.url.slice(BASE.length + 1);
  const claims = await verifyLink(KEY, token, T0);
  assert.equal(claims.project_id, id); assert.equal(claims.owner_hash, await ownerHash(A.userId));
  assert.ok(!r.text.includes(token) && !JSON.stringify(r.data).includes(token), 'the model reads text and data; the link is in neither');
  assert.ok(!r.text.includes(BASE), 'nor its address');
  assert.deepEqual(Object.keys(r.meta), [META]);
});

test('ON: a clip film gets no link (its pictures stay on the PC), a film that is not the person\'s is refused with no link, and a connection without the edit scope is refused', async () => {
  const { w, call } = world();
  const id = await project(call);
  const closed = await open(call, id, A, 'compilation');
  assert.equal(closed.code, 'not_shared'); assert.equal(closed.meta, undefined);
  w.mirror(A.userId, id, { duration: 12, clips: [{ id: 'c1', track: 'video', start: 0, len: 4, label: 'Intro' }] }, true);
  const comp = await open(call, id, A, 'compilation');
  assert.equal(comp.isError, undefined, 'the clip film opens once the track list is shared');
  assert.equal(comp.meta, undefined, 'and still gets no link: its pictures stay on the PC');
  const bobsLook = await open(call, id, B);
  assert.equal(bobsLook.isError, true); assert.equal(bobsLook.code, 'not_found'); assert.equal(bobsLook.meta, undefined); assert.ok(!JSON.stringify(bobsLook).includes(BASE));
  const ro = await open(call, id, R);
  assert.equal(ro.isError, true); assert.equal(ro.meta, undefined);
});

test('every link is its own: two openings give two different links; a link made for one project is refused for another', async () => {
  const { call } = world();
  const id1 = await project(call), id2 = await project(call);
  const a = (await open(call, id1)).meta[META].url, b = (await open(call, id1)).meta[META].url, c = (await open(call, id2)).meta[META].url;
  assert.notEqual(a, b); assert.notEqual(a, c);
  const claims = await Promise.all([a, b, c].map((u) => verifyLink(KEY, u.slice(BASE.length + 1), T0)));
  assert.deepEqual(claims.map((x) => x.project_id), [id1, id1, id2]);
  assert.equal(new Set(claims.map((x) => x.jti)).size, 3, 'each has its own id');
});

// ------------------------------------------------------------------------------------------------ over the MCP transport
function server(mcpApp) {
  const { w, env } = world();
  w.issue('tok-a', A);
  const e = env(A, { chatEditor: undefined });
  const deps = { data: null, policy: e.policy, deps: e.deps, verifyToken: w.verifyToken, dataFor: () => e.data, resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource', ...(mcpApp === undefined ? {} : { mcpApp }) };
  const raw = async (method, params, token = 'tok-a') => handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps);
  const rpc = async (method, params, token) => JSON.parse(await (await raw(method, params, token)).text());
  return { w, rpc, raw };
}

test('over MCP: only the open_editor answer carries _meta with the link; no other answer carries it, and the logs never hold it', async () => {
  const { w, rpc } = server(ON);
  const created = await rpc('tools/call', { name: 'create_project', arguments: { title: 'Editor' } });
  const id = created.result.structuredContent.project_id;
  const opened = await rpc('tools/call', { name: 'open_editor', arguments: { project_id: id, mode: 'data' } });
  const link = opened.result._meta[META];
  assert.ok(link.url.startsWith(BASE + '/'));
  const token = link.url.slice(BASE.length + 1);
  const others = [];
  for (const [name, args] of [['whoami_and_credits', {}], ['list_projects', {}], ['get_edit_state', { project_id: id }], ['create_project', { title: 'Two' }],
    ['editor_apply_ops', { p_project: id, p_mode: 'data', p_base_revision: 0, p_ops: [{ op: 'set_look', key: 'state.fill', value: '#112233' }] }], ['my_edit_ops_since', { p_project: id, p_mode: 'data', p_revision: 0 }],
    ['open_editor', { project_id: id, mode: 'compilation' }], ['nope_not_a_tool', {}]]) {
    const r = await rpc('tools/call', { name, arguments: args });
    others.push(JSON.stringify(r));
    assert.equal(r.result?._meta, undefined, name);
  }
  assert.ok(others.every((s) => !s.includes(token)), 'no other answer holds the link');
  assert.ok(!JSON.stringify(opened.result.content).includes(token) && !JSON.stringify(opened.result.structuredContent).includes(token), 'the text and the data of the open_editor answer do not either');
  assert.ok(!JSON.stringify(w.logs).includes(token), 'the call log never holds it');
});

test('over MCP: the link used as a bearer token on the connector is refused (it is not a session, and no connector tool accepts it)', async () => {
  const { rpc, raw } = server(ON);
  const created = await rpc('tools/call', { name: 'create_project', arguments: { title: 'Editor' } });
  const id = created.result.structuredContent.project_id;
  const token = (await rpc('tools/call', { name: 'open_editor', arguments: { project_id: id, mode: 'data' } })).result._meta[META].url.split('/').pop();
  const res = await raw('tools/call', { name: 'list_projects', arguments: {} }, token);
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes(token));
});

test('over MCP with the chat editor off: open_editor does not exist and nothing carries _meta', async () => {
  for (const cfg of [undefined, { enabled: true }, { enabled: true, chatEditor: false }]) {
    const { rpc } = server(cfg);
    const created = await rpc('tools/call', { name: 'create_project', arguments: { title: 'Editor' } });
    const r = await rpc('tools/call', { name: 'open_editor', arguments: { project_id: created.result.structuredContent.project_id, mode: 'data' } });
    assert.equal(r.result._meta, undefined); assert.equal(r.result.isError, true);
  }
});

test('the entry point makes a link only for an https address and only with the secret; the function secret and the address are named once each', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/connect/index.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('Deno.env.get("EDITOR_LINK_KEY")') && src.includes('Deno.env.get("CONNECT_EDITOR_BUNDLE_URL")'));
  assert.ok(src.includes('/^https:[/][/][a-z0-9.-]+([/][A-Za-z0-9_-]+)*$/.test(bundleBase) ? bundleBase : undefined'), 'only an https address of letters, digits, dots and dashes with plain path words');
  assert.equal(src.split('Deno.env.get("EDITOR_LINK_KEY")').length - 1, 1, 'the secret is read in one place');
  const fn = fs.readFileSync(new URL('../supabase/functions/editor-bundle/index.ts', import.meta.url), 'utf8');
  assert.ok(!/service_role|SERVICE_ROLE/.test(fn.replace(/\/\/.*$/gm, '')) && fn.includes('guardedServe') && fn.includes('"editor_link_check"'), 'the function uses the house service-key guard and asks only editor_link_check');
  assert.ok(/async object\(\) \{ return null; \}/.test(fn), 'until the bundle\'s home is decided nothing is read from storage');
});
