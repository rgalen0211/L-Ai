// Title-card limits (Ryan, 2026-10-12): the web editor and the AI editor enforce the render worker's limits EXACTLY:
// 12 seconds; 160 / 320 / 160 characters (headline / subhead / credit). An over-limit card is refused at SAVE time, in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { titleProblems as tsProblems, TITLE as tsTitle } from '../supabase/functions/_shared/title_limits.ts';
import { runTool } from '../supabase/functions/ai-editor/tools.ts';
import { SYSTEM } from '../supabase/functions/ai-editor/prompt.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const appWindow = {};
vm.runInNewContext(fs.readFileSync(path.join(here, '..', 'assets', 'app-limits.js'), 'utf8'), { window: appWindow, Array, Number, String, Object, RegExp });
const L = appWindow.ryagramLimits;
const plain = x => JSON.parse(JSON.stringify(x));
const story = (...cards) => ({ schema: 1, engine: 'sequence', name: 't', sequence: { clips: [...cards, { kind: 'render', dataset: 'state_obesity_fastfood', view: 'map', start: '2011', end: '2023' }] } });
const card = (over = {}) => ({ kind: 'title', id: 'open', seconds: 3, headline: 'Fast food and obesity', ...over });

test('the limits are the worker\'s: 12 seconds and 160 / 320 / 160 characters', () => {
  assert.deepEqual(plain(L.TITLE), { minSeconds: 0.5, maxSeconds: 12, headline: 160, subhead: 320, credit: 160, minFade: 0, maxFade: 2 });
  assert.deepEqual(plain(tsTitle), plain(L.TITLE));
  // and, when a Ryagram checkout is within reach, the worker's own schema says the same
  const roots = [process.env.RYAGRAM_REPO, path.join(here, '..', '..', 'Ryagram'), 'D:/Ryagram-scratch/WEB/Ryagram-main'].filter(Boolean);
  const file = roots.map(r => path.join(r, 'ryagram', 'worker', 'schema.py')).find(f => fs.existsSync(f));
  if (!file) return;
  const src = fs.readFileSync(file, 'utf8');
  const block = src.slice(src.indexOf('TITLE = Obj({'), src.indexOf('SETTINGS = Obj({'));
  assert.match(block, /"seconds": req\(Num\(0\.5, 12\.0\)\)/);
  assert.match(block, /"headline": opt\(Text\(160, free=True, breaks=True\)\)/);
  assert.match(block, /"subhead": opt\(Text\(320, free=True, breaks=True\)\)/);
  assert.match(block, /"credit": opt\(Text\(160, free=True\)\)/);
  assert.match(block, /"fade": opt\(Num\(0\.0, 2\.0\)\)/);
});

// every case runs through BOTH implementations, which must agree word for word
const CASES = [
  ['a normal card', story(card()), 0],
  ['exactly 12 seconds', story(card({ seconds: 12 })), 0],
  ['12.01 seconds', story(card({ seconds: 12.01 })), 1],
  ['0.5 seconds', story(card({ seconds: 0.5 })), 0],
  ['0.49 seconds', story(card({ seconds: 0.49 })), 1],
  ['no length', story(card({ seconds: undefined })), 1],
  ['a string for a length', story(card({ seconds: '3' })), 1],
  ['headline exactly 160', story(card({ headline: 'h'.repeat(160) })), 0],
  ['headline 161', story(card({ headline: 'h'.repeat(161) })), 1],
  ['subhead exactly 320', story(card({ subhead: 's'.repeat(320) })), 0],
  ['subhead 321', story(card({ subhead: 's'.repeat(321) })), 1],
  ['subhead 160 is fine now', story(card({ subhead: 's'.repeat(300) })), 0],
  ['credit exactly 160', story(card({ credit: 'c'.repeat(160) })), 0],
  ['credit 161', story(card({ credit: 'c'.repeat(161) })), 1],
  ['two over-limit cards, three problems', story(card({ headline: 'h'.repeat(200) }), card({ id: 'close', seconds: 13, headline: 'ok' })), 2],
  ['code points, not UTF-16 units: 160 emoji', story(card({ headline: String.fromCodePoint(0x1F600).repeat(160) })), 0],
  ['161 emoji', story(card({ headline: String.fromCodePoint(0x1F600).repeat(161) })), 1],
  ['a line break in a headline', story(card({ headline: 'Line one\nLine two' })), 0],
  ['a line break in a credit', story(card({ credit: 'Source\nline' })), 1],
  ['a tab in a headline', story(card({ headline: 'a' + String.fromCharCode(9) + 'b' })), 1],
  ['a zero-width space in a subhead', story(card({ subhead: 'a' + String.fromCharCode(0x200b) + 'b' })), 1],
  ['neither headline nor subhead', story(card({ headline: undefined })), 1],
  ['a subhead alone is a card', story(card({ headline: undefined, subhead: 'Only a subhead' })), 0],
  ['a number for a headline', story(card({ headline: 5 })), 1],
  ['fade 2 and 2.1', story(card({ fade: 2 })), 0],
  ['fade 2.1', story(card({ fade: 2.1 })), 1],
  ['not a story at all', null, 0],
  ['render clips only', { sequence: { clips: [{ kind: 'render' }] } }, 0]
];
for (const [name, s, n] of CASES) {
  test(`title limits, both implementations: ${name}`, () => {
    const a = L.titleProblems(plain(s ?? {})), b = tsProblems(plain(s ?? {}));
    assert.deepEqual(plain(a), plain(b));
    const expected = name.startsWith('two over-limit') ? 2 : n;
    assert.equal(a.length, expected, a.join(' | '));
  });
}

test('the sentences are plain: which card, which part, how long it is, what the limit is', () => {
  const [p] = L.titleProblems(story(card({ id: 'open', headline: 'h'.repeat(187) })));
  assert.equal(p, 'Title card 1 (open): the headline is 187 characters; the limit is 160.');
  assert.equal(L.titleProblems(story(card({ seconds: 20 })))[0], 'Title card 1 (open) runs 20 seconds; a title card can run 0.5 to 12 seconds.');
});

function appData() {
  const w = {};
  const ctx = { window: w, Array, Number, String, Object, RegExp, Promise, Error };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, '..', 'assets', 'app-limits.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(here, '..', 'assets', 'app-data.js'), 'utf8'), ctx);
  const client = createFakeClient();
  return { data: w.ryagramData(client), client };
}

test('THE WEB EDITOR: saving an over-limit card is refused at save time, with the reason, and nothing is stored', async () => {
  const { data } = appData();
  const { version } = await data.createProject('Limits');
  await data.saveStory(version.id, story(card()));                                       // within the limits: saved
  const before = plain((await data.getVersion(version.id)).version.story_spec);
  for (const [bad, re] of [[card({ headline: 'h'.repeat(161) }), /headline is 161 characters; the limit is 160/],
                           [card({ subhead: 's'.repeat(321) }), /subhead is 321 characters; the limit is 320/],
                           [card({ credit: 'c'.repeat(161) }), /credit line is 161 characters; the limit is 160/],
                           [card({ seconds: 12.5 }), /runs 12\.5 seconds; a title card can run 0\.5 to 12 seconds/]]) {
    await assert.rejects(data.saveStory(version.id, story(bad)), re);
  }
  assert.deepEqual(plain((await data.getVersion(version.id)).version.story_spec), before);   // the saved story is unchanged
  await data.saveStory(version.id, story(card({ seconds: 12, headline: 'h'.repeat(160), subhead: 's'.repeat(320), credit: 'c'.repeat(160) })));   // the edges save
});

test('THE AI EDITOR: edit_story and draft_story refuse an over-limit card and do not save; an in-limit card saves', async () => {
  const saved = [];
  const ctx = {
    data: {
      async getVersion() { return { version: { id: 'v', project_id: 'p', number: 1, state: 'draft', story_spec: story(card()), story_sha256: 'x' }, project: { id: 'p', title: 'T' }, jobs: [] }; },
      async saveStory(id, s) { saved.push(s); return { story_sha256: 'y' }; },
      async listVersions() { return []; }
    },
    versionId: 'v', actions: [], allowExecution: async () => true, addRuling: async () => 1
  };
  const tooLong = JSON.stringify(story(card({ subhead: 's'.repeat(400) })));
  const refused = await runTool('edit_story', { story_json: tooLong }, ctx);
  assert.equal(refused.isError, true);
  assert.match(refused.text, /not saved.*subhead is 400 characters; the limit is 320/);
  assert.equal(saved.length, 0);
  const tooLongTime = await runTool('edit_story', { story_json: JSON.stringify(story(card({ seconds: 15 }))) }, ctx);
  assert.equal(tooLongTime.isError, true);
  assert.match(tooLongTime.text, /runs 15 seconds/);
  const fine = await runTool('edit_story', { story_json: JSON.stringify(story(card({ seconds: 12, subhead: 's'.repeat(320) }))) }, ctx);
  assert.equal(fine.isError, undefined);
  assert.equal(saved.length, 1);
});

test('THE AI EDITOR\'S INSTRUCTIONS state the same limits (built from the same constants)', () => {
  assert.match(SYSTEM, /title: seconds 0\.5 to 12 \(required\)/);
  assert.match(SYSTEM, /headline \(at most 160 characters\)/);
  assert.match(SYSTEM, /subhead \(at most 320\)/);
  assert.match(SYSTEM, /credit \(at most 160\)/);
  assert.doesNotMatch(SYSTEM, /seconds 0\.5 to 6/);
  assert.match(SYSTEM, /refused when you save, with the reason/);
});

test('the app page loads the limits before the data layer', () => {
  const html = fs.readFileSync(path.join(here, '..', 'app', 'index.html'), 'utf8');
  assert.ok(html.indexOf('app-limits.js') > 0 && html.indexOf('app-limits.js') < html.indexOf('app-data.js'));
});
