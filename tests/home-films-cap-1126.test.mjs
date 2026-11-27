// GAMES 22:01 LOW: with the inner scroll box gone, the Your films row shows every tile; with 'All my films' available the home page shows only the newest four (listProjects is newest first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const lib = fs.readFileSync(new URL('../assets/app-library.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('HOME FILMS CAP: four newest when All my films exists, all otherwise', () => {
  assert.match(lib, /const HOME_FILMS_MAX = 4;/);
  assert.ok(lib.includes('(myFilmsOn() && window.ryagramFilms ? projects.slice(0, HOME_FILMS_MAX) : projects).map(p => S.filmCard('));
});
test('DELIVERY PLAYER: the delivered film is capped to the page (Claude 22:42): class, width 100%, max-height 70vh, contained', () => {
  assert.ok(lib.includes("h('video', { class: 'delivery-video', controls: true, preload: 'metadata', src: got.url })"));
  const css = fs.readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.delivery-video\{[^}]*width:100%[^}]*max-height:70vh[^}]*object-fit:contain/);
});
