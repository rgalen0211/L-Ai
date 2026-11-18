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
  assert.equal(Dp.ORDER[Dp.ORDER.length - 1], 'studio');
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

test('the server half is a migration for Ryan to apply (not applied here) and a rollback outside migrations/', () => {
  const m = read('supabase/migrations/20261118000100_department_studio.sql');
  assert.match(m, /NOT APPLIED/); assert.match(m, /insert into public\.departments[\s\S]*\('studio', 'Studio', 'soon', false, 60\)[\s\S]*on conflict \(id\) do nothing/);
  assert.ok(!/drop |delete |truncate /i.test(m.replace(/--.*$/gm, '')), 'adds one row, nothing else');
  const r = read('supabase/rollbacks/20261118000100_department_studio_rollback.sql');
  assert.match(r, /delete from public\.department_interest where department = 'studio'/); assert.match(r, /delete from public\.departments where id = 'studio'/);
});
