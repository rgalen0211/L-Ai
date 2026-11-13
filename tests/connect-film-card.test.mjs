// Editor Step A, the connector's side (CONNECT, 2026-11-09; contract proposals/CONNECT-EDITOR-STEP-A-CONTRACT-1109.md): the film look card. Three things are tested here, offline:
//  1. the CHECKER every card passes before the panel sees it (supabase/functions/connect-core/film_card.ts) against the SHARED cases ENGINE and WORKER also read (tests/fixtures/film-card/cases.json, built from build-cases.mjs);
//  2. the TOOL editor_film_card (app-only, behind the chat-editor switch, scope read): ask, wait, ready, stale, failed, a bad card turned into "not usable", limits, who may see what;
//  3. the stand-in world's mirror of the database rules (the real rules are in supabase/tests/test_film_card_requests.py).
// Must-fails: tests/connect_film_card_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp } from '../supabase/functions/connect-core/mcp.ts';
import { cases } from './fixtures/film-card/build-cases.mjs';
import { FILM_CARD_MAX_BYTES, SVG_MAX_CHARS, LOOK_REQUIRED, SVG_ATTRS, SVG_ELEMENTS, checkFilmCard, checkSvg, hasHiddenChars } from '../supabase/functions/connect-core/film_card.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
const ON = { enabled: true, chatEditor: true };

function server(mcpApp = ON, { scopes = ['read', 'write', 'render_free'] } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.addUser(B.userId, 'bob@example.test', 100);
  w.invite(A.userId, A.clientId, scopes); w.invite(B.userId, B.clientId, scopes);
  w.issue('tok-a', A); w.issue('tok-b', B);
  const deps = { data: null, policy: w.policy(), deps: { compile }, verifyToken: w.verifyToken, dataFor: (_t, p) => w.data(p.userId), resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource', mcpApp };
  const rpc = async (method, params, token = 'tok-a') => JSON.parse(await (await handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps)).text());
  const call = async (args, token = 'tok-a') => { const r = (await rpc('tools/call', { name: 'editor_film_card', arguments: args }, token)).result; return { ...r, body: r.structuredContent }; };
  const film = async (who = A, story = { title: 'invented one' }) => {
    const d = w.data(who.userId);
    const p = await d.createProject('Invented film');
    const v = (await d.listVersions?.(p.id)) ?? null; void v;
    const ver = w.users.get(who.userId).versions.find((x) => x.project_id === p.id);
    ver.story_spec = story; ver.story_sha256 = w.sha ? w.sha(story) : sha(story);
    return { id: p.id, ver };
  };
  return { w, rpc, call, film };
}
import crypto from 'node:crypto';
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const goodCard = (s) => { const c = JSON.parse(JSON.stringify(cases()[0].card)); c.basis.story_sha256 = s; return c; };

// ------------------------------------------------------------------------------------------------ 1. the checker and the shared cases
test('the committed cases.json is exactly what build-cases.mjs makes (so ENGINE and WORKER read the cases this test uses)', () => {
  const committed = JSON.parse(fs.readFileSync(new URL('./fixtures/film-card/cases.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed, cases());
  assert.ok(committed.filter((c) => c.ok).length >= 3 && committed.filter((c) => !c.ok).length >= 40);
  assert.ok(!/[^\x20-\x7e\r\n]/.test(fs.readFileSync(new URL('./fixtures/film-card/cases.json', import.meta.url), 'utf8')), 'the file holds plain ASCII only (hostile characters are written as escapes)');
});

// why each refused case is refused: the REASON is pinned, so a checker that refuses for the wrong reason (or by accident) fails here
const WHY = {
  'wrong schema number': /not schema 1/, 'missing a required look key': /no page\.background/, 'a look with other colours but no page background': /no page\.background/, 'an empty look': /no page\.background/, 'a text length written in non-ASCII digits': /text length is not a plain number/, 'a label of 31 emoji': /label is not plain text/, 'an engine label of 21 emoji': /engine label is not plain text/, 'a note of 81 emoji': /notes are not up to 5 plain sentences/, 'a text length that is not a plain number': /text length is not a plain number/, 'a text length written as an expression': /text length is not a plain number/, 'a length adjustment that is not an allowed word': /length adjustment is not one of/, 'an xml:space that is not an allowed word': /xml:space is not preserve or default/, 'an xml attribute that is not on the list': /not allowed [(]xml[?]lang[)]/, 'a colour that is not hex': /not a 6-digit hex/, 'a short hex colour': /not a 6-digit hex/,
  'a look name that is not plain': /name that is not plain/, 'a story hash that is not 64 hex': /story hash is not a sha-256/, 'an extra top-level part': /part it may not have \(extra\)/,
  'a picture wider than the limit': /width is not a whole number/, 'a ramp of 13 stops': /ramp is not a list of at most 12/, 'six notes': /notes are not up to 5/,
  'a label with a direction character': /label is not plain/, 'no picture': /no picture/,
  'a script element': /element that is not allowed \(script\)/, 'a style element': /\(style\)/, 'an image element': /\(image\)/, 'a foreignObject element': /\(foreignObject\)/, 'a use element': /\(use\)/,
  'an animation element': /\(animate\)/, 'an event handler': /attribute that is not allowed \(onclick\)/, 'a style attribute': /attribute that is not allowed \(style\)/, 'an href attribute': /\(href\)/,
  'an address in an attribute': /address or a script in an attribute/, 'a url() that is not a fragment': /refers to something that is not on the picture/, 'a url() in the wrong attribute': /refers to something/,
  'a data address': /address or a script/, 'a javascript address': /address or a script/, 'the wrong namespace': /names an address it may not/, 'xmlns on an inner element': /names an address it may not/,
  'a comment': /not a plain element/, 'a CDATA section': /not a plain element/, 'a doctype': /not a plain element/, 'a processing instruction': /not a plain element/,
  'an entity that is not one of the five': /entity it may not have/, 'text outside a text element': /text outside a text element/, 'tags that are not closed': /tags are not closed/,
  'tags that do not match': /tags do not match/, 'two top elements': /more than one top element/, 'no svg at all': /must be one svg element/, 'a repeated attribute': /repeats an attribute/,
  'an id that is not plain': /id is not plain/, 'a picture over the character limit': /over 300000 characters/, 'too many elements': /more than 30000 elements/, 'nested too deeply': /nested too deeply/,
  'a card over the byte limit': /over 320000 bytes/,
  'a pattern child that is not a line, path or rect': /pattern may hold only lines, paths and rectangles/, 'a text in a pattern': /pattern may hold only lines, paths and rectangles/, 'a pattern child with something inside it': /pattern may hold only lines, paths and rectangles/, 'a pattern inside a pattern': /pattern may hold only lines, paths and rectangles/,
  'a pattern child that refers to a paint': /pattern may not refer to anything/, 'a pattern that is itself filled by a reference': /pattern may not refer to anything/, 'a pattern transform that refers to something': /pattern may not refer to anything/,
  'a pattern with an href': /\(href\)/, 'a pattern with an attribute that is not on the list': /\(patternContentUnits\)/, 'a pattern units word that is not allowed': /pattern's units are not one of the two allowed words/,
  'a pattern with no width': /pattern needs a width and a height/, 'a pattern with no height': /pattern needs a width and a height/, 'a pattern tile of 1 pixel': /pattern needs a width and a height/, 'a pattern tile of 65 pixels': /pattern needs a width and a height/,
  'a pattern tile with a unit': /pattern needs a width and a height/, 'a pattern tile as a percentage': /pattern needs a width and a height/, 'a pattern tile of 1.5 pixels': /pattern needs a width and a height/, 'a pattern tile with four decimals': /pattern needs a width and a height/,
  'a hundred and one patterns': /more than 100 patterns/, 'a pattern attribute on a rectangle': /pattern attribute is on an element that is not a pattern/, 'a pattern transform on a path': /pattern attribute is on an element that is not a pattern/, 'a hidden character in the picture': /control or direction characters/,
};
test('every shared case: the good ones pass, every refused one is refused for ITS reason', () => {
  const all = cases();
  assert.deepEqual(all.filter((c) => !c.ok).map((c) => c.name).sort(), Object.keys(WHY).sort(), 'every refused case has a pinned reason, and every reason a case');
  for (const c of all) {
    const p = checkFilmCard(c.card);
    if (c.ok) assert.deepEqual(p, [], c.name);
    else { assert.ok(p.length >= 1, c.name); assert.match(p[0], WHY[c.name], `${c.name}: ${p[0]}`); }
  }
});

test('the checker never throws, whatever it is handed', () => {
  for (const v of [undefined, null, 0, '', 'x', [], [1], {}, { schema: 1 }, { schema: 1, basis: 5, look: 'x', frame: [] }, { frame: { svg: { toString() { throw new Error('x'); } } } }, 7n === 7n ? { a: 1 } : 0]) {
    assert.ok(Array.isArray(checkFilmCard(v)), String(v));
    assert.ok(checkFilmCard(v).length >= 1);
  }
  for (const v of [undefined, null, 5, {}, [], '', ' ', '<', '<svg', '<svg>', '</svg>', '<svg/>', '<svg></svg>']) assert.ok(Array.isArray(checkSvg(v)), String(v));
  const circular = {}; circular.self = circular;
  assert.deepEqual(checkFilmCard(circular), ['The card cannot be read.']);
});

test('the allowed lists are exactly the ones the contract names, and nothing dangerous is on them', () => {
  assert.deepEqual([...SVG_ELEMENTS].sort(), ['circle', 'clipPath', 'defs', 'ellipse', 'g', 'line', 'linearGradient', 'path', 'pattern', 'polygon', 'polyline', 'radialGradient', 'rect', 'stop', 'svg', 'text', 'title', 'tspan']);
  for (const bad of ['script', 'style', 'image', 'foreignObject', 'use', 'animate', 'set', 'a', 'iframe', 'link', 'mask', 'filter', 'switch', 'symbol', 'marker']) assert.ok(!SVG_ELEMENTS.has(bad), bad);
  for (const bad of ['style', 'href', 'xlink:href', 'class', 'onclick', 'onload', 'src', 'filter', 'mask', 'marker-start', 'content']) assert.ok(!SVG_ATTRS.has(bad), bad);
  assert.ok([...SVG_ATTRS].every((a) => !a.startsWith('on')));
  assert.deepEqual([...LOOK_REQUIRED], ['page.background']);
  assert.ok(SVG_ATTRS.has('textLength'));
  assert.ok(SVG_ATTRS.has('lengthAdjust') && SVG_ATTRS.has('xml:space') && !SVG_ATTRS.has('xml:lang') && !SVG_ATTRS.has('xlink:href'));
  assert.equal(FILM_CARD_MAX_BYTES, 320000);
  assert.equal(SVG_MAX_CHARS, 300000);
  assert.ok(SVG_ATTRS.has('patternUnits') && SVG_ATTRS.has('patternTransform') && !SVG_ATTRS.has('patternContentUnits') && !SVG_ATTRS.has('href'));
});

test('hidden characters are found: control, direction, zero-width and byte-order marks; plain text, tabs and newlines are not', () => {
  for (const c of [0, 7, 0x7f, 0x85, 0x200b, 0x200e, 0x2028, 0x2029, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff]) assert.equal(hasHiddenChars('a' + String.fromCharCode(c) + 'b'), true, c.toString(16));
  for (const s of ['plain', 'tab\there', 'a\nb', 'a\r\nb', 'caf\u00e9 (accents are fine)', '']) assert.equal(hasHiddenChars(s), false, JSON.stringify(s));
});

// ------------------------------------------------------------------------------------------------ 2. the tool
test('the tool is app-only, behind the chat-editor switch, scope read, and says in words what it is for', async () => {
  const on = server();
  const list = (await on.rpc('tools/list', {})).result.tools;
  const t = list.find((x) => x.name === 'editor_film_card');
  assert.deepEqual(t._meta, { ui: { visibility: ['app'] } });
  assert.match(t.description, /ONLY for the Ryagram editor panel/);
  assert.match(t.description, /ONLY for the Ryagram editor panel in this conversation, which calls it/);
  assert.equal(t.inputSchema.additionalProperties, false);
  assert.deepEqual(t.inputSchema.required, ['p_project']);
  for (const cfg of [{ enabled: true }, null, { enabled: false, chatEditor: true }]) {
    const off = server(cfg);
    assert.ok(!(await off.rpc('tools/list', {})).result.tools.some((x) => x.name === 'editor_film_card'));
    const r = await off.call({ p_project: '00000000-0000-4000-8000-000000000001' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /There is no tool called/);
  }
  const noRead = server(ON, { scopes: ['write'] });
  const f = await noRead.film();
  const r = await noRead.call({ p_project: f.id });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not allowed to do that/);
});

test('ask, wait, a card from the house computer, then ready: one request however often it is asked, and nobody else sees it', async () => {
  const s = server();
  const f = await s.film();
  const none = await s.call({ p_project: f.id });
  assert.deepEqual(none.body, { data: { state: 'none' } }, 'reading alone never asks');
  assert.equal(s.w.users.get(A.userId).cards.size, 0);
  const asked = await s.call({ p_project: f.id, p_ask: true });
  assert.deepEqual(asked.body, { data: { state: 'asked', waited_seconds: 0 } });
  for (let i = 0; i < 4; i++) assert.equal((await s.call({ p_project: f.id, p_ask: true })).body.data.state, 'asked', 'asking again is the same request');
  assert.equal(s.w.users.get(A.userId).cards.size, 1);
  const worker = s.w.cardWorker(A.userId);
  const job = worker.claim();
  assert.equal(job.story_sha256, f.ver.story_sha256);
  assert.deepEqual(job.story, { title: 'invented one' });
  assert.equal((await s.call({ p_project: f.id })).body.data.state, 'claimed');
  worker.finish(job.request_id, goodCard(f.ver.story_sha256));
  const ready = (await s.call({ p_project: f.id })).body.data;
  assert.equal(ready.state, 'ready'); assert.equal(ready.stale, false); assert.equal(ready.built_sha256, f.ver.story_sha256);
  assert.equal(ready.card.frame.label, '2024');
  assert.equal(JSON.parse((await s.call({ p_project: f.id })).content[0].text).data.state, 'ready', 'the text part carries the same answer');
  const bob = await s.call({ p_project: f.id }, 'tok-b');
  assert.equal(bob.isError, true); assert.equal(bob.body.error.code, 'PT404', "Bob cannot see that Alice's film exists");
});

test('a poll that already holds the card is not sent it again (p_have), and a different hash is', async () => {
  const s = server();
  const f = await s.film();
  await s.call({ p_project: f.id, p_ask: true });
  const w = s.w.cardWorker(A.userId), job = w.claim();
  w.finish(job.request_id, goodCard(f.ver.story_sha256));
  const again = (await s.call({ p_project: f.id, p_have: f.ver.story_sha256 })).body.data;
  assert.deepEqual(again, { state: 'ready', unchanged: true, stale: false, built_sha256: f.ver.story_sha256 });
  const other = (await s.call({ p_project: f.id, p_have: 'f'.repeat(64) })).body.data;
  assert.ok(other.card);
  assert.equal((await s.call({ p_project: f.id, p_have: 'abc' })).isError, true, 'a bad hash is refused');
});

test('a film saved again since the card was drawn: the old card is returned and called stale until the new one arrives', async () => {
  const s = server();
  const f = await s.film();
  await s.call({ p_project: f.id, p_ask: true });
  const w = s.w.cardWorker(A.userId); w.finish(w.claim().request_id, goodCard(f.ver.story_sha256));
  f.ver.story_spec = { title: 'invented two' }; f.ver.story_sha256 = sha({ title: 'invented two' });
  const old = (await s.call({ p_project: f.id })).body.data;
  assert.equal(old.state, 'ready'); assert.equal(old.stale, true); assert.ok(!('refresh' in old), 'nothing asked for the new save yet');
  assert.equal(s.w.users.get(A.userId).cards.size, 1, 'a read never asks');
  const asked = (await s.call({ p_project: f.id, p_ask: true })).body.data;
  assert.equal(asked.state, 'ready'); assert.equal(asked.stale, true); assert.deepEqual(asked.refresh, { state: 'asked' }); assert.ok(asked.card, 'the old card stays on show while the new one is drawn');
  assert.equal(s.w.users.get(A.userId).cards.size, 2, 'one new request for the new save');
  for (let i = 0; i < 3; i++) await s.call({ p_project: f.id, p_ask: true });
  assert.equal(s.w.users.get(A.userId).cards.size, 2, 'asking again while it is being drawn asks nothing more');
  const job = w.claim();
  assert.equal(job.story_sha256, f.ver.story_sha256);
  assert.deepEqual((await s.call({ p_project: f.id })).body.data.refresh, { state: 'claimed' });
  w.finish(job.request_id, goodCard(f.ver.story_sha256));
  const fresh = (await s.call({ p_project: f.id })).body.data;
  assert.equal(fresh.stale, false); assert.ok(!('refresh' in fresh)); assert.equal(fresh.built_sha256, f.ver.story_sha256);
  // a save the engine cannot draw: the older card stays, and the failure is said (not asked again for the same save)
  f.ver.story_spec = { title: 'invented three' }; f.ver.story_sha256 = sha({ title: 'invented three' });
  await s.call({ p_project: f.id, p_ask: true });
  const job2 = w.claim(); w.fail(job2.request_id, 'view_not_supported', '');
  const kept = (await s.call({ p_project: f.id, p_ask: true })).body.data;
  assert.equal(kept.stale, true); assert.deepEqual(kept.refresh, { state: 'failed', code: 'view_not_supported' }); assert.ok(kept.card);
  assert.equal(s.w.users.get(A.userId).cards.size, 3);
});

test('a failed card says why in words, a card that is not usable is turned into "not usable" and never passed on', async () => {
  const s = server();
  const f = await s.film();
  await s.call({ p_project: f.id, p_ask: true });
  const w = s.w.cardWorker(A.userId); const job = w.claim();
  w.fail(job.request_id, 'view_not_supported', 'x');
  const failed = (await s.call({ p_project: f.id })).body.data;
  assert.deepEqual(failed, { state: 'failed', code: 'view_not_supported', message: 'The engine cannot draw a picture of this kind of film yet. The editor keeps its stand-in picture.' });
  for (const [code, re] of [['story_not_found', /could not be read/], ['engine_error', /did not work this time/], ['card_rejected', /could not be used/]]) {
    const g = await s.film(A, { title: 'invented ' + code });
    await s.call({ p_project: g.id, p_ask: true });
    const job2 = w.claim(); w.fail(job2.request_id, code, '');
    const r = (await s.call({ p_project: g.id })).body.data;
    assert.equal(r.code, code); assert.match(r.message, re);
  }
  // a hostile card the database could not tell from a good one (its content is checked HERE)
  const h = await s.film(A, { title: 'invented hostile' });
  await s.call({ p_project: h.id, p_ask: true });
  const job3 = w.claim();
  const evil = goodCard(h.ver.story_sha256); evil.frame.svg = '<svg><script>alert(1)</script></svg>';
  w.finish(job3.request_id, evil);
  const r = (await s.call({ p_project: h.id })).body.data;
  assert.deepEqual(r, { state: 'failed', code: 'card_rejected', message: "The film's picture was drawn but could not be used." });
  assert.ok(!JSON.stringify(r).includes('script'));
  // a card whose own story hash does not match what the database says it was built for
  const m = await s.film(A, { title: 'invented mismatch' });
  await s.call({ p_project: m.id, p_ask: true });
  const job4 = w.claim(); w.finish(job4.request_id, goodCard(m.ver.story_sha256));
  [...s.w.users.get(A.userId).cards.values()].find((c) => c.id === job4.request_id).sha = 'e'.repeat(64);
  assert.equal((await s.call({ p_project: m.id })).body.data.code, 'card_rejected');
});

test('asks are limited to 20 an hour per person and the limit says so; reads are not counted', async () => {
  const s = server();
  const films = [];
  for (let i = 0; i < LIMITS.filmCardsPerHourPerUser + 1; i++) films.push(await s.film(A, { title: 'invented ' + i }));
  let ok = 0, limited = null;
  for (const f of films) {
    // an ask for a request that already finished frees the open-request cap, so the hourly limit is what is reached
    const r = await s.call({ p_project: f.id, p_ask: true });
    if (r.isError) { limited = r; break; }
    ok++;
    const w = s.w.cardWorker(A.userId); const job = w.claim(); if (job) w.fail(job.request_id, 'view_not_supported', '');
  }
  assert.equal(ok, LIMITS.filmCardsPerHourPerUser);
  assert.equal(limited.body.error.code, 'PT429');
  assert.match(limited.body.error.message, /20 film pictures an hour/);
  for (let i = 0; i < 5; i++) assert.equal((await s.call({ p_project: films[0].id })).isError, false, 'reads still work');
});

test('a database without the migration answers in words, not a crash; a film that is not yours is not found', async () => {
  const s = server();
  const real = s.w.data.bind(s.w);
  s.w.data = (id) => { const d = real(id); delete d.getFilmCard; delete d.askFilmCard; return d; };
  const f = await s.film();
  const r = await s.call({ p_project: f.id });
  assert.equal(r.isError, true); assert.equal(r.body.error.message, 'The film picture is not available yet.');
  const t = server();
  const g = await t.call({ p_project: '00000000-0000-4000-8000-000000000009', p_ask: true });
  assert.equal(g.isError, true); assert.equal(g.body.error.message, 'That film was not found among your projects.');
  assert.equal((await t.call({ p_project: 'not-a-uuid' })).isError, true);
  assert.equal((await t.call({ p_project: '00000000-0000-4000-8000-000000000009', more: 1 })).isError, true);
});

test('a picture that failed because the engine broke is asked for again when the editor is opened ten minutes later, not before, and a film the engine cannot draw is never asked for again', async () => {
  const s = server();
  const f = await s.film();
  await s.call({ p_project: f.id, p_ask: true });
  const w = s.w.cardWorker(A.userId);
  const job = w.claim(); w.fail(job.request_id, 'engine_error', 'it broke');
  const open = async () => (await s.call({ p_project: f.id, p_ask: true })).body.data;
  const failed = await open();
  assert.equal(failed.state, 'failed'); assert.equal(failed.code, 'engine_error');
  assert.match(failed.message, /ten minutes/, 'the words say what to do, and it is true');
  assert.equal(w.claim(), null, 'opening the editor again at once does not make a new request');
  const row = [...s.w.users.get(A.userId).cards.values()].find((c) => c.id === job.request_id);
  row.finished = Date.now() - 9 * 60000;
  assert.equal((await open()).state, 'failed', 'nine minutes is not ten');
  assert.equal(w.claim(), null);
  row.finished = Date.now() - 11 * 60000;
  assert.deepEqual(await open(), { state: 'asked', waited_seconds: 0 }, 'ten minutes on, opening the editor asks again');
  const job2 = w.claim();
  assert.ok(job2 && job2.request_id !== job.request_id, 'a new request was written for the same saved film');
  w.finish(job2.request_id, goodCard(f.ver.story_sha256));
  assert.equal((await open()).state, 'ready');
  // a film the engine cannot draw stays failed, however long ago
  const g = await s.film(A, { title: 'invented unsupported' });
  await s.call({ p_project: g.id, p_ask: true });
  const jobG = w.claim(); w.fail(jobG.request_id, 'view_not_supported', '');
  const rowG = [...s.w.users.get(A.userId).cards.values()].find((c) => c.id === jobG.request_id);
  rowG.finished = Date.now() - 3 * 3600000;
  const stays = (await s.call({ p_project: g.id, p_ask: true })).body.data;
  assert.equal(stays.state, 'failed'); assert.equal(stays.code, 'view_not_supported');
  assert.equal(w.claim(), null, 'nothing was asked for again');
  // polling without asking never asks, however much time has passed
  rowG.finished = Date.now() - 11 * 60000; row.state = 'failed'; row.fail_code = 'engine_error';
  assert.equal((await s.call({ p_project: g.id })).body.data.state, 'failed');
  assert.equal(w.claim(), null);
});

test('an older picture stays on show while a newer one that failed because the engine broke is asked for again after ten minutes, not before', async () => {
  const s = server();
  const f = await s.film();
  await s.call({ p_project: f.id, p_ask: true });
  const w = s.w.cardWorker(A.userId); w.finish(w.claim().request_id, goodCard(f.ver.story_sha256));
  f.ver.story_spec = { title: 'invented two' }; f.ver.story_sha256 = sha({ title: 'invented two' });
  await s.call({ p_project: f.id, p_ask: true });
  const job = w.claim(); w.fail(job.request_id, 'engine_error', 'it broke');
  const open = async () => (await s.call({ p_project: f.id, p_ask: true })).body.data;
  const soon = await open();
  assert.equal(soon.state, 'ready'); assert.equal(soon.stale, true); assert.deepEqual(soon.refresh, { state: 'failed', code: 'engine_error' }); assert.ok(soon.card);
  assert.equal(w.claim(), null, 'not before ten minutes');
  const row = [...s.w.users.get(A.userId).cards.values()].find((c) => c.id === job.request_id);
  row.finished = Date.now() - 11 * 60000;
  const later = await open();
  assert.equal(later.state, 'ready'); assert.equal(later.stale, true); assert.deepEqual(later.refresh, { state: 'asked' }); assert.ok(later.card, 'the older picture is still shown');
  const job2 = w.claim();
  assert.ok(job2 && job2.request_id !== job.request_id);
  assert.equal(job2.story_sha256, f.ver.story_sha256);
});

test('a county map the engine refuses for size reaches the person as ONE plain sentence with the two numbers; any other detail is never shown; the next film\'s card still shows (Ryan Q567 a)', async () => {
  const s = server();
  const w = s.w.cardWorker(A.userId);
  const county = await s.film(A, { title: 'invented county map' });
  await s.call({ p_project: county.id, p_ask: true });
  const job = w.claim(); w.fail(job.request_id, 'view_not_supported', 'too_big 359069 200000');
  const r = (await s.call({ p_project: county.id, p_ask: true })).body.data;
  assert.deepEqual(r, { state: 'failed', code: 'view_not_supported', size: { characters: 359069, limit: 200000 },
    message: "This film's picture is too detailed to draw in the chat: it would be 359,069 characters and the limit is 200,000. The editor keeps its stand-in picture." });
  assert.ok(!/engine|retry|try again|ten minutes|Error|D:|path/i.test(r.message.replace('The editor keeps', '')), 'one plain sentence: no engine talk, no retry promise, no path');
  // never asked for again, however long ago, and polling asks nothing
  const row = [...s.w.users.get(A.userId).cards.values()].find((c) => c.id === job.request_id);
  row.finished = Date.now() - 3 * 3600000;
  assert.equal((await s.call({ p_project: county.id, p_ask: true })).body.data.code, 'view_not_supported');
  assert.equal(w.claim(), null, 'a map that can never fit is not drawn again');
  // a detail that is anything but the strict digits is NOT shown (the worker's own words stay the fixed ones)
  for (const [i, bad] of ['too_big 5 1', 'too_big 359069 200000 and more', 'too_big 12345678901 200000', 'too_big 100 500', 'too_big 500000 999', 'too_big a b',
    'the still is 359,069 characters drawn faithfully; the cap is 200,000', 'D:\\Ryagram-cache\\x', ''].entries()) {
    const f = await s.film(A, { title: 'invented bad detail ' + i });
    await s.call({ p_project: f.id, p_ask: true });
    const j = w.claim(); w.fail(j.request_id, 'view_not_supported', bad);
    const d = (await s.call({ p_project: f.id })).body.data;
    assert.deepEqual(d, { state: 'failed', code: 'view_not_supported', message: 'The engine cannot draw a picture of this kind of film yet. The editor keeps its stand-in picture.' }, JSON.stringify(bad));
  }
  // a size detail on any other code is not a size sentence
  const g = await s.film(A, { title: 'invented engine error with a size' });
  await s.call({ p_project: g.id, p_ask: true });
  const jg = w.claim(); w.fail(jg.request_id, 'engine_error', 'too_big 359069 200000');
  const dg = (await s.call({ p_project: g.id })).body.data;
  assert.equal(dg.code, 'engine_error'); assert.ok(!('size' in dg)); assert.match(dg.message, /did not work this time/);
  // and another film's card still shows
  const bars = await s.film(A, { title: 'invented bar race' });
  await s.call({ p_project: bars.id, p_ask: true });
  const jb = w.claim(); w.finish(jb.request_id, goodCard(bars.ver.story_sha256));
  const ok = (await s.call({ p_project: bars.id })).body.data;
  assert.equal(ok.state, 'ready'); assert.ok(ok.card);
  assert.equal((await s.call({ p_project: county.id })).body.data.code, 'view_not_supported', 'and the county map still says why');
});

// ------------------------------------------------------------------------------------------------ 3. the stand-in world mirrors the database
test('the stand-in: 5 open at once, a worker cannot store a card for another story, an engine error is retried after 10 minutes and a card nobody drew is not made up', async () => {
  const s = server();
  const d = s.w.data(A.userId);
  const films = [];
  for (let i = 0; i < 6; i++) films.push(await s.film(A, { title: 'invented ' + i }));
  for (let i = 0; i < 5; i++) await d.askFilmCard(films[i].id);
  await assert.rejects(() => d.askFilmCard(films[5].id), (e) => e.code === 'PT429' && /5 film pictures/.test(e.message));
  const w = s.w.cardWorker(A.userId);
  const job = w.claim();
  assert.throws(() => w.finish(job.request_id, goodCard('9'.repeat(64))), (e) => e.code === '22023');
  assert.throws(() => w.finish(job.request_id, { schema: 1 }), (e) => e.code === '22023');
  assert.throws(() => w.finish(job.request_id, null), (e) => e.code === '22023');
  assert.throws(() => w.finish('nope', goodCard('9'.repeat(64))), (e) => e.code === '22023' || e.code === 'PT404');
  w.fail(job.request_id, 'engine_error', 'it broke');
  assert.equal((await d.askFilmCard(films[0].id)).repeat, true, 'not before ten minutes');
  const row = [...s.w.users.get(A.userId).cards.values()].find((c) => c.id === job.request_id);
  row.finished = Date.now() - 11 * 60000;
  const again = await d.askFilmCard(films[0].id);
  assert.equal(again.repeat, false); assert.notEqual(again.id, job.request_id);
  assert.throws(() => w.fail('x', 'because', ''), (e) => e.code === '22023');
  assert.equal(await d.getFilmCard('00000000-0000-4000-8000-0000000000ff'), null);
});

// ------------------------------------------------------------------------------------------------ the shared JSON schema and the checker agree
test('the shared JSON schema (tests/fixtures/film-card/film-card.schema.json, the file ENGINE validates against) and the checker never disagree on a case: the schema accepts every good card, and no card it rejects is accepted by the checker', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('./fixtures/film-card/film-card.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  let schemaRejects = 0;
  for (const c of cases()) {
    const bySchema = validate(c.card), byChecker = checkFilmCard(c.card).length === 0;
    if (c.ok) { assert.equal(bySchema, true, c.name); assert.equal(byChecker, true, c.name); }
    if (!bySchema) { schemaRejects++; assert.equal(byChecker, false, `${c.name}: the schema rejects it, so the checker must too`); }
  }
  assert.ok(schemaRejects >= 8, 'the schema is not an empty promise: it rejects the structural cases');
});

// ------------------------------------------------------------------------------------------------ the real database layer
test('the database layer sends each film card call to its own function, the token\'s hash first and never an owner or a story', async () => {
  const { ConnectDb } = await import('../supabase/functions/connect/db.ts');
  const seen = [];
  const db = new ConnectDb(async (sql, params) => { seen.push({ sql, params }); return [{ r: { state: 'none' } }]; }, 'https://x.example/app/');
  const data = db.data({ tokenHash: 'h'.repeat(64) });
  const P = '00000000-0000-4000-8000-0000000000a1';
  await data.askFilmCard(P);
  await data.getFilmCard(P);
  assert.deepEqual(seen.map((s) => s.sql), ['select public.connect_film_card_ask($1::text, $2::uuid) as r', 'select public.connect_film_card_get($1::text, $2::uuid) as r']);
  for (const s of seen) assert.deepEqual(s.params, ['h'.repeat(64), P]);
});
