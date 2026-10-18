// ENGINE's guided builder offered to the user's own AI: search, describe, compile. Pure tools; they save nothing; set_story still checks what they return.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { checkStory } from '../supabase/functions/connect-core/story_check.ts';
import storySchema from '../supabase/functions/_shared/story_schema.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { CATALOG } from '../supabase/functions/_shared/catalog_data.ts';
import { compileFilm, FILM_TYPES } from '../supabase/functions/_shared/film.ts';
import { listPresets } from '../supabase/functions/_shared/profile.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId, ['read', 'write', 'render_free']);
  return { w, call: (name, args) => callTool(name, args, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile } }) };
}
const usable = CATALOG.filter((e) => e.listable === true && e.status === 'usable');

test('three builder tools are registered, read-only, with closed schemas', () => {
  assert.equal(TOOLS.length, 18);
  for (const n of ['search_datasets', 'describe_dataset', 'compile_film']) {
    const t = TOOLS.find((x) => x.name === n);
    assert.ok(t, n); assert.equal(t.readOnly, true); assert.equal(t.scope, 'read'); assert.equal(t.inputSchema.additionalProperties, false);
    assert.match(t.name, /^[a-z0-9_]+$/);
  }
  assert.match(TOOLS.find((t) => t.name === 'compile_film').description, /saves NOTHING/);
});

test('search finds usable catalog datasets by words; no query lists some; nothing unlisted ever appears', async () => {
  const { call } = world();
  assert.ok(usable.length > 0);
  const word = usable[0].title.split(/\s+/)[0].toLowerCase();
  const hit = await call('search_datasets', { query: word });
  assert.equal(hit.isError, undefined); assert.ok(hit.data.datasets.length >= 1);
  assert.ok(hit.data.datasets.every((d) => usable.some((u) => u.id === d.id)));
  const none = await call('search_datasets', { query: 'zzz-no-such-thing' });
  assert.match(none.text, /No usable dataset matches/);
  const capped = await call('search_datasets', { limit: 2 });
  assert.ok(capped.data.datasets.length <= 2);
  const all = CATALOG.filter((e) => e.listable !== true);
  for (const e of all.slice(0, 20)) assert.ok(!(await call('search_datasets', { query: e.id })).data.datasets.some((d) => d.id === e.id), e.id);
  assert.equal((await call('describe_dataset', { dataset_id: all[0]?.id ?? 'x' })).code, 'not_found');           // an unlisted dataset does not exist to a person
});

test('describe returns source, licence, measures and gaps; an unknown id is refused in words', async () => {
  const { call } = world();
  const d = await call('describe_dataset', { dataset_id: usable[0].id });
  assert.equal(d.isError, undefined); assert.ok(d.data.dataset.licence_short); assert.ok(Array.isArray(d.data.dataset.measures));
  const bad = await call('describe_dataset', { dataset_id: 'not_a_dataset' });
  assert.equal(bad.isError, true); assert.match(bad.text, /not in the catalog/);
});

test('compile_film: a valid request yields a story the connection\'s own set_story accepts, and saves nothing by itself', async () => {
  const { call, w } = world();
  const e = usable.find((x) => x.film_types.includes('map')) ?? usable[0];
  const r = await call('compile_film', { dataset: e.id, film_type: e.film_types.find((f) => f !== 'paired'), title: 'A film from the builder' });
  assert.equal(r.isError, undefined, r.text);
  assert.match(r.text, /nothing is saved yet/); assert.ok(r.data.story.sequence.clips.length >= 2); assert.ok(r.data.report.dataset.licence_short);
  assert.equal(w.users.get(A.userId).projects.length, 0);                                                       // compile saved nothing
  const pid = (await call('create_project', { title: 'Builder' })).data.project_id;
  const saved = await call('set_story', { project_id: pid, story: r.data.story });
  assert.equal(saved.isError, undefined, saved.text); assert.equal(saved.data.saved, true);
});

test('every usable dataset x every film type the builder offers compiles to a story that passes the connection\'s own schema (the two vendored schemas agree)', () => {
  let n = 0;
  for (const e of usable) {
    for (const ft of e.film_types.filter((f) => FILM_TYPES.includes(f) && f !== 'paired')) {
      const { story } = compileFilm({ dataset: e.id, film_type: ft, title: 'Schema agreement' }, { audience: 'person' });
      assert.deepEqual(checkStory(story, compile(storySchema)), [], `${e.id} ${ft}`);
      n++;
    }
  }
  assert.ok(n >= 3, `only ${n} combinations`);
});

test('compile_film lists EVERY problem at once and refuses what the builder cannot do', async () => {
  const { call } = world();
  const r = await call('compile_film', { dataset: 'not_a_dataset', film_type: 'map', title: 'x', years: { start: '1500', end: '1400' } });
  assert.equal(r.isError, true); assert.equal(r.code, 'refused'); assert.match(r.text, /Not compiled/); assert.match(r.text, /dataset: /);
  const e = usable[0];
  const paired = await call('compile_film', { dataset: e.id, film_type: 'paired', title: 'x' });
  assert.equal(paired.isError, true);                                                                           // the schema's enum is the builder's: 'paired' is refused with a reason
  assert.ok(paired.failedChecks >= 1 || paired.code === 'args');
  const places = await call('compile_film', { dataset: e.id, film_type: e.film_types.find((f) => f !== 'paired'), title: 'x', places: ['Texas'] });
  assert.equal(places.code, 'args');                                                                            // not an argument at all
  assert.equal((await call('compile_film', { dataset: e.id, film_type: 'bars', title: 'x', source: 'my own numbers' })).code, 'args');
});

test('compile_film can apply the person\'s saved look or a starter look, and says what changed; an unknown look is refused', async () => {
  const { call } = world();
  const e = usable.find((x) => x.film_types.includes('bars') && !x.style?.choropleth?.continuous) ?? usable[0];
  const ft = e.film_types.find((f) => f !== 'paired');
  const withPreset = await call('compile_film', { dataset: e.id, film_type: ft, title: 'Looks', look_name: listPresets()[0].id, look_is_preset: true });
  assert.equal(withPreset.isError, undefined, withPreset.text); assert.equal(withPreset.data.report.look.applied, true);
  const missing = await call('compile_film', { dataset: e.id, film_type: ft, title: 'Looks', look_name: 'nobody-saved-this' });
  assert.equal(missing.code, 'not_found');
  const badPreset = await call('compile_film', { dataset: e.id, film_type: ft, title: 'Looks', look_name: 'no-such-preset', look_is_preset: true });
  assert.equal(badPreset.isError, true);
});

// ENGINE review HIGH-2: compileFilm's county rule reads req.look.look.ramp.mode, which is skipped if a look arrives as JSON text. The connector never lets the AI
// send a look at all: compile_film takes a NAME (a saved profile or a starter look) and the server turns it into an object. Proven from the AI's side.
import { getPreset } from '../supabase/functions/_shared/profile.ts';
test('HIGH-2: a hatched look cannot reach a county (continuous) map, whether it is a starter look, a saved look sent as JSON text, or a look pasted in as text', async () => {
  const { call } = world();
  const county = usable.find((x) => x.style?.choropleth?.continuous && x.film_types.includes('map'));
  assert.ok(county, 'a continuous-colour (county) map dataset exists in the catalog');
  const hatch = listPresets().map((p) => getPreset(p.id)).find((p) => p.look?.ramp?.mode === 'hatch');
  assert.ok(hatch, 'a hatching starter look exists');
  const base = { dataset: county.id, film_type: 'map', title: 'County map' };
  // 1. the starter look, by id
  const preset = await call('compile_film', { ...base, look_name: hatch.name, look_is_preset: true });
  assert.equal(preset.isError, true, preset.text); assert.match(preset.text, /too small to hatch/);
  // 2. the same look saved by the AI as JSON TEXT through set_profile (the one place text is accepted), then used by name
  const saved = await call('set_profile', { profile_json: JSON.stringify({ ...hatch, name: 'my-hatch', title: 'My hatch' }), make_default: false });
  assert.equal(saved.isError, undefined, saved.text);
  const named = await call('compile_film', { ...base, look_name: 'my-hatch' });
  assert.equal(named.isError, true, named.text); assert.match(named.text, /too small to hatch/);
  // 3. a look pasted straight into compile_film, as text or as an object, is not an argument at all: the closed schema refuses it
  for (const look of [JSON.stringify(hatch), JSON.stringify({ look: hatch.look }), hatch, { look: hatch.look }]) {
    const direct = await call('compile_film', { ...base, look });
    assert.equal(direct.isError, true); assert.equal(direct.code, 'args');
  }
  const t = TOOLS.find((x) => x.name === 'compile_film');
  assert.equal(t.inputSchema.additionalProperties, false);
  assert.ok(!Object.keys(t.inputSchema.properties).some((k) => /^look(_json|_text|_object)?$/.test(k)), 'no argument takes a look itself');
  // and the same story is accepted with a look that does not hatch, so the refusal above is the rule, not a broken fixture
  const solid = listPresets().map((p) => getPreset(p.id)).find((p) => p.look?.ramp?.mode === 'solid');
  const ok = await call('compile_film', { ...base, look_name: solid.name, look_is_preset: true });
  assert.equal(ok.isError, undefined, ok.text);
});
