// tests/edit-vectors.json is the live editor's op rules as data (tools/make-edit-vectors.mjs), for a twin in another language (the maker's Python applier). It must be exactly what the
// generator writes from assets/app-editor-core.js, so a change to a rule without regenerating the file fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/make-edit-vectors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = fs.readFileSync(path.join(here, 'edit-vectors.json'), 'utf8').replace(/\r\n/g, '\n');

test('the committed vectors equal what the generator writes from the page\'s own rules', () => {
  const hidden = new RegExp('[' + [[0x200e, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]].map(([x, y]) => String.fromCharCode(x) + '-' + String.fromCharCode(y)).join('') + ']', 'g');
  const text = JSON.stringify(build(), null, 1).replace(hidden, c => String.fromCharCode(92) + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
  assert.equal(file, text, 'run: node tools/make-edit-vectors.mjs');
});

test('the vectors cover every op, accepted and refused, with the exact sentences and revision + 1 on an accepted op', () => {
  const v = JSON.parse(file);
  assert.ok(v.cases.length >= 100);
  for (const op of v.ops) {
    assert.ok(v.cases.some(c => c.op && c.op.op === op && c.state_after), `no accepted case for ${op}`);
    assert.ok(v.cases.some(c => c.op && c.op.op === op && c.refusal), `no refused case for ${op}`);
  }
  for (const c of v.cases) {
    assert.ok((c.refusal === undefined) !== (c.state_after === undefined), c.name);
    if (c.state_after) assert.equal(c.state_after.revision, c.state_before.revision + 1, c.name);
    if (c.refusal) assert.equal(typeof c.refusal, 'string', c.name);
  }
  assert.ok(new Set(v.cases.filter(c => c.refusal).map(c => c.refusal)).size >= 18);
  assert.deepEqual(v.look_keys.slice().sort(), ['choropleth.high', 'choropleth.low', 'network.base_color', 'network.color', 'network.context_color', 'page.background', 'sequence.theme', 'state.fill', 'state.outline_width']);
  assert.ok(v.local_only_fields.includes('speaker') && !v.local_only_fields.includes('ai_altered'));
});

test('the cases that matter to the maker are in: a video start trim moves source_start, the file\'s end refuses, the lanes refuse, the text cap refuses', () => {
  const v = JSON.parse(file);
  const find = (state, op, extra) => v.cases.find(c => c.state === state && c.op && c.op.op === op && Object.entries(extra).every(([k, x]) => c.op[k] === x));
  const cut = find('comp', 'trim_clip', { id: 'v2', edge: 'start', to: 5.5 });
  const after = cut.state_after.clips.find(c => c.id === 'v2');
  assert.deepEqual([after.source_start, after.len, after.max_len], [4.5, 1.5, 3.5]);
  assert.match(find('comp', 'trim_clip', { id: 'v2', edge: 'end', to: 9.1 }).refusal, /past the end of the video file/);
  assert.match(find('comp', 'trim_clip', { id: 'v2', edge: 'start', to: 0 }).refusal, /before the start of the video file/);
  assert.match(find('comp_lanes', 'move_clip', { id: 'p1' }).refusal, /can not be edited here yet/);
  assert.match(find('comp_lanes', 'set_clip_text', { id: 't1', text: 'twenty-one letters 1.' }).refusal, /at most 20 letters/);
});
