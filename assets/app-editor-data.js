// The live editor's data-film mode, the part that is not the page: what the look panel offers, RENDERER's six presets, how a look becomes the story's look block that
// ENGINE's drawer (assets/preview/look-draw.js) reads, and the scrubber's numbers. NEXT-WEB 154. Pure: no DOM, no network, no storage; the page calls it.
// Only the keys the live worker accepts TODAY are ever saved (choropleth.low, choropleth.high, page.background, sequence.theme, state.outline_width); the drawer's other keys
// (middle colour, metal finish, glow) are named in WAITING and are neither offered nor saved until the worker's schema takes them.
(() => {
  const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const rgbHex = c => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
  const hexRgb = h => { const m = /^#([0-9a-fA-F]{6})$/.exec(String(h)); return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null; };
  const DARK_PAGE = '#14141a';                                                  // the drawer's own page colour on the dark theme (RENDERER's legibility sheet: 20,20,26)
  const ROWS = [                                                                // [key, label, kind], the order the panel shows them
    ['choropleth.low', 'Low colour', 'colour'], ['choropleth.high', 'High colour', 'colour'], ['page.background', 'Page colour', 'colour'],
    ['sequence.theme', 'Theme', 'theme'], ['state.outline_width', 'Border width', 'number']
  ];
  const WAITING = ['Middle colour', 'Metal finish', 'Glow'];                    // the drawer draws these; the worker does not take them yet, so they are shown, not offered
  // RENDERER's presets (Ryagram-logs\screens\look-presets, look-<name>.json and legibility.json): `look` is the drawer's own shape ({theme, page, palette}); only what the
  // worker takes is kept here (low, high, page, theme). The middle colour of a preset is not saved today, so the preview never shows it either.
  const PRESETS = [
    { id: 'dark-default', label: 'Dark default', blurb: 'Gold, silver and bronze on the dark page: the approved look.', look: {}, dE: { lowVsPage: 65.6, closestStep: 31.3 } },
    { id: 'white-background', label: 'White background', blurb: 'The light theme with darker colours so nothing is pale on white.', look: { theme: 'light', page: [255, 255, 255], low: [140, 70, 30], high: [214, 160, 20] }, dE: { lowVsPage: 76.7, closestStep: 28.8 } },
    { id: 'colour-blind-safe', label: 'Colour-blind safe', blurb: 'Orange to blue, easy to tell apart in all common kinds of colour vision.', look: { low: [230, 159, 0], high: [0, 114, 178] }, dE: { lowVsPage: 102.6, closestStep: 31.3 } },
    { id: 'high-contrast', label: 'High contrast', blurb: 'A black page with bright orange and cyan.', look: { page: [0, 0, 0], low: [255, 120, 0], high: [0, 200, 255] }, dE: { lowVsPage: 108.7, closestStep: 25.5 } },
    { id: 'monochrome', label: 'Monochrome', blurb: 'Dark to white greys, for print or a quiet look.', look: { low: [70, 70, 80], high: [255, 255, 255] }, dE: { lowVsPage: 23.6, closestStep: 16.0 } },
    { id: 'subject-colour-money', label: 'Money: amber to green', blurb: 'Amber for poorer areas through to green for richer ones.', look: { low: [166, 97, 26], high: [0, 150, 70] }, dE: { lowVsPage: 70.5, closestStep: 31.3 } }
  ];
  // Plain-words cautions from RENDERER's legibility numbers (colour distance dE; under about 30 for the lowest colour against the page, or under about 20 between two
  // neighbouring steps of the ramp, is hard to tell apart on screen). Nothing here blocks a preset; the person sees the note and decides.
  function cautions(p) {
    const out = [];
    if (p.dE.lowVsPage < 30) out.push('The lowest colour is close to the page colour, so low areas can sink into the background.');
    if (p.dE.closestStep < 20) out.push('Neighbouring steps of the colour ramp are close, so small differences are hard to see.');
    return out;
  }
  // The look the person has set (editor keys) -> the story's look block that ENGINE's drawer and the engine's final render both read.
  function story(look) {
    const l = look || {}, so = {};
    if (l['choropleth.low'] !== undefined || l['choropleth.high'] !== undefined) { so.choropleth = {}; if (l['choropleth.low'] !== undefined) so.choropleth.low = l['choropleth.low']; if (l['choropleth.high'] !== undefined) so.choropleth.high = l['choropleth.high']; }
    if (l['page.background'] !== undefined) so.page = { background: l['page.background'] };
    if (l['state.outline_width'] !== undefined) so.state = { outline_width: l['state.outline_width'] };
    const seq = { style_overrides: so };
    if (l['sequence.theme'] !== undefined) seq.theme = l['sequence.theme'];
    return seq;
  }
  // The rows the drawer really honours: ask the drawer itself with every key set, and drop the ones it reports in `ignored` (by name, never a guess here).
  function honoured(RL) {
    const probe = RL.lookFromStory(story({ 'choropleth.low': '#000001', 'choropleth.high': '#000002', 'page.background': '#000003', 'sequence.theme': 'light', 'state.outline_width': 1 }));
    return ROWS.filter(([k]) => !probe.ignored.includes(k));
  }
  // The preset as ops against the look as it stands: every key the preset owns is set, and a key it does not set is removed, so a preset is a complete look and not a patch.
  function presetOps(preset, current) {
    const l = preset.look, want = { 'choropleth.low': l.low ? rgbHex(l.low) : null, 'choropleth.high': l.high ? rgbHex(l.high) : null, 'page.background': l.page ? rgbHex(l.page) : null, 'sequence.theme': l.theme || null };
    const ops = [];
    for (const [key, value] of Object.entries(want)) {
      if (value !== null) { if (current[key] !== value) ops.push({ op: 'set_look', key, value }); }
      else if (current[key] !== undefined) ops.push({ op: 'unset_look', key });
    }
    return ops;
  }
  const presetOf = look => PRESETS.find(p => presetOps(p, look || {}).length === 0) || null;
  // What the colour inputs show before the person has set anything: the bundle's own ramp ends (stops are [r,g,b]; the drawer's low is stop 0, its high stop 2).
  function defaults(bundle, look) {
    const s = (bundle && bundle.stops) || [], light = look && look['sequence.theme'] === 'light';
    return { 'choropleth.low': s[0] ? rgbHex(s[0]) : '#a8562a', 'choropleth.high': s[2] ? rgbHex(s[2]) : '#f0c23a', 'page.background': light ? '#ffffff' : DARK_PAGE, 'sequence.theme': 'dark', 'state.outline_width': 1 };
  }
  // Under about 40 apart in RGB the two read as the same colour to most eyes; the page says so and still lets the person render.
  const near = (a, b) => { const x = hexRgb(a), y = hexRgb(b); return !!x && !!y && Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 40; };
  function warnings(bundle, look) {
    const d = defaults(bundle, look), v = k => (look && look[k] !== undefined ? look[k] : d[k]), out = [];
    if (near(v('choropleth.low'), v('page.background'))) out.push('The lowest colour is nearly the page colour, so low areas will look empty.');
    if (near(v('choropleth.high'), v('page.background'))) out.push('The highest colour is nearly the page colour, so high areas will look empty.');
    if (near(v('choropleth.low'), v('choropleth.high'))) out.push('The lowest and highest colours are nearly the same, so every area will look alike.');
    return out;
  }
  // The scrubber: one step per frame of the bundle, 0 .. frames - 1, label = the period on screen, ticks = each period's start as a fraction of the way along.
  function timeline(RL, bundle) {
    const d = RL.describe(bundle, 0), fps = bundle.fps, frames = Math.round(d.duration * fps), last = Math.max(1, frames - 1);
    const mk = RL.marks(bundle).map(m => ({ period: m.period, at: Math.min(1, Math.round(m.seconds * fps) / last) }));
    const every = Math.max(1, Math.ceil(mk.length / 8));                       // never more than about eight labels: fifty years would not fit on a phone
    return { fps, frames, seconds: frame => Math.min(frame, frames - 1) / fps, frame: seconds => Math.max(0, Math.min(frames - 1, Math.round(seconds * fps))), ticks: mk.filter((m, i) => i % every === 0 || i === mk.length - 1),
      label: seconds => String(RL.describe(bundle, Math.min(seconds, (frames - 1) / fps)).period) };
  }
  // One frame as a picture the page can show: ENGINE's drawer, then a standalone SVG document as a data address (the app's policy allows data images, not inline script).
  function pictureFor(RL, bundle, seconds, look) {
    try {
      const lf = RL.lookFromStory(story(look));
      const frame = RL.drawFrame(bundle, seconds, lf.look);
      if (!frame || !frame.elements) return { error: (frame && frame.unsupported) || 'The engine could not draw that.' };
      return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(RL.document(bundle, frame))}`, ignored: lf.ignored };
    } catch (e) {                                                              // drawing data that the drawer cannot read is said in words; the page keeps working
      return { error: 'The engine could not draw this film with that look.' };
    }
  }
  // A bundle from anywhere is checked before it is trusted: the format name, a version this drawer knows, and the pieces the drawer reads.
  function bundleProblem(b) {
    if (!b || typeof b !== 'object') return 'The film’s drawing data did not arrive.';
    if (b.format !== 'ryagram-look') return 'That is not drawing data this editor knows.';
    if (b.version !== 1) return 'That drawing data is from a different version of Ryagram.';
    if (!Array.isArray(b.periods) || !b.periods.length || !Array.isArray(b.canvas) || b.canvas.length !== 2 || !b.templates || !b.defs || !Number.isFinite(b.fps) || b.fps <= 0 || !Number.isFinite(b.frames_per_period) || b.frames_per_period < 1) return 'The film’s drawing data is incomplete.';
    return null;
  }
  window.ryagramEditorData = { ROWS, WAITING, PRESETS, DARK_PAGE, cautions, story, honoured, presetOps, presetOf, defaults, warnings, timeline, pictureFor, bundleProblem, rgbHex, hexRgb };
})();
