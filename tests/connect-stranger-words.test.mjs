// What the connector says to a STRANGER's AI (CONNECT 2026-11-23, audit of GAMES' 10:37 list, for Connect-an-AI open to everyone): every sentence below is true for an account with no credits and no desktop app.
// Customer step: a stranger's AI never promises a map or bars that fail, a compilation or download that needs an app the stranger cannot get, or a final film the stranger cannot pay for.
// Reads the real tool definitions and source; talks to nothing. Must-fails: tests/connect_stranger_words_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { UNMEASURED_WORDS } from '../supabase/functions/_shared/templates.ts';

const src = (p) => fs.readFileSync(new URL('../supabase/functions/' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tool = (n) => TOOLS.find((t) => t.name === n);

test('nothing steers the AI to a map or bars as the safe choice: a line view is, and the other views are "where dataset_info says"', () => {
  for (const f of ['connect-core/tools.ts', 'connect-core/story_check.ts', '_shared/templates.ts']) assert.doesNotMatch(src(f), /use a map, bars or line view/i, f);
  assert.match(UNMEASURED_WORDS, /use a line view \(it works for every dataset/);
  assert.match(src('connect-core/story_check.ts'), /Use a line view \(it works for every dataset\), or put a measured keyframes_per_year/);
  assert.doesNotMatch(UNMEASURED_WORDS, /make this film in the Ryagram app/);
  assert.match(src('connect-core/tools.ts'), /Views to use in a story for it: \$\{storyViews\.join\(", "\)\}\. A line view works for every dataset\./);
  assert.match(tool('dataset_info').description, /Use it before you promise a person a map, bars or a range of years \(a line view works for every dataset\)/);
});

test('the compilation and download tools say the desktop app is not open to everyone and tell the AI what to say without it', () => {
  assert.match(tool('set_compilation_request').description, /The desktop app is not open to everyone yet: ask the person first whether they have it/);
  assert.match(src('connect-core/tools.ts'), /If they do not have the app, tell them plainly that compilations are not available to them yet\./);
  assert.match(tool('request_download').description, /not open to everyone yet: if the person does not have it, tell them plainly that a download cannot be made for them yet/);
  assert.match(src('connect-core/tools.ts'), /in their Ryagram desktop app \(if they have it: it is not open to everyone yet\)/);
  const intake = src('connect-core/intake.ts');
  assert.doesNotMatch(intake, /Tell them where to get the app on the Ryagram website/);
  assert.match(intake, /The app is not open to everyone yet: if they do not already have it, tell them plainly that compilations are not available to them yet and offer a data film instead/);
});

test('a final film is never promised to a person who has no credits', () => {
  const t = src('connect-core/tools.ts');
  assert.match(t, /a final film needs credits: if the person has credits they press "Render final film" in the Ryagram app; if they have none, say plainly that a final film is not possible for them right now and do not promise one/);
  assert.match(t, /If the person has credits they press 'Render final film' in the Ryagram app; if they have none, tell them plainly that a final film is not possible for them right now\./);
  assert.match(t, /enough \? "A connection cannot start it: the person presses 'Render final film' in the Ryagram app\." : "A connection cannot start it, and the person does not have the credits for a final film, so do not promise one\."/);
  assert.match(src('connect-core/mcp.ts'), /a person with no credits cannot start it: say so plainly and do not promise a final film/);
});
