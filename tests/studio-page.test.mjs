// WEB 11-18: the STUDIO Coming soon page (Ryan Q639 yes, wording as filed; working name). Podcast camera crew + live editor. Public wording: no dates, no prices, no competitor names, no promise about
// live-switching hardware beyond 'works with your cameras'. Shown as one more soon department in the top bar, after Animation Studio, with the same 'Tell me when it's ready' button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/app-departments.js'), { window: win, document: {}, setTimeout, clearTimeout });
const Dp = win.ryagramDepartments, J = x => JSON.parse(JSON.stringify(x));
const all = () => [Dp.KNOWN.studio.line, ...Dp.KNOWN.studio.sections.flatMap(([t, items]) => [t, ...items])].join(' ');

test('Studio is a known department, last in the order, with the approved line', () => {
  assert.equal(Dp.KNOWN.studio.label, 'Studio');
  assert.equal(Dp.ORDER.filter(id => !Dp.PAGE_ONLY.includes(id)).pop(), 'studio');         // last of the departments the server announces (a page-owned one, Forecasts, follows it)
  assert.equal(Dp.KNOWN.studio.line, 'Your podcast’s camera crew and editor in one: Ryagram works with your cameras, cuts to the right camera as people talk, and finds the moments worth sharing.');
  assert.deepEqual(J(Dp.normalize([{ id: 'studio', status: 'soon' }, { id: 'games', status: 'soon' }])), { working: [], soon: ['games', 'studio'] });
});

test('the fuller words are exactly the filed ones: what is coming, then not built yet, with no date and no price', () => {
  assert.deepEqual(J(Dp.KNOWN.studio.sections.map(s => s[0])), ['What is coming', 'Not built yet']);
  const t = all();
  for (const w of ['multi-camera setup', 'reaction shot after the joke', 'wide shot when it gets heated', 'push-in on the serious line', 'Shorts', 'Your own AI can drive it', 'live editor', 'None of this works today', 'no price and no date']) assert.ok(t.includes(w), w);
  assert.ok(!/\b(20\d\d|january|february|march|april|may|june|july|august|september|october|november|december|\$|per month|free)\b/i.test(t), 'no date or price');
  assert.ok(!/\b(zoom|riverside|descript|restream|streamyard|obs|vmix|atem|blackmagic)\b/i.test(t), 'no competitor or hardware names');
  assert.ok(!/live switching|hardware/i.test(t), 'no promise about live-switching hardware');
});

test('the page draws the sections under the line, and the home-panel fixture carries the same id, label and line', () => {
  const src = read('assets/app-departments.js');
  assert.match(src, /\.\.\.studioEls, \.\.\.moreEls/);
  const fx = JSON.parse(read('tests/home-panel-departments.json'));
  assert.equal(fx.labels.studio, 'Studio'); assert.equal(fx.lines.studio, Dp.KNOWN.studio.line); assert.ok(fx.order.includes('studio'));
});

test('the server half (the studio department row) is ONE migration, CONNECT’s file, with its rollback outside migrations/; the page ignores the id until the server lists it', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const studio = fs.readdirSync(dir).filter(f => /studio/i.test(f) && !/animation/i.test(f));
  assert.deepEqual(studio, ['20261118000100_department_studio.sql'], 'exactly one studio migration in the tree: CONNECT’s');
  assert.ok(fs.existsSync(new URL('../supabase/rollbacks/20261118000100_department_studio_rollback.sql', import.meta.url)), 'its rollback lives outside migrations/');
  assert.match(read('supabase/migrations/20261118000100_department_studio.sql'), /'studio'/);
  assert.deepEqual(J(Dp.normalize([{ id: 'games', status: 'soon' }])), { working: [], soon: ['games'] });   // no studio row from the server: no Studio in the bar
});
