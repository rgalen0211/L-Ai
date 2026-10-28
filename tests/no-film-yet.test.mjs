// A new project has no film yet (King's Island walk W1): the three Render buttons stay off with a line beside them saying what to do, and the database's engineer sentence is never shown
// to a person. The behaviour is walked in real Chrome by tools/check-no-film-yet.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../assets/app-library.js', import.meta.url), 'utf8');

test('the Render panel turns the buttons off and says why when the story is empty, and turns them on again when a film is chosen', () => {
  assert.match(src, /const NO_FILM = 'Choose a film above first\.';/);
  assert.match(src, /'data-key': 'no-film-yet'/);
  assert.match(src, /const noFilm = !!\(window\.ryagramTemplates && window\.ryagramTemplates\.isBlank\(v\.story_spec\)\);/);
  assert.match(src, /blankNote\.hidden = !noFilm;/);
  assert.match(src, /if \(noFilm\) \{ sheetButton\.disabled = true; previewButton\.disabled = true; why\.sheet = NO_FILM; why\.preview = NO_FILM; \}/);
  assert.match(src, /if \(noFilm\) why\.final = NO_FILM;/);
  assert.match(src, /: \(noFilm \? NO_FILM : ladder\.missing\);/);
  assert.match(src, /jobs\.storyChanged\(result\.story_sha256\);/);                               // choosing a film re-runs syncControls, so the buttons come back
});

test('the database sentence about a schema-1 sequence is turned into words a person can act on', () => {
  assert.match(src, /\/not a schema-1 sequence\/i\.test\(String\(err && err\.message\)\)/);
  assert.match(src, /This version has no film yet\. Choose one above and press \\u201cUse this film\\u201d, or fix the story file under Advanced\./);
});
