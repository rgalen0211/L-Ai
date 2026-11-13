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

test('My films is a link that follows the per-account switch, not a department', () => {
  assert.ok(!D.ORDER.includes('my_films'));
  assert.equal(fixture.my_films.shownOnlyWhen, "featureOn('myFilms')");
  assert.match(read('assets/app-departments.js'), /featureOn\('myFilms'\)/);
});
