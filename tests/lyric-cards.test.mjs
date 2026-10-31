// NEXT-WEB 189: the lyric card choice (behind lyricCards, OFF). One new film look value, lyric_card (plate, bar, sing_along), in the editor core; a chooser that sets it; the SQL, its undo and its after-check exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = f => { const win = {}; vm.runInNewContext(read(f), { window: win }); return win; };
const LC = load('assets/app-lyric-cards.js').ryagramLyricCards, core = load('assets/app-editor-core.js').ryagramEditor;
const J = x => JSON.parse(JSON.stringify(x));

test('three designs, each with a picture that exists, a name and a line', () => {
  assert.deepEqual(J(LC.DESIGNS.map(d => d.id)), ['plate', 'bar', 'sing_along']);
  for (const d of LC.DESIGNS) { assert.ok(d.name && d.line); assert.ok(fs.statSync(new URL(`..${LC.IMG(d.id)}`, import.meta.url)).size > 1000, d.id); }
});

test('the switch: on only when exactly true; the current design is read from the look and an unknown value is none', () => {
  assert.equal(LC.on({ lyricCards: true }), true); assert.equal(LC.on({ lyricCards: 'yes' }), false); assert.equal(LC.on({}), false); assert.equal(LC.on(null), false);
  assert.equal(LC.current({ lyric_card: 'bar' }), 'bar'); assert.equal(LC.current({ lyric_card: 'neon' }), null); assert.equal(LC.current(null), null);
  assert.match(read('assets/ryagram-config.js'), /\n  lyricCards: false,/);
});

test('the editor core accepts the three designs and refuses anything else, in words; the look then holds the value', () => {
  const st = () => core.newState({ mode: 'compilation', clips: [], look: { theme: 'dark' } });
  for (const v of ['plate', 'bar', 'sing_along']) assert.equal(core.check(st(), { op: 'set_film_look', key: 'lyric_card', value: v }), null);
  for (const v of ['neon', 3, null]) assert.match(core.check(st(), { op: 'set_film_look', key: 'lyric_card', value: v }), /plate, bar, sing_along/);
  assert.match(core.check(st(), { op: 'set_film_look', key: 'font', value: 'x' }), /lyric_card\)/);
});

test('the chooser: one radio per design, the picked one checked, a click sets that design, locked turns them off', () => {
  const made = [];
  const h = (tag, attrs, ...kids) => { const el = { tag, attrs: attrs || {}, kids: kids.flat(), listeners: {}, addEventListener(n, f) { this.listeners[n] = f; } }; made.push(el); return el; };
  const set = []; const el = LC.panel(h, { lyric_card: 'bar' }, v => set.push(v), false);
  const radios = made.filter(e => e.tag === 'input'); assert.equal(radios.length, 3);
  assert.deepEqual(radios.map(r => !!r.attrs.checked), [false, true, false]);
  radios[2].checked = true; radios[2].listeners.change(); assert.deepEqual(set, ['sing_along']);
  const locked = []; made.length = 0; LC.panel(h, {}, () => {}, true); assert.ok(made.filter(e => e.tag === 'input').every(r => r.attrs.disabled === true));
  assert.ok(made.filter(e => e.tag === 'img').every(i => /^A (Plate|Bar|Sing-along) lyric card: /.test(i.attrs.alt)));
  assert.ok(el && el.tag === 'fieldset'); void locked;
});

test('it is honest: the note says nothing renders these cards yet', () => { assert.match(LC.NOTE, /does not draw these cards yet/); });

test('the SQL is a new migration with its undo and an after-check, both functions redefined, no table touched', () => {
  const sql = read('supabase/migrations/20261031000200_lyric_card_look.sql');
  assert.match(sql, /create or replace function ryagram_private\.edit_op_problem/); assert.match(sql, /create or replace function public\.node_edit_post_summary/);
  assert.match(sql, /'plate', 'bar', 'sing_along'/); assert.ok(!/\b(alter|drop|create)\s+table\b/i.test(sql.replace(/--.*$/gm, '')));
  const rb = read('supabase/rollbacks/20261031000200_lyric_card_look_rollback.sql'); assert.ok(!/lyric_card/.test(rb.replace(/--.*$/gm, '')), 'the undo no longer knows the setting');
  assert.ok(fs.existsSync(new URL('../supabase/live-steps/18_lyric_card_look_after_check.sql', import.meta.url)));
});
