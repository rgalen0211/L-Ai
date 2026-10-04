const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
function load(...files) {
  const ctx = { window: {}, document: undefined };
  for (const f of files) vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', f), 'utf8'), ctx);
  return ctx.window;
}
const w = load('app-catalog-data.js', 'app-templates.js', 'app-catalog.js');
const D = w.ryagramCatalogData, K = w.ryagramCatalog, T = w.ryagramTemplates;
const plain = v => JSON.parse(JSON.stringify(v));
const usable = D.entries.filter(e => e.status === 'usable');

test('the generated data is well formed: unique ids, known groups and statuses, plain text', () => {
  assert.match(D.engine, /^[0-9a-f]{12}$/);
  assert.ok(D.entries.length > 60);
  assert.equal(new Set(D.entries.map(e => e.id)).size, D.entries.length);
  const groups = new Set(K.GROUPS.map(g => g.key));
  for (const e of D.entries) {
    assert.match(e.id, /^[a-z0-9_]{1,64}$/);
    assert.ok(['usable', 'next', 'later'].includes(e.status), e.id);
    assert.ok(groups.has(e.group), `${e.id}: ${e.group}`);
    assert.ok(e.title && e.blurb && e.source, `${e.id} needs a title, a line and a source`);
    assert.ok(e.views.length && e.views.every(v => ['map', 'bars', 'line', 'paired', 'panel'].includes(v)), e.id);
    assert.ok(!e.url || e.url.startsWith('https://'), e.id);
    assert.doesNotMatch(`${e.title} ${e.blurb}`, /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/);
    assert.doesNotMatch(`${e.title} ${e.blurb}`, /\ball jobs\b/i);               // CBP-covered, never "all"
    if (e.family && e.family.endsWith('share-state')) assert.match(e.title, /CBP-covered/);
    if (e.kind === 'plain') assert.ok(!e.views.includes('map'), `${e.id}: a map needs places`);
  }
});

test('fixtures, private data and shapes the app cannot build are not in the catalog', () => {
  for (const e of D.entries) {
    assert.doesNotMatch(e.id, /^example_corp_|_fixture|^ryan_|lewis_clark|brooks_liscow|network/, e.id);
  }
});

test('"ready" is exactly the installed worker allowlist, and every ready dataset can be priced and built', () => {
  assert.deepEqual(plain(usable.map(e => e.id).sort()), plain([...D.allow].sort()));
  for (const id of D.allow) assert.ok(D.entries.some(e => e.id === id), `allowlisted ${id} is missing from the catalog`);
  for (const id of Object.keys(D.next)) assert.equal(D.entries.find(e => e.id === id)?.status, 'next', id);
  // credit_quote refuses a dataset with no shape row (supabase/phase-2b/credits_ledger.sql).
  const sql = fs.readFileSync(path.join(root, 'supabase/phase-2b/credits_ledger.sql'), 'utf8');
  const seeded = new Set([...sql.matchAll(/\('([a-z0-9_]+)', 'standard'/g)].map(m => m[1]));
  const sectors = [...sql.match(/unnest\(array\[((?:'[a-z_]+',?\s*)+)\]\) sector/)[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  const suffixes = [...sql.match(/unnest\(array\[((?:'_[a-z_]+',?\s*)+)\]\) suffix/)[1].matchAll(/'(_[a-z_]+)'/g)].map(m => m[1]);
  for (const s of sectors) for (const x of suffixes) seeded.add(`cbp_${s}${x}`);
  for (const e of usable) {
    assert.ok(seeded.has(e.id), `${e.id} has no credit_dataset_shapes row`);
    assert.ok(e.window && e.window.length === 2, `${e.id} needs a ready-made period`);
  }
});

test('when WORKER-SETUP.ps1 is on this machine, the catalog lists are its lists', t => {
  const f = 'C:/Users/Ryan/Ryagram-logs/proposals/WORKER-SETUP.ps1';
  if (!fs.existsSync(f)) return t.skip('WORKER-SETUP.ps1 not on this machine');
  const text = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '');
  const allow = [...text.match(/\$AllowToml\s*=\s*@'\s*([\s\S]*?)\s*'@/)[1].matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]);
  const next = [...text.match(/\$UpdateCandidates\s*=\s*\[ordered\]@\{([\s\S]*?)\n\}/)[1].matchAll(/^\s*'([a-z0-9_]+)'\s*=\s*'/gm)].map(m => m[1]);
  assert.deepEqual(plain([...D.allow].sort()), plain([...allow].sort()), 'regenerate: python tools/gen-catalog.py');
  assert.deepEqual(plain(Object.keys(D.next).sort()), plain([...next].sort()), 'regenerate: python tools/gen-catalog.py');
});

test('by default only what can run is listed; "coming soon" is a separate switch', () => {
  const hidden = K.layout(D.entries);
  const shownHidden = hidden.flatMap(g => [...g.items, ...g.families.flatMap(f => f.items)]);
  assert.equal(shownHidden.length, usable.length);
  assert.ok(shownHidden.every(e => e.status === 'usable'));
  assert.ok(hidden.every(g => g.ready === g.total && g.ready > 0), 'no empty or partly "soon" groups');
  const soon = K.layout(D.entries, { soon: true });
  const shownSoon = soon.flatMap(g => [...g.items, ...g.families.flatMap(f => f.items)]);
  assert.equal(shownSoon.length, D.entries.length);
  assert.ok(soon.length > hidden.length);
  // Within a group, ready rows come before coming-soon rows.
  for (const g of soon) {
    const order = g.items.map(e => ['usable', 'next', 'later'].indexOf(e.status));
    assert.deepEqual(plain(order), plain([...order].sort((a, b) => a - b)), g.name);
  }
});

test('sector rows sit under one family heading, search narrows, and nothing is invented', () => {
  const work = K.layout(D.entries, { soon: true }).find(g => g.key === 'work');
  const share = work.families.find(f => f.key === 'cbp-share-state');
  assert.equal(share.title, 'Share of jobs by industry, by state');
  assert.equal(share.items.length, 18);
  assert.ok(share.items.some(e => e.short === 'Manufacturing'));
  assert.equal(K.visible(D.entries, { text: 'manufacturing' }).length, 1);                  // ready only
  assert.ok(K.visible(D.entries, { soon: true, text: 'manufacturing' }).length > 1);
  assert.equal(K.visible(D.entries, { text: 'zzzz nothing' }).length, 0);
  assert.equal(K.visible(D.entries, { text: 'census manufacturing' }).length, 1);            // words are ANDed
});

test('every ready dataset builds a valid story on every offered view, in the worker schema shape', () => {
  let n = 0;
  for (const e of usable) {
    const choices = K.viewChoices(e, T.TEMPLATES);
    assert.ok(choices.length, e.id);
    for (const { view, blocked } of choices.filter(c => !c.blocked)) {
      const s = plain(T.buildFor(K.storyInfo(e, view), ''));
      assert.deepEqual(Object.keys(s).sort(), ['engine', 'name', 'notes', 'schema', 'sequence']);
      assert.match(s.name, /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/);
      const [title, render] = s.sequence.clips;
      assert.ok(title.headline.length >= 1 && title.headline.length <= 160 && title.subhead.length <= 160);
      assert.deepEqual([render.dataset, render.view, render.start, render.end], [e.id, view, e.window[0], e.window[1]]);
      if (view === 'bars') {
        assert.deepEqual(s.sequence.style_overrides, { bars: { swap_seconds: 0.5 } });  // snapping bars fail rows_move_smoothly
        assert.deepEqual([render.settings, render.hold_seconds], [{ top_n: 10, axis: 'fixed' }, 3]);
      }
      if (view === 'map' && /counties/i.test(e.level)) assert.deepEqual(s.sequence.style_overrides, { choropleth: { mode: 'solid', continuous: true } });
      if (view === 'map' && /states/i.test(e.level)) assert.equal(s.sequence.style_overrides, undefined);
      n++;
    }
  }
  assert.ok(n >= usable.length * 2, `${n} stories`);
  assert.throws(() => T.buildFor(K.storyInfo({ ...usable[0], window: null }, 'map'), ''), /ready-made period/);
  assert.throws(() => K.storyInfo(D.entries.find(e => e.id === 'bls_state_unemployment'), 'map'), /isn.t offered/);   // measured to fail
  assert.throws(() => T.buildFor({ id: 'x; drop', view: 'map' }, ''), /Unknown dataset/);
  assert.throws(() => T.buildFor({ id: 'ok_id', view: 'globe' }, ''), /available/);
});

test('"not drawn before" is said for any view and dataset pair no confirmed template has drawn', () => {
  const obesity = K.viewChoices(D.entries.find(e => e.id === 'state_obesity_fastfood'), T.TEMPLATES);
  assert.deepEqual(plain(obesity.map(c => [c.view, c.tested, !!c.blocked])),
                   [['map', true, false], ['bars', false, true], ['line', true, false], ['paired', true, false]]);
  const sector = K.viewChoices(D.entries.find(e => e.id === 'cbp_retail_share_state'), T.TEMPLATES);
  assert.ok(sector.every(c => !c.tested));
});

test('measured combinations: blocked views are not built, drawn-and-passing ones are marked drawn', () => {
  const by = id => K.viewChoices(D.entries.find(e => e.id === id), T.TEMPLATES);
  assert.deepEqual(plain(by('bls_state_unemployment').filter(c => c.blocked).map(c => c.view)), ['map']);
  assert.deepEqual(plain(by('cbp_suppression').filter(c => c.blocked).map(c => c.view)), ['bars']);
  assert.equal(by('cbp_county_grocery').find(c => c.view === 'map').tested, true);
  assert.equal(by('cbp_suppression').find(c => c.view === 'line').tested, true);
  // Every measured entry names a dataset the catalog actually has, and a view it offers.
  for (const kind of ['ok', 'blocked']) {
    for (const [id, v] of Object.entries(K.MEASURED[kind])) {
      const e = D.entries.find(x => x.id === id);
      assert.ok(e, id);
      for (const view of Array.isArray(v) ? v : Object.keys(v)) assert.ok(e.views.includes(view), `${id}/${view}`);
    }
  }
});
