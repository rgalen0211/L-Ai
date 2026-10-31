// make_song_film (NEXT-CONNECT 182): a request, as DATA, for a song film built on the person's own computer. UNLISTED, and the real function wires no `songFilm` dependency, so today it refuses and writes nothing (OFF).
// The copyright rule (P11): Ryagram cannot check lyrics, so it takes only lyrics whose origin is declared (written for this film, own or licensed, public domain) and sourced in words, refuses the lyrics of a published
// song and any copyright mark or credit line, and marks the request "verified: false". Against the in-memory stand-in for the database.
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
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
function world({ songFilm = undefined } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.addUser(B.userId, 'bob@example.test', 100);
  w.invite(A.userId, A.clientId); w.invite(B.userId, B.clientId);
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile, ...(songFilm ? { songFilm } : {}) } });
  return { w, call: (p, name, args) => callTool(name, args, p, env(p)) };
}
const switchOn = (reqs, enabled = true) => ({ enabled: () => enabled, request: async (r) => { reqs.push(r); return { id: '00000000-0000-4000-8000-0000000000a1', state: 'waiting' }; } });
const project = async (call, p = A) => (await call(p, 'create_project', { title: 'Song film' })).data.project_id;
const good = (id, o = {}) => ({ project_id: id, name: 'The Big Club', lyrics: ['We are the club', 'Come on in'], lyrics_origin: 'written_for_this_film', lyrics_source: 'original lyrics written for this film',
  cast: [{ line: 1, who: 'Dee' }, { line: 2, who: 'ALL' }], folders: ['Speeches'], ...o });

test('the tool is unlisted, writes data only, and has no address, path or published-song option', () => {
  const t = TOOLS.find((x) => x.name === 'make_song_film');
  assert.ok(t); assert.equal(t.listed, false); assert.equal(t.scope, 'write'); assert.equal(t.readOnly, false);
  assert.ok(!toolList().some((x) => x.name === 'make_song_film'));
  assert.equal(t.inputSchema.additionalProperties, false);
  assert.deepEqual(t.inputSchema.properties.lyrics_origin.enum, ['written_for_this_film', 'own_or_licensed', 'public_domain']);
  assert.ok(!Object.keys(t.inputSchema.properties).some((k) => /url|path|link|address/i.test(k)));
});

test('OFF (no switch wired, as in the real function): it refuses in words and writes nothing', async () => {
  const { call } = world(); const id = await project(call);
  const r = await call(A, 'make_song_film', good(id));
  assert.equal(r.isError, true); assert.equal(r.code, 'not_available'); assert.match(r.text, /Nothing was written down/);
  assert.deepEqual([r.data.ok, r.data.written], [false, false]);
});

test('OFF (a switch that says no): the same, and the request function is never called', async () => {
  const reqs = []; const { call } = world({ songFilm: switchOn(reqs, false) }); const id = await project(call);
  assert.equal((await call(A, 'make_song_film', good(id))).code, 'not_available'); assert.deepEqual(reqs, []);
});

test('ON: the request is written with the lyrics, the cast, the folder NAMES and the declaration marked NOT verified; nothing is built or charged', async () => {
  const reqs = []; const { w, call } = world({ songFilm: switchOn(reqs) }); const id = await project(call);
  const snap = () => JSON.stringify([...w.users].map(([k, u]) => [k, u.credits, u.held, u.jobs.length]));
  const before = snap();
  const r = await call(A, 'make_song_film', good(id, { note: 'For the club night.' }));
  assert.equal(r.isError, undefined, r.text); assert.equal(r.data.written, true); assert.equal(r.data.verified, false);
  assert.equal(reqs.length, 1);
  const q = reqs[0];
  assert.deepEqual([q.project_id, q.name, q.lyrics.length, q.lyrics_origin, q.verified, q.speed_cap], [id, 'The Big Club', 2, 'written_for_this_film', false, 1.5]);
  assert.deepEqual(q.cast, [{ line: 1, who: 'Dee' }, { line: 2, who: 'ALL' }]); assert.deepEqual(q.folders, ['Speeches']);
  assert.match(r.text, /NOT verified by Ryagram/); assert.match(r.text, /no credit is used/); assert.match(r.text, /never receive a video/);
  assert.ok(r.text.indexOf('original lyrics written for this film') > 0 && r.text.slice(0, r.text.indexOf('original lyrics written for this film')).includes('lyrics-source'), 'the declaration is fenced as the AI\'s words');
  assert.equal(snap(), before, 'asking changed something');
});

test('MUST-FAIL: lyrics with no declared origin, a published-song claim or a blank source are refused and nothing is written', async () => {
  const reqs = []; const { call } = world({ songFilm: switchOn(reqs) }); const id = await project(call);
  const noOrigin = good(id); delete noOrigin.lyrics_origin;
  assert.equal((await call(A, 'make_song_film', noOrigin)).isError, true);
  const published = await call(A, 'make_song_film', good(id, { lyrics_origin: 'published_song' }));
  assert.equal(published.isError, true);
  const blank = await call(A, 'make_song_film', good(id, { lyrics_source: '   ' }));
  assert.equal(blank.isError, true); assert.equal(blank.code, 'lyrics_origin');
  assert.deepEqual(reqs, []);
});

test('MUST-FAIL: a copyright sign, a notice or a credit line inside the lyrics is refused, with the way out, and nothing is written', async () => {
  const reqs = []; const { call } = world({ songFilm: switchOn(reqs) }); const id = await project(call);
  for (const line of ['© 1969 Some Music Ltd', 'Copyright 1969 Some Music', '(c) 1969 Some Music', 'All rights reserved', 'Lyrics by A. Writer', 'Written by A. Writer', 'Words and music by A. Writer']) {
    const r = await call(A, 'make_song_film', good(id, { lyrics: ['We are the club', line] }));
    assert.equal(r.isError, true, line); assert.equal(r.code, 'lyrics_copyright', line);
    assert.match(r.text, /original lyrics/); assert.match(r.text, /cannot check lyrics/);
  }
  assert.deepEqual(reqs, []);
});

test('MUST-FAIL: an address or a place in the lyrics, the source, the name or a singer is refused', async () => {
  const reqs = []; const { call } = world({ songFilm: switchOn(reqs) }); const id = await project(call);
  const bad = [{ lyrics: ['see https://example.test/song'] }, { lyrics_source: 'from https://example.test/song' }, { lyrics_source: 'from www.example.com' }, { name: 'C:' + String.fromCharCode(92) + 'songs' },
    { cast: [{ line: 1, who: 'www.example.com' }] }, { note: 'open C:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92) + 'x' }];
  for (const o of bad) { const r = await call(A, 'make_song_film', good(id, o)); assert.equal(r.isError, true, JSON.stringify(o)); }
  assert.deepEqual(reqs, []);
});

test('the cast must fit the lyrics: a line that is not there and the same singer twice on one line are refused', async () => {
  const reqs = []; const { call } = world({ songFilm: switchOn(reqs) }); const id = await project(call);
  const far = await call(A, 'make_song_film', good(id, { cast: [{ line: 3, who: 'Dee' }] }));
  assert.equal(far.isError, true); assert.match(far.text, /lyrics have 2 lines/);
  const twice = await call(A, 'make_song_film', good(id, { cast: [{ line: 1, who: 'Dee' }, { line: 1, who: 'dee' }] }));
  assert.equal(twice.isError, true); assert.deepEqual(reqs, []);
});

test('limits: at most 60 lyric lines, a speed cap between 1 and 2, and at least one folder', async () => {
  const reqs = []; const { call } = world({ songFilm: switchOn(reqs) }); const id = await project(call);
  assert.equal((await call(A, 'make_song_film', good(id, { lyrics: Array.from({ length: 61 }, (_, i) => 'line ' + i) }))).isError, true);
  assert.equal((await call(A, 'make_song_film', good(id, { speed_cap: 3 }))).isError, true);
  assert.equal((await call(A, 'make_song_film', good(id, { speed_cap: 0.5 }))).isError, true);
  assert.equal((await call(A, 'make_song_film', good(id, { folders: [] }))).isError, true);
  assert.equal((await call(A, 'make_song_film', good(id, { speed_cap: 1.25 }))).isError, undefined);
  assert.equal(reqs.length, 1); assert.equal(reqs[0].speed_cap, 1.25);
});

test('another person\'s project is not found and nothing is written; the daily limit stops the ' + LIMITS.songFilmRequestsPerDayPerUser + 'th-plus request', async () => {
  const reqs = []; const { call } = world({ songFilm: switchOn(reqs) }); const id = await project(call);
  const other = await call(B, 'make_song_film', good(id));
  assert.equal(other.isError, true); assert.equal(other.code, 'not_found'); assert.deepEqual(reqs, []);
  for (let i = 0; i < LIMITS.songFilmRequestsPerDayPerUser; i++) assert.equal((await call(A, 'make_song_film', good(id))).isError, undefined);
  const over = await call(A, 'make_song_film', good(id));
  assert.equal(over.isError, true); assert.equal(over.code, 'rate'); assert.equal(reqs.length, LIMITS.songFilmRequestsPerDayPerUser);
});
