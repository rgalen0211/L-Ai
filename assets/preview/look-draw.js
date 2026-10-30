/* look-draw.js -- the browser half of the live look (NEXT-ENGINE 35; ryagram/preview/look.py is the reference this file is a mechanical port of).
 *
 *   RyagramLook.draw(bundle, period, sub, look) -> {elements: [...], extra: {id: filter-def}, drop_extra, unsupported}
 *
 * `bundle` is look.build()'s JSON; `period` a string from bundle.periods; `sub` the frame inside the period (0 .. frames_per_period - 1); `look` the overrides:
 *   {palette: {low, mid, high}  (each [r,g,b]),  metal: strength,  theme: "light",  page: [r,g,b],  glow: false}
 * The same keys, serialised into the story's look block, are what the engine's final render reads. tests/live_look.py holds this file byte-identical to look.py.
 */
(function (root) {
  "use strict";
  var PLACES = 2;
  var BUCKETS = 10;
  var KEY_STEPS = 125;

  // Python's round(v, 2) as a number (half to even on an exact tie; the ties are the odd multiples of 1/8).
  function pyRound2(v) {
    var a = Math.abs(v), r;
    if (a * 8 === Math.floor(a * 8) && a * 4 !== Math.floor(a * 4)) {
      var w = Math.floor(a * 100);
      r = (w % 2 === 0 ? w : w + 1) / 100;
    } else {
      r = parseFloat(a.toFixed(PLACES));
    }
    return v < 0 ? -r : r;
  }
  // Python's int(round(x)): half to even.
  function pyRoundInt(x) {
    var f = Math.floor(x), d = x - f;
    if (d === 0.5) { return (f % 2 === 0) ? f : f + 1; }
    return Math.round(x);
  }
  // svgdraw._n
  function nn(v) {
    var r = pyRound2(Number(v));
    if (r === Math.trunc(r)) { return String(Math.trunc(r) === 0 ? 0 : Math.trunc(r)); }
    return r.toFixed(PLACES).replace(/0+$/, "");
  }

  function toLinear(c) {
    c = c / 255.0;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function fromLinear(c) {
    c = Math.max(0.0, Math.min(1.0, c));
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return pyRoundInt(c * 255);
  }
  function toLab(rgb) {
    var r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
    var x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    var y = (0.2126 * r + 0.7152 * g + 0.0722 * b);
    var z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    function f(t) { return t > 216 / 24389 ? Math.pow(t, 1 / 3) : (841 / 108) * t + 4 / 29; }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function toRgb(lab) {
    var L = lab[0], a = lab[1], b = lab[2];
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    function inv(t) { var cubed = Math.pow(t, 3); return cubed > 216 / 24389 ? cubed : (t - 4 / 29) * (108 / 841); }
    var x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
    return [fromLinear(3.2406 * x - 1.5372 * y - 0.4986 * z),
            fromLinear(-0.9689 * x + 1.8758 * y + 0.0415 * z),
            fromLinear(0.0557 * x - 0.2040 * y + 1.0570 * z)];
  }
  function lerp(p, q, t) {
    t = Math.max(0.0, Math.min(1.0, Number(t)));
    var a = toLab(p), b = toLab(q);
    return toRgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  function divergingColour(u, low, mid, high) {
    u = Math.min(Math.max(Number(u), 0.0), 1.0);
    if (u <= 0.5) { return lerp(low, mid, u / 0.5); }
    return lerp(mid, high, (u - 0.5) / 0.5);
  }
  function indexFor(edges, rate) {
    var count = edges.length - 1;
    for (var i = 0; i < count; i++) {
      if (rate < edges[i + 1] || i === count - 1) { return i; }
    }
    return count - 1;
  }
  function fillColour(value, edges, stops) {
    var count = edges.length - 1;
    var v = Math.min(Math.max(Number(value), edges[0]), edges[edges.length - 1]);
    var i = indexFor(edges, v);
    var lo = edges[i], hi = edges[i + 1];
    var frac = hi > lo ? (v - lo) / (hi - lo) : 0.0;
    var u = (i + Math.min(Math.max(frac, 0.0), 1.0)) / count;
    return divergingColour(u, stops[0], stops[1], stops[2]);
  }
  function fadeWindow(tCross, fadeSeconds, hold) {
    var width = Math.min(1.0, Math.max(1e-6, fadeSeconds / Math.max(1e-6, hold)));
    var lo = tCross - width / 2, hi = tCross + width / 2;
    if (lo < 0.0) { lo = 0.0; hi = width; }
    if (hi > 1.0) { lo = 1.0 - width; hi = 1.0; }
    return [lo, hi];
  }
  // transitions.colour_plan: flat inside a band, a Lab blend across a break centred on the real crossing.
  function bandedColour(a, b, t, edges, colours, abrupt, fadeSeconds, hold) {
    var ba = indexFor(edges, a);
    if (b === null || b === undefined || a === b) { return colours[ba].slice(); }
    var bb = indexFor(edges, b);
    if (ba === bb) { return colours[ba].slice(); }
    var threshold = bb > ba ? edges[ba + 1] : edges[ba];
    var denom = b - a;
    var tc = denom ? (threshold - a) / denom : 0.5;
    tc = Math.min(1.0, Math.max(0.0, tc));
    var mix;
    if (abrupt) { mix = t >= tc ? 1.0 : 0.0; }
    else { var w = fadeWindow(tc, fadeSeconds, hold); mix = t <= w[0] ? 0.0 : (t >= w[1] ? 1.0 : (t - w[0]) / (w[1] - w[0])); }
    return lerp(colours[ba], colours[bb], mix);
  }
  function keyColour(k, edges, stops) {
    var count = edges.length - 1;
    var idx = (1 - (k + 0.5) / KEY_STEPS) * count;
    var i = Math.min(Math.trunc(idx), count - 1);
    var lo = edges[i], hi = edges[i + 1];
    return fillColour(lo + (hi - lo) * (idx - i), edges, stops);
  }
  function hex2(v) { var s = (v | 0).toString(16); return s.length < 2 ? "0" + s : s; }

  function metalGroups(fills, anchors) {
    var pts = anchors.map(function (a) { return [Number(a[0]), Number(a[1]), Number(a[2])]; });
    var groups = {};
    fills.forEach(function (kf) {
      var key = kf[0], f = [Number(kf[1][0]), Number(kf[1][1]), Number(kf[1][2])];
      var best = null;
      for (var k = 0; k < 2; k++) {
        var a = pts[k], b = pts[k + 1];
        var ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        var fa = [f[0] - a[0], f[1] - a[1], f[2] - a[2]];
        var u = (fa[0] * ba[0] + fa[1] * ba[1] + fa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]);
        u = Math.min(Math.max(u, 0.0), 1.0);
        var d0 = f[0] - (a[0] + ba[0] * u), d1 = f[1] - (a[1] + ba[1] * u), d2 = f[2] - (a[2] + ba[2] * u);
        var d = Math.pow(d0 * d0 + d1 * d1 + d2 * d2, 0.5);
        if (best === null || d < best[0]) { best = [d, (k + u) / 2.0]; }
      }
      if (best[0] > 90) { return; }
      var gi = Math.min(BUCKETS - 1, Math.trunc(best[1] * BUCKETS));
      (groups[gi] = groups[gi] || []).push([f, key]);
    });
    var out = [];
    Object.keys(groups).map(Number).sort(function (x, y) { return x - y; }).forEach(function (k) {
      var items = groups[k], n = items.length;
      var mean = [0, 1, 2].map(function (i) { var s = 0; items.forEach(function (it) { s += it[0][i]; }); return s / n; });
      var t = (k + 0.5) / BUCKETS;
      var grain = t < 0.85 ? 0.15 + 0.4 * (1 - Math.abs(t - 0.5) * 2) : 0.08;
      out.push([mean, pyRound2(grain), items.map(function (it) { return it[1]; })]);
    });
    return out;
  }

  function metalFilter(fid, hi, lo, hr, hg, hb, grain, s, w, h) {
    return '<filter id="' + fid + '" filterUnits="userSpaceOnUse" x="0" y="0" ' +
      'width="' + w + '" height="' + h + '" color-interpolation-filters="sRGB">' +
      '<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0" result="hm"/>' +
      '<feGaussianBlur in="hm" stdDeviation="1.35" result="soft"/>' +
      '<feDiffuseLighting in="soft" surfaceScale="6.5" diffuseConstant="1" ' +
      'lighting-color="#fff" result="lit"><feDistantLight azimuth="225" elevation="45"/></feDiffuseLighting>' +
      '<feColorMatrix in="lit" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ' + nn(5.0 * s * 1.0) + ' 0 0 0 ' + nn(-5.0 * s * 1.0 * 0.7071) + '" result="hia"/>' +
      '<feFlood flood-color="' + hi + '" result="hic"/><feComposite in="hic" in2="hia" operator="in" result="hilite"/>' +
      '<feColorMatrix in="lit" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ' + nn(-1.6 * s) + ' 0 0 0 ' + nn(1.6 * s * 0.7071) + '" result="sha"/>' +
      '<feFlood flood-color="' + lo + '" result="shc"/><feComposite in="shc" in2="sha" operator="in" result="shade"/>' +
      '<feSpecularLighting in="soft" surfaceScale="6.5" specularConstant="' + nn(0.9 * s * 1.0) + '" ' +
      'specularExponent="22" lighting-color="' + hi + '" result="spec"><feDistantLight azimuth="225" elevation="45"/></feSpecularLighting>' +
      '<feComposite in="spec" in2="SourceAlpha" operator="in" result="specc"/>' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.012 0.85" numOctaves="2" seed="7" result="noise"/>' +
      '<feColorMatrix in="noise" type="matrix" values="0 0 0 0 ' + nn(hr) + '  0 0 0 0 ' + nn(hg) + '  0 0 0 0 ' + nn(hb) + '  ' + nn(3.0 * grain * s) + ' 0 0 0 ' + nn(-1.5 * grain * s) + '" result="gl"/>' +
      '<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ' + nn(-2.5 * grain * s) + ' 0 0 0 ' + nn(1.25 * grain * s) + '" result="gd"/>' +
      '<feMerge result="all"><feMergeNode in="shade"/><feMergeNode in="hilite"/><feMergeNode in="specc"/><feMergeNode in="gl"/><feMergeNode in="gd"/></feMerge>' +
      '<feComposite in="all" in2="hm" operator="in"/></filter>';
  }

  function metalElements(groups, hrefs, strength, canvas) {
    var s = Number(strength), w = Math.trunc(canvas[0]), h = Math.trunc(canvas[1]);
    var elements = [], extra = {};
    groups.forEach(function (g, gi) {
      var mean = g[0], grain = g[1], keys = g[2];
      var ids = [];
      keys.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(hrefs, k)) { ids.push(hrefs[k]); } });
      if (!ids.length) { return; }
      var hv = mean.map(function (c) { return Math.min(1.0, (c / 255) * 0.62 + 0.38 * (0.52 + 0.48 * (c / 255))); });
      var hi = "#" + hv.map(function (v) { return hex2(Math.trunc(v * 255)); }).join("");
      var lo = "#" + mean.map(function (c) { return hex2(Math.trunc(c * 0.30)); }).join("");
      var fid = ("metal-county-g" + gi + "-" + hi.slice(1) + "-" + nn(grain) + "-" + nn(s) + "-" + w + "x" + h).replace(/\./g, "_");
      if (!Object.prototype.hasOwnProperty.call(extra, fid)) {
        extra[fid] = metalFilter(fid, hi, lo, hv[0], hv[1], hv[2], grain, s, w, h);
      }
      var uses = ids.map(function (i) { return '<use href="#' + i + '"/>'; }).join("");
      elements.push('<g filter="url(#' + fid + ')" fill="#ffffff" stroke="#000000" stroke-width="1.5" stroke-linejoin="round">' + uses + '</g>');
    });
    return {elements: elements, extra: extra};
  }

  // look.is_outline: a county outline use (what a draft frame leaves out)
  function isOutline(e) { return e.indexOf('<use href="#a') === 0 && e.indexOf(' fill="none"') >= 0 && e.indexOf(" stroke=") >= 0; }

  function retheme(e, pairs) {
    e = e.replace(/rgb\(\d+,\d+,\d+\)/g, function (m) { return Object.prototype.hasOwnProperty.call(pairs.colours, m) ? pairs.colours[m] : m; });
    return e.replace(/perimeter-glow-[0-9a-f]+/g, function (m) { return Object.prototype.hasOwnProperty.call(pairs.glow, m) ? pairs.glow[m] : m; });
  }

  // look.ramp_colours: the band colours of a banded map for the look's low / mid / high (the engine's arithmetic)
  function rampColours(r, pal) {
    var low = (pal.low || r.low).map(Math.trunc), high = (pal.high || r.high).map(Math.trunc), n = r.count, out = [], i;
    if (r.kind === "diverging") {
      var mid = (pal.mid || r.mid).map(Math.trunc);
      for (i = 0; i < n; i++) { out.push(divergingColour((i + 0.5) / n, low, mid, high)); }
      return out;
    }
    if (n === 1) { return [low]; }
    var a = toLab(low), b = toLab(high);
    for (i = 0; i < n; i++) { out.push(toRgb([a[0] + (b[0] - a[0]) * i / (n - 1), a[1] + (b[1] - a[1]) * i / (n - 1), a[2] + (b[2] - a[2]) * i / (n - 1)])); }
    return out;
  }

  function applyLook(bundle, look) {
    if (bundle.mode === "banded") {
      var bs = bundle.stops.map(function (c) { return [c[0], c[1], c[2]]; });
      if (look && look.palette && bundle.ramp) { bs = rampColours(bundle.ramp, look.palette); }
      ((look && look.bands) || []).forEach(function (c, i) { bs[i] = [Math.trunc(c[0]), Math.trunc(c[1]), Math.trunc(c[2])]; });
      return {stops: bs, anchors: [], metal: 0.0};
    }
    var pal = (look && look.palette) || {};
    var stops = bundle.stops.map(function (s) { return [s[0], s[1], s[2]]; });
    ["low", "mid", "high"].forEach(function (k, i) {
      if (Object.prototype.hasOwnProperty.call(pal, k)) { stops[i] = [Math.trunc(pal[k][0]), Math.trunc(pal[k][1]), Math.trunc(pal[k][2])]; }
    });
    var metal = look && look.metal !== undefined ? Number(look.metal) : Number(bundle.metal);
    return {stops: stops, anchors: stops.map(function (s) { return s.slice(); }), metal: metal};
  }

  function sameStops(a, b) {
    if (a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { for (var j = 0; j < 3; j++) { if (a[i][j] !== b[i][j]) { return false; } } }
    return true;
  }

  function draw(bundle, period, sub, look) {
    look = look || {};
    sub = sub || 0;
    var periods = bundle.periods, p = String(period), i = periods.indexOf(p);
    if (bundle.loaded && i >= 0 && (!bundle.loaded[p] || (i + 1 < periods.length && !bundle.loaded[periods[i + 1]]))) {
      return {elements: null, extra: {}, unsupported: "loading", loading: true};
    }
    if (i < 0) { return {elements: null, extra: {}, unsupported: "period " + p + " is not in this bundle"}; }
    var nxt = i + 1 < periods.length ? periods[i + 1] : null;
    var t = bundle.t[sub];
    var a = bundle.values[p] || {}, b = nxt ? (bundle.values[nxt] || {}) : null;
    var lk = applyLook(bundle, look), stops = lk.stops, anchors = lk.anchors, metal = lk.metal;
    var edges = bundle.edges, tpl = bundle.templates[p];
    var staticPairs = null;
    if (look.theme !== undefined && look.theme !== null) {
      staticPairs = tpl.themes[look.theme] || null;
      if (!staticPairs) {
        return {elements: null, extra: {}, unsupported: "theme " + JSON.stringify(look.theme) + " is not in this bundle (have " + JSON.stringify(Object.keys(tpl.themes).sort()) + ")"};
      }
    }
    var fillsEl = [], fillsKey = [], done = {};
    for (var n = 0; n < tpl.fills.length; n++) {
      var it = tpl.fills[n];
      if (it[0] === "s") { fillsEl.push(staticPairs ? retheme(it[1], staticPairs) : it[1]); continue; }
      var fips = it[1], h = it[2];
      if (!Object.prototype.hasOwnProperty.call(done, fips)) {
        var va = a[fips];
        if (va === undefined || va === null) {
          return {elements: null, extra: {}, unsupported: fips + " has no value in " + p + ": the no-data crossing is not ported"};
        }
        var vb = b ? b[fips] : undefined;
        var v = (vb === undefined || vb === null) ? va : va + (vb - va) * t;
        if (bundle.mode === "banded") { var tw = bundle.tween; done[fips] = bandedColour(va, vb === undefined ? null : vb, t, edges, stops, tw.abrupt, tw.fade_seconds, tw.hold); }
        else { done[fips] = fillColour(v, edges, stops); }
        fillsKey.push([fips, done[fips]]);
      }
      var c = done[fips];
      fillsEl.push('<use href="#' + h + '" fill="rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')"/>');
    }
    var metalEl = [], extra = {};
    if (metal > 0 && !look.draft) {
      var me = metalElements(metalGroups(fillsKey, anchors), bundle.metal_href, metal, bundle.canvas);
      metalEl = me.elements; extra = me.extra;
    }
    var tail = tpl.tail, head = tpl.head;
    var key = tpl.key;
    if (staticPairs) {
      var k0 = key ? key[0] : tail.length;
      head = head.map(function (e) { return retheme(e, staticPairs); });
      tail = tail.map(function (e, j) { return (j >= k0 && j < k0 + KEY_STEPS) ? e : retheme(e, staticPairs); });
    }
    if (look.page !== undefined && look.page !== null) {
      var pc = look.page;
      head = [head[0].replace(/^(<rect width="[^"]*" height="[^"]*" fill=")rgb\([^)]*\)/, function (m, g1) {
        return g1 + "rgb(" + Math.trunc(pc[0]) + "," + Math.trunc(pc[1]) + "," + Math.trunc(pc[2]) + ")";
      })].concat(head.slice(1));
    }
    var dropExtra = [];
    if (look.glow === false) {
      var notGlow = function (e) { return e.indexOf('<g filter="url(#perimeter-glow') !== 0; };
      head = head.filter(notGlow); tail = tail.filter(notGlow);
      dropExtra = "perimeter-glow";
    }
    if (bundle.mode === "banded" && tpl.key_polys && !sameStops(stops, bundle.stops)) {
      tail = tail.slice();
      tpl.key_polys.forEach(function (ji) {
        tail[ji[0]] = tail[ji[0]].replace(/fill="rgb\(\d+,\d+,\d+\)"/, 'fill="rgb(' + stops[ji[1]][0] + "," + stops[ji[1]][1] + "," + stops[ji[1]][2] + ')"');
      });
    }
    if (key && !sameStops(stops, bundle.stops)) {
      tail = tail.slice();
      for (var k = 0; k < KEY_STEPS; k++) {
        var kc = keyColour(k, edges, stops);
        tail[key[0] + k] = key[1][k] + "rgb(" + kc[0] + "," + kc[1] + "," + kc[2] + ')"/>';
      }
    }
    if (look.draft) {
      // A DRAFT FRAME (a drag, not a result): the same frame without the county outlines and the metal finish; every element kept is byte-identical to the full frame's.
      var notOutline = function (e) { return !isOutline(e); };
      head = head.filter(notOutline); tail = tail.filter(notOutline); fillsEl = fillsEl.filter(notOutline);
    }
    return {elements: head.concat(fillsEl, metalEl, tail), extra: extra, drop_extra: dropExtra};
  }

  // The packed bundle (look.pack) back to the form draw() reads.
  function unpack(packed) {
    var tb = packed.table, out = {};
    Object.keys(packed).forEach(function (k) { if (k !== "templates" && k !== "table") { out[k] = packed[k]; } });
    out.templates = {};
    Object.keys(packed.templates).forEach(function (p) {
      var t = packed.templates[p];
      var pick = function (ids) { return ids.map(function (i) { return tb[i]; }); };
      out.templates[p] = {head: pick(t.head), tail: pick(t.tail), fills: pick(t.fills), key: t.key ? [t.key[0], tb[t.key[1]]] : null, themes: t.themes};
    });
    return out;
  }

  // A complete standalone SVG document for one frame (look.draw's result inside the bundle's defs), as svgdraw.document writes it.
  function document_(bundle, frame) {
    var d = bundle.defs, w = bundle.canvas[0], h = bundle.canvas[1];
    var defs = d.atlas.map(function (a) { return '<path id="' + a[0] + '" d="' + a[1] + '"/>'; }).join("");
    var ex = {};
    Object.keys(d.extra).forEach(function (k) { ex[k] = d.extra[k]; });
    Object.keys(frame.extra).forEach(function (k) { ex[k] = frame.extra[k]; });
    Object.keys(ex).forEach(function (k) { defs += ex[k]; });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><style>' + d.fonts_css + '</style><defs>' + defs + '</defs>' + frame.elements.join("") + '</svg>';
  }

  // look.frame_at / locate / draw_at: the time axis. A film's `seconds`; a compilation's timecode is located first.
  function frameAt(bundle, seconds) {
    var fpp = bundle.frames_per_period, periods = bundle.periods;
    var n = (periods.length - 1) * fpp + 1;
    var i = Math.min(Math.max(Math.trunc(Number(seconds) * bundle.fps + 1e-9), 0), n - 1);
    var pi = Math.min(Math.floor(i / fpp), periods.length - 1);
    return [periods[pi], pi === periods.length - 1 ? 0 : i - pi * fpp];
  }
  function locate(clips, seconds) {
    var t = Math.max(0.0, Number(seconds));
    for (var k = 0; k < clips.length; k++) {
      if (t < clips[k].seconds || k === clips.length - 1) { return [k, Math.min(t, clips[k].seconds)]; }
      t -= clips[k].seconds;
    }
    throw new Error("a compilation needs at least one clip");
  }
  function drawAt(bundle, seconds, look) { var f = frameAt(bundle, seconds); return draw(bundle, f[0], f[1], look); }

  // The editor's own shapes. drawFrame(bundle, t, look) = drawAt; marks = each period's start in seconds (for the scrubber's ticks); describe = what is on screen at t.
  function marks(bundle) {
    return bundle.periods.map(function (p, i) { return {period: p, seconds: i * bundle.frames_per_period / bundle.fps}; });
  }
  function describe(bundle, seconds) {
    var f = frameAt(bundle, seconds);
    return {period: f[0], sub: f[1], seconds: Number(seconds), duration: ((bundle.periods.length - 1) * bundle.frames_per_period + 1) / bundle.fps};
  }
  function hexRgb(h) {
    var m = /^#([0-9a-fA-F]{6})$/.exec(String(h));
    return m ? [parseInt(m[1].substr(0, 2), 16), parseInt(m[1].substr(2, 2), 16), parseInt(m[1].substr(4, 2), 16)] : null;
  }
  // The story's look block (sequence.theme + sequence.style_overrides: the SAME keys the engine's final render reads) -> the look draw() takes. Keys the drawer cannot
  // honour are returned in `ignored` by name, never dropped silently (border width: the engine clamps it on dense county maps; labels/dots: not ported).
  function lookFromStory(sequence) {
    var so = (sequence && sequence.style_overrides) || {}, look = {}, ignored = [];
    var ch = so.choropleth || {}, dv = ch.diverging || {}, pal = {};
    [["low", ch.low], ["mid", dv.mid], ["high", ch.high]].forEach(function (kv) {
      if (kv[1] === undefined) { return; }
      var rgb = hexRgb(kv[1]);
      if (rgb) { pal[kv[0]] = rgb; } else { ignored.push("choropleth." + kv[0]); }
    });
    if (Object.keys(pal).length) { look.palette = pal; }
    if (sequence && sequence.theme !== undefined && sequence.theme !== "dark") { look.theme = sequence.theme; }
    var st = so.state || {};
    if (st.perimeter_glow !== undefined) { if (Number(st.perimeter_glow) === 0) { look.glow = false; } }
    if (st.metal_finish !== undefined) { look.metal = Number(st.metal_finish); }
    if (st.outline_width !== undefined) { ignored.push("state.outline_width"); }
    var pg = so.page || {};
    if (pg.background !== undefined) { var pc = hexRgb(pg.background); if (pc) { look.page = pc; } else { ignored.push("page.background"); } }
    Object.keys(so).forEach(function (k) { if (["choropleth", "state", "page"].indexOf(k) < 0) { ignored.push(k); } });
    return {look: look, ignored: ignored};
  }

  // STREAMING (look.pack_progressive): start from the head, add each period's chunk as it arrives; draw() says "loading" for a period whose chunk
  // (or whose next period's values) is not here yet. fonts arrive last and are optional for a first frame.
  function progressive(head) {
    var b = {};
    Object.keys(head).forEach(function (k) { b[k] = head[k]; });
    b.periods = head.period_list; b.templates = {}; b.values = {}; b.loaded = {};
    b.defs = {atlas: head.defs.atlas, extra: head.defs.extra, fonts_css: ""};
    return b;
  }
  function addPeriod(b, p, chunk) {
    var tb = b.table, t = chunk.template, pick = function (ids) { return ids.map(function (i) { return tb[i]; }); };
    b.templates[p] = {head: pick(t.head), tail: pick(t.tail), fills: pick(t.fills), key: t.key ? [t.key[0], tb[t.key[1]]] : null, themes: t.themes};
    b.values[p] = chunk.values; b.loaded[p] = true;
  }

  // THE BAR RACE (look.bars_apply): a copy of a bars-rules bundle with the look applied; look = {bar: [r,g,b], page: [r,g,b], theme: name}.
  // scene.look_themes (look.bars_with_themes) holds the other themes' colour tables. Feed the result to scene-draw.js as before.
  function rgbStr(c) { return "rgb(" + Math.trunc(c[0]) + "," + Math.trunc(c[1]) + "," + Math.trunc(c[2]) + ")"; }
  function subStrings(o, fn) {
    if (typeof o === "string") { return fn(o); }
    if (Array.isArray(o)) { return o.map(function (x) { return subStrings(x, fn); }); }
    if (o && typeof o === "object") { var r = {}; Object.keys(o).forEach(function (k) { r[k] = subStrings(o[k], fn); }); return r; }
    return o;
  }
  function barsApply(scene, look) {
    look = look || {};
    var out = JSON.parse(JSON.stringify(scene)), sub = {}, themes = scene.look_themes || {};
    if (look.theme !== undefined && look.theme !== null) {
      if (!Object.prototype.hasOwnProperty.call(themes, look.theme)) { throw new Error("theme " + JSON.stringify(look.theme) + " is not in this bundle (have " + JSON.stringify(Object.keys(themes).sort()) + ")"); }
      Object.keys(themes[look.theme]).forEach(function (k) { sub[k] = themes[look.theme][k]; });
    }
    if (look.page !== undefined && look.page !== null) { sub[rgbStr(scene.rules.page)] = rgbStr(look.page); }
    var fn = function (t) { return t.replace(/rgb\(\d+,\d+,\d+\)/g, function (m) { return Object.prototype.hasOwnProperty.call(sub, m) ? sub[m] : m; }); };
    out.static.chrome = fn(out.static.chrome); out.static.head = fn(out.static.head);
    out.years = subStrings(out.years, fn);
    ["ink", "ink2", "outline", "fill", "page"].forEach(function (k) {
      var key = rgbStr(scene.rules[k]);
      if (Object.prototype.hasOwnProperty.call(sub, key)) { out.rules[k] = (sub[key].match(/\d+/g) || []).map(Number).concat([255]); }
    });
    if (look.bar !== undefined && look.bar !== null) { out.rules.fill = [Math.trunc(look.bar[0]), Math.trunc(look.bar[1]), Math.trunc(look.bar[2]), 255]; }
    return out;
  }

  var api = {draw: draw, barsApply: barsApply, progressive: progressive, addPeriod: addPeriod, drawAt: drawAt, drawFrame: drawAt, marks: marks, describe: describe, lookFromStory: lookFromStory, frameAt: frameAt, locate: locate, unpack: unpack, document: document_, fillColour: fillColour, keyColour: keyColour, metalGroups: metalGroups, nn: nn};
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  root.RyagramLook = api;
})(typeof window !== "undefined" ? window : globalThis);
