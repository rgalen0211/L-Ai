// Item 4 (in-chat home panel), the website half (WEB, 2026-11-13): the panel and the site must name and order the departments the same way. The site's list is the source;
// tests/home-panel-departments.json is the copy CONNECT builds the panel from. Offline; fails if either side drifts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const fixture = JSON.parse(read('tests/home-panel-departments.json'));
const win = { addEventListener() {}, removeEventListener() {} };
vm.runInNewContext(read('assets/app-departments.js'), { window: win, document: { addEventListener() {}, removeEventListener() {}, body: {}, createElement() { return {}; } }, console });
const D = win.ryagramDepartments;

test('the home panel list has the same ids, order and labels as the site departments', () => {
  // The chat's home panel lists what the SERVER announces; a page-owned department (PAGE_ONLY: Forecasts, Ryan 11-20, until CONNECT's row exists) is on the site only.
  const served = [...D.ORDER].filter(id => !D.PAGE_ONLY.includes(id));
  assert.deepEqual(fixture.order, served);
  for (const id of served) assert.equal(fixture.labels[id], id === 'geo_intelligence' ? 'Opportunity Map' : D.KNOWN[id].label, id); // geo_intelligence: the CONNECT fixture keeps the old name; the site says Perfect City (Ryan 11-20 14:36)
  assert.deepEqual(Object.keys(fixture.labels).sort(), Object.keys(D.KNOWN).filter(id => !D.PAGE_ONLY.includes(id)).sort());
});

test("the words: every Coming soon card line in the fixture is the site's own line, and the refused wording is gone", () => {
  // Paired with the Compilations page push: while this tree's site file still has the OLD compilations line, the fixture must hold the NEW one (exact words); once the site has it, plain equality holds.
  const OLD_COMP = 'Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. Soon it will turn your clips into songs, too.';
  const NEW_COMP = 'Save a request for a phrase in your footage. The film needs the Ryagram app, not open to everyone yet.';
  for (const [id, line] of Object.entries(fixture.lines)) assert.equal(id === 'compilations' && D.KNOWN[id].line === OLD_COMP ? NEW_COMP : D.KNOWN[id].line, line, id);
  assert.equal(D.KNOWN.data_films.sentence, fixture.data_films_sentence);
  for (const id of D.ORDER) if (id !== 'data_films' && !D.PAGE_ONLY.includes(id)) assert.ok(fixture.lines[id], `${id} has a line in the fixture`);
  const all = read('assets/app-departments.js');
  assert.ok(!/where would a new shop do well/i.test(all) && !/chicken restaurant might do well/i.test(all), 'no line asks where a business would do well');
});

test('My films is always shown; where it goes follows the per-account switch (the fixture says what the site does, the real-Chrome check tools/check-home-panel-fixture.py reads the bar)', () => {
  assert.ok(!D.ORDER.includes('my_films'));
  assert.equal(fixture.my_films.always_shown, true);
  assert.equal(fixture.my_films.link_when_on, '#/films'); assert.equal(fixture.my_films.link_when_off, '#/');
  assert.match(read('assets/app-departments.js'), /featureOn\('myFilms'\) \? '#\/films' : '#\/', 'My films'/);
});

test('Perfect City (Ryan 2026-11-20 14:36, replacing Opportunity Map): the SITE says Perfect City; the CONNECT-owned panel fixture still says its old name until CONNECT changes it, and the old names are not shown on the site', () => {
  assert.equal(D.KNOWN.geo_intelligence.label, 'Perfect City'); assert.equal(fixture.labels.geo_intelligence, 'Opportunity Map', 'CONNECT-owned fixture: not changed here');
  for (const f of ['assets/app-departments.js', 'geo-demo/index.html']) { assert.ok(!/Geographic Intelligence|Opportunity Map|Geo intelligence/i.test(read(f)), f); }
  assert.match(read('geo-demo/index.html'), /<title>Perfect City demo/);
});
