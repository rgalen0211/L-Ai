// The guided-builder Edge function (WEB's front end for ENGINE's compileFilm): who may call it, what it lists, and that a compile is exactly ENGINE's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, catalogFor, forPerson, claimsOf } from '../supabase/functions/guided-builder/builder.ts';
import { CATALOG } from '../supabase/functions/_shared/catalog_data.ts';
import { compileFilm } from '../supabase/functions/_shared/film.ts';
import { listableEntries } from '../supabase/functions/_shared/catalog_rules.ts';

const ORIGIN = 'https://uselai.com';
const deps = (user = { id: 'u1', clientId: null }) => ({ allowedOrigins: [ORIGIN, 'https://www.uselai.com'], verifyUser: async jwt => (jwt === 'good' ? user : null) });
const post = (body, { origin = ORIGIN, auth = 'Bearer good', method = 'POST', raw, d = deps(), catalog } = {}) =>
  handle(new Request('https://x.supabase.co/functions/v1/guided-builder', { method, headers: { ...(origin ? { origin } : {}), ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(body) }) }), d, catalog);

test('WHO: only uselai.com, only POST, only a signed-in person; a connected AI\'s token and a bad token are refused', async () => {
  assert.equal((await post({ action: 'catalog' }, { origin: null })).status, 403);
  assert.equal((await post({ action: 'catalog' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ action: 'catalog' }, { method: 'GET' })).status, 405);
  assert.equal((await post({ action: 'catalog' }, { method: 'OPTIONS' })).status, 204);
  assert.equal((await post({ action: 'catalog' }, { auth: null })).status, 401);
  assert.equal((await post({ action: 'catalog' }, { auth: 'Bearer bad' })).status, 401);
  const ai = await post({ action: 'catalog' }, { d: deps({ id: 'u1', clientId: 'chatgpt' }) });
  assert.equal(ai.status, 403);
  assert.match((await ai.json()).error, /connected AI builds films through its own tools/);
  assert.equal((await post({ action: 'catalog' })).headers.get('cache-control'), 'no-store');
});

test('CATALOG: lists exactly the entries a person may see (listable AND usable), each with its source and licence; nothing personal, nothing unlisted', async () => {
  const res = await post({ action: 'catalog' });
  assert.equal(res.status, 200);
  const { datasets, film_types } = await res.json();
  const want = listableEntries({ usableOnly: true }).map(e => e.id).sort();
  assert.deepEqual(datasets.map(d => d.id).sort(), want);
  assert.ok(datasets.length >= 10);
  assert.deepEqual(film_types, ['map', 'bars', 'line', 'paired']);
  for (const d of datasets) {
    assert.ok(d.publisher && d.licence_short && d.title, d.id);
    assert.deepEqual(Object.keys(d).sort(), ['film_types', 'geography', 'id', 'licence_short', 'period', 'publisher', 'title', 'topic', 'url']);       // no detail beyond what the picker shows
  }
  const notListed = CATALOG.filter(e => !e.listable || e.status !== 'usable').map(e => e.id);
  for (const id of notListed) assert.ok(!datasets.some(d => d.id === id), id);
  assert.deepEqual(catalogFor().map(d => d.id).sort(), want);
});

test('DESCRIBE: one dataset with its measures, coverage, method changes and the FULL licence; an unknown or unlisted one is "not available", the same answer', async () => {
  const ok = await (await post({ action: 'describe', dataset: 'state_obesity_fastfood' })).json();
  const d = ok.dataset;
  assert.equal(d.id, 'state_obesity_fastfood');
  assert.match(d.licence, /public domain/);
  assert.ok(d.methodology_breaks.length >= 1 && d.measures.some(m => m.selectable) && d.measures.some(m => !m.selectable));
  assert.deepEqual(d.period, { from: '2011', to: '2023', cadence: 'annual' });
  assert.equal(d.continuous_colour, false);
  assert.equal(forPerson(CATALOG.find(e => e.id === 'bps_county_permits')).continuous_colour, true);                   // the page can say a county map is solid colour only
  const hidden = CATALOG.find(e => !e.listable);
  for (const id of [hidden?.id ?? 'ryan_private', 'no_such_dataset', '', 7, null]) {
    const r = await post({ action: 'describe', dataset: id });
    assert.equal(r.status, 404, String(id));
    assert.deepEqual(await r.json(), { error: 'That dataset is not available.' });
  }
});

test('COMPILE: a valid request returns ENGINE\'s story and report unchanged; every refusal reason comes back at once (422), never just the first', async () => {
  const request = { dataset: 'state_obesity_fastfood', film_type: 'bars', title: 'Obesity and fast food, 2011 to 2023', measure: 'obesity', years: { start: '2012', end: '2020' } };
  const res = await post({ action: 'compile', request });
  assert.equal(res.status, 200);
  const got = await res.json();
  const direct = compileFilm(request);
  assert.deepEqual(got.story, JSON.parse(JSON.stringify(direct.story)));
  assert.deepEqual(got.report, JSON.parse(JSON.stringify(direct.report)));
  assert.equal(got.story.schema, 1);
  const bad = await post({ action: 'compile', request: { dataset: 'state_obesity_fastfood', film_type: 'bars', title: '', years: { start: '1990', end: '2030' }, places: ['Ohio'], measure: 'nope', extra: 1 } });
  assert.equal(bad.status, 422);
  const { errors } = await bad.json();
  assert.ok(errors.length >= 5, errors.join(' | '));
  for (const part of [/title/, /years\.start/, /years\.end/, /places/, /measure/, /unknown key 'extra'/]) assert.ok(errors.some(e => part.test(e)), String(part));
  const notListed = CATALOG.find(e => !e.listable);
  if (notListed) {
    const r = await post({ action: 'compile', request: { dataset: notListed.id, film_type: 'bars', title: 'x' } });
    assert.equal(r.status, 422);
    assert.match((await r.json()).errors.join(' '), /not in the catalog/);                                          // an unlisted dataset does not exist to a person
  }
});

test('COMPILE: a look rides along and only changes the look (ENGINE\'s guard); a hatching look on a county map is refused in words', async () => {
  const look = { profile_version: 1, name: 'mine', look: { theme: 'light' } };
  const r = await post({ action: 'compile', request: { dataset: 'state_obesity_fastfood', film_type: 'map', title: 'A map', look } });
  assert.equal(r.status, 200);
  const { story, report } = await r.json();
  assert.equal(story.sequence.theme, 'light');
  assert.equal(report.look.applied, true);
  const county = await post({ action: 'compile', request: { dataset: 'bps_county_permits', film_type: 'map', title: 'Permits', look: { profile_version: 1, name: 'mine', look: { ramp: { mode: 'hatch' } } } } });
  assert.equal(county.status, 422);
  assert.match((await county.json()).errors.join(' '), /too small to hatch/);
});

test('INPUT: bad JSON, a non-object, an oversized body and an unknown action are refused without a stack trace', async () => {
  assert.equal((await post(null, { raw: '{nope' })).status, 400);
  assert.equal((await post(null, { raw: '[1]' })).status, 400);
  assert.equal((await post(null, { raw: JSON.stringify({ action: 'compile', request: { title: 'x'.repeat(50000) } }) })).status, 413);
  const unknown = await post({ action: 'delete_everything' });
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: 'Unknown action.' });
  assert.deepEqual(claimsOf('not.a.jwt'), {});
});
