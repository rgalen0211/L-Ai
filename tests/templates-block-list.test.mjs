// The server's template list (supabase/functions/_shared/templates.ts, read by the AI editor) must never offer a (dataset, view) pair that ENGINE's
// catalog block list says the machine's own checks fail (2026-11-23: the county permits Map and the Bars template were dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '../supabase/functions/_shared/templates.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const block = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'data', 'engine-catalog-block-list-1123.json'), 'utf8'));
const blocked = (d, v) => (block[d] || []).includes(v);

test('the server template list offers no block-listed (dataset, view) pair that it can build', () => {
  assert.ok(Object.keys(block).length >= 16, 'the block list did not load');
  let checked = 0;
  for (const t of shared.TEMPLATES) {
    // paired is never built here (unmeasured) and the Industry template is dormant (confirmed: false; the site hides it with industryTemplate): neither is offered to anyone.
    if (t.unmeasured || t.confirmed === false) continue;
    for (const d of t.datasets) { assert.ok(!blocked(d, t.view), `template ${t.id} offers ${d} ${t.view}, which the engine's checks fail`); checked++; }
  }
  assert.ok(checked >= 3, 'too few template pairs were checked');
});

test('the two pairs ENGINE named are gone: Map on bps_county_permits and the Bars template on bls_state_unemployment', () => {
  const offers = (id, d) => shared.TEMPLATES.some(t => t.id === id && t.datasets.includes(d));
  assert.equal(offers('map', 'bps_county_permits'), false);
  assert.equal(shared.TEMPLATES.some(t => t.id === 'bars'), false);
  assert.ok(blocked('bps_county_permits', 'map') && blocked('bls_state_unemployment', 'bars'), 'the block list no longer names them');
});
