// The film strip under the data editor (WEB, 2026-11-13, item 1): pure helpers, the DOM piece against a tiny fake, and the wiring. Offline; invented years only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const win = {}; vm.runInNewContext(read('assets/app-editor-timeline.js'), { window: win });
const T = win.ryagramEditorTimeline;
const plain = v => JSON.parse(JSON.stringify(v));

test('tilesFor: every year when few, evenly spaced with both ends when many, nothing for a bad range', () => {
  assert.deepEqual(plain(T.tilesFor(1985, 1990)), [1985, 1986, 1987, 1988, 1989, 1990]);
  const many = plain(T.tilesFor(1985, 2010, 12));
  assert.equal(many.length, 12); assert.equal(many[0], 1985); assert.equal(many.at(-1), 2010);
  assert.deepEqual(many, [...many].sort((a, b) => a - b)); assert.equal(new Set(many).size, many.length);
  assert.deepEqual(plain(T.tilesFor(2010, 1985)), []); assert.deepEqual(plain(T.tilesFor('x', 5)), []);
  assert.deepEqual(plain(T.tilesFor(2000, 2000)), [2000]);
});

test('fractionOf and valueAt are inverses on whole years, clamp at the ends, and survive a flat range', () => {
  assert.equal(T.fractionOf(1985, 1985, 2010), 0); assert.equal(T.fractionOf(2010, 1985, 2010), 1);
  assert.equal(T.fractionOf(1997.5, 1985, 2010), 0.5); assert.equal(T.fractionOf(1900, 1985, 2010), 0); assert.equal(T.fractionOf(3000, 1985, 2010), 1);
  assert.equal(T.fractionOf(5, 5, 5), 0);
  for (const y of [1985, 1990, 1999, 2010]) assert.equal(T.valueAt(T.fractionOf(y, 1985, 2010), 1985, 2010, 1), y);
  assert.equal(T.valueAt(-3, 1985, 2010, 1), 1985); assert.equal(T.valueAt(9, 1985, 2010, 1), 2010);
  assert.equal(T.valueAt(0.4, 1985, 2010, 5), 1995);
  assert.equal(T.valueAt(-3, 1985, 2010, 0), 1985); assert.equal(T.valueAt(9, 1985, 2010, 0), 2010);      // an unstepped slider clamps too
});

test('tileIndexFor picks the tile at or before the year', () => {
  const ys = [1985, 1990, 1995];
  assert.equal(T.tileIndexFor(ys, 1985), 0); assert.equal(T.tileIndexFor(ys, 1989), 0); assert.equal(T.tileIndexFor(ys, 1990), 1); assert.equal(T.tileIndexFor(ys, 2040), 2);
});

// a tiny DOM: elements with children, classList, style, listeners
function el(tag, props = {}, ...kids) {
  const listeners = {}; const cls = new Set(String(props.class || '').split(/\s+/).filter(Boolean));
  const n = { tag, props, style: {}, children: [], listeners, classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); }, getBoundingClientRect: () => ({ left: 0, width: 200 }), setPointerCapture() {} };
  for (const k of kids.flat(3)) if (k !== null && k !== undefined) n.children.push(k);
  return n;
}
const fire = (n, t, ev) => (n.listeners[t] || []).forEach(f => f(ev));
const find = (n, pred, out = []) => { if (n && n.tag && pred(n)) out.push(n); for (const c of (n.children || [])) find(c, pred, out); return out; };

test('build: tiles, a playhead that follows the value, pointer down and drag seek, and it is hidden from assistive tech', () => {
  let value = 1985; const seeks = [];
  const s = T.build({ first: 1985, last: 2010, max: 6, h: el, get: () => ({ min: 1985, max: 2010, step: 1, value }), seek: v => { seeks.push(v); value = v; } });
  assert.equal(s.tileCount, 6); assert.equal(s.el.props['aria-hidden'], 'true');
  const strip = find(s.el, n => /le-tl-strip/.test(n.props.class || ''))[0];
  fire(strip, 'pointerdown', { clientX: 100, pointerId: 1 });
  assert.deepEqual(seeks, [2000]);                                             // the 4th of 6 tiles holds the middle of the strip: its year, not a linear guess
  fire(strip, 'pointermove', { clientX: 200 }); assert.equal(seeks.at(-1), 2010);
  fire(strip, 'pointerup', {}); fire(strip, 'pointermove', { clientX: 0 }); assert.equal(seeks.at(-1), 2010, 'no seek after release');
  value = 1990; s.paint(1990);
  const head = find(s.el, n => /le-tl-head/.test(n.props.class || ''))[0]; assert.ok(Math.abs(parseFloat(head.style.left) - 25) < 1e-9, head.style.left);      // the centre of the second of six tiles
  const on = find(s.el, n => n.classList.contains('le-tl-on')); assert.equal(on.length, 1);
  assert.match(find(s.el, n => /le-tl-note/.test(n.props.class || ''))[0].children.join(''), /Plain tiles for now/);
});

test('build: a picture shows only when the page hands one over, and the note then says so', () => {
  const s = T.build({ first: 2000, last: 2002, h: el, get: () => ({ min: 2000, max: 2002, step: 1, value: 2000 }), seek() {}, thumb: y => el('canvas', { 'data-y': y }) });
  assert.equal(find(s.el, n => n.classList.contains('le-tl-real')).length, 3);
  assert.match(find(s.el, n => /le-tl-note/.test(n.props.class || ''))[0].children.join(''), /Pictures from your film/);
});

test('wiring: the strip is built only for the stand-in data editor, follows the slider and stops playback on a seek; the script is stamped and loaded before the editor', () => {
  const ed = read('assets/app-editor.js'), html = read('app/index.html');
  assert.match(ed, /const makeStrip = \(\) => \(isData && !bundleMode && TLM \? TLM\.build\(/);
  assert.match(ed, /if \(strip\) strip\.paint\(position\); if \(!isData\) head\.style\.left/);
  assert.match(ed, /seek: v => \{ stopPlay\(\); range\.value = String\(v\); range\.dispatchEvent\(new Event\('input'/);
  assert.match(ed, /scrub, stripHolder, ticks/);
  assert.ok(html.indexOf('app-editor-timeline.js?v=20261113a') > 0 && html.indexOf('app-editor-timeline.js') < html.indexOf('app-editor.js?v='));
  assert.match(html, /app-editor\.js\?v=20261113a/);
  assert.ok(!/innerHTML/.test(read('assets/app-editor-timeline.js')), 'no HTML from strings');
});

// ---- the time ruler above the compilation's tracks ----
test('rulerTicks: a round step with at most max labels, from zero, and safe on bad input', () => {
  assert.deepEqual(plain(T.rulerTicks(12, 10)), { step: 2, ticks: [0, 2, 4, 6, 8, 10, 12] });
  assert.equal(T.rulerTicks(9, 10).step, 1); assert.equal(T.rulerTicks(95, 10).step, 10); assert.equal(T.rulerTicks(600, 10).step, 60);
  for (const d of [3, 12, 47, 95, 300, 4000]) { const r = T.rulerTicks(d, 10); assert.ok(r.ticks.length <= 11, d); assert.equal(r.ticks[0], 0); assert.ok(r.ticks.at(-1) <= d + 1e-6); }
  assert.deepEqual(plain(T.rulerTicks(0)), { step: 1, ticks: [0] }); assert.deepEqual(plain(T.rulerTicks('x')), { step: 1, ticks: [0] });
  assert.equal(T.clock(75), '1:15'); assert.equal(T.clock(5), '0:05');
});

test('ruler: a lane with a blank name cell, labelled ticks, a playhead that follows, click and drag seek in seconds, hidden from assistive tech', () => {
  const seeks = [];
  const r = T.ruler({ h: el, duration: 12, seek: s => seeks.push(s) });
  const bar = find(r.lane, n => /le-ruler-bar/.test(n.props.class || ''))[0];
  assert.equal(bar.props['aria-hidden'], 'true'); assert.equal(r.tickCount, 7);
  const labels = find(bar, n => n.tag === 'i').map(n => n.children.join('')); assert.deepEqual(labels, ['0:00', '0:02', '0:04', '0:06', '0:08', '0:10', '0:12']);
  assert.equal(find(bar, n => /le-ruler-tick/.test(n.props.class || ''))[3].style.left, '50%');
  fire(bar, 'pointerdown', { clientX: 100, pointerId: 1 }); assert.deepEqual(seeks, [6]);
  fire(bar, 'pointermove', { clientX: 400 }); assert.equal(seeks.at(-1), 12, 'clamped at the end');
  fire(bar, 'pointerup', {}); fire(bar, 'pointermove', { clientX: 0 }); assert.equal(seeks.at(-1), 12, 'no seek after release');
  r.paint(0.25); assert.equal(find(bar, n => /le-ruler-head/.test(n.props.class || ''))[0].style.left, '25%');
  r.paint(9); assert.equal(find(bar, n => /le-ruler-head/.test(n.props.class || ''))[0].style.left, '100%');
});

test('wiring: the page builds a ruler above the tracks and moves its playhead with the slider', () => {
  const ed = read('assets/app-editor.js');
  assert.match(ed, /const rl = TLM \? TLM\.ruler\(\{ h, duration: ed\.state\.duration, seek: s => \{ stopPlay\(\); range\.value = String\(Math\.round\(s \* 10\)\)/);
  assert.match(ed, /rulerHolder\.replaceChildren\(\.\.\.\(rl \? \[rl\.lane\] : \[\]\)\);/);
  assert.match(ed, /lanes\.replaceChildren\(\.\.\.E\.TRACKS\.map/, 'the tracks box holds only the tracks');
  assert.match(ed, /isData \? null : \[rulerHolder, lanes, list,/);
  assert.ok(!/class: 'le-lane le-ruler-lane'/.test(read('assets/app-editor-timeline.js')), 'the ruler is not a lane: the tracks box counts and orders its lanes (check-live-editor, check-chat-editor)');
  assert.match(ed, /function paintHead\(\) \{ if \(rulerPaint\) rulerPaint\(Math\.min\(1, position \/ Math\.max\(1, ed\.state\.duration\)\)\);/);
});

// ---- CC1 07:23: a click lands on the tile under the pointer, never a neighbour; the playhead sits where the tiles are; every built page carries the script ----
test('every tile\'s 10, 50 and 90 percent points pick that tile\'s own year, for several strip sizes', () => {
  for (const [first, last, max] of [[1985, 2010, 12], [1985, 2010, 6], [1990, 1995, 12], [1998, 2023, 12], [2000, 2002, 12], [1900, 2023, 7]]) {
    const years = plain(T.tilesFor(first, last, max)), n = years.length;
    const seeks = [];
    const s = T.build({ first, last, max, h: el, get: () => ({ min: first, max: last, step: 1, value: first }), seek: v => seeks.push(v) });
    const strip = find(s.el, x => /le-tl-strip/.test(x.props.class || ''))[0]; strip.getBoundingClientRect = () => ({ left: 0, width: 1000 });
    for (let k = 0; k < n; k++) for (const p of [0.1, 0.5, 0.9]) {
      fire(strip, 'pointerdown', { clientX: ((k + p) / n) * 1000, pointerId: 1 }); fire(strip, 'pointerup', {});
      assert.equal(seeks.at(-1), years[k], `${first}-${last}/${max} tile ${k} at ${p}`);
    }
  }
});

test('the playhead sits on the tile of the year: at the centre of a sampled year\'s tile, between centres in between, and stays on the end tiles', () => {
  const ys = [1985, 1990, 1995, 2000];
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(T.headFraction(ys, 1985), 0.125)); assert.ok(near(T.headFraction(ys, 1990), 0.375)); assert.ok(near(T.headFraction(ys, 2000), 0.875));
  assert.ok(near(T.headFraction(ys, 1992.5), 0.5)); assert.ok(near(T.headFraction(ys, 1900), 0.125)); assert.ok(near(T.headFraction(ys, 3000), 0.875));
  assert.equal(T.tileAt(4, 0), 0); assert.equal(T.tileAt(4, 0.999), 3); assert.equal(T.tileAt(4, 1), 3); assert.equal(T.tileAt(4, -2), 0);
});

test('the chat editor page and the PC maker page each DEFINE the timeline script before the editor, and the generators list it', () => {
  for (const f of ['supabase/functions/connect-core/editor_page.ts', 'tools/maker-live/live.js']) {
    const src = read(f), def = src.indexOf('window.ryagramEditorTimeline = {'), use = src.indexOf('const TLM = window.ryagramEditorTimeline');
    assert.ok(def > 0 && use > 0 && def < use, f);
  }
  for (const g of ['tools/build-chat-editor.mjs', 'tools/build-maker-live.mjs']) assert.match(read(g), /'assets\/app-editor-timeline\.js', 'assets\/app-editor\.js'/, g);
});

test("the ruler last label sits left of its tick so it cannot overhang the bar", () => {
  const r = T.ruler({ h: el, duration: 12, seek() {} });
  const ticks = find(r.lane, n => /le-ruler-tick/.test(n.props.class || ''));
  assert.ok(/le-ruler-last/.test(ticks.at(-1).props.class)); assert.ok(!ticks.slice(0, -1).some(n => /le-ruler-last/.test(n.props.class)));
  assert.match(read('assets/app-editor.css'), /\.le-ruler-last i\{left:auto;right:3px\}/);
});

test('maxTilesFor: fewer tiles on narrow screens so a year label always fits, and the page asks for it', () => {
  assert.equal(T.maxTilesFor(320), 6); assert.equal(T.maxTilesFor(390), 6); assert.equal(T.maxTilesFor(430), 6); assert.equal(T.maxTilesFor(600), 8); assert.equal(T.maxTilesFor(1280), 12);
  assert.equal(T.maxTilesFor(0), 12); assert.equal(T.maxTilesFor('x'), 12);
  for (const w of [320, 360, 390, 430, 600, 700]) assert.ok((w - 40) / T.maxTilesFor(w) >= 40, `${w}px: about 40 px of tile per label`);
  assert.match(read('assets/app-editor.js'), /let stripMax = TLM \? TLM\.maxTilesFor\(window\.innerWidth\) : 12;/); assert.match(read('assets/app-editor.js'), /TLM\.build\(\{ first: FIRST, last: LAST, max: stripMax, h,/);
});

test('keyTarget: Space and K toggle play, Shift+arrows and J and L jump a tenth of the film, plain arrows and modified keys are left alone, and the ends clamp', () => {
  const S = { value: 1990, min: 1985, max: 2010, step: 1 };
  assert.deepEqual(plain(T.keyTarget({ key: ' ' }, S)), { toggle: true }); assert.deepEqual(plain(T.keyTarget({ key: 'k' }, S)), { toggle: true }); assert.deepEqual(plain(T.keyTarget({ key: 'K' }, S)), { toggle: true });
  assert.deepEqual(plain(T.keyTarget({ key: 'ArrowRight', shiftKey: true }, S)), { value: 1993 }); assert.deepEqual(plain(T.keyTarget({ key: 'ArrowLeft', shiftKey: true }, S)), { value: 1987 });
  assert.deepEqual(plain(T.keyTarget({ key: 'l' }, S)), { value: 1993 }); assert.deepEqual(plain(T.keyTarget({ key: 'j' }, S)), { value: 1987 });
  assert.equal(T.keyTarget({ key: 'ArrowRight' }, S), null, 'the native slider keeps the plain arrows'); assert.equal(T.keyTarget({ key: 'Home' }, S), null); assert.equal(T.keyTarget({ key: 'a' }, S), null);
  for (const m of ['ctrlKey', 'altKey', 'metaKey']) { assert.equal(T.keyTarget({ key: ' ', [m]: true }, S), null, m); assert.equal(T.keyTarget({ key: 'l', [m]: true }, S), null, m); }
  assert.deepEqual(plain(T.keyTarget({ key: 'l' }, { ...S, value: 2009 })), { value: 2010 }); assert.deepEqual(plain(T.keyTarget({ key: 'j' }, { ...S, value: 1986 })), { value: 1985 });
  assert.deepEqual(plain(T.keyTarget({ key: 'l' }, { value: 0, min: 0, max: 120, step: 1 })), { value: 12 });
  assert.equal(T.keyTarget({ key: 'l' }, { value: 'x', min: 0, max: 10, step: 1 }), null); assert.equal(T.keyTarget(null, S), null);
});

test('wiring: the slider has the video-editor keys and the page says which keys', () => {
  const ed = read('assets/app-editor.js');
  assert.match(ed, /range\.addEventListener\('keydown', ev => \{\s*const kt = window\.ryagramEditorTimeline && window\.ryagramEditorTimeline\.keyTarget\(ev,/);
  assert.match(ed, /if \(kt\.toggle\) \{ playBtn\.click\(\); return; \}\s*stopPlay\(\); range\.value = String\(kt\.value\)/);
  assert.match(ed, /Keys on the slider: arrows step, Shift\+arrows or J and L jump a tenth of the film, Space or K plays and pauses/);
});

test('wiring: the strip is rebuilt when the width crosses a tile-count breakpoint, and the listener goes when the editor stops', () => {
  const ed = read('assets/app-editor.js');
  assert.match(ed, /const onResize = \(\) => \{\s*const next = TLM \? TLM\.maxTilesFor\(window\.innerWidth\) : stripMax;\s*if \(!strip \|\| next === stripMax\) return;\s*stripMax = next; strip = makeStrip\(\); stripHolder\.replaceChildren\(strip\.el\); strip\.paint\(position\);/);
  assert.match(ed, /window\.addEventListener\('resize', onResize\); onStop\(\(\) => window\.removeEventListener\('resize', onResize\)\);/);
});

test('the keys line is hidden where there is no keyboard (touch devices), and the stylesheet carries a new stamp', () => {
  assert.match(read('assets/app-editor.css'), /@media \(hover:none\),\(pointer:coarse\)\{\.le-keys\{display:none\}\}/);
  assert.match(read('app/index.html'), /app-editor\.css\?v=20261113c/);
});
