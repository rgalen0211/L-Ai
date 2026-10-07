// A STAND-IN drawer for the synthetic fixture scene (tests/fixtures/scene-fixture.zip). It follows SCENE-BUNDLE.md v1's
// shape (draw(scene, frame) -> SVG string, plus describe) but is NOT the engine's rules: the real reference drawer,
// ryagram/preview/scene-draw.js, replaces it when BUILDER ships it. Presentation attributes only (no style="" and no <style>),
// because the app's policy forbids inline styles; `parts` lets the viewer draw the graphics without the text (to cache them).
(() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // The clock: the last mark at or before the frame; the tween to the next mark begins after that mark's still.
  function tick(scene, frame) {
    const marks = scene.marks;
    let i = 0;
    while (i + 1 < marks.length && marks[i + 1] <= frame) i++;
    if (i >= marks.length - 1) return { index: i, t: 0 };
    const still = scene.clock.stills.find(s => s.first === marks[i]);
    const start = marks[i] + (still ? still.last - still.first + 1 : 0);
    const span = marks[i + 1] - start;
    return { index: i, t: span > 0 ? Math.max(0, Math.min(1, (frame - start) / span)) : 0 };
  }
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const attrs = (st, extra = '') => `fill="${st.fill || 'none'}" stroke="${st.stroke || 'none'}" stroke-width="${st.width || 0}" stroke-linecap="round" stroke-linejoin="round"${extra}`;

  function readout(scene, tk) {
    const v = scene.texts.find(t => t.rule === 'readout').values;
    const next = v[Math.min(v.length - 1, tk.index + 1)];
    return v[tk.index] + (next - v[tk.index]) * tk.t;
  }

  function draw(scene, frame, opts = {}) {
    const parts = opts.parts || 'all';
    const tk = tick(scene, frame);
    const S = scene.styles;
    const out = [];
    if (parts !== 'texts') {
      out.push(`<rect width="${scene.canvas[0]}" height="${scene.canvas[1]}" fill="${scene.theme.page}"/>`);
      for (const layer of scene.layers) {
        const st = S[layer.style];
        if (layer.role === 'dated') {
          const done = [], tween = [];
          for (const g of layer.groups) {
            const gi = scene.clock.periods.indexOf(g.year);
            if (gi <= tk.index) done.push(...g.miles.map(m => m.d));
            else if (gi === tk.index + 1 && tk.t > 0) {
              const fade = scene.clock.reveal_fade;
              for (const m of g.miles) {
                const start = (m.rank[0] / m.rank[1]) * (1 - fade);
                const a = clamp01((tk.t - start) / fade);
                if (a > 0) tween.push(`<path d="${m.d}" ${attrs(st)} opacity="${a.toFixed(3)}"/>`);
              }
            }
          }
          if (done.length) out.push(`<path d="${done.join(' ')}" ${attrs(st)}/>`);
          out.push(...tween);
        } else {
          const extra = layer.role === 'context' ? ` opacity="${(st.opacity ?? 1)}"` : '';
          out.push(`<path d="${layer.d}" ${attrs(st, extra)}/>`);
        }
      }
    }
    if (parts !== 'graphics') {
      for (const t of scene.texts) {
        const st = S[t.style];
        let body = t.text || '';
        if (t.rule === 'period') body = scene.clock.periods[tk.index];
        if (t.rule === 'readout') body = `${readout(scene, tk).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${t.label}`;
        out.push(`<text x="${t.x}" y="${t.y}" font-family="${t.font === 'sans' ? 'system-ui, sans-serif' : t.font}" font-size="${t.size}" fill="${st.fill}" text-anchor="${t.anchor}">${esc(body)}</text>`);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.canvas[0]} ${scene.canvas[1]}" width="${scene.canvas[0]}" height="${scene.canvas[1]}">${out.join('')}</svg>`;
  }

  function describe(scene, frame) {
    const tk = tick(scene, frame);
    return { period: scene.clock.periods[tk.index], readout: `${readout(scene, tk).toFixed(1)} ${scene.texts.find(t => t.rule === 'readout').label}` };
  }

  window.ryagramSceneDraw = { draw, describe, tick, version: 'fixture' };
})();
