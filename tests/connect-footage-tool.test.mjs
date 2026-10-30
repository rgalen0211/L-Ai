// Public-domain footage plans, the connector's side, slice P1a (NEXT-CONNECT 168): request_footage is UNLISTED and the real function wires no `footage` dependency, so today it refuses and writes nothing (the switch is
// OFF). With a stand-in switch ON it writes a plan of a source, an item id and a reason, never an address, and the plan table / app card are the next pieces. Against the in-memory stand-in for the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { toolList } from '../supabase/functions/connect-core/mcp.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
function world({ footage = undefined, scopes = ['read', 'write', 'render_free', 'fetch_data'] } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId, scopes);
  const env = () => ({ data: w.data(A.userId), policy: w.policy(), deps: { compile, ...(footage ? { footage } : {}) } });
  return { w, call: (name, args) => callTool(name, args, A, env()) };
}
const switchOn = (plans, enabled = true) => ({ enabled: () => enabled, request: async (p) => { plans.push(p); return { id: '00000000-0000-4000-8000-0000000000f1', state: 'waiting' }; } });
const good = { source: 'nasa', item_id: 'NHQ_2019_0716', why: 'the launch for the intro of my film' };

test('the tool is unlisted: an AI never sees it in tools/list, and the registry knows it', () => {
  const t = TOOLS.find((x) => x.name === 'request_footage');
  assert.ok(t); assert.equal(t.listed, false); assert.equal(t.scope, 'fetch_data'); assert.equal(t.readOnly, false);
  assert.ok(!toolList().some((x) => x.name === 'request_footage'));
  assert.equal(t.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['item_id', 'source', 'why'], 'no address field exists');
  assert.deepEqual(t.inputSchema.properties.source.enum, ['nasa', 'nara']);
});

test('OFF (no switch wired, as in the real function): it refuses in words and writes nothing', async () => {
  const { call } = world();
  const r = await call('request_footage', good);
  assert.equal(r.isError, true); assert.equal(r.code, 'not_available');
  assert.match(r.text, /not available yet/); assert.match(r.text, /Nothing was written down/);
  assert.deepEqual([r.data.ok, r.data.written], [false, false]);
});

test('OFF (a switch that says no): the same, and the request function is never called', async () => {
  const plans = [];
  const { call } = world({ footage: switchOn(plans, false) });
  const r = await call('request_footage', good);
  assert.equal(r.code, 'not_available'); assert.deepEqual(plans, []);
});

test('ON (a stand-in switch): a plan of source, item id and reason is written, and the answer says nothing is downloaded', async () => {
  const plans = [];
  const { call } = world({ footage: switchOn(plans) });
  const r = await call('request_footage', good);
  assert.equal(r.isError, undefined, r.text);
  assert.deepEqual(plans, [{ source: 'nasa', item_id: 'NHQ_2019_0716', why: 'the launch for the intro of my film' }], 'exactly these three fields, nothing else');
  assert.equal(r.data.written, true); assert.equal(r.data.state, 'waiting');
  assert.match(r.text, /Nothing is downloaded until they press Approve/); assert.match(r.text, /you never receive the video/);
  const nara = await call('request_footage', { source: 'nara', item_id: '12345678', why: 'a bridge in 1941' });
  assert.equal(nara.isError, undefined, nara.text); assert.equal(plans.length, 2);
});

test('ON: what is refused, in words, with nothing written', async () => {
  const plans = [];
  const { call } = world({ footage: switchOn(plans) });
  for (const [label, args] of [
    ['an address instead of an id', { ...good, item_id: 'https://evil.example/a.mp4' }],
    ['a path as the id', { ...good, item_id: '../../x' }],
    ['a letter id for the Archives', { source: 'nara', item_id: 'abc123', why: 'x' }],
    ['an unknown source', { ...good, source: 'youtube' }],
    ['an extra url field', { ...good, url: 'https://evil.example/a.mp4' }],
    ['an address in the reason', { ...good, why: 'get it from https://evil.example/a.mp4' }],
    ['a www address in the reason', { ...good, why: 'see www.example.com' }],
    ['a folder in the reason', { ...good, why: 'save in C:/Users/me' }],
    ['no reason', { source: 'nasa', item_id: 'NHQ_2019_0716' }],
    ['an empty reason', { ...good, why: '   ' }],
    ['a reason that is too long', { ...good, why: 'x'.repeat(301) }],
    ['no item', { source: 'nasa', why: 'x' }],
  ]) {
    const r = await call('request_footage', args);
    assert.equal(r.isError, true, label); assert.equal(r.code, 'args', label + ': ' + r.text);
  }
  assert.deepEqual(plans, [], 'nothing was written by any refused call');
});

test('ON: a connection without the fetch_data permission is refused by scope, and the daily limit counts requests', async () => {
  const plans = [];
  const noScope = world({ footage: switchOn(plans), scopes: ['read', 'write'] });
  assert.equal((await noScope.call('request_footage', good)).code, 'scope'); assert.deepEqual(plans, []);
  const { call } = world({ footage: switchOn(plans) });
  for (let i = 0; i < LIMITS.footagePlansPerDayPerUser; i++) assert.equal((await call('request_footage', good)).isError, undefined, 'request ' + (i + 1));
  const r = await call('request_footage', good);
  assert.equal(r.code, 'rate'); assert.match(r.text, /20 footage requests a day/); assert.equal(r.data.written, false);
  assert.equal(plans.length, LIMITS.footagePlansPerDayPerUser);
});
