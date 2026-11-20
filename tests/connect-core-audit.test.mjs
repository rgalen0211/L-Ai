// Connector-core audit 2026-11-20: behaviours that had no test, and four that were wrong. Offline, invented data, the in-memory stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp, toolList, PROTOCOLS } from '../supabase/functions/connect-core/mcp.ts';
import { handleRest, openApi } from '../supabase/functions/connect-core/rest.ts';
import { callerKey } from '../supabase/functions/connect-core/oauth.ts';
import { checkStoryStructured } from '../supabase/functions/connect-core/story_check.ts';
import { checkSvg } from '../supabase/functions/connect-core/film_card.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';
import { build } from '../supabase/functions/_shared/templates.ts';
import storySchema from '../supabase/functions/_shared/story_schema.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const BASE = 'https://x.test/functions/v1/connect';

function world(deps = {}) {
  const w = new FakeWorld(); w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId, ['read', 'write', 'render_free']); w.issue('tok-alice', A);
  const env = { data: w.data(A.userId), policy: w.policy(), deps: { compile, ...deps } };
  const mcpDeps = { ...env, verifyToken: w.verifyToken, dataFor: (_t, p) => w.data(p.userId), resourceMetadataUrl: BASE + '/.well-known/oauth-protected-resource' };
  return { w, env, mcpDeps, call: (name, args) => callTool(name, args, A, env) };
}

// ------------------------------------------------------------------------------------------------ set_story: the catalog check
test('a dataset named like a built-in object key (constructor, __proto__) is not in the catalog: set_story refuses it and saves nothing', async () => {
  for (const ds of ['constructor', '__proto__']) {
    const s = build('map', 'state_obesity_fastfood', 'Invented headline');
    s.sequence.clips.find((c) => c.kind === 'render').dataset = ds;
    const r = checkStoryStructured(s, compile(storySchema));
    assert.equal(r.ok, false, ds);
    assert.match(r.plain.join(' '), /not in the Ryagram catalog/, ds);
  }
  const { call } = world();
  const id = (await call('create_project', { title: 'Invented proto film' })).data.project_id;
  const s = build('map', 'state_obesity_fastfood', 'Invented headline');
  s.sequence.clips.find((c) => c.kind === 'render').dataset = 'constructor';
  const r = await call('set_story', { project_id: id, story: s });
  assert.equal(r.data.saved, false);
  assert.equal(r.code, 'checks_failed');
  const ok = build('map', 'state_obesity_fastfood', 'Invented headline');
  assert.equal(checkStoryStructured(ok, compile(storySchema)).ok, true, 'control: a real catalog dataset still passes');
});

// ------------------------------------------------------------------------------------------------ the OpenAPI document lists what REST can call
test('OpenAPI lists exactly the tools REST lists: no unlisted tool, no chat-editor tool, no home-panel tool (REST answers "no such tool" for those)', async () => {
  const paths = Object.keys(openApi(BASE).paths).sort();
  assert.deepEqual(paths, toolList().map((t) => `/v1/tools/${t.name}`).sort());
  for (const n of ['request_full_render', 'get_clip_explanations', 'editor_apply_ops', 'editor_film_card', 'open_editor', 'open_ryagram_home', 'forecast_series']) assert.ok(!paths.includes(`/v1/tools/${n}`), n);
  assert.ok(paths.includes('/v1/tools/whoami_and_credits') && paths.includes('/v1/tools/set_story'));
  const { mcpDeps } = world();
  const r = await handleRest(new Request(BASE + '/v1/tools/open_ryagram_home', { method: 'POST', headers: { authorization: 'Bearer tok-alice' }, body: '{}' }), '/v1/tools/open_ryagram_home', mcpDeps, BASE);
  assert.match((await r.json()).text, /There is no tool called/, 'control: what the document no longer lists really is not callable here');
});

// ------------------------------------------------------------------------------------------------ forecast_series: the horizon limit the description states
test('forecast_series refuses a horizon of more than half the years given, before asking anything (the engine would refuse it later)', async () => {
  const series = [[2015, 100], [2016, 102], [2017, 104], [2018, 105], [2019, 108], [2020, 109]];
  const { w, call } = world({ forecast: { enabled: () => true } });
  const rows = () => [...w.users.get(A.userId).geo.values()];
  const tooFar = await call('forecast_series', { series, horizon: 4 });
  assert.equal(tooFar.isError, true); assert.equal(tooFar.code, 'args'); assert.match(tooFar.text, /half/); assert.match(tooFar.text, /Nothing was asked/);
  assert.equal(rows().length, 0, 'nothing was written');
  const fine = await call('forecast_series', { series, horizon: 3 });
  assert.equal(fine.isError, undefined, fine.text); assert.equal(rows().length, 1);
});

// ------------------------------------------------------------------------------------------------ the drawn still: a CSS escape in an attribute
test('a drawn still whose attribute carries a backslash (a CSS escape that could spell url() ) is refused; a plain one passes', () => {
  const bs = String.fromCharCode(92);
  const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect fill="${fill}" width="5" height="5"/></svg>`;
  assert.deepEqual(checkSvg(svg('#336699')), []);
  assert.equal(checkSvg(svg('url(x.svg#a)')).length, 1, 'control: a plain url( to something off the picture is already refused');
  assert.equal(checkSvg(svg(bs + '75rl(x.svg#a)')).length, 1);
  assert.equal(checkSvg(svg(bs + '68ttps:example.org/x.svg#a)')).length, 1);
});

// ------------------------------------------------------------------------------------------------ no test existed for these
test('callerKey: the LAST forwarded hop counts (the first is the caller\'s to forge), the CDN header wins, no address = no key, and the key never holds the address', async () => {
  const req = (h) => new Request(BASE + '/register', { method: 'POST', headers: h });
  const k1 = await callerKey(req({ 'x-forwarded-for': '6.6.6.6, 9.9.9.9' })), k2 = await callerKey(req({ 'x-forwarded-for': '7.7.7.7, 9.9.9.9' })), k3 = await callerKey(req({ 'x-forwarded-for': '6.6.6.6, 8.8.8.8' }));
  assert.equal(k1, k2, 'a forged first hop changes nothing'); assert.notEqual(k1, k3);
  assert.equal(await callerKey(req({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' })), k1, 'the CDN header is the address when present');
  assert.equal(await callerKey(req({})), null);
  assert.match(k1, /^[0-9a-f]{64}$/); assert.ok(!k1.includes('9.9.9.9'));
});

test('REST: a body that is not JSON is 400, an oversize body 413, a wrong method 405, and a body that is not an object is refused by the gate', async () => {
  const { mcpDeps } = world();
  const post = (body, headers = {}, path = '/v1/tools/whoami_and_credits', method = 'POST') => handleRest(new Request(BASE + path, { method, headers: { authorization: 'Bearer tok-alice', ...headers }, body }), path, mcpDeps, BASE);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post('{}', { 'content-length': String(LIMITS.maxBodyBytes + 1) })).status, 413);
  assert.equal((await post('x'.repeat(LIMITS.maxBodyBytes + 1))).status, 413);
  assert.equal((await post(undefined, {}, '/v1/tools/whoami_and_credits', 'GET')).status, 405);
  assert.equal((await post(undefined, {}, '/v1/tools', 'POST')).status, 405);
  const arr = await (await post('[1]')).json();
  assert.equal(arr.isError, true); assert.match(arr.text, /JSON object/);
  const empty = await (await post('')).json();
  assert.equal(empty.isError, false, 'an empty body means no arguments');
});

test('MCP: initialize answers with the version the client asked for when Ryagram speaks it, else the newest; a notification is accepted with 202 and no body', async () => {
  const { mcpDeps } = world();
  const rpc = async (msg) => handleMcp(new Request(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-alice' }, body: JSON.stringify(msg) }), mcpDeps);
  for (const v of PROTOCOLS) assert.equal((await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v } })).json()).result.protocolVersion, v);
  assert.equal((await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json()).result.protocolVersion, PROTOCOLS[0]);
  assert.equal((await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })).json()).result.protocolVersion, PROTOCOLS[0]);
  const n = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(n.status, 202); assert.equal(await n.text(), '');
});
