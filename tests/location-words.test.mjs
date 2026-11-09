// BACKLOG WEB-3 / NEXT-WEB 207: GEO's own words on the Geographic Intelligence Coming soon page, behind locationWords (OFF). Words from proposals/GEO-LI-COMING-SOON-WORDS-1106.md,
// run through the claims guard (ryagram.geo.claims.check flags none). No figure for any real place and no example number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/app-departments.js'), { window: win, document: {}, setTimeout, clearTimeout });
const Dp = win.ryagramDepartments;
const text = () => [Dp.LOCATION.intro, ...Dp.LOCATION.sections.flatMap(([t, items]) => [t, ...items.map(i => i.join(' '))]), Dp.LOCATION.noFigure, Dp.LOCATION.source].join('\n');

test('shown only on geo_intelligence and only when the switch is exactly true; the switch ships OFF', () => {
  for (const cfg of [undefined, null, {}, { locationWords: false }, { locationWords: 'true' }, { locationWords: 1 }]) assert.equal(Dp.locationFor('geo_intelligence', cfg), null, JSON.stringify(cfg));
  assert.ok(Dp.locationFor('geo_intelligence', { locationWords: true }));
  for (const id of ['games', 'data_films', 'compilations', 'animation_studio', '__proto__']) assert.equal(Dp.locationFor(id, { locationWords: true }), null, id);
  assert.match(read('assets/ryagram-config.js'), /\n  locationWords: false,\n/);
  assert.match(read('assets/app-departments.js'), /const locationOn = cfg => !!cfg && cfg\.locationWords === true;/);
});

test('the page says what it will do, will not claim, and how to read the numbers; it names no best site, no success, no zero', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(Dp.LOCATION.sections.map(s => s[0]))), ['What it will do', 'What it will not claim', 'How to read the numbers']);
  const t = text();
  assert.match(t, /does not say whether a business would succeed/); assert.match(t, /does not pick a .best. site/); assert.match(t, /does not say what zoning allows/);
  assert.match(t, /Observed:[\s\S]*Calculated:[\s\S]*Estimated:[\s\S]*Simulated:/); assert.match(t, /never shows a zero/);
  assert.match(t, /forecast is an estimate/); assert.match(t, /Each source is named beside its numbers/);
});

test('nothing is promised or priced, no real place is named, no outside link', () => {
  const t = text();
  assert.ok(!/[$£€]\s?\d|\b(Dayton|Ohio|Greene|Montgomery)\b/.test(t), 'no price and no real place');
  assert.ok(!/\b(guarantee|always|best place|will succeed|perfect|revolutionary)\b/i.test(t), 'no boasting word');
  assert.ok(!/https?:|www\./i.test(t));
  assert.ok(!/\d{2,}/.test(t.replace(/10-minute|10 minutes|1 and 2 km/g, '')), 'no stray figure: only the radii the tool will use');
});

test('it is drawn with the draft note, replaces the departmentDetails words, and builds only with text nodes', () => {
  const code = read('assets/app-departments.js');
  assert.match(code, /const loc = locationFor\(id, window\.ryagramConfig\);/); assert.match(code, /const more = loc \? null : detailsFor/);
  assert.match(code, /Draft wording, not yet approved\./); assert.ok(!/innerHTML/.test(code));
});
