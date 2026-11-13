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
  assert.deepEqual(fixture.order, [...D.ORDER]);
  for (const id of D.ORDER) assert.equal(fixture.labels[id], D.KNOWN[id].label, id);
  assert.deepEqual(Object.keys(fixture.labels).sort(), Object.keys(D.KNOWN).sort());
});

test("the words: every Coming soon card line in the fixture is the site's own line, and the refused wording is gone", () => {
  for (const [id, line] of Object.entries(fixture.lines)) assert.equal(D.KNOWN[id].line, line, id);
  assert.equal(D.KNOWN.data_films.sentence, fixture.data_films_sentence);
  for (const id of D.ORDER) if (id !== 'data_films') assert.ok(fixture.lines[id], `${id} has a line in the fixture`);
  const all = read('assets/app-departments.js');
  assert.ok(!/where would a new shop do well/i.test(all) && !/chicken restaurant might do well/i.test(all), 'no line asks where a business would do well');
});

test('My films is always shown; where it goes follows the per-account switch (the fixture says what the site does, the real-Chrome check tools/check-home-panel-fixture.py reads the bar)', () => {
  assert.ok(!D.ORDER.includes('my_films'));
  assert.equal(fixture.my_films.always_shown, true);
  assert.equal(fixture.my_films.link_when_on, '#/films'); assert.equal(fixture.my_films.link_when_off, '#/');
  assert.match(read('assets/app-departments.js'), /featureOn\('myFilms'\) \? '#\/films' : '#\/', 'My films'/);
});
