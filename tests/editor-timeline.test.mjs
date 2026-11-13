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
  assert.deepEqual(seeks, [1998]);                                             // the middle of 1985..2010 (rounded to a whole year)
  fire(strip, 'pointermove', { clientX: 200 }); assert.equal(seeks.at(-1), 2010);
  fire(strip, 'pointerup', {}); fire(strip, 'pointermove', { clientX: 0 }); assert.equal(seeks.at(-1), 2010, 'no seek after release');
  value = 1990; s.paint(0.2);
  const head = find(s.el, n => /le-tl-head/.test(n.props.class || ''))[0]; assert.equal(head.style.left, '20%');
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
  assert.match(ed, /const strip = isData && !bundleMode && TLM \? TLM\.build\(/);
  assert.match(ed, /if \(strip\) strip\.paint\(TLM\.fractionOf\(position, FIRST, LAST\)\); if \(!isData\) head\.style\.left/);
  assert.match(ed, /seek: v => \{ stopPlay\(\); range\.value = String\(v\); range\.dispatchEvent\(new Event\('input'/);
  assert.match(ed, /scrub, strip \? strip\.el : null, ticks/);
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
  assert.match(ed, /lanes\.replaceChildren\(\.\.\.\(rl \? \[rl\.lane\] : \[\]\), \.\.\.E\.TRACKS\.map/);
  assert.match(ed, /function paintHead\(\) \{ if \(rulerPaint\) rulerPaint\(Math\.min\(1, position \/ Math\.max\(1, ed\.state\.duration\)\)\);/);
});
