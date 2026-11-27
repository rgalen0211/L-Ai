// GAMES 22:01 LOW: with the inner scroll box gone, the Your films row shows every tile; with 'All my films' available the home page shows only the newest four (listProjects is newest first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const lib = fs.readFileSync(new URL('../assets/app-library.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('HOME FILMS CAP: four newest when All my films exists, all otherwise', () => {
  assert.match(lib, /const HOME_FILMS_MAX = 4;/);
  assert.ok(lib.includes('(myFilmsOn() && window.ryagramFilms ? projects.slice(0, HOME_FILMS_MAX) : projects).map(p => S.filmCard('));
});
