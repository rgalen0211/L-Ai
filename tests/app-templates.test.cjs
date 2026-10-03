const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/app-templates.js'), 'utf8'), { window });
const T = window.ryagramTemplates;
const plain = v => JSON.parse(JSON.stringify(v));

// The parts of the worker's story schema v1 a template can get wrong.
function assertSchemaShape(s) {
  assert.deepEqual(Object.keys(s).sort(), ['engine', 'name', 'notes', 'schema', 'sequence']);
  assert.equal(s.schema, 1);
  assert.equal(s.engine, 'sequence');
  assert.match(s.name, /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/);
  assert.deepEqual(plain(s.sequence.canvas), [1920, 1080]);
  assert.ok([24, 25, 30].includes(s.sequence.fps));
  assert.ok(['light', 'dark'].includes(s.sequence.theme));
  const [title, render] = s.sequence.clips;
  assert.equal(title.kind, 'title');
  assert.ok(title.seconds >= 0.5 && title.seconds <= 6);
  assert.ok(title.headline.length <= 160 && title.subhead.length <= 160);
  assert.doesNotMatch(title.headline, /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/);
  assert.equal(render.kind, 'render');
  assert.ok(['map', 'bars', 'line', 'paired', 'panel'].includes(render.view));
  assert.ok(render.start <= render.end);
  assert.ok(['cut', 'crossfade', 'fade'].includes(render.transition.kind));
}

test('every template on every offered dataset builds a story in the worker schema', () => {
  const views = new Set();
  for (const t of T.TEMPLATES) {
    for (const d of t.datasets) {
      const s = T.build(t.id, d, 'Obesity and fast food, 2011–2023');
      assertSchemaShape(s);
      assert.equal(s.sequence.clips[1].dataset, d);
      views.add(s.sequence.clips[1].view);
    }
  }
  assert.deepEqual([...views].sort(), ['bars', 'line', 'map', 'paired']);
});

test('county permits draw in continuous colour (too small to hatch); state maps keep hatching', () => {
  assert.deepEqual(plain(T.build('map', 'bps_county_permits', '').sequence.style_overrides), { choropleth: { mode: 'solid', continuous: true } });
  assert.equal(T.build('map', 'state_obesity_fastfood', '').sequence.style_overrides, undefined);
});

test('"Highest" template: the six states with the highest adult obesity, as a line', () => {
  const s = T.build('highest', 'state_obesity_fastfood', '');
  assert.equal(s.sequence.clips[0].headline, 'The states with the highest adult obesity');
  assert.deepEqual(plain(s.sequence.clips[1].settings), { line_top_n: 6 });
  assert.equal(s.sequence.clips[1].view, 'line');
  assert.equal(T.build('map', 'state_obesity_fastfood', '').sequence.clips[0].headline,
               'Obesity and fast food by state (CDC + Census, annual)');            // other templates unchanged
});

test('industry template: 18 state sector-share races, 1998-2023, headline from the sector', () => {
  const t = T.TEMPLATES.find(x => x.id === 'sector');
  assert.equal(t.datasets.length, 18);
  assert.ok(t.datasets.every(d => /^cbp_[a-z_]+_share_state$/.test(d)));
  assert.match(t.note, /can’t share a map/);
  const s = T.build('sector', 'cbp_manufacturing_share_state', '');
  assert.equal(s.sequence.clips[0].headline, 'Which states depend most on manufacturing?');
  assert.equal(s.sequence.clips[0].subhead, 'Manufacturing: share of CBP-covered jobs, by state (Census, annual)');
  assert.deepEqual(plain(s.sequence.clips[1]), { kind: 'render', id: 'main', dataset: 'cbp_manufacturing_share_state', view: 'bars',
    start: '1998', end: '2023', transition: { kind: 'crossfade', seconds: 0.6 }, settings: { top_n: 10, axis: 'fixed' }, hold_seconds: 3 });
  assert.deepEqual(plain(s.sequence.style_overrides), { bars: { swap_seconds: 0.5 } });
  assert.equal(T.build('sector', 'cbp_retail_share_state', 'My own question').sequence.clips[0].headline, 'My own question');
  for (const d of t.datasets) {
    assert.ok(T.DATASETS[d].label.length <= 160);
    assert.doesNotMatch(T.DATASETS[d].label + T.DATASETS[d].headline, /all jobs/i);   // CBP-covered, never "all"
  }
});

test('headlines are cleaned: control and direction-override characters removed, length capped', () => {
  const s = T.build('map', 'state_obesity_fastfood', 'Evil\u202eheadline\u0007 ' + 'x'.repeat(300));
  assertSchemaShape(s);
  assert.ok(s.sequence.clips[0].headline.startsWith('Evil headline'));
  assert.equal(s.sequence.clips[0].headline.length, 160);
  const empty = T.build('paired', 'state_obesity_fastfood', '   ');
  assert.equal(empty.sequence.clips[0].headline, T.DATASETS.state_obesity_fastfood.label);   // falls back
});

test('story names are safe slugs, whatever the title', () => {
  assert.equal(T.slug('Obesity & fast food — 2011/2023!'), 'Obesity-fast-food-2011-2023');
  assert.equal(T.slug('Ünïcödé café'), 'Unicode-cafe');
  assert.equal(T.slug('!!!'), 'ryagram-story');
  assert.match(T.slug('a'.repeat(80) + ' b'), /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/);
});

test('only offered template/dataset pairs build', () => {
  assert.throws(() => T.build('globe', 'state_obesity_fastfood', 'x'), /Unknown template/);
  assert.throws(() => T.build('paired', 'bls_state_unemployment', 'x'), /isn’t offered/);
});

test('blank means nothing to lose', () => {
  assert.equal(T.isBlank({}), true);
  assert.equal(T.isBlank(null), true);
  assert.equal(T.isBlank({ schema: 1 }), false);
});
