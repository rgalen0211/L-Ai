// Connector parity (NEXT-CONNECT 104): a connected AI is told EVERY option of the shared list, in plain words, with its path, allowed values, choices, default and hard limits,
// and the server's story check stays the ONLY validator. The list is wording. These tests prove (1) the vendored list is WEB's shared list, (2) get_story_schema shows every
// available row once with its bound, names what is NOT available yet, shows no TODO text and the known defaults dark-first, (3) the one-option explanation works and refuses an
// unknown name plainly, (4) a row the list calls NOT AVAILABLE is really refused by the story check, and (5) for every row whose bound can be exercised on the template story, an
// in-range value is accepted and an out-of-range value is REFUSED BY THE SCHEMA in plain words, so the list never promises more than the check allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { allowedWords } from '../supabase/functions/connect-core/options.ts';
import { OPTIONS, OPTIONS_SHA256, OPTION_GROUPS } from '../supabase/functions/_shared/options_list.ts';
import { checkStory } from '../supabase/functions/connect-core/story_check.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';
import storySchema from '../supabase/functions/_shared/story_schema.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId);
  return (name, args = {}) => callTool(name, args, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile } });
}
const call = world();
const schemaCall = await call('get_story_schema');
// The expectations come from the list's own flags, written out here, NOT from the module under test.
const availableRows = () => OPTIONS.filter((o) => o.source === 'story' && o.connector === 'yes' && o.path);
const unavailableRows = () => OPTIONS.filter((o) => o.connector !== 'yes' && (o.path || o.label));
const appOnlyRows = () => OPTIONS.filter((o) => o.source === 'profile' && o.connector === 'yes' && !o.same_as);
const lineFor = (path) => schemaCall.text.split('\n').filter((l) => l.startsWith(`- ${path}: `));

test('THE VENDORED LIST IS THE SHARED LIST: the generated module equals options_list.json, row for row, with its SHA-256', () => {
  const raw = read('supabase/functions/_shared/options_list.json');
  const json = JSON.parse(raw);
  assert.equal(OPTIONS_SHA256, crypto.createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(JSON.parse(JSON.stringify(OPTIONS)), json.options);
  assert.deepEqual(JSON.parse(JSON.stringify(OPTION_GROUPS)), json.groups);
});

test('EVERY AVAILABLE ROW IS SHOWN, WITH ITS BOUND AND DEFAULT: get_story_schema lists each story option the list marks connector yes, and the structured data carries the same', () => {
  const rows = availableRows();
  assert.ok(rows.length >= 128, `at least the 128 engine story options (${rows.length})`);
  assert.match(schemaCall.text, new RegExp(`Options you can set \\(${rows.length}\\)\\.`));
  for (const o of rows) {
    const mine = lineFor(o.path);
    assert.ok(mine.some((l) => l.includes(`Allowed: ${allowedWords(o)}.`) && / If left out: /.test(l)), `${o.path}: allowed values and default are stated`);
  }
  const listed = schemaCall.text.split('\n').filter((l) => l.startsWith('- ') && l.includes(' Allowed: ')).length;
  assert.equal(listed, rows.length);
  assert.equal(schemaCall.data.options.length, rows.length);
  assert.ok(schemaCall.data.options.every((v) => v.path && v.label && v.allowed && v.default && v.applies_to));
});

test('NOTHING UNWRITTEN REACHES THE AI: no TODO text anywhere, every row has plain help', () => {
  assert.doesNotMatch(schemaCall.text, /TODO/);
  assert.doesNotMatch(JSON.stringify(schemaCall.data.options), /TODO/);
  for (const o of availableRows()) assert.ok(o.help && o.help.length > 3 && o.label, `${o.path} has a label and help`);
});

test('THE HARD LIMITS ARE STATED: every number, list, text and colour bound appears in its line', () => {
  for (const o of availableRows()) {
    const h = o.hard ?? {};
    const line = lineFor(o.path).find((l) => l.includes(`Allowed: ${allowedWords(o)}.`)) ?? '';
    if (typeof h.minimum === 'number') assert.ok(line.includes(String(h.minimum)), `${o.path} min`);
    if (typeof h.maximum === 'number') assert.ok(line.includes(String(h.maximum)), `${o.path} max`);
    if (typeof h.maxLength === 'number') assert.ok(line.includes(`up to ${h.maxLength} characters`), `${o.path} maxLength`);
    if (typeof h.pattern === 'string') assert.ok(line.includes(h.pattern), `${o.path} pattern`);
    if (Array.isArray(h.enum)) for (const v of h.enum) assert.ok(line.includes(JSON.stringify(v)), `${o.path} enum ${JSON.stringify(v)}`);
    if (typeof h.maxItems === 'number') assert.ok(line.includes(String(h.maxItems)), `${o.path} maxItems`);
  }
});

test('DEFAULTS, DARK FIRST, FROM THE SHARED LIST: dark, 1920x1080, 30 fps come through the profile twin; a default nobody wrote down says the engine decides; the choice words are shown', () => {
  assert.match(lineFor('sequence.theme')[0], /Choices: "dark" = Dark; "light" = Light\. .*If left out: "dark"\./);
  assert.match(lineFor('sequence.canvas')[0], /If left out: \[1920,1920\]|If left out: \[1920,1080\]\./);
  assert.match(lineFor('sequence.fps')[0], /If left out: 30\./);
  assert.match(lineFor('sequence.hold_seconds')[0], /set by the engine when you leave it out/);
  assert.ok(lineFor('sequence.clips[].transition.kind').some((l) => /"cut" = Straight cut/.test(l)), 'the choice words reach the row that has a profile twin');
});

test('THE GROUPS READ IN A PERSON\'S ORDER, with the shared list\'s own words for each heading', () => {
  const label = (id) => OPTION_GROUPS.find((g) => g.id === id).label;
  const present = ['story', 'size', 'look', 'chart', 'words', 'brand', 'outro', 'advanced'].filter((g) => availableRows().some((o) => o.group === g));
  const heads = schemaCall.text.split('\n').filter((l) => present.some((g) => l === `${label(g)}:`));
  assert.deepEqual(heads, present.map((g) => `${label(g)}:`));
});

test('WHAT IS NOT AVAILABLE IS SAID, and the app-only look is named: the planned, reserved and engine-only rows are listed so the AI does not try them', () => {
  const na = unavailableRows();
  assert.ok(na.length >= 15, `the planned and reserved rows (${na.length})`);
  const t = schemaCall.text;
  assert.match(t, /NOT AVAILABLE YET \(the story check refuses these; do not write them\):/);
  for (const o of na.filter((x) => x.path)) assert.ok(t.includes(`- ${o.path}: ${o.label}.`), `${o.path} is named as not available`);
  const app = appOnlyRows();
  assert.ok(app.length >= 1);
  assert.match(t, /SET IN THE APP ONLY/);
  for (const o of app) assert.ok(t.includes(`- ${o.label}: ${o.help}`), `${o.label} is named as app-only`);
});

test('A NOT-AVAILABLE STORY ROW IS REALLY REFUSED BY THE CHECK (so the warning is true): planned fields written into a story are rejected', () => {
  const t = TEMPLATES[0];
  for (const o of unavailableRows().filter((x) => x.source === 'story' && x.path)) {
    const s = JSON.parse(JSON.stringify(build(t.id, t.datasets[0], 'Test headline')));
    const value = o.control === 'colour' ? '#336699' : o.control === 'toggle' ? true : o.control === 'text' ? 'x' : 1;
    if (!setAt(s, o.path, value, 0)) continue;
    assert.notEqual(problemsFor(s).length, 0, `${o.path} is listed as not available but the story check ACCEPTS it: the list and the schema have drifted`);
  }
});

test('ONE OPTION IN FULL: get_story_schema with option explains one option, by path or by id, and refuses an unknown name in plain words', async () => {
  const byPath = await call('get_story_schema', { option: 'sequence.theme' });
  assert.equal(byPath.isError, undefined);
  assert.match(byPath.text, /^sequence\.theme\nPage\. /);
  assert.match(byPath.text, /What it changes: /);
  assert.match(byPath.text, /Use it when: /);
  assert.match(byPath.text, /Allowed: one of "light", "dark"\./);
  assert.match(byPath.text, /If left out: "dark"\./);
  assert.match(byPath.text, /In the app this is also "Page" under Your look\./);
  const byId = await call('get_story_schema', { option: 'sequence_theme' });
  assert.equal(byId.text, byPath.text);
  const planned = await call('get_story_schema', { option: 'clips[].clarity.question' });
  assert.equal(planned.isError, true);
  const bad = await call('get_story_schema', { option: 'sequence.nope' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /No option called "sequence\.nope"\. Call get_story_schema without option to see the list\./);
  const rude = await call('get_story_schema', { option: 'x'.repeat(300) });
  assert.equal(rude.isError, true, 'an overlong name is refused by the tool schema');
});

test('THE TOOLS SAY IT: the tool descriptions and rules tell the AI to set options by path and that the check is the validator', () => {
  assert.match(schemaCall.data.rules.join('\n'), /Options: everything a person can set in the Ryagram app for one film is a field of the story/);
  const byName = Object.fromEntries(TOOLS.map((x) => [x.name, x]));
  assert.match(byName.get_story_schema.description, /EVERY option you can set/);
  assert.match(byName.set_story.description, /Any option in get_story_schema's list is set by writing its path into the story; a value outside its allowed range is refused/);
  assert.match(schemaCall.text, /it does not allow anything by itself/);
  assert.equal(byName.get_story_schema.inputSchema.additionalProperties, false);
});

// ----------------------------------------------------------------------------------------------- the server stays the only validator
const base = () => { const t = TEMPLATES[0]; return JSON.parse(JSON.stringify(build(t.id, t.datasets[0], 'Test headline'))); };
function setAt(story, path, value, clipIndex) {
  const parts = path.split('.');
  let cur = story;
  for (let i = 0; i < parts.length; i++) {
    let key = parts[i];
    const last = i === parts.length - 1;
    if (key.endsWith('[]')) {
      key = key.slice(0, -2);
      cur[key] = cur[key] ?? [];
      cur = cur[key][clipIndex];
      if (!cur) return false;
      continue;
    }
    if (last) { cur[key] = value; return true; }
    cur[key] = cur[key] ?? {};
    cur = cur[key];
  }
  return true;
}
const problemsFor = (story) => checkStory(story, compile(storySchema));
function inRange(o) {
  const h = o.hard ?? {};
  if (Array.isArray(h.enum)) return h.enum[0];
  if (typeof h.minimum === 'number' && typeof h.maximum === 'number') {
    const mid = (h.minimum + h.maximum) / 2;
    return Number.isInteger(h.minimum) && Number.isInteger(h.maximum) ? Math.round(mid) : mid;
  }
  if (typeof h.maxLength === 'number') return 'ok';
  if (typeof h.pattern === 'string') return '#336699';
  return undefined;
}
function outOfRange(o) {
  const h = o.hard ?? {};
  if (Array.isArray(h.enum)) return 'zz-not-an-option';
  if (typeof h.maximum === 'number') return h.maximum + 1;
  if (typeof h.minimum === 'number') return h.minimum - 1;
  if (typeof h.maxLength === 'number') return 'x'.repeat(h.maxLength + 1);
  if (typeof h.pattern === 'string') return 'not a colour';
  return undefined;
}
const PLAIN = /must be one of|must be at (most|least)|is too long|is not in the allowed format|must be (a|an) (number|string|integer)|can hold at most|needs at least/;

test('THE SCHEMA ENFORCES WHAT THE LIST SAYS (the server stays the only validator): every row whose bound can be tried on the template story accepts an in-range value and refuses an out-of-range one in plain words', () => {
  const tried = [], skipped = [], gaps = [];
  for (const o of availableRows()) {
    const good = inRange(o), bad = outOfRange(o);
    if (good === undefined || bad === undefined) { skipped.push(`${o.path} (no simple bound)`); continue; }
    const n = base().sequence?.clips?.length ?? 0;
    const ctxs = o.path.includes('[]') ? [...Array(n).keys()] : [0];
    let accepted = null;
    for (const c of ctxs) {
      const s = base();
      if (!setAt(s, o.path, good, c)) continue;
      if (problemsFor(s).length === 0) { accepted = c; break; }
    }
    if (accepted === null) { skipped.push(`${o.path} (not settable on the template story)`); continue; }
    const s = base();
    setAt(s, o.path, bad, accepted);
    const probs = problemsFor(s);
    if (probs.length === 0) gaps.push(`${o.path}: ${JSON.stringify(bad).slice(0, 40)} was ACCEPTED`);
    else if (!probs.some((p) => PLAIN.test(p))) gaps.push(`${o.path}: refused but not in plain words: ${probs[0]}`);
    tried.push(o.path);
  }
  console.log(`  rows exercised against the real schema: ${tried.length} of ${availableRows().length}; not exercisable on the template story: ${skipped.length}`);
  assert.deepEqual(gaps, [], 'every advertised bound is enforced by the schema, in plain words');
  assert.ok(tried.length >= 60, `at least 60 rows exercised (${tried.length})`);
});

test('MUST-FAIL THROUGH THE TOOL: set_story refuses an out-of-range option with a message the AI can relay, and saves nothing; an in-range one is saved', async () => {
  const id = (await call('create_project', { title: 'Opt' })).data.project_id;
  const bad = base(); bad.sequence.fps = 31;
  const r = await call('set_story', { project_id: id, story: bad });
  assert.equal(r.isError, true);
  assert.match(r.text, /The story was NOT saved/);
  assert.match(r.text, /must be one of: 24, 25, 30/);
  const good = base(); good.sequence.fps = 25; good.sequence.theme = 'dark';
  const ok = await call('set_story', { project_id: id, story: good });
  assert.equal(ok.isError, undefined, ok.text);
});
