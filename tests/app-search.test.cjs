const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(file, extra = {}) {
  const window = { ...extra };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), { window, URL });
  return window;
}
const S = load('app-search.js').ryagramSearch;
const T = load('app-templates.js').ryagramTemplates;
const plain = v => JSON.parse(JSON.stringify(v));

test('the prompt is checked before it is sent: empty, and over 500 characters', () => {
  assert.equal(S.checkPrompt('   ').ok, false);
  assert.match(S.checkPrompt('x'.repeat(501)).problem, /501 characters.*500/);
  assert.deepEqual(plain(S.checkPrompt('  Which states\u202e depend\non manufacturing? ')), { ok: true, prompt: 'Which states depend on manufacturing?', problem: '' });
});

test('a card shows what the answer says, as plain text, with a dash for anything missing and https links only', () => {
  const c = S.cardView({ id: 'a', title: 'T\u0007itle', publisher: 'P', source_url: 'javascript:alert(1)', coverage: 'C', licence_short: 'L', licence_full: 'Full', fit: 'full', recommended: true, reason: 'Because.' });
  assert.deepEqual(plain(c), { id: 'a', title: 'T itle', publisher: 'P', url: '', coverage: 'C', licenceShort: 'L', licenceFull: 'Full', fit: 'full', recommended: true, reason: 'Because.', noRedistribution: false });
  const empty = S.cardView({});
  assert.deepEqual([empty.title, empty.publisher, empty.coverage, empty.licenceShort, empty.fit, empty.recommended], [S.DASH, S.DASH, S.DASH, S.DASH, 'partial', false]);
  assert.equal(S.cardView({ id: 'a', source_url: 'https://www.census.gov/x' }).url, 'https://www.census.gov/x');
  assert.equal(S.cardView({ id: 'a', recommended: false, reason: 'sneaky' }).reason, '');
});

test('however the answer looks, at most one card shows Recommended', () => {
  const a = S.answerView({ suggestions: [{ id: 'a', recommended: true, reason: 'x' }, { id: 'b', recommended: true, reason: 'y' }, { id: '' }, { id: 'c' }] });
  assert.deepEqual(a.cards.map(c => [c.id, c.recommended]), [['a', true], ['b', false], ['c', false]]);
  assert.equal(S.answerView(null).cards.length, 0);
  assert.equal(S.answerView({ suggestions: Array(9).fill({ id: 'z' }) }).cards.length, 6);
  assert.deepEqual(plain(S.answerView({ verdict: { code: 'no_such_data', message: 'We don’t have it.' }, unavailable: [{ id: 'x', message: 'We have X, but can’t use it yet.' }, { id: 'y' }] })),
    { cards: [], verdict: { code: 'no_such_data', message: 'We don’t have it.' }, unavailable: [{ id: 'x', message: 'We have X, but can’t use it yet.' }] });
});

test('ticked data becomes one story, one clip each; data with no ready-made film is reported, not faked', () => {
  const one = S.filmFromTicks(['state_obesity_fastfood'], T, 'My headline');
  assert.equal(one.story.sequence.clips.filter(c => c.kind === 'render').length, 1);
  assert.equal(one.story.sequence.clips[0].headline, 'My headline');
  assert.deepEqual(plain(one.missing), []);
  const two = S.filmFromTicks(['state_obesity_fastfood', 'bps_county_permits', 'state_obesity_fastfood', 'not_in_templates'], T, '');
  const renders = two.story.sequence.clips.filter(c => c.kind === 'render');
  assert.deepEqual(plain(renders.map(c => c.dataset)), ['state_obesity_fastfood', 'bps_county_permits']);
  assert.equal(new Set(two.story.sequence.clips.map(c => c.id)).size, two.story.sequence.clips.length);   // unique clip ids
  assert.deepEqual(plain(two.missing), ['not_in_templates']);
  assert.match(two.story.notes, /does not join datasets/);
  assert.deepEqual(plain(S.filmFromTicks(['cbp_manufacturing_share_state'], T, '')), { story: null, missing: ['cbp_manufacturing_share_state'] });   // its template is switched off
  assert.equal(S.filmFromTicks(['a', 'b', 'c', 'd', 'e', 'f', 'g'], T, '').missing.length, 5);              // 5 sources at most
});
