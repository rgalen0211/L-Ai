// PRO mode of the live editor (assets/app-editor-pro.js; paper proposals/WEB-PRO-EDITOR-1120.md): the pure parts, and that it adds no new change (op) of its own. The browser behaviour is tools/check-pro-editor.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
vm.runInNewContext(read('assets/app-editor-pro.js'), { window: win });
const P = win.ryagramEditorPro;

test('the time reads as minutes, seconds, tenths, and the frame when there are real frames', () => {
  assert.equal(P.timecode(7.4, 0), '0:07.4');
  assert.equal(P.timecode(67.25, 10), '1:07.2');                       // 10 "frames" a second is the compilation's own tenth-of-a-second step: no frame number is claimed
  assert.equal(P.timecode(7.4, 24), '0:07.4 · frame 178');
  assert.equal(P.timecode(-3, 30), '0:00.0 · frame 0');
});

test('every change in the history is described in words, and an unknown one still reads as a change', () => {
  assert.match(P.describe({ op: 'set_look', key: 'network.color', value: '#ff9f6b' }), /line colour.*#ff9f6b/);
  assert.match(P.describe({ op: 'trim_clip', id: 'v1', edge: 'end', to: 4.25 }), /Trimmed the end of clip v1 to 4\.3? s|4\.2/);
  assert.equal(P.describe({ op: 'delete_clip', id: 't1' }), 'Deleted clip t1');
  assert.equal(P.describe({ op: 'nothing' }), 'A change');
  assert.equal(P.describe(null), 'A change');
});

test('PRO makes no change of its own: the only ops it sends are the editor core\'s trim_clip and add_clip', () => {
  const src = read('assets/app-editor-pro.js');
  const sent = [...src.matchAll(/\{ op: '([a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(sent)].sort(), ['add_clip', 'trim_clip']);
  const core = read('assets/app-editor-core.js');
  for (const op of ['add_clip', 'trim_clip']) assert.ok(core.includes(`'${op}'`), op);
});

test('the page loads PRO after the editor and before the app, with its stylesheet; and the editor calls it only with the website host', () => {
  const html = read('app/index.html'), ed = read('assets/app-editor.js');
  const at = s => html.indexOf(s);
  assert.ok(at('app-editor.js') > 0 && at('app-editor.js') < at('app-editor-pro.js') && at('app-editor-pro.js') < at('app-library.js'));
  assert.ok(at('app-editor-pro.css') > 0);
  assert.match(ed, /window\.ryagramEditorPro && !host/);
});
