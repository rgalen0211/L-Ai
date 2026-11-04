// set_compilation_request: title / end CARDS (BUILDER 11-04, "words-only cards"): the person's own words on the film's page colour, up to 4, start or end. DATA only, like every other field;
// the desktop app builds them. Against the connector's own code and its in-memory stand-in world. Must-fails are in tests/connect_request_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };

function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId);
  const call = (p, name, args) => callTool(name, args, p, { data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  return { w, call };
}
const project = async (call) => (await call(A, 'create_project', { title: 'Cards' })).data.project_id;
const GOOD = (project_id) => ({ project_id, phrase: 'great news', folders: ['My Videos'] });
const card = (o = {}) => ({ text: 'A film about good news', where: 'start', seconds: 3, ...o });

test('the schema offers cards: at most 4, each {text, where start|end, seconds 0.5-10}, nothing else', () => {
  const p = TOOLS.find((t) => t.name === 'set_compilation_request').inputSchema.properties.cards;
  assert.equal(p.type, 'array');
  assert.equal(p.maxItems, 4);
  assert.deepEqual(p.items.required, ['text', 'where', 'seconds']);
  assert.equal(p.items.additionalProperties, false);
  assert.deepEqual(p.items.properties.where.enum, ['start', 'end']);
  assert.deepEqual([p.items.properties.seconds.minimum, p.items.properties.seconds.maximum, p.items.properties.text.maxLength], [0.5, 10, 120]);
});

test('cards are saved exactly as written, in order, and counted in the answer; the words are cleaned like every other text', async () => {
  const { w, call } = world();
  const id = await project(call);
  const r = await call(A, 'set_compilation_request', { ...GOOD(id), cards: [card({ text: '  A film   about good news ' }), card({ where: 'end', seconds: 5.5, text: 'Thanks for watching' })] });
  assert.equal(r.isError, undefined, r.text);
  assert.equal(r.data.cards, 2);
  const q = w.users.get(A.userId).requests.get(id).request;
  assert.deepEqual(q.cards, [{ text: 'A film about good news', where: 'start', seconds: 3 }, { text: 'Thanks for watching', where: 'end', seconds: 5.5 }]);
  assert.equal(w.users.get(A.userId).requests.get(id).sha256, r.data.request_sha256);
});

test('no cards given: the saved request has NO cards key (older requests and drafts are exactly as before) and the answer counts 0', async () => {
  const { w, call } = world();
  const id = await project(call);
  const r = await call(A, 'set_compilation_request', GOOD(id));
  assert.equal(r.data.cards, 0);
  assert.equal('cards' in w.users.get(A.userId).requests.get(id).request, false);
  const r2 = await call(A, 'set_compilation_request', { ...GOOD(id), cards: [] });
  assert.equal('cards' in w.users.get(A.userId).requests.get(id).request, false, 'an empty list saves nothing extra');
  assert.equal(r2.data.cards, 0);
});

test('MUST FAIL: five cards, a bad position, a bad length, an extra field, a missing field or empty words are each refused and nothing is saved', async () => {
  const { w, call } = world();
  const id = await project(call);
  const bad = [
    { cards: Array.from({ length: 5 }, () => card()) }, { cards: [card({ where: 'middle' })] }, { cards: [card({ seconds: 0.2 })] }, { cards: [card({ seconds: 11 })] },
    { cards: [card({ extra: 1 })] }, { cards: [{ text: 'x', where: 'start' }] }, { cards: [{ where: 'start', seconds: 2 }] }, { cards: [card({ text: '' })] }, { cards: [card({ text: 'x'.repeat(121) })] },
    { cards: [card({ seconds: '3' })] }, { cards: 'a card' }, { cards: [{ ...card(), picture: 'p.png' }] },
  ];
  for (const extra of bad) {
    const r = await call(A, 'set_compilation_request', { ...GOOD(id), ...extra });
    assert.equal(r.isError, true, JSON.stringify(extra).slice(0, 90) + ' must be refused');
    assert.equal(r.code, 'args', JSON.stringify(extra).slice(0, 90));
  }
  assert.equal(w.users.get(A.userId).requests.size, 0);
});

test('MUST FAIL: words that are only spaces, and a place on the computer hidden in a card, are refused in plain words', async () => {
  const { w, call } = world();
  const id = await project(call);
  const blank = await call(A, 'set_compilation_request', { ...GOOD(id), cards: [card({ text: '    ' })] });
  assert.equal(blank.isError, true);
  assert.match(blank.text, /needs its words/);
  for (const text of ['see C:\\Users\\Ryan\\v.mp4', 'at D:/clips/a.mp4', '\\\\server\\share\\a.mp4', 'open ../../secret']) {
    const r = await call(A, 'set_compilation_request', { ...GOOD(id), cards: [card({ text })] });
    assert.equal(r.isError, true, text);
    assert.match(r.text, /Write words, not a place on the computer/);
  }
  assert.equal(w.users.get(A.userId).requests.size, 0);
});
