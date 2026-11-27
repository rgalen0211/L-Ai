// BUILDER 2026-11-25: a ready-made start is offered only when the guided-builder function's catalog lists its dataset (app-builder.js readyMade), and
// one click compiles with that film type. So every start must be in what the REAL function answers to { action: 'catalog' } (supabase/functions/
// guided-builder/builder.ts, the same CATALOG the live function ships), with its film type in that dataset's film_types. Otherwise a stranger
// never sees the start, or clicks it and is refused at the Review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { catalogFor } from '../supabase/functions/guided-builder/builder.ts';
import { compileFilm } from '../supabase/functions/_shared/film.ts';
import { STORY_SCHEMA } from '../supabase/functions/_shared/catalog_data.ts';
import { checkAgainst } from '../supabase/functions/_shared/schema_check.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, document: undefined };
for (const f of ['app-catalog-data.js', 'app-templates.js', 'app-catalog.js', 'app-builder.js']) {
  try { vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', f), 'utf8'), ctx); } catch (e) { if (f !== 'app-builder.js') throw e; }
}
const B = ctx.window.ryagramBuilder;
const served = catalogFor();

test('every ready-made start is offered by the real catalog action, and its film type is one that dataset may be compiled as', () => {
  assert.ok(served.length >= 20, 'the function lists the usable catalog');
  for (const r of B.READY_MADE) {
    const d = served.find(x => x.id === r.dataset);
    assert.ok(d, `${r.id}: ${r.dataset} is not in the function's catalog, so the start would never be shown`);
    assert.ok((d.film_types || []).includes(r.film_type), `${r.id}: the function does not offer ${r.film_type} for ${r.dataset} (it offers ${JSON.stringify(d.film_types)})`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(B.readyMade(served).map(r => r.id))), JSON.parse(JSON.stringify(B.READY_MADE.map(r => r.id))), 'every start is shown on the live catalog');
});

test('one click compiles: each start, as the request the builder sends, is accepted by the real compile step and its story fits the story schema', () => {
  const out = process.env.STARTS_STORY_DIR;                                              // optional: write the compiled stories for ENGINE's sheet check
  for (const r of B.READY_MADE) {
    const req = JSON.parse(JSON.stringify(B.requestFrom({ dataset: r.dataset, type: r.film_type, title: r.title, start: r.start, end: r.end })));
    const { story, report } = compileFilm(req);
    assert.ok(story && story.sequence, `${r.id} compiled`);
    const clip = story.sequence.clips.find(c => c.kind === 'render');
    assert.equal(clip.dataset, r.dataset, r.id);
    assert.equal(clip.view, r.film_type, r.id);
    assert.deepEqual(checkAgainst(STORY_SCHEMA, story), [], `${r.id} fits the story schema`);
    assert.ok(report, r.id);
    if (out) fs.writeFileSync(path.join(out, `${r.id}.json`), JSON.stringify(story, null, 1));
  }
});

test('MUST-FAIL: a start on a blocked view or a dataset the function does not list is caught by the same check', () => {
  const offered = (r) => { const d = served.find(x => x.id === r.dataset); return Boolean(d && (d.film_types || []).includes(r.film_type)); };
  assert.equal(offered({ dataset: 'bls_state_unemployment', film_type: 'bars' }), false, 'on the engine block list: bars jump too far');
  assert.equal(offered({ dataset: 'cbp_finance_share_state', film_type: 'map' }), false, 'blocked: band flicker');
  assert.equal(offered({ dataset: 'not_a_dataset', film_type: 'line' }), false);
  assert.equal(offered({ dataset: 'cbp_manufacturing_share_state', film_type: 'line' }), true, 'the real start passes');
});
