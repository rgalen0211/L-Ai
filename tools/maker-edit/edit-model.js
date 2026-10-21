// The edit list of a clip film and everything the edit page can do to it (NEXT-WEB 120; the page is tools/maker-edit/edit.js).
// Pure functions, no DOM and no network: the same file runs in the browser page and under node, so a test can say exactly what a given second of the film shows.
//   edit.json ("ryagram.maker-edit/0"): the clips in order (file NAME, in, out, the words each says), the joins, the pictures (name + SHA-256, never a path), the rules
//   "every time <phrase> is said, show <picture> for <N> seconds", free text, captions, and the look. Paths stay on the person's PC (the host maps an id to a file).
//   One overlay spec, two drawers: specs() is the one list; the browser draws it with CSS, the final render draws the same list with ffmpeg (ENGINE's finishing pass).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ryagramEditModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 'ryagram.maker-edit/0';
  const MIN_CLIP_S = 0.3;
  const MODES = ['full', 'centre', 'corner', 'lower_third'];
  const GEOMETRY = {                                     // where a picture sits, in the film's own 0..1 coordinates
    full: { x: 0, y: 0, w: 1, h: 1 },
    centre: { x: 0.25, y: 0.2, w: 0.5, h: 0.6 },
    corner: { x: 0.72, y: 0.05, w: 0.23, h: 0.26 },
    lower_third: { x: 0.08, y: 0.66, w: 0.84, h: 0.26 },
  };
  const TEXT_POSITIONS = { top: { x: 0.08, y: 0.06, w: 0.84, h: 0.14 }, centre: { x: 0.08, y: 0.43, w: 0.84, h: 0.14 }, bottom: { x: 0.08, y: 0.8, w: 0.84, h: 0.14 }, lower_third: { x: 0.08, y: 0.68, w: 0.84, h: 0.14 } };
  const CAPTION_BOX = { bottom: { x: 0.06, y: 0.82, w: 0.88, h: 0.12 }, top: { x: 0.06, y: 0.06, w: 0.88, h: 0.12 } };
  const CAPTION_WORDS = 7;                               // a caption line holds at most this many words
  const SIZES = ['small', 'medium', 'large'];
  const THEMES = {                                       // dark by default; slides and cards follow the film's theme (RULINGS 10-19 15:50 and 10-20 12:01)
    dark: { text_color: '#f3f6f5', box_color: '#000000', box_opacity: 0.6, letterbox: '#0b0f0e' },
    light: { text_color: '#10201c', box_color: '#ffffff', box_opacity: 0.75, letterbox: '#f4f6f5' },
  };
  const PALETTE = ['#f3f6f5', '#fff3b0', '#9fe8d6', '#ffb4a8', '#10201c', '#0b3d5c', '#000000', '#ffffff'];   // the small set the Look tab offers

  // ONE shared editing workspace for every kind of film (Claude 13:12): what the page offers is switched on and off by the film's mode.
  // Only the compilation mode exists today; the data-film mode is declared so the page is built to that shape, and is refused until it is built.
  const FILM_MODES = {
    compilation: { label: 'Compilation', available: true, features: { clips: true, slides: true, rules: true, captions: true, text: true, look: true } },
    data: { label: 'Data film', available: false, features: { clips: false, slides: false, rules: false, captions: false, text: true, look: true } },
  };
  const features = mode => (FILM_MODES[mode] || FILM_MODES.compilation).features;
  class EditError extends Error { }
  const fail = m => { throw new EditError(m); };

  const round = (x, n) => { const k = Math.pow(10, n || 3); return Math.round(x * k) / k; };
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  const safeName = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\\/:*?"<>|\u0000-\u001f]/.test(v);   // a file NAME, never a path
  const safeRel = v => typeof v === 'string' && v.length > 0 && v.length <= 260 && !/[*?"<>|:\u0000-\u001f]/.test(v) && !/^[\\/]/.test(v) && !v.split(/[\\/]/).some(seg => seg === '..' || seg === '' || seg === '.');
  const relName = v => v.replace(/\\/g, '/');
  const words = s => String(s).toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);

  // ---- colour: WCAG contrast, used by the live warning ----
  function lum(hex) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function mixOver(fg, alpha, bg) {
    const f = [1, 3, 5].map(i => parseInt(fg.slice(i, i + 2), 16)), g = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16));
    return '#' + f.map((v, i) => Math.round(v * alpha + g[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
  }

  // ---- normalize: one validated, canonical copy (so the same edit always saves to the same text) ----
  function normalize(src) {
    if (!isObj(src)) fail('That is not an edit list.');
    if (src.schema !== SCHEMA) fail('This edit list is from a different version of the maker.');
    const film = isObj(src.film) ? src.film : {};
    const fw = film.width === undefined ? 1280 : film.width, fh = film.height === undefined ? 720 : film.height, ff = film.fps === undefined ? 30 : film.fps;
    for (const v of [fw, fh, ff]) if (!Number.isInteger(v) || v < 1 || v > 8192) fail('The film size is not valid.');
    const mode = src.mode === undefined ? 'compilation' : src.mode;
    if (!FILM_MODES[mode]) fail('The editor does not know this kind of film.');
    if (!FILM_MODES[mode].available) fail(`Editing a ${FILM_MODES[mode].label.toLowerCase()} here is not built yet.`);
    const out = { schema: SCHEMA, mode, film: { width: fw, height: fh, fps: ff }, seq: 0, clips: [], images: [], rules: [], texts: [], captions: null, look: null, music: null };
    out.seq = Number.isInteger(src.seq) && src.seq >= 0 ? src.seq : 0;

    if (!Array.isArray(src.clips) || src.clips.length < 1) fail('The film has no clips.');
    if (src.clips.length > 500) fail('That is more clips than the maker can edit at once (500).');
    const seen = new Set();
    src.clips.forEach((c, i) => {
      if (!isObj(c)) fail(`Clip ${i + 1} is not valid.`);
      if (typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(c.id) || seen.has(c.id)) fail(`Clip ${i + 1} has a missing or repeated id.`);
      seen.add(c.id);
      if (!safeRel(c.file_name)) fail(`Clip ${i + 1} must name its video file by name, or by a folder-relative name, never by a full path.`);
      if (typeof c.in_s !== 'number' || typeof c.out_s !== 'number' || !isFinite(c.in_s) || !isFinite(c.out_s) || c.in_s < 0) fail(`Clip ${i + 1} has a start or end that is not a time.`);
      const ins = round(c.in_s), outs = round(c.out_s);
      if (outs - ins < MIN_CLIP_S - 1e-9) fail(`A clip must stay at least ${MIN_CLIP_S} seconds long.`);
      const ws = (Array.isArray(c.words) ? c.words : []).map(w => {
        if (!isObj(w) || typeof w.w !== 'string' || !w.w.trim() || w.w.length > 60 || typeof w.s !== 'number' || typeof w.e !== 'number' || !(w.e >= w.s) || w.s < 0) fail(`A word in clip ${i + 1} has a time that is not valid.`);
        return { w: w.w, s: round(w.s), e: round(w.e) };
      }).sort((a, b) => a.s - b.s);
      let slide = null;
      if (c.slide !== undefined && c.slide !== null) {
        if (!isObj(c.slide) || typeof c.slide.image_id !== 'string') fail(`Slide ${i + 1} must name its picture.`);
        if (ins !== 0) fail('A slide always starts at 0 seconds; change how long it stays with its end.');
        if (outs > 10) fail('A slide stays up to 10 seconds.');
        slide = { image_id: c.slide.image_id };
      }
      let join = null;
      if (c.join !== undefined && c.join !== null) {
        if (!isObj(c.join) || !['cut', 'crossfade'].includes(c.join.kind)) fail(`The join after clip ${i + 1} must be a cut or a crossfade.`);
        const js = c.join.kind === 'crossfade' ? round(typeof c.join.s === 'number' ? c.join.s : 0.3) : 0;
        if (js < 0 || js > 2) fail('A crossfade is between 0 and 2 seconds.');
        join = { kind: c.join.kind, s: js };
      }
      const clip = { id: c.id, file_name: relName(c.file_name), in_s: ins, out_s: outs, words: slide ? [] : ws, join: join || { kind: 'cut', s: 0 } };
      if (slide) clip.slide = slide;
      out.clips.push(clip);
    });

    const imgIds = new Set();
    (Array.isArray(src.images) ? src.images : []).forEach(m => {
      if (!isObj(m) || typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(m.id) || imgIds.has(m.id)) fail('A picture has a missing or repeated id.');
      imgIds.add(m.id);
      if (!safeName(m.file_name)) fail('A picture must be named by file name only, not by path.');
      if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) fail(`${m.file_name} has no valid fingerprint (SHA-256).`);
      if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1) fail(`${m.file_name} has no valid size.`);
      out.images.push({ id: m.id, file_name: m.file_name, sha256: m.sha256, width: m.width, height: m.height, rights_ticked: m.rights_ticked === true });
    });

    if (out.clips.filter(c => c.slide).length > 10) fail('A film can have up to 10 slides.');
    out.clips.forEach((c, i) => {
      if (!c.slide) return;
      const m = out.images.find(x => x.id === c.slide.image_id);
      if (!m) fail(`Slide ${i + 1} uses a picture that is not in this film.`);
      if (c.file_name !== m.file_name) fail(`Slide ${i + 1} must be named after its picture.`);
    });

    const ruleIds = new Set();
    (Array.isArray(src.rules) ? src.rules : []).forEach(r => {
      if (!isObj(r) || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id) || ruleIds.has(r.id)) fail('A rule has a missing or repeated id.');
      ruleIds.add(r.id);
      if (typeof r.phrase !== 'string' || r.phrase.length > 200 || !words(r.phrase).length) fail('A rule needs the words to listen for.');
      if (!imgIds.has(r.image_id)) fail(`The rule for "${String(r.phrase).slice(0, 40)}" uses a picture that is not in this film.`);
      const secs = round(typeof r.seconds === 'number' ? r.seconds : 2);
      if (!(secs >= 0.5 && secs <= 10)) fail('A picture stays on screen between 0.5 and 10 seconds.');
      if (!MODES.includes(r.mode)) fail('Choose where the picture sits: full frame, centre, corner or lower third.');
      const fade = round(typeof r.fade_s === 'number' ? r.fade_s : 0.2);
      if (!(fade >= 0 && fade <= 1) || fade > secs / 2 + 1e-9) fail('The fade must be between 0 and 1 second, and at most half the time the picture stays.');
      out.rules.push({ id: r.id, phrase: r.phrase.trim().replace(/\s+/g, ' '), image_id: r.image_id, seconds: secs, mode: r.mode, fade_s: fade });
    });

    const textIds = new Set();
    (Array.isArray(src.texts) ? src.texts : []).forEach(t => {
      if (!isObj(t) || typeof t.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(t.id) || textIds.has(t.id)) fail('A text has a missing or repeated id.');
      textIds.add(t.id);
      if (typeof t.text !== 'string' || !t.text.trim() || t.text.length > 200) fail('A text needs 1 to 200 characters.');
      if (typeof t.start_s !== 'number' || !(t.start_s >= 0)) fail('A text starts at a time of 0 or more.');
      const len = round(typeof t.length_s === 'number' ? t.length_s : 3);
      if (!(len >= 0.5 && len <= 60)) fail('A text stays on screen between 0.5 and 60 seconds.');
      if (!TEXT_POSITIONS[t.position]) fail('Choose where the text sits: top, centre, bottom or lower third.');
      out.texts.push({ id: t.id, text: t.text.replace(/\s+/g, ' ').trim(), start_s: round(t.start_s), length_s: len, position: t.position });
    });

    const cap = isObj(src.captions) ? src.captions : {};
    const cpos = cap.position === undefined ? 'bottom' : cap.position, csize = cap.size === undefined ? 'medium' : cap.size;
    if (!CAPTION_BOX[cpos]) fail('Captions sit at the top or the bottom.');
    if (!SIZES.includes(csize)) fail('Caption size is small, medium or large.');
    out.captions = { on: cap.on === true, size: csize, position: cpos };

    const lk = isObj(src.look) ? src.look : {};
    const theme = lk.theme === undefined ? 'dark' : lk.theme;
    if (!THEMES[theme]) fail('The look is dark or light.');
    const d = THEMES[theme];
    const look = { theme, text_color: lk.text_color === undefined ? d.text_color : lk.text_color, box_color: lk.box_color === undefined ? d.box_color : lk.box_color,
      box_opacity: lk.box_opacity === undefined ? d.box_opacity : lk.box_opacity, letterbox: lk.letterbox === undefined ? d.letterbox : lk.letterbox };
    if (!isHex(look.text_color) || !isHex(look.box_color) || !isHex(look.letterbox)) fail('Colours are six-digit codes like #10201c.');
    if (typeof look.box_opacity !== 'number' || !(look.box_opacity >= 0 && look.box_opacity <= 1)) fail('The caption box is between 0 and 1.');
    look.text_color = look.text_color.toLowerCase(); look.box_color = look.box_color.toLowerCase(); look.letterbox = look.letterbox.toLowerCase(); look.box_opacity = round(look.box_opacity, 2);
    out.look = look;
    if (src.music !== undefined && src.music !== null) fail('Music is not in this version of the maker yet.');
    return out;
  }

  // ---- the clock: where each clip sits in the FINISHED film, and where each word lands ----
  function timeline(edit) {
    const items = [];
    let at = 0, prev = null;
    for (const c of edit.clips) {
      const start = prev ? round(at - (prev.join.kind === 'crossfade' ? prev.join.s : 0)) : 0;
      const len = round(c.out_s - c.in_s);
      const ws = c.words.filter(w => w.s >= c.in_s - 1e-6 && w.e <= c.out_s + 1e-6).map(w => ({ w: w.w, s: round(start + w.s - c.in_s), e: round(start + w.e - c.in_s) }));
      items.push({ id: c.id, file_name: c.file_name, start_s: start, end_s: round(start + len), length_s: len, words: ws, slide: c.slide ? c.slide.image_id : null });
      at = start + len; prev = c;
    }
    return { clips: items, total_s: items.length ? items[items.length - 1].end_s : 0 };
  }

  // ---- "every time <phrase> is said": found in the words of the BUILT film, across clip borders too ----
  function occurrences(edit, phrase, tl) {
    const want = words(phrase);
    if (!want.length) return [];
    const flat = [];
    (tl || timeline(edit)).clips.forEach(c => c.words.forEach(w => flat.push({ n: words(w.w).join(''), s: w.s, e: w.e })));
    flat.sort((a, b) => a.s - b.s || a.e - b.e);
    const found = [];
    for (let i = 0; i + want.length <= flat.length; i++) {
      let ok = true;
      for (let j = 0; j < want.length; j++) if (flat[i + j].n !== want[j]) { ok = false; break; }
      if (ok) { found.push({ at_s: flat[i].s, end_s: flat[i + want.length - 1].e }); i += want.length - 1; }
    }
    return found;
  }

  // ---- the one overlay spec list ----
  function specs(edit) {
    const tl = timeline(edit), total = tl.total_s, out = [];
    for (const r of edit.rules) {
      const img = edit.images.find(m => m.id === r.image_id);
      if (!img || !img.rights_ticked) continue;                                  // without the tick the picture never draws
      const g = GEOMETRY[r.mode];
      occurrences(edit, r.phrase, tl).forEach((o, k) => {
        const len = round(Math.min(r.seconds, total - o.at_s));
        if (len > 0) out.push({ id: `${r.id}#${k + 1}`, kind: 'image', source: img.id, text: null, start_s: o.at_s, length_s: len, x: g.x, y: g.y, w: g.w, h: g.h, fade_s: Math.min(r.fade_s, len / 2), z: 1 });
      });
    }
    tl.clips.forEach(c => {
      if (!c.slide) return;
      const img = edit.images.find(m => m.id === c.slide), g = GEOMETRY.full;
      if (!img || !img.rights_ticked) return;                                    // without the tick the slide shows nothing
      out.push({ id: `slide-${c.id}`, kind: 'image', source: img.id, text: null, start_s: c.start_s, length_s: c.length_s, x: g.x, y: g.y, w: g.w, h: g.h, fade_s: Math.min(0.2, c.length_s / 2), z: 1 });
    });
    if (edit.captions.on) {
      const box = CAPTION_BOX[edit.captions.position];
      tl.clips.forEach(c => {
        for (let i = 0; i < c.words.length; i += CAPTION_WORDS) {
          const part = c.words.slice(i, i + CAPTION_WORDS);
          out.push({ id: `cap-${c.id}-${i / CAPTION_WORDS + 1}`, kind: 'caption', source: null, text: part.map(w => w.w).join(' '), start_s: part[0].s, length_s: round(part[part.length - 1].e - part[0].s + 0.15), x: box.x, y: box.y, w: box.w, h: box.h, fade_s: 0, z: 2 });
        }
      });
    }
    for (const t of edit.texts) {
      const g = TEXT_POSITIONS[t.position], len = round(Math.min(t.length_s, Math.max(0, total - t.start_s)));
      if (len > 0) out.push({ id: t.id, kind: 'text', source: null, text: t.text, start_s: t.start_s, length_s: len, x: g.x, y: g.y, w: g.w, h: g.h, fade_s: 0, z: 3 });
    }
    return out.sort((a, b) => a.start_s - b.start_s || a.z - b.z || (a.id < b.id ? -1 : 1));
  }

  // what is on screen at time t: the same answer the page draws and a test can compare
  function frameAt(edit, t, pre) {
    const tl = pre ? pre.tl : timeline(edit), sp = pre ? pre.specs : specs(edit);
    const tt = round(Math.max(0, Math.min(t, tl.total_s)));
    let clip = null;
    for (const c of tl.clips) if (tt >= c.start_s - 1e-9 && tt < c.end_s - 1e-9) clip = c;
    if (!clip && tl.clips.length) clip = tl.clips[tl.clips.length - 1];
    const active = [];
    for (const s of sp) {
      if (tt + 1e-9 < s.start_s || tt >= s.start_s + s.length_s - 1e-9) continue;
      let op = 1;
      if (s.fade_s > 0) op = Math.max(0, Math.min(1, (tt - s.start_s) / s.fade_s, (s.start_s + s.length_s - tt) / s.fade_s));
      active.push({ id: s.id, kind: s.kind, source: s.source, text: s.text, x: s.x, y: s.y, w: s.w, h: s.h, opacity: round(op) });
    }
    const word = clip ? clip.words.find(w => tt >= w.s - 1e-9 && tt < w.e) : null;
    return { t: tt, clip: clip ? clip.id : null, word: word ? word.w : null, look: edit.look, captions: { size: edit.captions.size }, active };
  }

  // ---- live warnings: warn, never block ----
  const mmss = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  function warnings(edit) {
    const w = [], tl = timeline(edit), sp = specs(edit);
    for (const r of edit.rules) {
      const img = edit.images.find(m => m.id === r.image_id);
      const occ = occurrences(edit, r.phrase, tl);
      if (!occ.length) w.push({ where: r.id, text: `"${r.phrase}" is not said in this film, so that picture will not show.` });
      if (img && !img.rights_ticked) w.push({ where: r.id, text: `Tick "I have the right to use this picture" for ${img.file_name}, or the rule for "${r.phrase}" will not show it.` });
    }
    for (const c of edit.clips) {
      if (!c.slide) continue;
      const img = edit.images.find(m => m.id === c.slide.image_id);
      if (img && !img.rights_ticked) w.push({ where: c.id, text: `Tick "I have the right to use this picture" for ${img.file_name}, or its slide will show nothing.` });
    }
    const imgs = sp.filter(s => s.kind === 'image');
    for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) {
      const a = imgs[i], b = imgs[j];
      const t0 = Math.max(a.start_s, b.start_s), t1 = Math.min(a.start_s + a.length_s, b.start_s + b.length_s);
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (t1 > t0 && ix > 0 && iy > 0 && ix * iy > 0.25 * Math.min(a.w * a.h, b.w * b.h)) { w.push({ where: a.id.split('#')[0], text: `Two pictures are on screen on top of each other at ${mmss(t0)}.` }); }
    }
    for (const t of edit.texts) {
      if (t.start_s >= tl.total_s) w.push({ where: t.id, text: `The text "${t.text.slice(0, 30)}" starts after the film has ended.` });
      else if (t.start_s + t.length_s > tl.total_s + 1e-9) w.push({ where: t.id, text: `The text "${t.text.slice(0, 30)}" runs past the end of the film; it will be cut off.` });
      for (const c of sp.filter(s => s.kind === 'caption' && edit.captions.on)) {
        const ix = Math.min(c.x + c.w, TEXT_POSITIONS[t.position].x + TEXT_POSITIONS[t.position].w) - Math.max(c.x, TEXT_POSITIONS[t.position].x), iy = Math.min(c.y + c.h, TEXT_POSITIONS[t.position].y + TEXT_POSITIONS[t.position].h) - Math.max(c.y, TEXT_POSITIONS[t.position].y);
        if (ix > 0 && iy > 0 && Math.min(c.start_s + c.length_s, t.start_s + t.length_s) > Math.max(c.start_s, t.start_s)) { w.push({ where: t.id, text: `The text "${t.text.slice(0, 30)}" sits on the captions at ${mmss(Math.max(c.start_s, t.start_s))}. Move it to another place.` }); break; }
      }
    }
    if (edit.captions.on || edit.texts.length) {
      const box = mixOver(edit.look.box_color, edit.look.box_opacity, edit.look.letterbox);
      const ratio = contrast(edit.look.text_color, box);
      if (ratio < 4.5) w.push({ where: 'look', text: `Caption and text colours are hard to read together (contrast ${ratio.toFixed(1)}; aim for 4.5 or more).` });
    }
    edit.clips.forEach((c, i) => { if (!c.slide && c.out_s - c.in_s < 0.5) w.push({ where: c.id, text: `Clip ${i + 1} is very short (${(c.out_s - c.in_s).toFixed(1)} s).` }); });
    return w;
  }

  // ---- the edits: each returns a NEW, validated edit list, or says in plain words why not ----
  const nextId = (edit, prefix) => { const n = edit.seq + 1; return { id: `${prefix}${n}`, seq: n }; };
  const clone = e => JSON.parse(JSON.stringify(e));
  const clipIndex = (edit, id) => { const i = edit.clips.findIndex(c => c.id === id); if (i < 0) fail('That clip is not in the film any more.'); return i; };
  const need = (edit, feature, what) => { if (!features(edit.mode)[feature]) fail(`This kind of film does not use ${what}.`); };
  const ops = {
    moveClip(edit, id, dir) {
      need(edit, 'clips', 'clips');
      const e = clone(edit), i = clipIndex(e, id), j = i + (dir < 0 ? -1 : 1);
      if (j < 0 || j >= e.clips.length) fail(dir < 0 ? 'That clip is already first.' : 'That clip is already last.');
      [e.clips[i], e.clips[j]] = [e.clips[j], e.clips[i]];
      return normalize(e);
    },
    removeClip(edit, id) {
      need(edit, 'clips', 'clips');
      const e = clone(edit), i = clipIndex(e, id);
      if (e.clips.length === 1) fail('A film needs at least one clip.');
      e.clips.splice(i, 1);
      return normalize(e);
    },
    nudge(edit, id, side, delta) {                                               // side: 'in' or 'out'; delta in seconds (0.1 steps)
      const e = clone(edit), c = e.clips[clipIndex(e, id)];
      if (side === 'in') c.in_s = round(c.in_s + delta); else if (side === 'out') c.out_s = round(c.out_s + delta); else fail('Nudge the start or the end.');
      if (c.in_s < 0) fail('That clip cannot start before its video begins.');
      return normalize(e);
    },
    addSlide(edit, s) {                                                                   // a picture that is its own stretch of the film, after a clip (or first)
      need(edit, 'slides', 'slides');
      const e = clone(edit), m = e.images.find(x => x.id === s.image_id); if (!m) fail('Choose a picture for the slide first.');
      const n = nextId(e, 's'); e.seq = n.seq;
      const at = s.after === null || s.after === undefined ? 0 : s.after === 'end' ? e.clips.length : clipIndex(e, s.after) + 1;
      e.clips.splice(at, 0, { id: n.id, file_name: m.file_name, in_s: 0, out_s: s.seconds === undefined ? 3 : s.seconds, words: [], slide: { image_id: m.id }, join: { kind: 'cut', s: 0 } });
      return normalize(e);
    },
    addImage(edit, img) {
      const e = clone(edit), n = nextId(e, 'img'); e.seq = n.seq;
      e.images.push({ id: img.id || n.id, file_name: img.file_name, sha256: img.sha256, width: img.width, height: img.height, rights_ticked: img.rights_ticked === true });
      return normalize(e);
    },
    setRights(edit, imageId, ticked) {
      const e = clone(edit), m = e.images.find(x => x.id === imageId); if (!m) fail('That picture is not in this film.');
      m.rights_ticked = ticked === true; return normalize(e);
    },
    removeImage(edit, imageId) {
      const e = clone(edit);
      if (e.rules.some(r => r.image_id === imageId)) fail('A rule still uses that picture. Remove the rule first.');
      if (e.clips.some(c => c.slide && c.slide.image_id === imageId)) fail('A slide still uses that picture. Take the slide out first.');
      e.images = e.images.filter(m => m.id !== imageId); return normalize(e);
    },
    addRule(edit, r) {
      need(edit, 'rules', 'rules');
      const e = clone(edit), n = nextId(e, 'r'); e.seq = n.seq;
      e.rules.push({ id: n.id, phrase: r.phrase, image_id: r.image_id, seconds: r.seconds === undefined ? 2 : r.seconds, mode: r.mode || 'full', fade_s: r.fade_s === undefined ? 0.2 : r.fade_s });
      return normalize(e);
    },
    removeRule(edit, id) { const e = clone(edit); if (!e.rules.some(r => r.id === id)) fail('That rule is not in the film.'); e.rules = e.rules.filter(r => r.id !== id); return normalize(e); },
    addText(edit, t) {
      need(edit, 'text', 'free text');
      const e = clone(edit), n = nextId(e, 't'); e.seq = n.seq;
      e.texts.push({ id: n.id, text: t.text, start_s: t.start_s, length_s: t.length_s === undefined ? 3 : t.length_s, position: t.position || 'lower_third' });
      return normalize(e);
    },
    removeText(edit, id) { const e = clone(edit); if (!e.texts.some(t => t.id === id)) fail('That text is not in the film.'); e.texts = e.texts.filter(t => t.id !== id); return normalize(e); },
    setCaptions(edit, patch) { need(edit, 'captions', 'captions'); const e = clone(edit); Object.assign(e.captions, patch); return normalize(e); },
    setLook(edit, patch) {
      const e = clone(edit);
      if (patch.theme && patch.theme !== e.look.theme) e.look = { theme: patch.theme };           // a theme switch brings that theme's own colours
      Object.assign(e.look, patch);
      return normalize(e);
    },
  };

  // ---- save and open: stable text, so the same edit always saves the same bytes ----
  const stringify = edit => JSON.stringify(normalize(edit), null, 2) + '\n';
  const parse = text => { let v; try { v = JSON.parse(text); } catch (e) { fail('That file is not an edit list.'); } return normalize(v); };

  return { SCHEMA, FILM_MODES, features, MIN_CLIP_S, MODES, SIZES, THEMES, PALETTE, TEXT_POSITIONS, GEOMETRY, CAPTION_BOX, EditError, normalize, timeline, occurrences, specs, frameAt, warnings, ops, stringify, parse, contrast, mixOver, words, mmss };
}));
