// NEXT-WEB 170: the help entries for what is new in the app are in the page but HIDDEN until their own site switch is on. No script, a switch that is off, or a switch that does not exist keeps an entry hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8');
const html = read('help/index.html');
const entries = [...html.matchAll(/<details([^>]*)data-flag="([^"]+)"([^>]*)>\s*<summary>([^<]*)<\/summary>/g)].map(m => ({ attrs: m[1] + m[3], flags: m[2].split(/\s+/), title: m[4] }));

function run(cfg) {                                                               // the real script against a minimal page made from the real entries
  const els = entries.map(e => ({ hidden: /\bhidden\b/.test(e.attrs), getAttribute: n => (n === 'data-flag' ? e.flags.join(' ') : null) }));
  const ctx = { window: { ryagramConfig: cfg }, document: { querySelectorAll: sel => (sel === '[data-flag]' ? els : []) } };
  vm.createContext(ctx); vm.runInContext(read('assets/help-flags.js'), ctx);
  return els.map(e => e.hidden);
}

test('the page holds the new-in-the-app entries, every one hidden in the markup', () => {
  assert.ok(entries.length >= 3);
  for (const e of entries) assert.match(e.attrs, /\bhidden\b/, e.title);
  assert.deepEqual(entries.map(e => e.flags[0]).sort(), ['connectAi', 'liveEditor', 'uploads']);
});

test('an entry shows only when ALL its switches are on', () => {
  assert.ok(run({}).every(Boolean), 'no switch on: all hidden');
  assert.ok(run(undefined).every(Boolean), 'no config at all: all hidden');
  const on = run({ connectAi: true, liveEditor: false, uploads: false });
  assert.deepEqual(entries.map((e, i) => [e.flags[0], on[i]]).filter(x => !x[1]).map(x => x[0]), ['connectAi']);
  assert.ok(run({ connectAi: 'yes', liveEditor: 1, uploads: 'true' }).every(Boolean), 'only the value true counts as on');
  assert.ok(run({ connectAi: true, liveEditor: true, uploads: true }).every(h => h === false), 'all on: all shown');
});

test('config loads before the script, both are same-origin files, the policy still allows only own scripts, and the page promises nothing the entries do not', () => {
  assert.ok(html.indexOf('/assets/ryagram-config.js') > -1 && html.indexOf('/assets/ryagram-config.js') < html.indexOf('/assets/help-flags.js'));
  assert.match(html, /script-src 'self'/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline script');
  assert.ok(!/(sorry|\bsoon\b|\bcoming\b)/i.test(entries.map(e => e.title).join(' ')));
  for (const w of ['Tell me when it’s ready', 'song cast', 'recipe']) assert.ok(!html.toLowerCase().includes(w.toLowerCase()), `${w} stays off the page`);
  assert.ok(!fs.readFileSync(path.join(here, '..', 'assets/help-flags.js'), 'utf8').match(/fetch\(|XMLHttpRequest|localStorage|eval\(/));
});

test('the switches named in the entries are real names, or a switch that is not in the config yet (then the entry stays hidden)', () => {
  const cfg = read('assets/ryagram-config.js');
  for (const n of ['connectAi', 'uploads']) assert.match(cfg, new RegExp(`\\b${n}:`));
  const known = /\bliveEditor:/.test(cfg);
  assert.ok(known || run(Object.fromEntries(Object.keys({}).map(k => [k, true]))).every(Boolean));
});
