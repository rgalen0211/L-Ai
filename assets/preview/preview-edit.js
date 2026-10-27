// Editing the colours of a scene in the browser, live, before anything is saved. The scene's drawing is the engine's own
// strings (colours written as rgb(r,g,b)); to restyle a layer this finds the colour that layer is drawn in and swaps it in
// exactly the strings that belong to the layer, copying only what it touches. The STORY is changed separately, by
// ryagramLook.apply (the one function the page controls and the AI editor share), so what is previewed is what would be saved.
//
//   const E = window.ryagramPreviewEdit;
//   E.current(scene)                      -> { lines: '#c8372d', page: '#14141a', ... }  (only the layers this scene has)
//   const next = E.recolour(scene, { lines: '#ff0000' })   // a new scene object; `scene` itself is never changed
(() => {
  const hex2 = n => n.toString(16).padStart(2, '0');
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const toRgb = hex => `rgb(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)})`;
  const toHex = rgb => { const m = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/.exec(rgb || ''); return m ? `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}` : null; };

  // The definitions a drawn string points at (<use href="#id">).
  const refs = str => [...String(str || '').matchAll(/href="#([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
  const attrIn = (str, attr) => { const m = new RegExp(`${attr}="(rgb\\([^"]+\\))"`).exec(str || ''); return m ? m[1] : null; };
  // First colour a layer is drawn in, looking in its own string and then in the definitions it uses.
  function find(scene, strings, attr) {
    for (const s of strings) {
      const own = attrIn(s, attr);
      if (own) return own;
      for (const id of refs(s)) { const d = attrIn(scene.defs && scene.defs[id], attr); if (d) return d; }
    }
    return null;
  }
  const swap = (str, attr, from, to) => String(str).split(`${attr}="${from}"`).join(`${attr}="${to}"`);

  // The layers a person can recolour: the label, the story field (in ryagramLook), and how to find and swap the colour.
  const LAYERS = [
    { id: 'lines', field: 'network_color', label: 'Roads as they are built',
      strings: s => (s.parts.years || []).map(y => y[1]).concat(s.parts.reveal && s.parts.reveal.stroke ? [`stroke="${s.parts.reveal.stroke}"`] : []), attr: 'stroke',
      find: s => (s.parts.reveal && s.parts.reveal.stroke) || find(s, (s.parts.years || []).map(y => y[1]), 'stroke'),
      paint(s, from, to) {
        const parts = { ...s.parts, years: (s.parts.years || []).map(([y, str]) => [y, swap(str, 'stroke', from, to)]) };
        if (s.parts.reveal && s.parts.reveal.stroke === from) parts.reveal = { ...s.parts.reveal, stroke: to };
        return { parts };
      } },
    { id: 'base', field: 'network_base_color', label: 'Roads already open', attr: 'stroke', source: s => [s.parts.base], find: s => find(s, [s.parts.base], 'stroke') },
    { id: 'context', field: 'network_context_color', label: 'Background roads', attr: 'stroke', source: s => [s.parts.context && s.parts.context.layer], find: s => find(s, [s.parts.context && s.parts.context.layer], 'stroke') },
    { id: 'land', field: 'land_fill', label: 'Land', attr: 'fill', source: s => [s.parts.states], find: s => find(s, [s.parts.states], 'fill') },
    { id: 'page', field: 'page_background', label: 'Page', attr: 'fill', source: s => [s.parts.page], find: s => find(s, [s.parts.page], 'fill') }
  ];

  // Swap `from` for `to` (attr) in the layer's own strings and in the definitions they use; returns the pieces that changed.
  function paintStrings(scene, strings, attr, from, to, key) {
    const parts = { ...scene.parts };
    const defs = { ...scene.defs };
    for (const [i, str] of strings.entries()) {
      if (!str) continue;
      const swapped = swap(str, attr, from, to);
      if (swapped !== str) key(parts, i, swapped);
      for (const id of refs(str)) if (defs[id]) defs[id] = swap(defs[id], attr, from, to);
    }
    return { parts, defs };
  }
  const SETTERS = {
    base: (parts, i, v) => { parts.base = v; },
    context: (parts, i, v) => { parts.context = { ...parts.context, layer: v }; },
    land: (parts, i, v) => { parts.states = v; },
    page: (parts, i, v) => { parts.page = v; }
  };

  const available = scene => LAYERS.filter(l => { try { return !!l.find(scene); } catch { return false; } });
  function current(scene) {
    const out = {};
    for (const l of available(scene)) out[l.id] = toHex(l.find(scene));
    return out;
  }
  // `edits`: { layerId: '#rrggbb' }. Unknown layers, a layer the scene lacks and a bad colour are ignored.
  function recolour(scene, edits) {
    let next = { ...scene, parts: { ...scene.parts }, defs: { ...scene.defs } };
    for (const l of LAYERS) {
      const to = edits && edits[l.id];
      if (!to || !HEX.test(to)) continue;
      const from = l.find(next);
      if (!from) continue;
      const rgb = toRgb(to.toLowerCase());
      if (l.paint) { const p = l.paint(next, from, rgb); next = { ...next, ...p }; }
      else {
        const done = paintStrings(next, l.source(next), l.attr, from, rgb, SETTERS[l.id]);
        next = { ...next, parts: done.parts, defs: done.defs };
      }
      // The legend (the key) draws a sample in the same colour: keep it in step.
      const attr = l.attr || 'stroke';
      if (next.parts.key) next = { ...next, parts: { ...next.parts, key: swap(next.parts.key, attr, from, rgb) } };
      if (next.parts.context && next.parts.context.key) next = { ...next, parts: { ...next.parts, context: { ...next.parts.context, key: swap(next.parts.context.key, attr, from, rgb) } } };
    }
    return next;
  }

  // ---- THEME: both palettes the engine has, applied through the bundle's own `styles` table ------------------------------------------------
  // scene.styles[key] = { source: 'theme' | 'story', value: 'rgb(r,g,b)' (as drawn), places: ['parts.key', 'defs.x', ...] }. A theme swap restyles exactly the
  // keys whose source is 'theme', inside exactly the places listed, in ONE pass per place (so a colour that becomes another colour's old value
  // is not changed twice). The bundle carries the theme it was drawn in; the other palette is the engine's own, from ryagram/maprace/style.yaml
  // (themes.light, engine commit 98836d8), pinned by tests/preview-edit.test.mjs. Story colours (the roads) belong to the story, not the theme.
  const LIGHT = Object.freeze({ 'page.background': '#fcfcfb', 'state.fill': '#f6f5f1', 'state.outline': '#3d3c39',
                                'text.primary': '#0b0b0b', 'text.secondary': '#52514e', 'text.muted': '#898781' });
  const themeKeys = scene => Object.keys(scene.styles || {}).filter(k => scene.styles[k] && scene.styles[k].source === 'theme');
  const getAt = (scene, place) => place.split('.').reduce((o, k) => (o == null ? o : o[k]), scene);
  function mapStrings(v, fn) {                                                  // a copy with fn applied to every string inside (arrays and objects walked)
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map(x => mapStrings(x, fn));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = mapStrings(v[k], fn); return o; }
    return v;
  }
  function setAt(scene, place, value) {                                         // copy-on-write along the path; the original scene is never changed
    const keys = place.split('.');
    const go = (o, i) => ({ ...o, [keys[i]]: i === keys.length - 1 ? value : go(o[keys[i]], i + 1) });
    return go(scene, 0);
  }
  // edits: { 'text.primary': '#rrggbb', ... } keyed by styles key. Unknown keys and bad colours are ignored.
  function restyle(scene, edits) {
    const byPlace = new Map();
    for (const key of Object.keys(edits || {})) {
      const st = scene.styles && scene.styles[key];
      const to = edits[key];
      if (!st || !HEX.test(to || '') || toRgb(to.toLowerCase()) === st.value) continue;
      for (const place of st.places || []) {
        if (!byPlace.has(place)) byPlace.set(place, new Map());
        byPlace.get(place).set(st.value, toRgb(to.toLowerCase()));
      }
    }
    let next = scene;
    const styles = { ...(scene.styles || {}) };
    for (const key of Object.keys(edits || {})) {                                 // the table follows the scene, so a restyled scene can be restyled again
      const st = styles[key];
      if (st && HEX.test(edits[key] || '')) styles[key] = { ...st, value: toRgb(edits[key].toLowerCase()) };
    }
    for (const [place, map] of byPlace) {
      const cur = getAt(next, place);
      if (cur === undefined) continue;
      const olds = [...map.keys()].map(v => v.replace(/[()]/g, c => '\\' + c));
      const re = new RegExp(olds.join('|'), 'g');
      next = setAt(next, place, mapStrings(cur, str => str.replace(re, m => map.get(m))));
    }
    return byPlace.size === 0 ? scene : { ...next, styles };
  }
  // The edits that put the scene in a theme: 'light' = the engine's light palette; 'dark' (or any other name) = the colours the bundle was drawn with.
  function themeEdits(scene, theme, drawnIn = scene) {
    const out = {};
    for (const key of themeKeys(drawnIn)) {
      if (theme === 'light') { if (Object.hasOwn(LIGHT, key) && LIGHT[key]) out[key] = LIGHT[key]; }
      else out[key] = toHex(drawnIn.styles[key].value);
    }
    return out;
  }

  window.ryagramPreviewEdit = { LIGHT, themeKeys, restyle, themeEdits, LAYERS: LAYERS.map(l => ({ id: l.id, field: l.field, label: l.label })), current, recolour, toRgb, toHex, HEX };
})();
