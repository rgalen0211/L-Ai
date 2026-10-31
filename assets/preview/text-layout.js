// Text over a film in three styles, placed the way the engine places it (NEXT-BUILDER 24): the SAME steps as ryagram/local/textstyle.py layout(), from the SAME
// numbers (`rules`, exported by textstyle.rules(w, h, platform)), with the browser's canvas measureText for the width. tests/text_overlays.py draws both and
// measures the difference. No DOM beyond the canvas context you pass; no network.
//
//   const L = RyagramText.layout(rules, "Day one", "title", ctx);   // -> {style, size, pad, box: [x0, y0, x1, y1], text_x, text_y, text_w}
//   RyagramText.draw(ctx, rules, L, "Day one", {text: "#f2f2f2", box: "#14141a", alpha: 0.75});
(function (root) {
  "use strict";

  function free(y0, y1, safe, keep) {
    const blocked = keep
      .filter(k => Math.min(k.rect[3], y1) - Math.max(k.rect[1], y0) > 0 && Math.min(k.rect[2], safe[2]) > Math.max(k.rect[0], safe[0]))
      .map(k => [Math.max(k.rect[0], safe[0]), Math.min(k.rect[2], safe[2])])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];
    let x = safe[0];
    for (const [a, b] of blocked) {
      if (a > x) out.push([x, a]);
      x = Math.max(x, b);
    }
    if (safe[2] > x) out.push([x, safe[2]]);
    return out;
  }

  // Python's round() rounds halves to even; the engine uses it, so this must too or a half-pixel lands differently.
  function pyRound(v) {
    const f = Math.floor(v), d = v - f;
    if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(v);
  }

  function layout(rules, text, style, ctx) {
    const st = rules.styles[style];
    if (!st) throw new Error("A text style is a title, a caption or a lower third.");
    const [w, h] = rules.canvas, safe = rules.safe, keep = rules.keep_out;
    const short = Math.min(w, h);
    let size = pyRound(st.size * short);
    const floor = pyRound(st.min_size * short);
    while (size >= floor) {
      const pad = Math.max(4, Math.floor(size * rules.pad_ratio));
      const bh = pyRound(size * rules.line_ratio) + 2 * pad;
      let y0 = st.row === "top" ? safe[1] : st.row === "bottom" ? safe[3] - bh : pyRound(rules.lower_third_at * h);
      const spans = free(y0, y0 + bh, safe, keep);
      if (spans.length) {
        let span;
        if (st.align === "centre") span = spans.find(f => f[0] <= w / 2 && w / 2 <= f[1]) || spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
        else span = spans[0];
        ctx.font = `${size}px ${rules.font}`;
        const tw = ctx.measureText(text).width;
        const bw = tw + 2 * pad;
        if (bw <= span[1] - span[0]) {
          let x0 = st.align === "centre" ? (span[0] + span[1]) / 2 - bw / 2 : span[0];
          x0 = pyRound(x0);
          y0 = pyRound(y0);
          return { style, size, pad, box: [x0, y0, x0 + pyRound(bw), y0 + bh], text_x: x0 + pad, text_y: y0 + pad, text_w: Math.round(tw * 10) / 10 };
        }
      }
      size -= 1;
    }
    throw new Error(`This text is too long for a ${style.replace("_", " ")} here: make it shorter, or split it into two texts.`);
  }

  // Draw it as the engine's drawtext does: a box of the theme's colour around the words, the words' top-left at (text_x, text_y).
  function draw(ctx, rules, L, text, colours) {
    ctx.save();
    ctx.font = `${L.size}px ${rules.font}`;
    ctx.textBaseline = "top";
    const m = ctx.measureText(text);
    const glyphH = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0) || L.size;
    ctx.globalAlpha = colours.alpha;
    ctx.fillStyle = colours.box;
    ctx.fillRect(L.text_x - L.pad, L.text_y - L.pad, m.width + 2 * L.pad, glyphH + 2 * L.pad);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colours.text;
    ctx.fillText(text, L.text_x, L.text_y);
    ctx.restore();
  }

  const api = { layout, draw, free };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RyagramText = api;
})(typeof window !== "undefined" ? window : globalThis);
