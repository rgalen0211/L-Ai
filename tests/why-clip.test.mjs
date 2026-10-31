// NEXT-WEB 185: the "Why this clip" panel (assets/app-why-clip.js) draws BUILDER 48's report (tools/why_this_clip.py, schema ryagram.why-clip/0) and works nothing out. The report here is the REAL tool's output on a
// SYNTHETIC edit list (tests/fixtures/why-clip.PROVENANCE.txt). The panel refuses a report it does not know, shows every sentence the report holds and no other, finds the clip at the playhead, and filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/app-why-clip.js'), { window: win, Number, String, Array, Object, Math, JSON });
const W = win.ryagramWhyClip, J = x => JSON.parse(JSON.stringify(x));
const REP = JSON.parse(read('tests/fixtures/why-clip-report.json'));

const h = (tag, attrs, ...kids) => { const el = { tag, attrs: attrs || {}, children: [], addEventListener() {} }; const add = k => { if (Array.isArray(k)) k.forEach(add); else if (k !== null && k !== undefined && k !== false) el.children.push(typeof k === 'object' ? k : String(k)); }; kids.forEach(add); return el; };
const all = (el, out = []) => { if (el && typeof el === 'object') { out.push(el); el.children.forEach(c => all(c, out)); } return out; };
const text = el => (typeof el === 'string' ? el : el.children.map(text).join(' '));

test('the fixture is the real tool\'s schema, and the panel accepts it', () => {
  assert.equal(REP.schema, 'ryagram.why-clip/0'); assert.equal(W.SCHEMA, REP.schema);
  assert.equal(W.problem(REP), null);
  assert.deepEqual(J(REP.clips.map(c => c.take)), ['own', 'fit', 'forms', 'alias', 'cast-fallback']);
  assert.match(read('tests/fixtures/why-clip.PROVENANCE.txt'), /SYNTHETIC/);
});

test('a report it does not know is refused in words, never drawn', () => {
  for (const bad of [null, undefined, 5, 'x', {}, { schema: 'other', clips: [] }, { schema: W.SCHEMA }, { schema: W.SCHEMA, clips: 'no' }, { schema: W.SCHEMA, clips: [{ n: 1, why: 'text' }] }, { schema: W.SCHEMA, clips: [{ n: 1, why: [5] }] }, { schema: W.SCHEMA, clips: [{ n: 'a', why: [] }] }, { schema: W.SCHEMA, clips: [{ n: 1, why: [], at_s: 'soon' }] }]) assert.ok(typeof W.problem(bad) === 'string', JSON.stringify(bad));
  const v = W.view(h, { schema: 'nope', clips: [] });
  assert.match(text(v), /not an explanation this panel knows/); assert.equal(all(v).filter(e => e.tag === 'li').length, 0);
});

test('every sentence under a clip is the report\'s own, in order, and nothing else is added as a reason', () => {
  const v = W.view(h, REP, { at: 0 });
  const items = all(v).filter(e => e.attrs && e.attrs.class && e.attrs.class.startsWith('le-why-clip'));
  assert.equal(items.length, 5);
  items.forEach((li, i) => {
    const reasons = all(li).filter(e => e.attrs && e.attrs.class === 'le-why-reasons')[0].children.map(c => text(c));
    assert.deepEqual(reasons, REP.clips[i].why, `clip ${i + 1}`);
  });
});

test('the clip at the playhead is marked and nothing else is; a time before the first clip marks none; a clip with no time is never chosen', () => {
  assert.equal(W.clipAt(REP, 0).n, 1); assert.equal(W.clipAt(REP, 1.19).n, 1); assert.equal(W.clipAt(REP, 1.2).n, 2); assert.equal(W.clipAt(REP, 3.5).n, 4); assert.equal(W.clipAt(REP, 99).n, 5);
  assert.equal(W.clipAt(REP, -1), null); assert.equal(W.clipAt(REP, null), null); assert.equal(W.clipAt({ clips: [{ n: 1, at_s: null, why: [] }] }, 5), null);
  const marked = all(W.view(h, REP, { at: 3.5 })).filter(e => e.attrs && e.attrs['aria-current'] === 'true');
  assert.equal(marked.length, 1); assert.equal(marked[0].attrs['data-n'], '4');
  assert.equal(all(W.view(h, REP, { at: -5 })).filter(e => e.attrs && e.attrs['aria-current'] === 'true').length, 0);
});

test('the filters show the stand-ins, the voices to check, and the clips held back by the speed limit; the summary line agrees with the report', () => {
  assert.deepEqual(J(W.filtered(REP, 'stand_in').map(r => r.n)), [5]);
  assert.deepEqual(J(W.filtered(REP, 'voice_unsure').map(r => r.n)), [5]);
  assert.deepEqual(J(W.filtered(REP, 'limited').map(r => r.n)), [5]);
  assert.equal(W.filtered(REP, 'all').length, 5); assert.equal(W.filtered(REP, 'nonsense').length, 5);
  assert.equal(W.summaryLine(REP), '5 clips, 1 stand-in, 1 to check by ear, 1 held back by the speed limit.');
  assert.equal(W.summaryLine({ clips: [{}] }), '1 clip.');
  assert.match(text(W.view(h, REP, { filter: 'stand_in' })), /5\. /); assert.ok(!/ 2\. /.test(text(W.view(h, REP, { filter: 'stand_in' }))));
  assert.match(text(W.view(h, { ...REP, clips: [] }, { filter: 'all' })), /No clip matches that/);
});

test('words: each take is named plainly; a take the panel does not know says so; a missing time and voice are said, not guessed', () => {
  assert.equal(W.takeWords({ take: 'cast-fallback' }), 'a stand-in'); assert.equal(W.takeWords({ take: 'own' }), 'the singer’s own take');
  assert.match(W.takeWords({ take: 'mystery' }), /does not know/);
  assert.match(W.headline({ n: 3, sung: '', voice: '' }), /words not recorded.*voice not recorded/); assert.equal(W.mmss(null), 'time not recorded');
  assert.equal(W.mmss(3.7), '0:03.7');
});

test('wiring: behind its own switch (off), compilation mode only, loaded before the editor page, from the maker\'s host or the test mock; text only', () => {
  const cfg = read('assets/ryagram-config.js'), page = read('assets/app-editor.js'), html = read('app/index.html'), src = read('assets/app-why-clip.js');
  assert.match(cfg, /\n  whyClip: false,/);
  assert.match(page, /whyOn = !!WHY && WHY\.enabled\(\) && !isData/);
  assert.match(read('assets/app-why-clip.js'), /ryagramConfig\.whyClip === true/);
  assert.match(page, /host && typeof host\.whyClip === 'function'/);
  assert.ok(html.indexOf('app-why-clip.js') > 0 && html.indexOf('app-why-clip.js') < html.indexOf('app-editor.js?'));
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|fetch\(|localStorage/.test(src));
});
