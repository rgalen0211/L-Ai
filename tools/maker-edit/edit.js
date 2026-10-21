// The edit-and-preview space for a clip film (NEXT-WEB 120). The AI / Plan makes the rough cut; the person lands here, scrubs every moment, adds pictures and text,
// changes the look, reorders and trims, and only then presses Render. Everything on this page is drawn in the browser from the edit list (edit-model.js): free,
// instant, no re-encode. The real render stays the authority and runs only on the press of Render.
// The page talks to its host through ONE small object (see docs/maker-edit-host-contract.md): load / save / proxy / rebuildProxy / pickImage / imageUrl / render / back.
// ?fixture uses a made-up cut with no maker behind it. No innerHTML anywhere: every word on the page is a text node.
(function () {
  'use strict';
  const M = window.ryagramEditModel;

  // ---- the host: the practice cut, or the maker's local server (same token the maker page uses) ----
  function apiHost() {
    const token = new URLSearchParams(location.search).get('t') || (function () { try { return sessionStorage.getItem('maker-token') || ''; } catch (e) { return ''; } }());
    try { sessionStorage.setItem('maker-token', token); } catch (e) { /* works without it */ }
    const call = async (path, body) => {
      const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Maker-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The maker did not answer. Is it still open?');
      return j;
    };
    return {
      name: 'maker',
      async load() { return (await call('/api/edit')).edit; },
      async save(text) { return call('/api/edit', { edit: JSON.parse(text) }); },
      async proxy() { return call('/api/edit/proxy'); },
      async rebuildProxy(edit) { return call('/api/edit/proxy', { edit }); },
      async pickImage() { return call('/api/image/pick', {}); },
      imageUrl(id) { return `/api/image/file?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`; },
      async render(edit) { return call('/api/edit/render', { edit }); },
      back() { location.href = '/?t=' + encodeURIComponent(token); return true; },
    };
  }
  const host = new URLSearchParams(location.search).has('fixture') ? window.ryagramEditFixtureHost : apiHost();

  const S = { edit: null, undo: [], t: 0, playing: false, tab: 'clips', sel: null, proxy: { state: 'ready', url: null }, msg: '', dirty: false, rendering: false, savedAt: null, note: '' };
  const $ = id => document.getElementById(id);
  const mm = M.mmss;

  function h(tag, attrs) {
    const el = document.createElement(tag);
    const kids = [];
    for (let i = 1; i < arguments.length; i++) { const a = arguments[i]; if (i === 1 && a && typeof a === 'object' && !(a instanceof Node) && !Array.isArray(a)) continue; kids.push(a); }
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === false || v === null || v === undefined) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'hidden') { if (v) el.setAttribute(k, ''); }
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }
  const say = text => { S.note = text; const n = $('live'); if (n) n.textContent = text; };
  const err = text => { S.msg = text; const n = $('msg'); if (n) n.textContent = text; };

  // ---- applying an edit: validated by the model, remembered for Undo, preview refreshed ----
  const clipSig = e => JSON.stringify(e.clips.map(c => [c.id, c.in_s, c.out_s, c.join]));
  function apply(fn, said) {
    try {
      const before = S.edit, next = fn(before);
      S.undo.push(before); if (S.undo.length > 100) S.undo.shift();
      S.edit = next; S.dirty = true; err(''); if (said) say(said);
      if (clipSig(before) !== clipSig(next)) refreshProxy();
      S.t = Math.min(S.t, M.timeline(S.edit).total_s);
      redraw();
    } catch (e) {
      if (e instanceof M.EditError) { err(e.message); redrawPanelsKeepFocus(); } else throw e;
    }
  }
  async function refreshProxy() {
    S.proxy = { state: 'updating', url: S.proxy.url }; drawStatus();
    try { S.proxy = await host.rebuildProxy(S.edit); } catch (e) { S.proxy = { state: 'failed', url: null }; err(e.message); }
    drawStatus(); drawStage();
  }
  const total = () => M.timeline(S.edit).total_s;

  // ---- the stage: the picture, its overlays, the scrubber ----
  let clock = null;
  function setT(t, fromVideo) {
    S.t = Math.max(0, Math.min(total(), Math.round(t * 1000) / 1000));
    const r = $('scrub'); if (r) { r.value = String(S.t); r.setAttribute('aria-valuetext', `${mm(S.t)} of ${mm(total())}`); }
    const v = document.querySelector('.film video');
    if (v && !fromVideo && Math.abs(v.currentTime - S.t) > 0.05) v.currentTime = S.t;
    drawFrame();
  }
  function play(on) {
    S.playing = on;
    if (clock) { cancelAnimationFrame(clock); clock = null; }
    const v = document.querySelector('.film video');
    if (on) {
      if (S.t >= total() - 0.05) setT(0);
      const v0 = performance.now(), t0 = S.t;
      if (v) v.play().catch(() => {});
      const tick = now => {
        if (!S.playing) return;
        const t = v ? v.currentTime : t0 + (now - v0) / 1000;
        if (t >= total()) { setT(total()); play(false); return; }
        setT(t, !!v); clock = requestAnimationFrame(tick);
      };
      clock = requestAnimationFrame(tick);
    } else if (v) v.pause();
    const b = $('play'); if (b) { b.textContent = on ? 'Pause' : 'Play'; b.setAttribute('aria-pressed', String(on)); }
  }
  function drawFrame() {
    const film = document.querySelector('.film'); if (!film) return;
    const f = M.frameAt(S.edit, S.t, S.pre);
    film.style.setProperty('--u', (film.clientWidth / 100) + 'px');
    film.style.background = S.edit.look.letterbox;
    const layer = film.querySelector('.layer'), look = S.edit.look, sizeU = { small: 2.6, medium: 3.6, large: 4.8 }[S.edit.captions.size];
    layer.replaceChildren();
    for (const o of f.active) {
      const box = h('div', { class: 'ov ' + (o.kind === 'caption' ? 'cap' : ''), 'data-kind': o.kind, 'data-id': o.id });
      box.style.left = (o.x * 100) + '%'; box.style.top = (o.y * 100) + '%'; box.style.width = (o.w * 100) + '%'; box.style.height = (o.h * 100) + '%'; box.style.opacity = String(o.opacity);
      if (o.kind === 'image') {
        const url = host.imageUrl(o.source);
        if (url) { const im = h('img', { alt: '', src: url }); box.append(im); }
      } else {
        box.append(o.text);
        box.style.color = look.text_color; box.style.fontSize = `calc(var(--u,8px) * ${sizeU})`;
        if (o.kind === 'caption' || o.kind === 'text') { box.style.background = hexA(look.box_color, look.box_opacity); box.style.borderRadius = 'calc(var(--u,8px) * .8)'; }
      }
      layer.append(box);
    }
    const stand = film.querySelector('.standin');
    if (stand) {
      stand.style.color = look.text_color;
      stand.querySelector('.big').textContent = f.word || '';
      stand.querySelector('.small').textContent = f.clip ? `Practice picture: ${S.edit.clips.find(c => c.id === f.clip).file_name}` : '';
    }
    const tt = $('time'); if (tt) tt.textContent = `${mm(S.t)} / ${mm(total())}`;
    document.querySelectorAll('ol.strip button.card').forEach(b => b.classList.toggle('now', b.dataset.id === f.clip));
  }
  const hexA = (hex, a) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

  function drawStage() {
    const e = S.edit, tl = M.timeline(e), box = $('stage'); box.replaceChildren();
    const film = h('div', { class: 'film', role: 'img', 'aria-label': 'The film preview' });
    film.style.aspectRatio = `${e.film.width} / ${e.film.height}`;
    if (S.proxy.url) { const v = h('video', { src: S.proxy.url, preload: 'auto', muted: true, playsinline: true, 'aria-hidden': 'true' }); v.muted = true; film.append(v); }
    else film.append(h('div', { class: 'standin' }, h('div', { class: 'big' }), h('div', { class: 'small' })));
    film.append(h('div', { class: 'layer' }));
    const scrub = h('input', { id: 'scrub', type: 'range', min: '0', max: String(tl.total_s), step: '0.1', value: String(S.t), 'aria-label': 'Position in the film', 'aria-valuetext': `${mm(S.t)} of ${mm(tl.total_s)}`,
      oninput: ev => { play(false); setT(parseFloat(ev.target.value)); } });
    const marks = h('div', { class: 'marks', 'aria-hidden': 'true' });
    const pct = s => (tl.total_s ? (s / tl.total_s) * 100 : 0) + '%';
    tl.clips.forEach(c => { const m = h('span', { class: 'm-clip' }); m.style.left = pct(c.start_s); marks.append(m); });
    for (const s of S.pre.specs) { if (s.kind === 'caption') continue; const m = h('span', { class: s.kind === 'image' ? 'm-img' : 'm-txt' }); m.style.left = pct(s.start_s); m.style.width = pct(Math.min(s.length_s, tl.total_s - s.start_s)); marks.append(m); }
    box.append(film, h('div', { class: 'controls' },
      h('button', { id: 'play', type: 'button', class: 'primary', 'aria-pressed': 'false', onclick: () => play(!S.playing) }, 'Play'),
      h('div', { class: 'scrub' }, scrub, marks),
      h('span', { id: 'time', class: 'time', 'aria-hidden': 'true' })));
    if (window.ResizeObserver) new ResizeObserver(() => drawFrame()).observe(film);
    drawFrame();
  }

  // ---- the clip strip ----
  function drawStrip() {
    const tl = M.timeline(S.edit), ol = $('strip'); ol.replaceChildren();
    tl.clips.forEach((c, i) => {
      const src = S.edit.clips[i];
      ol.append(h('li', {}, h('button', { type: 'button', class: 'card', 'data-id': c.id, 'data-key': 'card-' + c.id, 'aria-pressed': String(S.sel === c.id),
        'aria-label': `Clip ${i + 1} of ${tl.clips.length}: ${c.words.map(w => w.w).join(' ') || 'no words'}. ${c.length_s.toFixed(1)} seconds. From ${c.file_name}. Press to choose it.`,
        onclick: () => { S.sel = c.id; setT(c.start_s); say(`Clip ${i + 1} chosen.`); drawStrip(); drawPanels(); } },
        h('span', { class: 'n' }, `${i + 1}  ·  ${mm(c.start_s)}  ·  ${c.length_s.toFixed(1)} s${src.join.kind === 'crossfade' ? '  ·  fades into the next' : ''}`),
        h('span', { class: 'wd' }, c.words.map(w => w.w).join(' ') || '(no words)'),
        h('span', { class: 'fn' }, c.file_name))));
    });
  }

  // ---- the panels ----
  const TABS = [['clips', 'Clips'], ['extras', 'Images and text'], ['look', 'Look']];
  function drawPanels() {
    const p = $('panels'); p.replaceChildren();
    const list = h('div', { role: 'tablist', 'aria-label': 'Edit panels' });
    TABS.forEach(([id, label]) => list.append(h('button', { role: 'tab', id: 'tab-' + id, type: 'button', 'aria-selected': String(S.tab === id), 'aria-controls': 'pane-' + id, tabindex: S.tab === id ? '0' : '-1', 'data-key': 'tab-' + id,
      onclick: () => { S.tab = id; drawPanels(); $('tab-' + id).focus(); },
      onkeydown: ev => { const i = TABS.findIndex(t => t[0] === S.tab); if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); S.tab = TABS[(i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]; drawPanels(); $('tab-' + S.tab).focus(); } } }, label)));
    p.append(list);
    const pane = h('div', { role: 'tabpanel', id: 'pane-' + S.tab, 'aria-labelledby': 'tab-' + S.tab });
    ({ clips: paneClips, extras: paneExtras, look: paneLook })[S.tab](pane);
    p.append(pane, h('p', { id: 'msg', class: 'msg', role: 'alert' }, S.msg));
    drawWarnings();
  }
  function redrawPanelsKeepFocus() {
    const k = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key;
    drawPanels(); if (k) { const el = document.querySelector(`[data-key="${CSS.escape(k)}"]`); if (el) el.focus(); }
  }
  function drawWarnings() {
    const ws = M.warnings(S.edit), ul = $('warns'); ul.replaceChildren();
    ws.forEach(w => ul.append(h('li', {}, w.text)));
    ul.hidden = ws.length === 0;
  }

  function stepButton(label, key, fn) { return h('button', { type: 'button', 'data-key': key, onclick: fn }, label); }
  function paneClips(pane) {
    const c = S.edit.clips.find(x => x.id === S.sel), tl = M.timeline(S.edit);
    if (!c) { pane.append(h('p', {}, 'Choose a clip in the strip above to move it, trim it, or take it out.')); return; }
    const i = S.edit.clips.indexOf(c), t = tl.clips[i];
    pane.append(h('h2', {}, `Clip ${i + 1}: ${t.words.map(w => w.w).join(' ') || '(no words)'}`),
      h('p', { class: 'note' }, `From ${c.file_name}, ${c.in_s.toFixed(1)} s to ${c.out_s.toFixed(1)} s (${t.length_s.toFixed(1)} s long in the film).`),
      h('fieldset', {}, h('legend', {}, 'Trim'), h('div', { class: 'row' },
        stepButton('Start 0.1 s earlier', 'in-', () => apply(e => M.ops.nudge(e, c.id, 'in', -0.1), 'Start moved 0.1 seconds earlier.')),
        stepButton('Start 0.1 s later', 'in+', () => apply(e => M.ops.nudge(e, c.id, 'in', 0.1), 'Start moved 0.1 seconds later.')),
        stepButton('End 0.1 s earlier', 'out-', () => apply(e => M.ops.nudge(e, c.id, 'out', -0.1), 'End moved 0.1 seconds earlier.')),
        stepButton('End 0.1 s later', 'out+', () => apply(e => M.ops.nudge(e, c.id, 'out', 0.1), 'End moved 0.1 seconds later.')))),
      h('fieldset', {}, h('legend', {}, 'Order'), h('div', { class: 'row' },
        h('button', { type: 'button', 'data-key': 'mv-', disabled: i === 0, onclick: () => apply(e => M.ops.moveClip(e, c.id, -1), 'Clip moved earlier in the film.') }, 'Move earlier'),
        h('button', { type: 'button', 'data-key': 'mv+', disabled: i === S.edit.clips.length - 1, onclick: () => apply(e => M.ops.moveClip(e, c.id, 1), 'Clip moved later in the film.') }, 'Move later'),
        h('button', { type: 'button', 'data-key': 'play-clip', onclick: () => { setT(t.start_s); play(true); } }, 'Play this clip'),
        h('button', { type: 'button', 'data-key': 'remove', disabled: S.edit.clips.length === 1, onclick: () => { const nb = S.edit.clips[i + 1] || S.edit.clips[i - 1]; if (nb) S.sel = nb.id; apply(e => M.ops.removeClip(e, c.id), 'Clip taken out of the film.'); } }, 'Take this clip out'))),
      i < S.edit.clips.length - 1 ? h('fieldset', {}, h('legend', {}, 'Join to the next clip'), h('div', { class: 'row' },
        h('label', {}, h('input', { type: 'radio', name: 'join', value: 'cut', checked: c.join.kind === 'cut', onchange: () => apply(e => { const x = JSON.parse(JSON.stringify(e)); x.clips[i].join = { kind: 'cut', s: 0 }; return M.normalize(x); }, 'Join set to a cut.') }), 'Cut'),
        h('label', {}, h('input', { type: 'radio', name: 'join', value: 'crossfade', checked: c.join.kind === 'crossfade', onchange: () => apply(e => { const x = JSON.parse(JSON.stringify(e)); x.clips[i].join = { kind: 'crossfade', s: 0.3 }; return M.normalize(x); }, 'Join set to a short crossfade.') }), 'Short crossfade'))) : null);
  }

  function paneExtras(pane) {
    const e = S.edit, tl = M.timeline(e);
    // pictures
    const pics = h('ul', { class: 'list' });
    e.images.forEach(m => pics.append(h('li', {}, h('strong', {}, m.file_name), ` (${m.width} × ${m.height})`,
      h('label', {}, h('input', { type: 'checkbox', checked: m.rights_ticked, 'data-key': 'rt-' + m.id, onchange: ev => apply(x => M.ops.setRights(x, m.id, ev.target.checked), ev.target.checked ? 'Rights box ticked.' : 'Rights box cleared.') }), 'I have the right to use this picture'),
      h('button', { type: 'button', 'aria-label': `Remove the picture ${m.file_name}`, onclick: () => apply(x => M.ops.removeImage(x, m.id), 'Picture removed.') }, 'Remove'))));
    pane.append(h('fieldset', {}, h('legend', {}, 'Pictures'), pics.children.length ? pics : h('p', { class: 'note' }, 'No pictures yet. Pictures stay on this computer and are only used by the rules below.'),
      h('button', { type: 'button', id: 'add-pic', 'data-key': 'add-pic', onclick: async () => {
        try { const r = await host.pickImage(); if (r && r.image) apply(x => M.ops.addImage(x, r.image), `${r.image.file_name} added. Tick the rights box to use it.`); } catch (er) { err(er.message); redrawPanelsKeepFocus(); }
      } }, 'Add a picture')));
    // rules
    const imgSel = h('select', { id: 'r-img', 'aria-label': 'Picture' }, e.images.map(m => h('option', { value: m.id }, m.file_name)));
    const mode = h('select', { id: 'r-mode', 'aria-label': 'Where it sits' }, [['full', 'full frame'], ['centre', 'centre'], ['corner', 'corner'], ['lower_third', 'lower third']].map(([v, l]) => h('option', { value: v }, l)));
    const form = h('form', { id: 'rule-form', onsubmit: ev => { ev.preventDefault();
      apply(x => M.ops.addRule(x, { phrase: $('r-phrase').value, image_id: $('r-img').value, seconds: parseFloat($('r-secs').value), mode: $('r-mode').value, fade_s: parseFloat($('r-fade').value) }), 'Rule added.'); } },
      h('p', {}, 'Every time ', h('input', { id: 'r-phrase', type: 'text', maxlength: '200', size: '16', 'aria-label': 'Words to listen for', required: true }), ' is said, show ', imgSel, ' for ',
        h('input', { id: 'r-secs', type: 'number', min: '0.5', max: '10', step: '0.5', value: '2', 'aria-label': 'Seconds on screen' }), ' seconds, ', mode, ', fade ',
        h('input', { id: 'r-fade', type: 'number', min: '0', max: '1', step: '0.1', value: '0.2', 'aria-label': 'Fade in seconds' }), ' s. ',
        h('button', { type: 'submit', class: 'primary', disabled: !e.images.length, 'data-key': 'add-rule' }, 'Add this rule')));
    const rules = h('ul', { class: 'list' });
    e.rules.forEach(r => {
      const occ = M.occurrences(e, r.phrase, tl), img = e.images.find(m => m.id === r.image_id);
      rules.append(h('li', {}, h('span', {}, `"${r.phrase}" shows ${img ? img.file_name : 'a picture'} for ${r.seconds} s (${r.mode.replace('_', ' ')}): `),
        h('strong', {}, occ.length ? `${occ.length} time${occ.length === 1 ? '' : 's'}` : 'not said anywhere'),
        occ.map((o, k) => h('button', { type: 'button', 'aria-label': `Go to ${mm(o.at_s)}`, onclick: () => { play(false); setT(o.at_s); } }, mm(o.at_s))),
        h('button', { type: 'button', 'aria-label': `Remove the rule for ${r.phrase}`, onclick: () => apply(x => M.ops.removeRule(x, r.id), 'Rule removed.') }, 'Remove rule')));
    });
    pane.append(h('fieldset', {}, h('legend', {}, 'Rules'), form, rules.children.length ? rules : h('p', { class: 'note' }, 'The words are looked for in the finished film, so a phrase the cut put together from several videos is found too.')));
    // captions
    pane.append(h('fieldset', {}, h('legend', {}, 'Captions'), h('div', { class: 'row' },
      h('label', {}, h('input', { id: 'cap-on', type: 'checkbox', checked: e.captions.on, 'data-key': 'cap-on', onchange: ev => apply(x => M.ops.setCaptions(x, { on: ev.target.checked }), ev.target.checked ? 'Captions on.' : 'Captions off.') }), 'Show the spoken words as captions'),
      h('label', {}, 'Size ', h('select', { id: 'cap-size', 'data-key': 'cap-size', onchange: ev => apply(x => M.ops.setCaptions(x, { size: ev.target.value }), 'Caption size changed.') },
        M.SIZES.map(s => h('option', { value: s, selected: e.captions.size === s }, s)))),
      h('label', {}, 'Place ', h('select', { id: 'cap-pos', 'data-key': 'cap-pos', onchange: ev => apply(x => M.ops.setCaptions(x, { position: ev.target.value }), 'Caption place changed.') },
        ['bottom', 'top'].map(s => h('option', { value: s, selected: e.captions.position === s }, s)))))));
    // text
    const tf = h('form', { id: 'text-form', onsubmit: ev => { ev.preventDefault();
      apply(x => M.ops.addText(x, { text: $('t-text').value, start_s: parseFloat($('t-start').value), length_s: parseFloat($('t-len').value), position: $('t-pos').value }), 'Text added.'); } },
      h('div', { class: 'grid' },
        h('label', {}, 'Text', h('input', { id: 't-text', type: 'text', maxlength: '200', required: true })),
        h('label', {}, 'Starts at (seconds)', h('input', { id: 't-start', type: 'number', min: '0', step: '0.1', value: String(S.t) })),
        h('label', {}, 'Stays (seconds)', h('input', { id: 't-len', type: 'number', min: '0.5', max: '60', step: '0.5', value: '3' })),
        h('label', {}, 'Place', h('select', { id: 't-pos' }, [['lower_third', 'lower third'], ['top', 'top'], ['centre', 'centre'], ['bottom', 'bottom']].map(([v, l]) => h('option', { value: v }, l))))),
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => { $('t-start').value = String(S.t); } }, 'Start where the scrubber is'), h('button', { type: 'submit', class: 'primary', 'data-key': 'add-text' }, 'Add this text')));
    const texts = h('ul', { class: 'list' });
    e.texts.forEach(t => texts.append(h('li', {}, h('span', {}, `"${t.text}" at ${mm(t.start_s)} for ${t.length_s} s (${t.position.replace('_', ' ')})`),
      h('button', { type: 'button', 'aria-label': `Go to the text ${t.text}`, onclick: () => { play(false); setT(t.start_s); } }, 'Go to it'),
      h('button', { type: 'button', 'aria-label': `Remove the text ${t.text}`, onclick: () => apply(x => M.ops.removeText(x, t.id), 'Text removed.') }, 'Remove'))));
    pane.append(h('fieldset', {}, h('legend', {}, 'Text on the film'), tf, texts));
  }

  function swatches(label, current, key, pick) {
    return h('div', {}, h('p', { id: 'sw-' + key }, label), h('div', { class: 'swatches', role: 'group', 'aria-labelledby': 'sw-' + key },
      M.PALETTE.map(c => { const b = h('button', { type: 'button', 'aria-label': `${label}: ${c}`, 'aria-pressed': String(current === c), 'data-key': `${key}-${c}`, onclick: () => pick(c) }); b.style.background = c; return b; })));
  }
  function paneLook(pane) {
    const l = S.edit.look;
    pane.append(h('fieldset', {}, h('legend', {}, 'Theme'), h('div', { class: 'row' },
      ['dark', 'light'].map(t => h('label', {}, h('input', { type: 'radio', name: 'theme', value: t, checked: l.theme === t, 'data-key': 'theme-' + t, onchange: () => apply(e => M.ops.setLook(e, { theme: t }), `The ${t} look is on.`) }), t === 'dark' ? 'Dark (the default)' : 'Light'))),
      h('p', { class: 'note' }, 'Cards and slides follow the film’s theme: a dark film gets the dark page and light text.')),
      h('fieldset', {}, h('legend', {}, 'Colours for captions and text'),
        swatches('Text colour', l.text_color, 'tc', c => apply(e => M.ops.setLook(e, { text_color: c }), 'Text colour changed.')),
        swatches('Box colour behind the text', l.box_color, 'bc', c => apply(e => M.ops.setLook(e, { box_color: c }), 'Box colour changed.')),
        h('label', {}, 'How solid the box is ', h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(l.box_opacity), 'aria-label': 'How solid the box is', 'data-key': 'box-op',
          onchange: ev => apply(e => M.ops.setLook(e, { box_opacity: parseFloat(ev.target.value) }), 'Box changed.') }))));
  }

  // ---- the top bar ----
  function drawStatus() {
    const s = $('status'); if (!s) return;
    s.textContent = S.proxy.state === 'updating' ? 'Updating the preview' : S.proxy.state === 'failed' ? 'The preview could not be updated' : 'Preview is ready';
    const u = $('undo'); if (u) u.disabled = S.undo.length === 0;
    const sv = $('save'); if (sv) sv.textContent = S.dirty ? 'Save my edit' : 'Saved';
  }
  async function save() {
    try { await host.save(M.stringify(S.edit)); S.dirty = false; S.savedAt = new Date(); err(''); say('Your edit is saved.'); } catch (e) { err(e.message); }
    drawStatus(); redrawPanelsKeepFocus();
  }
  async function render() {
    if (S.rendering) { err('A render is already running. Wait for it to finish.'); return; }
    S.rendering = true; $('render').disabled = true; say('Starting the render.');
    try { await host.save(M.stringify(S.edit)); S.dirty = false; const r = await host.render(S.edit); say(r.message || 'The render has started.'); } catch (e) { err(e.message); }
    S.rendering = false; $('render').disabled = false; drawStatus();
  }

  function redraw() { S.pre = { tl: M.timeline(S.edit), specs: M.specs(S.edit) }; drawStage(); drawStrip(); redrawPanelsKeepFocus(); drawStatus(); setT(S.t); }

  async function start() {
    try {
      const raw = await host.load();
      S.edit = M.normalize(raw); S.sel = S.edit.clips[0].id;
      try { S.proxy = await host.proxy(); } catch (e) { S.proxy = { state: 'failed', url: null }; }
      document.title = 'Edit your film';
      const top = $('top');
      top.append(h('h1', {}, 'Edit your film'), h('div', { class: 'row' }, h('span', { id: 'status', class: 'status', role: 'status' }),
        h('button', { id: 'undo', type: 'button', onclick: () => { if (!S.undo.length) return; S.edit = S.undo.pop(); S.dirty = true; refreshProxy(); redraw(); say('Undone.'); } }, 'Undo'),
        h('button', { id: 'back', type: 'button', onclick: () => { if (!host.back()) say('This is the practice cut: there is no plan to go back to.'); } }, 'Back to Plan'),
        h('button', { id: 'save', type: 'button', onclick: save }, 'Save my edit'),
        h('button', { id: 'render', type: 'button', class: 'primary', onclick: render }, 'Render')));
      redraw();
      if (S.proxy.state === 'failed') err('The preview video could not be built, but you can still edit.');
      window.ryagramEdit = { get edit() { return S.edit; }, get state() { return S; }, model: M, host, setT, frame: t => M.frameAt(S.edit, t, S.pre), saveText: () => M.stringify(S.edit) };
      document.documentElement.setAttribute('data-ready', '1');
    } catch (e) {
      $('top').append(h('p', { class: 'msg', role: 'alert' }, e instanceof M.EditError ? e.message : 'The edit page could not open: ' + e.message));
    }
  }
  start();
}());
