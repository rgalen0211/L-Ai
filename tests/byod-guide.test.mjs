// BYOD audit (Ryan 2026-10-18): the guide for people who bring their own spreadsheet, behind ryagramConfig.byodGuide (off). The audit itself is tools/audit-byod.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
for (const f of ['app-templates.js', 'app-uploads.js']) vm.runInNewContext(read(`assets/${f}`), { window: win });
const T = win.ryagramTemplates, U = win.ryagramUploads;
const plain = x => JSON.parse(JSON.stringify(x));

test('FLAG: the guide ships OFF, needs uploads on too, and is on in mock mode', () => {
  assert.match(read('assets/ryagram-config.js'), /byodGuide: false,/);
  assert.match(read('assets/app-library.js'), /const byodGuideOn = \(\) => \(window\.ryagramConfig\?\.uploads === true && window\.ryagramConfig\?\.byodGuide === true\) \|\| !!window\.ryagramMock;/);
});

test('STARTER FILM: a blank story plus a ready upload gives a real story (a title and one clip for the data); a story that already has a clip is only re-pointed', () => {
  const ref = `u_${'a1b2c3d4e5f6a7b8c9d0e1f2'}`;
  const built = T.buildFor({ id: ref, label: 'rents.csv', start: '2015', end: '2023', view: 'map' }, 'My rents');
  assert.deepEqual(plain(built.sequence.clips.map(c => c.kind)), ['title', 'render']);
  assert.deepEqual(plain([built.sequence.clips[1].dataset, built.sequence.clips[1].start, built.sequence.clips[1].end, built.sequence.clips[1].view]), [ref, '2015', '2023', 'map']);
  assert.equal(built.sequence.clips[0].headline, 'My rents');
  assert.equal(built.schema, 1);
  assert.equal(built.engine, 'sequence');
  assert.equal(U.useInStory({}, ref), null, 'the old behaviour for a blank story: nothing to point (hence the dead end before the guide)');
  assert.equal(U.useInStory(built, 'u_ffffffffffffffffffffffff').sequence.clips[1].dataset, 'u_ffffffffffffffffffffffff');
  const lib = read('assets/app-library.js');
  assert.match(lib, /if \(!built && byodGuideOn\(\) && window\.ryagramTemplates\.isBlank\(v\.story_spec\)\) \{/);
  assert.match(lib, /ds\?\.ingest_report\?\.periods/);
  assert.match(lib, /useInFilm\(ref, ds\)/);
});

test('POINTER AND EXAMPLE: a line near the top opens the own-data panel; an example of a good file; the wide-file words say how to reshape it', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /'Have your own spreadsheet\? ', h\('button', \{ class: 'link-button', type: 'button'/);
  assert.match(lib, /advanced\.open = true;/);
  assert.ok(lib.includes("h('summary', {}, 'What should my file look like?')"));
  assert.deepEqual(plain(U.EXAMPLE.head), ['State', 'Year', 'Median rent']);
  assert.match(U.WIDE_HELP, /one row for each place and year/);
  assert.match(U.WIDE_HELP, /Unpivot/);
  assert.match(lib, /byodGuideOn\(\) \? U\.WIDE_HELP : U\.problem\(null, report\)/, 'only with the guide; the old sentence stays otherwise');
});

test('CONTROLS ARE CONTROLS: a radio or tick box in the upload and account forms is a small control, not the full-width 44 px input that pushed its words aside', () => {
  assert.match(read('assets/app.css'), /\.choice input\[type=radio\],\.choice input\[type=checkbox\]\{width:20px;height:20px;min-height:20px;flex:none;margin:2px 0 0\}/);
});
