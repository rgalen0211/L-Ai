// A FORECAST on a line chart (CC1 for Claude 15:30 item 2, 11-04), behind the site switch forecastToggle (OFF). It draws ENGINE's forecast hand-over (Ryagram main 3900383f,
// ryagram/predict: {observed: [[year, value]], forecast: [[year, value, low, high]], breaks, method, basis, backtest: {hidden_years, mean_abs_pct_error, inside_band, of}, kind, label})
// with RENDERER's look rules (tools/forecast_look.py, Q384): observed SOLID, the forecast the same colour DASHED and faded inside its shaded range, a visible "Forecast begins" line,
// a plain-words key ("Estimated, based on ..."), the backtest sentence ALWAYS shown, missing years left missing, the word Observed never used for a forecast. The checks are the same as
// forecast_look.validate, so a series the engine would refuse to draw is refused here too, in words, and nothing is drawn. Everything goes in as text nodes, never HTML.
(() => {
  const on = cfg => !!cfg && cfg.forecastToggle === true;

  class Refused extends Error {}

  // forecast_look.validate, line for line (same order, same words)
  function validate(series) {
    if (!series || typeof series !== 'object' || Array.isArray(series)) throw new Refused('a series is a dictionary');
    const obs = (series.observed || []).map(r => [Math.trunc(Number(r[0])), Number(r[1])]);
    const years = obs.map(r => r[0]);
    if (obs.length < 2 || years.some((y, i) => i && y <= years[i - 1]) || obs.some(r => !Number.isFinite(r[0]) || !Number.isFinite(r[1]))) throw new Refused('observed needs at least two values, one per year, in order');
    const fc = (series.forecast || []).map(r => [Math.trunc(Number(r[0])), Number(r[1]), Number(r[2]), Number(r[3])]);
    if (!fc.length) throw new Refused('there is no forecast to draw');
    const last = obs[obs.length - 1][0];
    if (fc.some((r, i) => r.some(x => !Number.isFinite(x)) || (i && r[0] !== fc[i - 1][0] + 1)) || fc[0][0] <= last) throw new Refused(`the forecast must start after the last observed year (${last}) and go forward one year at a time`);
    let prev = 0;
    for (const [y, v, lo, hi] of fc) {
      if (!(lo <= v && v <= hi)) throw new Refused(`${y}: the forecast value must lie inside its band`);
      if (hi - lo < prev - 1e-9) throw new Refused(`${y}: the band narrows with distance; a forecast is less certain further out, never more`);
      prev = hi - lo;
    }
    const breaks = (series.breaks || []).map(b => Math.trunc(Number(b))).sort((a, b) => a - b);
    for (const b of breaks) if (last < b && b <= fc[fc.length - 1][0]) throw new Refused(`a method break (${b}) lies inside the forecast; a trend may not cross it unless the person says so`);
    if (!String(series.method || '').trim() || !String(series.basis || '').trim()) throw new Refused('the method and what the forecast is based on must be written in words');
    const bt = series.backtest;
    if (!bt || typeof bt !== 'object' || !Number.isInteger(bt.hidden_years) || bt.hidden_years < 1 || typeof bt.mean_abs_pct_error !== 'number' || !Number.isFinite(bt.mean_abs_pct_error)) throw new Refused('the backtest error is missing; a forecast is never shown without it');
    const kind = series.kind === undefined ? 'estimated' : series.kind;
    if (kind !== 'estimated' && kind !== 'simulated') throw new Refused('a forecast is Estimated, or Simulated when it comes from a what-if; never Observed');
    const want = kind === 'simulated' ? 'Simulated' : 'Estimated', other = kind === 'simulated' ? 'Estimated' : 'Simulated';
    if (series.label !== undefined && series.label !== want) throw new Refused('a forecast is Estimated, or Simulated when it comes from a what-if; never Observed');
    if (/^\s*Observed\b/i.test(String(series.basis)) || new RegExp(`^\\s*${other}\\b`).test(String(series.basis))) throw new Refused(`the words say ${String(series.basis).trim().split(/[ ,]/)[0]} but the forecast is ${want}`);
    return { ...series, observed: obs, forecast: fc, breaks, kind, backtest: bt };
  }

  // The words under the chart. Estimated or Simulated, never Observed; the backtest always; a warning when the range caught the real value in fewer than 8 of 10 hidden years.
  function keyLines(s) {
    const first = s.forecast[0][0], obsFirst = s.observed[0][0], obsLast = s.observed[s.observed.length - 1][0];
    const label = s.kind === 'simulated' ? 'Simulated' : 'Estimated';
    const bt = s.backtest, pct = Math.round(bt.mean_abs_pct_error * 10) / 10;
    // ENGINE's basis already starts with its label ("Estimated, based on the 2012-2023 trend"); one without a label gets it, and validate() refused one that names the other label.
    const basis = String(s.basis).trim().replace(/\.$/, '');
    const dashed = /^(Estimated|Simulated)\b/.test(basis) ? basis : `${label}, ${basis}`;
    // A what-if's test is the TREND's (ENGINE carries the trend beside it for scale), so the sentence says whose test it is.
    const whose = s.kind === 'simulated' ? 'A test of the trend shown for scale (not of the what-if)' : 'A test';
    const lines = [
      `Solid line: as published, ${obsFirst}-${obsLast}.`,
      `Dashed line: ${dashed}.`,
      `Shaded: the likely range, which widens the further out it goes. Forecast begins ${first}.`,
      `${whose}: hiding the last ${bt.hidden_years} year${bt.hidden_years === 1 ? '' : 's'} and forecasting them from the years before missed by ${pct}% on average.`
    ];
    if (Number.isInteger(bt.inside_band) && Number.isInteger(bt.of) && bt.of > 0 && bt.inside_band * 10 < bt.of * 8) {
      lines.push(`The range held the real value in only ${bt.inside_band} of ${bt.of} test years: treat the range as too optimistic.`);
    }
    if (s.kind === 'simulated') lines.push('Simulated: this shows what happens IF the assumption holds, not what will happen.');
    return lines;
  }

  // The chart as a list of shapes (testable without a browser): [{tag, attrs, text?}]. box = {w, h}; colours from the look.
  function shapes(series, box = { w: 320, h: 180 }, look = {}) {
    const s = validate(series);
    const ink = look.ink || '#f2f2ef', line = look.line || '#8fb6ea', band = look.band || '#8fb6ea', soft = look.soft || '#b6b5ae', page = look.page || '#14141a', brk = look.break || '#ffbe32';
    const pad = { l: 36, r: 10, t: 12, b: 22 }, W = box.w - pad.l - pad.r, H = box.h - pad.t - pad.b;
    const y0 = s.observed[0][0], y1 = s.forecast[s.forecast.length - 1][0];
    const vals = [...s.observed.map(r => r[1]), ...s.forecast.flatMap(r => [r[2], r[3]])];
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { hi += 1; lo -= 1; }
    const X = y => pad.l + (W * (y - y0)) / Math.max(1, y1 - y0), Y = v => pad.t + H - (H * (v - lo)) / (hi - lo);
    const r2 = n => Math.round(n * 100) / 100;
    const out = [{ tag: 'rect', attrs: { width: box.w, height: box.h, fill: page } }];
    // observed: solid, and broken at a missing year (a gap of more than one year is never bridged) or at a declared break
    const runs = []; let cur = [];
    s.observed.forEach(([y, v], i) => {
      const gap = i && (y - s.observed[i - 1][0] > 1 || s.breaks.some(b => s.observed[i - 1][0] < b && b <= y));
      if (gap && cur.length) { runs.push(cur); cur = []; }
      cur.push([y, v]);
    });
    if (cur.length) runs.push(cur);
    for (const run of runs) {
      if (run.length === 1) out.push({ tag: 'circle', attrs: { cx: r2(X(run[0][0])), cy: r2(Y(run[0][1])), r: 1.6, fill: line, 'data-part': 'observed' } });
      else out.push({ tag: 'polyline', attrs: { points: run.map(([y, v]) => `${r2(X(y))},${r2(Y(v))}`).join(' '), fill: 'none', stroke: line, 'stroke-width': 1.8, 'data-part': 'observed' } });
    }
    for (const b of s.breaks) out.push({ tag: 'line', attrs: { x1: r2(X(b - 0.5)), x2: r2(X(b - 0.5)), y1: pad.t, y2: pad.t + H, stroke: brk, 'stroke-width': 1, 'data-part': 'break' } });
    // the range, from the last observed point outwards (a point at the start, then wider)
    const [ly, lv] = s.observed[s.observed.length - 1];
    const top = [[ly, lv], ...s.forecast.map(r => [r[0], r[3]])], bottom = [...s.forecast.map(r => [r[0], r[2]])].reverse();
    out.push({ tag: 'polygon', attrs: { points: [...top, ...bottom, [ly, lv]].map(([y, v]) => `${r2(X(y))},${r2(Y(v))}`).join(' '), fill: band, 'fill-opacity': 0.18, stroke: 'none', 'data-part': 'band' } });
    out.push({ tag: 'polyline', attrs: { points: [[ly, lv], ...s.forecast.map(r => [r[0], r[1]])].map(([y, v]) => `${r2(X(y))},${r2(Y(v))}`).join(' '), fill: 'none', stroke: line, 'stroke-width': 1.6, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.7, 'data-part': 'forecast' } });
    const fx = r2(X(s.forecast[0][0] - 0.5));
    out.push({ tag: 'line', attrs: { x1: fx, x2: fx, y1: pad.t, y2: pad.t + H, stroke: soft, 'stroke-width': 0.8, 'stroke-dasharray': '1 2', 'data-part': 'begins' } });
    // the label sits LEFT of the marker (the forecast is always at the right end, so a label to its right runs off the chart)
    out.push({ tag: 'text', attrs: { x: fx - 3, y: pad.t + 8, fill: soft, 'font-size': 8, 'text-anchor': 'end' }, text: `Forecast begins ${s.forecast[0][0]}` });
    // the value scale: the lowest and highest values drawn (observed and the range), so the line can be read against numbers
    const fmt = v => { const a = Math.abs(v); return a >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : a >= 1e4 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10); };
    out.push({ tag: 'text', attrs: { x: pad.l - 4, y: r2(Y(hi)) + 3, fill: soft, 'font-size': 8, 'text-anchor': 'end' }, text: fmt(hi) });
    out.push({ tag: 'text', attrs: { x: pad.l - 4, y: r2(Y(lo)), fill: soft, 'font-size': 8, 'text-anchor': 'end' }, text: fmt(lo) });
    out.push({ tag: 'text', attrs: { x: pad.l, y: box.h - 6, fill: soft, 'font-size': 8 }, text: String(y0) });
    out.push({ tag: 'text', attrs: { x: pad.l + W, y: box.h - 6, fill: soft, 'font-size': 8, 'text-anchor': 'end' }, text: String(y1) });
    out.push({ tag: 'text', attrs: { x: pad.l + W, y: pad.t + H - 4, fill: ink, 'font-size': 8, 'text-anchor': 'end' }, text: s.kind === 'simulated' ? 'Simulated' : 'Estimated' });
    return { shapes: out, key: keyLines(s), series: s };
  }

  // Browser only: the chart and its key as DOM, or the refusal in words. h = the page's element helper.
  function render(series, { h, box, look } = {}) {
    let got;
    try { got = shapes(series, box, look); }
    catch (err) { return h('p', { class: 'form-note app-error', role: 'status', 'data-part': 'refused' }, `No forecast is drawn: ${err.message}.`); }
    const NS = 'http://www.w3.org/2000/svg', b = box || { w: 320, h: 180 };
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${b.w} ${b.h}`); svg.setAttribute('class', 'fc-svg'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', got.key.join(' '));
    for (const sh of got.shapes) { const el = document.createElementNS(NS, sh.tag); for (const [k, v] of Object.entries(sh.attrs)) el.setAttribute(k, String(v)); if (sh.text) el.textContent = sh.text; svg.append(el); }
    return h('figure', { class: 'fc-chart' }, svg, h('figcaption', {}, ...got.key.map(t => h('p', { class: 'form-note' }, t))));
  }

  window.ryagramForecast = Object.freeze({ on, validate, keyLines, shapes, render, Refused });
})();
