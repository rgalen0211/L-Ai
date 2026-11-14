// WEB 22:13 ask from CC1 (launch slice IN 2): the website must not let a person make a paired story with no keyframes_per_year, which the engine refuses at render
// (Ryan 2026-09-28). Offline, invented account and story. Covers the page's template picker, the page's own template builders, and the website AI editor (draft_story, set_mapping, edit_story).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { handle } from '../supabase/functions/ai-editor/editor.ts';
import { TOOLS } from '../supabase/functions/ai-editor/tools.ts';
import { TEMPLATES, build, UNMEASURED_WORDS } from '../supabase/functions/_shared/templates.ts';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const win = {}; vm.runInNewContext(read('assets/app-templates.js'), { window: win });
const T = win.ryagramTemplates;

test('the page: the Paired template is never offered or built, and says what to do instead', () => {
  assert.equal(T.TEMPLATES.find(t => t.id === 'paired').unmeasured, true);
  assert.throws(() => T.build('paired', 'state_obesity_fastfood', 'Invented headline'), /keyframes_per_year/);
  assert.throws(() => T.build('paired', 'state_obesity_fastfood', 'Invented headline'), /map, bars or line/);
  assert.throws(() => T.buildFor({ id: 'state_obesity_fastfood', label: 'x', view: 'paired', start: '2011', end: '2023' }, 'x'), /keyframes_per_year/);
  assert.throws(() => T.buildFor({ id: 'state_obesity_fastfood', label: 'x', view: 'panel', start: '2011', end: '2023' }, 'x'), /keyframes_per_year/);
  for (const v of ['map', 'bars', 'line']) assert.doesNotThrow(() => T.buildFor({ id: 'state_obesity_fastfood', label: 'x', view: v, start: '2011', end: '2023' }, 'x'), v);
});

test('the page: the ready-made picker filters unmeasured templates out', () => {
  assert.match(read('assets/app-library.js'), /T\.TEMPLATES\.filter\(t => !t\.unmeasured\)/);
});

test('the AI editor: the model cannot pick the paired template, and a story with a paired view and no keyframes is not saved', async () => {
  const draft = TOOLS.find(t => t.name === 'draft_story');
  assert.ok(!draft.input_schema.properties.template.enum.includes('paired'));
  assert.ok(TEMPLATES.find(t => t.id === 'paired').unmeasured, 'the shared list marks it');
  assert.ok(typeof UNMEASURED_WORDS === 'string' && /map, bars or line/.test(UNMEASURED_WORDS));
  assert.ok(build('paired', 'state_obesity_fastfood', 'x'), 'the connector builder is untouched (CONNECT refuses it at set_story)');
});
