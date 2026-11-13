// The film strip under the data editor's picture (WEB, 2026-11-13, CC1 07:06 item 1: "a live editor that looks like a real video editor"): a row of tiles, one per sampled year, a ruler above it,
// and a playhead that follows the slider. Click or drag on the strip to move the playhead. The slider above stays THE accessible control (keyboard, screen reader): the strip is a pointer
// shortcut to it and is hidden from assistive tech, so nothing is announced twice. Tiles show a real picture only when the page hands over a drawing function for that year (the film's own
// frames, once ENGINE's drawing data is served); until then they are plain tiles with the year, and the strip says so in words. No picture is ever invented.
// Pure helpers first (tests/editor-timeline.test.mjs), then the small DOM piece.
(() => {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Which years get a tile: every year when there are at most `max`, otherwise evenly spaced, always including the first and the last.
  function tilesFor(first, last, max = 12) {
    first = Math.round(Number(first)); last = Math.round(Number(last)); max = Math.max(2, Math.floor(Number(max) || 12));
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];
    const n = last - first + 1;
    if (n <= max) return Array.from({ length: n }, (_, i) => first + i);
    const out = [];
    for (let i = 0; i < max; i++) out.push(Math.round(first + (i * (last - first)) / (max - 1)));
    return [...new Set(out)];
  }
  // The slider value (min..max) as a fraction 0..1 of the strip, and back.
  const fractionOf = (value, min, max) => (max > min ? clamp((Number(value) - min) / (max - min), 0, 1) : 0);
  const valueAt = (fraction, min, max, step = 1) => {
    const raw = min + clamp(fraction, 0, 1) * (max - min);
    return step > 0 ? clamp(Math.round((raw - min) / step) * step + min, min, max) : raw;
  };
  // Which tile holds a year (the nearest sampled year at or before it).
  function tileIndexFor(years, year) {
    let at = 0;
    for (let i = 0; i < years.length; i++) if (years[i] <= year) at = i;
    return at;
  }

  // The tile under a pointer (fraction 0..1 across the strip) and where the playhead sits for a year: tiles are equal width, so both are worked out in tiles, not in years. A year between two
  // sampled years sits between the two tile centres; before the first and after the last it stays on that tile's centre.
  const tileAt = (count, fraction) => (count > 0 ? clamp(Math.floor(clamp(Number(fraction) || 0, 0, 1) * count), 0, count - 1) : 0);
  function headFraction(years, year) {
    const n = years.length; if (!n) return 0;
    const y = Number(year); if (!Number.isFinite(y) || y <= years[0]) return 0.5 / n;
    if (y >= years[n - 1]) return (n - 0.5) / n;
    const k = tileIndexFor(years, y), within = (y - years[k]) / (years[k + 1] - years[k]);
    return (k + 0.5 + within) / n;
  }

  // build({ first, last, h, get, seek, thumb }) -> { el, paint(year), tileCount }
  //   get(): { min, max, step, value } of the slider; seek(value): move the slider (the page sets it and fires its own input event); thumb(year): a canvas/img node or null.
  function build(o) {
    const h = o.h, years = tilesFor(o.first, o.last, o.max || 12);
    const head = h('span', { class: 'le-tl-head', 'aria-hidden': 'true' });
    const tiles = years.map(y => {
      const pic = typeof o.thumb === 'function' ? o.thumb(y) : null;
      return h('span', { class: pic ? 'le-tl-tile le-tl-real' : 'le-tl-tile', 'data-year': String(y) }, pic || null, h('i', {}, String(y)));
    });
    const strip = h('div', { class: 'le-tl-strip' }, tiles, head);
    const anyReal = tiles.some(t => t.classList && t.classList.contains('le-tl-real'));
    const note = h('p', { class: 'meta le-tl-note' }, anyReal ? 'Pictures from your film. Click or drag to move the playhead.'
      : 'Plain tiles for now: your film’s own pictures appear here once its drawing data is ready. Click or drag to move the playhead.');
    const el = h('div', { class: 'le-tl', 'aria-hidden': 'true', 'data-tiles': String(years.length) }, strip, note);
    let down = false;
    const at = ev => {
      const r = strip.getBoundingClientRect(); if (!r.width) return;
      o.seek(years[tileAt(years.length, (ev.clientX - r.left) / r.width)]);
    };
    strip.addEventListener('pointerdown', ev => { down = true; try { strip.setPointerCapture(ev.pointerId); } catch (e) { /* not every pointer can be captured */ } at(ev); });
    strip.addEventListener('pointermove', ev => { if (down) at(ev); });
    const up = () => { down = false; };
    strip.addEventListener('pointerup', up); strip.addEventListener('pointercancel', up);
    function paint(value) {
      head.style.left = `${headFraction(years, value) * 100}%`;
      const k = tileIndexFor(years, Math.round(Number(value)));
      tiles.forEach((t, i) => t.classList.toggle('le-tl-on', i === k));
    }
    return { el, paint, tileCount: years.length };
  }

  // Ruler ticks for a film of `duration` seconds: a round step (1, 2, 5, 10, 15, 30, 60 ... seconds) so there are at most `max` labels, always from 0.
  const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  function rulerTicks(duration, max = 10) {
    const d = Number(duration); max = Math.max(2, Math.floor(Number(max) || 10));
    if (!Number.isFinite(d) || d <= 0) return { step: 1, ticks: [0] };
    const step = STEPS.find(s => d / s <= max) || STEPS[STEPS.length - 1];
    const ticks = []; for (let t = 0; t <= d + 1e-9; t += step) ticks.push(t);
    return { step, ticks };
  }
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ruler({ h, duration, seek(seconds) }) -> { lane, paint(fraction) }: the row above the tracks, same columns as a lane (a blank name cell, then the bar). Click or drag on it moves the playhead
  // (the page's slider stays the accessible control, so the ruler is hidden from assistive tech).
  function ruler(o) {
    const h = o.h, dur = Math.max(1, Number(o.duration) || 1), { ticks } = rulerTicks(dur, o.max || 10);
    const head = h('span', { class: 'le-ruler-head', 'aria-hidden': 'true' });
    const marks = ticks.map(t => { const m = h('span', { class: 'le-ruler-tick' }, h('i', {}, clock(t))); m.style.left = `${(t / dur) * 100}%`; return m; });
    const bar = h('div', { class: 'le-ruler-bar', 'aria-hidden': 'true' }, marks, head);
    let down = false;
    const at = ev => { const r = bar.getBoundingClientRect(); if (!r.width) return; o.seek(clamp(((ev.clientX - r.left) / r.width), 0, 1) * dur); };
    bar.addEventListener('pointerdown', ev => { down = true; try { bar.setPointerCapture(ev.pointerId); } catch (e) { /* not every pointer can be captured */ } at(ev); });
    bar.addEventListener('pointermove', ev => { if (down) at(ev); });
    const up = () => { down = false; };
    bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    const lane = h('div', { class: 'le-lane le-ruler-lane' }, h('b', { 'aria-hidden': 'true' }, ''), bar);
    return { lane, paint: f => { head.style.left = `${clamp(Number(f) || 0, 0, 1) * 100}%`; }, tickCount: ticks.length };
  }

  window.ryagramEditorTimeline = { tilesFor, fractionOf, valueAt, tileIndexFor, tileAt, headFraction, build, rulerTicks, ruler, clock };
})();
