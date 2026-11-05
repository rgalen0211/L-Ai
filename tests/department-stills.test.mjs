// Department picture slots (CC1 11-05): up to four frames on the Games and Geographic Intelligence Coming soon pages and a Forecasts group on the Data films page, behind deptStills (OFF).
// The files are not in the repo; a missing file means no frame. Alt text is the draft in proposals/DEPT-PAGES-STILLS-1105.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/app-departments.js'), { window: win, document: {}, setTimeout, clearTimeout });
const Dp = win.ryagramDepartments;

test('the switch is OFF and needs exactly true; only games, geo_intelligence and data_films have slots', () => {
  assert.match(read('assets/ryagram-config.js'), /\n  deptStills: false,/);
  for (const cfg of [undefined, null, {}, { deptStills: false }, { deptStills: 'true' }, { deptStills: 1 }]) assert.equal(Dp.stillsFor('games', cfg), null, JSON.stringify(cfg));
  const on = { deptStills: true };
  for (const id of ['games', 'geo_intelligence', 'data_films']) assert.equal(Dp.stillsFor(id, on).alts.length, 4, id);
  for (const id of ['compilations', 'animation_studio', 'nope', '__proto__', 'constructor']) assert.equal(Dp.stillsFor(id, on), null, id);
});

test('alt text is the draft from the stills proposal, word for word (when the proposal file is on this machine), and says made-up where it should', { skip: !fs.existsSync('C:/Users/Ryan/Ryagram-logs/proposals/DEPT-PAGES-STILLS-1105.md') && 'proposal file not on this machine' }, () => {
  const draft = fs.readFileSync('C:/Users/Ryan/Ryagram-logs/proposals/DEPT-PAGES-STILLS-1105.md', 'utf8').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  for (const id of ['games', 'geo_intelligence', 'data_films']) for (const alt of Dp.STILLS[id].alts) assert.ok(draft.includes(alt.replace(/[‘’]/g, "'")), alt);
  assert.ok(Dp.STILLS.geo_intelligence.alts.every(a => /made-up/.test(a)));
  assert.match(Dp.STILLS.geo_intelligence.alts[3], /Simulated/);
});

test('a frame is hidden until its file loads, tries .svg then .png, and is removed when neither exists; the group stays hidden with no file', () => {
  const src = read('assets/app-departments.js');
  const block = src.match(/function stillsBlock\(id\) \{[\s\S]*?\n    \}\n/)[0];
  assert.match(block, /class: 'soon-stills'[^\n]*hidden: true/); assert.match(block, /class: 'soon-still', hidden: true/);
  assert.match(block, /\/assets\/dept-stills\/\$\{s\.name\}-\$\{i \+ 1\}/); assert.match(block, /\.svg/); assert.match(block, /\.png/);
  assert.match(block, /fig\.hidden = false; group\.hidden = false/); assert.match(block, /fig\.remove\(\)/);
  assert.ok(!/loading: 'lazy'/.test(block), 'a lazy image inside a hidden figure would never load');
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(block) && !/caption/i.test(block), 'text alt only, no caption words of mine');
});

test('the block is drawn only on the three pages, after the sentence or picture, and no stills are copied into the repo', () => {
  const src = read('assets/app-departments.js');
  assert.equal((src.match(/stillsBlock\(id\)/g) || []).length, 3, 'defined once, used on Data films and on a Coming soon page');
  assert.ok(!fs.existsSync(new URL('../assets/dept-stills/', import.meta.url)), 'the stills are Ryan\'s call: not in the repo yet');
});
