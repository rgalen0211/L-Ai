// "Your look": the profile editor (ENGINE's spec, 2026-10-17). A person picks a starting look, tweaks it, sees a quick look and a real sample sheet, and saves it as
// their engine's default look. It edits ONE thing, a profile (ENGINE-PROFILE.md): never a film's data, scale or claims, and no control for a locked thing exists.
//
// The rules are the ENGINE's own, not ours: assets/profile-core.js is generated from the engine's profile.ts + profile_data.ts (tools/make-profile-core.mjs), and
// the database's set_engine_profile() is the backstop (the server's answer is the one that counts). This file has NO validator of its own.
// Everything from the database goes in as text nodes, never as HTML. Say "look" to the person, "profile" only in the API.
(() => {
  const core = () => window.ryagramProfile;

  const LOCKED_TEXT = 'A look changes how a film looks and moves. It can’t change the data, the scale, the sources, the notes, how “not published” or “estimated” is shown, or any of the checks.';
  const LATER_TEXT = 'Not applied yet: the engine doesn’t use these. They are stored with your look and will apply when the engine supports them; nothing needs re-saving.';
  const VERTICAL_NOTE = 'The engine has no vertical layout yet: the 16:9 picture is fitted into the frame, not re-laid-out.';
  const SAMPLE_TITLE = 'Profile preview (sample)';
  const SHEET_NOTE = 'About 4 minutes on the render PC. Keep editing: it shows the look you had when you pressed the button. It is free.';
  const QUICK_NOTE = 'Approximate: drawn here from your colours, not by the engine.';

  // ---------------------------------------------------------------- the form, as data
  const COLOUR = 'color';
  const SECTIONS = [
    { id: 'look', title: 'Look', fields: [
      { path: 'look.theme', kind: 'radio', label: 'Theme', options: [['light', 'Light'], ['dark', 'Dark']] },
      { path: 'look.canvas', kind: 'radio', label: 'Shape', options: [[[1920, 1080], '16:9 HD'], [[1280, 720], '720p'], [[1080, 1920], 'Vertical']], note: { 'Vertical': VERTICAL_NOTE } },
      { path: 'look.fps', kind: 'radio', label: 'Frame rate', options: [[24, '24'], [25, '25'], [30, '30']] },
      { path: 'look.page_background', kind: COLOUR, label: 'Page colour' },
      { path: 'look.text_muted', kind: COLOUR, label: 'Muted text' },
      { path: 'look.ramp.low', kind: COLOUR, label: 'Colour scale: low' },
      { path: 'look.ramp.high', kind: COLOUR, label: 'Colour scale: high' },
      { path: 'look.ramp.mode', kind: 'radio', label: 'Scale style', options: [['solid', 'Solid'], ['hatch', 'Hatch']] },
      { path: 'look.ramp.steps', kind: 'steps', label: 'Steps' },
      { path: 'look.ramp.continuous', kind: 'check', label: 'Continuous colour (solid only)' },
      { path: 'look.hatch_line_color', kind: COLOUR, label: 'Hatch line colour' },
      { path: 'look.dots.color', kind: COLOUR, label: 'Dots: colour' },
      { path: 'look.dots.baseline_color', kind: COLOUR, label: 'Dots: stock colour' },
      { path: 'look.dots.radius', kind: 'number', label: 'Dots: size', min: 0.5, max: 6, step: 0.1 },
      { path: 'look.state.fill', kind: COLOUR, label: 'Areas: fill' },
      { path: 'look.state.no_data_fill', kind: COLOUR, label: 'Areas: “not published” fill' },
      { path: 'look.state.outline_width', kind: 'number', label: 'Areas: edge', min: 0, max: 4, step: 0.1 },
      { path: 'look.bars.swap_seconds', kind: 'number', label: 'Bar race: swap speed (s)', min: 0, max: 1.5, step: 0.05 },
      { path: 'look.bars.label_width', kind: 'number', label: 'Bar race: label width', min: 60, max: 600, step: 1 },
      { path: 'look.bars.value_width', kind: 'number', label: 'Bar race: value width', min: 40, max: 400, step: 1 }
    ] },
    { id: 'pacing', title: 'Pacing', fields: [
      { path: 'pacing.hold_seconds', kind: 'number', label: 'Hold per period (s)', min: 0, max: 10, step: 0.1 },
      { path: 'pacing.transition.kind', kind: 'radio', label: 'Transition', options: [['cut', 'Cut'], ['crossfade', 'Crossfade'], ['fade', 'Fade']] },
      { path: 'pacing.transition.seconds', kind: 'number', label: 'Transition length (s)', min: 0, max: 3, step: 0.1 },
      { path: 'pacing.title_card.fade', kind: 'number', label: 'Title cards: fade (s)', min: 0, max: 2, step: 0.1 },
      { path: 'pacing.title_card.align', kind: 'radio', label: 'Title cards: align', options: [['left', 'Left'], ['center', 'Centre']] }
    ] }
  ];
  const FONTS = ['dejavu-sans', 'liberation-sans', 'noto-sans', 'open-sans', 'roboto', 'inter', 'source-sans-3', 'lato', 'ibm-plex-sans', 'fira-sans'];
  const LATER = [
    { path: 'reserved.fonts.bold', kind: 'select', label: 'Bold font', options: FONTS },
    { path: 'reserved.fonts.regular', kind: 'select', label: 'Regular font', options: FONTS },
    { path: 'reserved.motion.position_easing', kind: 'select', label: 'Motion easing', options: ['linear', 'ease_in_out', 'ease_out'] },
    { path: 'reserved.brand.channel', kind: 'text', label: 'Channel name', max: 60 },
    { path: 'reserved.brand.credit_line', kind: 'text', label: 'Credit line', max: 160 }
  ];

  // ---------------------------------------------------------------- pure helpers (tested in node)
  const clone = x => JSON.parse(JSON.stringify(x));
  function getPath(obj, path) { return path.split('.').reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), obj); }
  // A new profile with one value set; '' / null / undefined REMOVES it (so the theme's own default applies), and empty parents are pruned.
  function setPath(profile, path, value) {
    const out = clone(profile);
    const keys = path.split('.');
    const trail = [out];
    for (const k of keys.slice(0, -1)) {
      if (trail[trail.length - 1][k] == null || typeof trail[trail.length - 1][k] !== 'object') trail[trail.length - 1][k] = {};
      trail.push(trail[trail.length - 1][k]);
    }
    const last = keys[keys.length - 1];
    if (value === '' || value == null || (typeof value === 'number' && Number.isNaN(value))) delete trail[trail.length - 1][last];
    else trail[trail.length - 1][last] = value;
    for (let i = trail.length - 1; i > 0; i--) if (!Object.keys(trail[i]).length) delete trail[i - 1][keys[i - 1]];
    return out;
  }

  // The engine's own sentences, each tied to the control it is about: "look.ramp: low ..." -> path look.ramp; "profile: ..." -> no path.
  function toProblem(text) {
    const m = /^([a-z_]+(?:\.[a-z_]+)*)[: ]/.exec(text);
    return { path: m && m[1] !== 'profile' ? m[1] : '', text };
  }
  // Shape first (the colour guards need a well-formed profile), then colours. Warnings are amber notes, never errors.
  function check(profile) {
    const P = core();
    const shape = P.checkShape(profile);
    if (shape.length) return { errors: shape.map(toProblem), warnings: [] };
    const errors = P.checkColours(profile).map(toProblem);
    let warnings = [];
    if (!errors.length) {
      try { warnings = [...P.applyProfile(profile, P.SAMPLE_STORY).report.warnings]; } catch { warnings = []; }
    }
    return { errors, warnings };
  }
  const problemsFor = (problems, path) => problems.filter(p => p.path && (p.path === path || path.startsWith(`${p.path}.`)));

  function hex(c) { return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); }
  function mix(a, b, t) {
    const x = hex(a), y = hex(b);
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
  }
  // A client-side mock from the profile alone: page, a 5-swatch ramp, two dots, the no-data swatch, a title card. Never the engine's drawing.
  function quickLook(profile) {
    const look = profile.look || {};
    const td = core().THEME_DEFAULTS[look.theme || 'dark'];
    const valid = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
    const pick = (v, d) => (valid(v) ? v : d);
    const low = pick(look.ramp?.low, td.choropleth.low), high = pick(look.ramp?.high, td.choropleth.high);
    return {
      page: pick(look.page_background, td.page.background), muted: pick(look.text_muted, td.text.muted), text: td.text.primary,
      ramp: [0, 0.25, 0.5, 0.75, 1].map(t => mix(low, high, t)),
      dot: pick(look.dots?.color, td.dots.color), stock: pick(look.dots?.baseline_color, td.dots.baseline_color),
      fill: pick(look.state?.fill, td.state.fill), noData: pick(look.state?.no_data_fill, td.state.no_data_fill),
      fade: profile.pacing?.title_card?.fade, align: profile.pacing?.title_card?.align || 'left'
    };
  }

  // The same profile text -> the same hash (so a sheet already running for it is not started twice).
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }
  function hashProfile(profile) {
    let h = 0x811c9dc5;
    for (const ch of canonical(profile)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  // The changed paths of an applied look, in plain words ("Theme: dark → light", "3 title-card fades").
  const GROUPS = [
    [/^sequence\.theme$/, 'Theme'], [/^sequence\.canvas$/, 'Shape'], [/^sequence\.fps$/, 'Frame rate'], [/^sequence\.hold_seconds$/, 'Hold per period'],
    [/^sequence\.style_overrides\.page\./, 'Page colour'], [/^sequence\.style_overrides\.text\./, 'Muted text colour'],
    [/^sequence\.style_overrides\.choropleth\./, 'Colour scale'], [/^sequence\.style_overrides\.hatch\./, 'Hatch lines'],
    [/^sequence\.style_overrides\.dots\./, 'Dots'], [/^sequence\.style_overrides\.state\./, 'Areas'], [/^sequence\.style_overrides\.bars\./, 'Bar race'],
    [/^sequence\.clips\.\d+\.transition$/, 'transition'], [/^sequence\.clips\.\d+\.fade$/, 'title-card fade'], [/^sequence\.clips\.\d+\.align$/, 'title-card alignment']
  ];
  const showValue = v => (v === undefined ? 'the film’s own' : Array.isArray(v) ? v.join('×') : typeof v === 'object' ? 'changed' : String(v));
  function diffWords(before, after, changed) {
    const byLabel = new Map();
    for (const path of changed || []) {
      const g = GROUPS.find(([re]) => re.test(path));
      if (!g) continue;
      if (!byLabel.has(g[1])) byLabel.set(g[1], []);
      byLabel.get(g[1]).push(path);
    }
    const out = [];
    for (const [label, paths] of byLabel) {
      const clip = /^(transition|title-card)/.test(label);
      if (clip) out.push(`${paths.length} ${label}${paths.length === 1 ? '' : 's'}`);
      else if (paths.length === 1) out.push(`${label}: ${showValue(getPath(before, paths[0]))} → ${showValue(getPath(after, paths[0]))}`);
      else out.push(`${label} changed`);
    }
    return out;
  }

  function uniqueName(existing, base) {
    const have = new Set(existing);
    if (!have.has(base)) return base;
    for (let i = 2; i < 100; i++) if (!have.has(`${base}-${i}`)) return `${base}-${i}`;
    return `${base}-${Date.now() % 10000}`;
  }

  // ---------------------------------------------------------------- the screens
  function create(ctx) {
    const { h, data, busy, showError, errorLine, date } = ctx;

    function lockedPanel() {
      return h('details', { class: 'look-locked' }, h('summary', {}, 'What a look can’t change'), h('p', {}, LOCKED_TEXT));
    }

    // ---- A. Your look
    async function listView() {
      const P = core();
      const error = errorLine();
      const rows = await data.listLooks();
      const list = h('div');
      function draw(items) {
        list.replaceChildren(items.length ? h('ul', { class: 'project-list look-list' }, items.map(r => h('li', {},
          h('strong', {}, r.title || r.name), h('span', { class: 'meta' }, ` ${r.name}${r.based_on ? `, based on ${r.based_on}` : ''}, saved ${date(r.updated_at)} `),
          r.is_default ? h('span', { class: 'state state-complete' }, 'Default') : null, ' ',
          h('a', { class: 'button secondary small', href: `#/looks/edit/${encodeURIComponent(r.name)}` }, 'Edit'), ' ',
          r.is_default ? null : h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
            error.hidden = true;
            await busy(event.currentTarget, 'Saving…', async () => {
              try { const row = await data.getLook(r.name); await data.saveLook(row.spec, true); draw(await data.listLooks()); } catch (err) { showError(error, err); }
            });
          } }, 'Set default'), ' ',
          h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
            if (!confirm(`Delete “${r.title || r.name}”?${r.is_default ? ' It is your default, so you will have no default look.' : ''}`)) return;
            error.hidden = true;
            await busy(event.currentTarget, 'Deleting…', async () => {
              try { await data.deleteLook(r.id); draw(await data.listLooks()); } catch (err) { showError(error, err); }
            });
          } }, 'Delete'))))
          : h('p', { class: 'form-note' }, 'You have no looks yet. Start from one of the presets below.'));
      }
      draw(rows);
      return [h('a', { href: '#/account', class: 'back' }, '← Account'), h('h1', { tabindex: '-1' }, 'Your look'),
        h('p', { class: 'form-intro' }, 'A look is how your films look and move: colours, shape, pacing. Save one as your default and new films start with it.'),
        h('h2', {}, `My looks (${rows.length} of ${P.MAX_PROFILES_PER_USER})`), list, error,
        h('h2', {}, 'New from a preset'),
        h('ul', { class: 'project-list look-presets' }, P.listPresets().map(p => h('li', {},
          h('a', { class: 'button secondary small', href: `#/looks/new?preset=${encodeURIComponent(p.id)}` }, p.title), h('span', { class: 'meta' }, ` ${p.summary}`)))),
        lockedPanel()];
    }

    // ---- B. The editor
    async function editorView(mode, key, onStop) {
      const P = core();
      const error = errorLine();
      const existing = await data.listLooks();
      let profile, isDefault = false, original = null;
      if (mode === 'edit') {
        const row = await data.getLook(key);
        if (!row) return [h('a', { href: '#/looks', class: 'back' }, '← Your look'), h('h1', { tabindex: '-1' }, 'Look not found'), h('p', {}, 'It may have been deleted.')];
        profile = clone(row.spec); isDefault = !!row.is_default; original = row;
      } else {
        const presetId = P.listPresets().some(p => p.id === key) ? key : 'clean-light';
        profile = P.forkPreset(presetId, uniqueName(existing.map(r => r.name), 'my-look'), `My ${P.listPresets().find(p => p.id === presetId).title.toLowerCase()}`);
      }
      const problemList = h('ul', { class: 'look-problems', role: 'alert' });
      const warnList = h('ul', { class: 'look-warnings' });
      const quick = h('div', { class: 'look-quick', role: 'img', 'aria-label': 'Quick look: approximate colours' });
      const save = h('button', { class: 'button primary', type: 'submit' }, 'Save');
      const saveDefault = h('button', { class: 'button secondary', type: 'button' }, 'Save as default');
      const sheetButton = h('button', { class: 'button secondary', type: 'button' }, 'Make a sample sheet');
      const sheetOut = h('div', { class: 'look-sheet-out', 'aria-live': 'polite' });
      const controls = [];                                   // { path, el, redraw }

      function redraw(source) {
        const result = check(profile);
        problemList.replaceChildren(...result.errors.map(p => h('li', {}, p.text)));
        problemList.hidden = !result.errors.length;
        warnList.replaceChildren(...result.warnings.map(w => h('li', {}, w)));
        warnList.hidden = !result.warnings.length;
        for (const c of controls) {
          const mine = problemsFor(result.errors, c.path);
          c.note.textContent = mine.map(p => p.text).join(' ');
          c.note.hidden = !mine.length;
          if (c.refresh && (c !== source || c.always)) c.refresh();        // never re-fill the box being typed in
        }
        const bad = result.errors.length > 0 || !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(profile.name || '');
        save.disabled = bad; saveDefault.disabled = bad; sheetButton.disabled = bad || sheetRunning();
        const q = quickLook(profile);
        quick.replaceChildren(
          swatch(q.page, h('div', { class: 'look-quick-card' }, h('strong', { class: 'look-quick-title' }, profile.title || profile.name || 'Title card'),
            h('span', { class: 'look-quick-sub' }, `fade ${q.fade ?? 'default'} s, ${q.align === 'center' ? 'centred' : 'left'}`)), q.text, q.align),
          h('div', { class: 'look-quick-row' }, q.ramp.map(c => swatch(c, null)), swatch(q.noData, null, null, 'not published'), swatch(q.fill, null, null, 'fill')),
          h('div', { class: 'look-quick-row' }, dot(q.dot, q.page), dot(q.stock, q.page)),
          h('p', { class: 'form-note' }, QUICK_NOTE));
        syncSheetNote();
      }
      function swatch(colour, child, text, label) {
        const el = h('span', { class: 'look-swatch', title: label ? `${label} ${colour}` : colour }, child, label ? h('span', { class: 'look-swatch-label' }, label) : null);
        el.style.backgroundColor = colour;
        if (text) { el.style.color = text; }
        return el;
      }
      function dot(colour, page) {
        const el = h('span', { class: 'look-dot', title: colour });
        el.style.backgroundColor = colour; el.style.outlineColor = page;
        return el;
      }
      function set(path, value, source) { profile = setPath(profile, path, value); redraw(source); }

      // ---- one control per field
      function field(f) {
        const id = `look-${f.path.replace(/\./g, '-')}`;
        const note = h('p', { class: 'form-note app-error look-field-error', hidden: true });
        const wrap = h('div', { class: 'look-field' });
        const c = { path: f.path, note, refresh: null, always: !['color', 'number', 'text'].includes(f.kind) };
        if (f.kind === 'radio') {
          const group = h('div', { class: 'look-radios', role: 'radiogroup', 'aria-label': f.label });
          const inputs = f.options.map(([val, label]) => {
            const input = h('input', { type: 'radio', name: id, value: JSON.stringify(val), onchange: () => set(f.path, val, c) });
            group.append(h('label', { class: 'choice' }, input, ' ', label));
            return [val, input];
          });
          c.refresh = () => { const cur = JSON.stringify(getPath(profile, f.path)); for (const [val, input] of inputs) input.checked = JSON.stringify(val) === cur; };
          wrap.append(h('div', { class: 'look-label' }, f.label), group);
          const vertical = f.options.find(([, l]) => f.note?.[l]);
          if (vertical) { const n = h('p', { class: 'form-note look-vertical-note', hidden: true }, f.note[vertical[1]]); wrap.append(n); const r = c.refresh; c.refresh = () => { r(); n.hidden = JSON.stringify(getPath(profile, f.path)) !== JSON.stringify(vertical[0]); }; }
        } else if (f.kind === COLOUR) {
          const text = h('input', { id, type: 'text', maxlength: '7', spellcheck: 'false', autocomplete: 'off', placeholder: 'default', class: 'look-colour-text' });
          const picker = h('input', { type: 'color', 'aria-label': `${f.label} picker`, class: 'look-colour-picker' });
          text.addEventListener('input', () => { set(f.path, text.value.trim(), c); if (/^#[0-9a-fA-F]{6}$/.test(text.value.trim())) picker.value = text.value.trim().toLowerCase(); });
          picker.addEventListener('input', () => { text.value = picker.value; set(f.path, picker.value, c); });
          c.refresh = () => { const v = getPath(profile, f.path); text.value = typeof v === 'string' ? v : ''; if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value.toLowerCase(); };
          wrap.append(h('label', { for: id, class: 'look-label' }, f.label), h('span', { class: 'look-colour' }, text, picker));
        } else if (f.kind === 'number') {
          const input = h('input', { id, type: 'number', min: String(f.min), max: String(f.max), step: String(f.step), placeholder: 'default' });
          input.addEventListener('input', () => set(f.path, input.value === '' ? null : Number(input.value), c));
          c.refresh = () => { const v = getPath(profile, f.path); input.value = v == null ? '' : String(v); };
          wrap.append(h('label', { for: id, class: 'look-label' }, f.label), input);
        } else if (f.kind === 'check') {
          const input = h('input', { id, type: 'checkbox', onchange: () => set(f.path, input.checked ? true : null, c) });
          c.refresh = () => { input.checked = getPath(profile, f.path) === true; };
          wrap.append(h('label', { for: id, class: 'choice' }, input, ' ', f.label));
        } else if (f.kind === 'steps') {
          const sel = h('select', { id }, h('option', { value: '' }, 'default'), h('option', { value: 'auto' }, 'auto'), [3, 4, 5, 6, 7, 8, 9].map(n => h('option', { value: String(n) }, String(n))));
          sel.addEventListener('change', () => set(f.path, sel.value === '' ? null : sel.value === 'auto' ? 'auto' : Number(sel.value), c));
          c.refresh = () => { const v = getPath(profile, f.path); sel.value = v == null ? '' : String(v); };
          wrap.append(h('label', { for: id, class: 'look-label' }, f.label), sel);
        } else if (f.kind === 'select') {
          const sel = h('select', { id }, h('option', { value: '' }, 'default'), f.options.map(o => h('option', { value: o }, o)));
          sel.addEventListener('change', () => set(f.path, sel.value || null, c));
          c.refresh = () => { sel.value = getPath(profile, f.path) || ''; };
          wrap.append(h('label', { for: id, class: 'look-label' }, f.label), sel);
        } else {
          const input = h('input', { id, type: 'text', maxlength: String(f.max), autocomplete: 'off' });
          input.addEventListener('input', () => set(f.path, input.value === '' ? null : input.value, c));
          c.refresh = () => { input.value = getPath(profile, f.path) || ''; };
          wrap.append(h('label', { for: id, class: 'look-label' }, f.label), input);
        }
        wrap.append(note);
        controls.push(c);
        return wrap;
      }

      // ---- name, title, starting point
      const nameInput = h('input', { id: 'look-name', type: 'text', maxlength: '64', autocomplete: 'off', value: profile.name || '', ...(mode === 'edit' ? { readonly: true, 'aria-describedby': 'look-name-note' } : {}) });
      nameInput.addEventListener('input', () => { profile = setPath(profile, 'name', nameInput.value); redraw(); });
      const titleInput = h('input', { id: 'look-title', type: 'text', maxlength: '80', autocomplete: 'off', value: profile.title || '' });
      titleInput.addEventListener('input', () => { profile = setPath(profile, 'title', titleInput.value); redraw(); });
      const presetRow = h('div', { class: 'look-radios', role: 'group', 'aria-label': 'Start from' }, P.listPresets().map(p => h('button', {
        class: `button secondary small${profile.based_on === p.id ? ' is-chosen' : ''}`, type: 'button', title: p.summary, 'aria-pressed': String(profile.based_on === p.id),
        onclick: () => {
          if (JSON.stringify(profile) !== JSON.stringify(original ? original.spec : profile) && !confirm('Start again from this preset? Your changes to this look are replaced (nothing is saved until you press Save).')) return;
          profile = P.forkPreset(p.id, profile.name, profile.title || undefined);
          for (const b of presetRow.querySelectorAll('button')) { const on = b.title === p.summary; b.classList.toggle('is-chosen', on); b.setAttribute('aria-pressed', String(on)); }
          controls.forEach(c => c.refresh && c.refresh());
          redraw();
        } }, p.title)));

      // ---- sample sheet (a free contact sheet of the CURRENT look on the engine's sample story; never charged)
      let sheet = null;                                      // { hash, versionId, timer }
      const sheetRunning = () => !!(sheet && sheet.running && sheet.hash === hashProfile(profile));
      function syncSheetNote() { if (sheet && sheet.running && sheet.hash === hashProfile(profile)) sheetButton.textContent = 'Sheet running…'; else sheetButton.textContent = 'Make a sample sheet'; }
      async function pollSheet() {
        if (!sheet) return;
        try {
          const st = await data.lookSheetStatus(sheet.versionId);
          if (!st) return;
          if (st.state === 'complete') {
            sheet.running = false;
            sheetOut.replaceChildren(st.url ? h('img', { class: 'look-sheet', src: st.url, alt: 'Sample sheet: a map, a bar race and a line chart in this look' }) : h('p', {}, 'The sheet is ready but its picture is not available.'),
              h('p', { class: 'form-note' }, 'The engine’s checks passed on this sheet. A map, a bar race and a line chart, in the look you had when you pressed the button.'));
            redraw();
          } else if (st.state === 'failed' || st.state === 'cancelled' || st.state === 'editorial_action_required') {
            sheet.running = false;
            sheetOut.replaceChildren(h('p', { class: 'app-error', role: 'alert' }, window.ryagramJobs ? window.ryagramJobs.problem(st.job) : 'The sheet did not finish.'));
            redraw();
          } else {
            sheetOut.replaceChildren(h('p', { class: 'form-note' }, `Making your sample sheet (${(window.ryagramJobs && window.ryagramJobs.STATE_LABELS[st.state]) || st.state}). ${SHEET_NOTE}`));
            sheet.timer = setTimeout(pollSheet, 4000);
          }
        } catch (err) { sheetOut.replaceChildren(h('p', { class: 'app-error', role: 'alert' }, err.message)); if (sheet) sheet.running = false; redraw(); }
      }
      onStop(() => { if (sheet && sheet.timer) clearTimeout(sheet.timer); });
      sheetButton.addEventListener('click', async () => {
        if (sheetRunning()) return;
        error.hidden = true;
        let story;
        try { story = P.applyProfile(profile, P.SAMPLE_STORY).story; } catch (err) { showError(error, new Error((err.errors || [err.message]).join(' '))); return; }
        sheetButton.disabled = true;
        try {
          const queued = await data.lookSheet(story, P.SAMPLE_SHEET_PERIODS);
          sheet = { hash: hashProfile(profile), versionId: queued.versionId, running: true, timer: null };
          sheetOut.replaceChildren(h('p', { class: 'form-note' }, `Sample sheet queued. ${SHEET_NOTE}`));
          redraw();
          sheet.timer = setTimeout(pollSheet, 1500);
        } catch (err) { showError(error, err); sheetButton.disabled = false; }
      });

      // ---- save
      async function persist(makeDefault) {
        error.hidden = true;
        const b = makeDefault ? saveDefault : save;
        await busy(b, 'Saving…', async () => {
          try { await data.saveLook(profile, makeDefault); location.hash = '#/looks'; }
          catch (err) { showError(error, err); }                      // the database's own sentence, verbatim
        });
      }
      const form = h('form', { class: 'look-form', onsubmit: event => { event.preventDefault(); persist(false); } });
      const sectionEls = SECTIONS.map(s => h('fieldset', { class: 'look-section' }, h('legend', {}, s.title), s.fields.map(field)));
      const laterEls = h('fieldset', { class: 'look-section look-later' }, h('legend', {}, 'Later (stored, not applied yet)'), h('p', { class: 'form-note' }, LATER_TEXT), LATER.map(field));
      form.append(
        h('div', { class: 'look-row' }, h('label', { for: 'look-name', class: 'look-label' }, 'Name (letters, digits, hyphens)'), nameInput,
          mode === 'edit' ? h('p', { id: 'look-name-note', class: 'form-note' }, 'The name can’t change once saved; make a copy under a new name by starting a new look.') : null),
        h('div', { class: 'look-row' }, h('label', { for: 'look-title', class: 'look-label' }, 'Title'), titleInput),
        ...sectionEls, laterEls,
        h('div', { class: 'actions-row' }, save, saveDefault, h('a', { class: 'button secondary', href: '#/looks' }, 'Cancel')), error);
      saveDefault.addEventListener('click', () => persist(true));
      controls.forEach(c => c.refresh && c.refresh());
      redraw();

      return [h('a', { href: '#/looks', class: 'back' }, '← Your look'),
        h('h1', { tabindex: '-1' }, mode === 'edit' ? `Edit ${profile.title || profile.name}` : 'New look'),
        isDefault ? h('p', { class: 'form-note' }, 'This is your default look.') : null,
        h('div', { class: 'look-presets-row' }, h('div', { class: 'look-label' }, 'Start from'), presetRow),
        h('div', { class: 'look-layout' }, form,
          h('aside', { class: 'look-side' }, h('h2', {}, 'Quick look'), quick, h('h2', {}, 'Sample sheet'), sheetButton, h('p', { class: 'form-note' }, SHEET_NOTE), sheetOut,
            h('h2', {}, 'Problems'), problemList, warnList, lockedPanel()))];
    }

    // ---- "Apply my look" on a film (spec section 3): a diff in words, then a NEW version (never edits in place)
    async function applyPanel(project, v, locked, afterNewVersion) {
      const P = core();
      let looks;
      try { looks = await data.listLooks(); } catch { return null; }
      if (!looks.length || locked) return null;
      const error = errorLine();
      const diffOut = h('div', { class: 'look-diff' });
      const pick = h('div', { class: 'look-radios', role: 'radiogroup', 'aria-label': 'Which look' }, looks.map((r, i) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'apply-look', value: r.name, ...(i === 0 || r.is_default ? { checked: true } : {}) }), ` ${r.title || r.name}${r.is_default ? ' (default)' : ''}`)));
      const modes = h('div', { class: 'look-radios', role: 'radiogroup', 'aria-label': 'How' }, [['restyle', 'Restyle: your look wins'], ['fill', 'Fill gaps: the film wins']].map(([val, label], i) =>
        h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'apply-mode', value: val, ...(i === 0 ? { checked: true } : {}) }), ` ${label}`)));
      const chosen = () => pick.querySelector('input:checked')?.value;
      const mode = () => modes.querySelector('input:checked')?.value;
      let pending = null;
      const go = h('button', { class: 'button secondary', type: 'button', hidden: true }, 'Create a new version with this look');
      const show = h('button', { class: 'button secondary', type: 'button' }, 'See what would change');
      show.addEventListener('click', async () => {
        error.hidden = true; diffOut.replaceChildren(); go.hidden = true;
        await busy(show, 'Checking…', async () => {
          try {
            const row = await data.getLook(chosen());
            const { story, report } = P.applyProfile(row.spec, v.story_spec, mode());
            pending = story;
            const words = diffWords(v.story_spec, story, report.changed);
            diffOut.replaceChildren(
              words.length ? h('ul', {}, words.map(w => h('li', {}, w))) : h('p', { class: 'form-note' }, 'Nothing would change: the film already has this look.'),
              ...report.warnings.map(w => h('p', { class: 'form-note look-warning' }, w)),
              h('p', { class: 'form-note' }, 'This makes a new version; this one is not changed. The sheet and preview you made for this story are not valid for the new one, so make them again.'));
            go.hidden = !words.length;
          } catch (err) { showError(error, new Error(err.errors ? err.errors.join(' ') : err.message)); }
        });
      });
      go.addEventListener('click', async () => {
        if (!pending) return;
        await busy(go, 'Creating…', async () => {
          try {
            const nv = await data.createVersion(project.id, v.id);
            await data.saveStory(nv.id, pending);
            afterNewVersion(nv.id);
          } catch (err) { showError(error, err); }
        });
      });
      return h('details', { class: 'look-apply' }, h('summary', {}, 'Apply my look'),
        h('p', { class: 'form-note' }, 'Only the look changes: never the data, scale, sources or notes. Pick a look and how to apply it.'),
        h('div', { class: 'look-label' }, 'Which look'), pick, h('div', { class: 'look-label' }, 'How'), modes, h('p', {}, show, ' ', go), diffOut, error);
    }

    // "Using your look" when a template builds a film: the default look is applied before the story is saved.
    async function withDefaultLook(story) {
      let row;
      try { row = await data.defaultLook(); } catch { return { story, used: null, warnings: [] }; }
      if (!row) return { story, used: null, warnings: [] };
      try {
        const { story: styled, report } = core().applyProfile(row.spec, story, 'restyle');
        return { story: styled, used: row.title || row.name, warnings: report.warnings };
      } catch { return { story, used: null, warnings: [] }; }                      // a look that no longer validates never blocks a film
    }

    return { listView, editorView, applyPanel, withDefaultLook, lockedPanel };
  }

  window.ryagramLooks = { create, SECTIONS, LATER, LOCKED_TEXT, LATER_TEXT, QUICK_NOTE, SAMPLE_TITLE, getPath, setPath, check, toProblem, problemsFor, quickLook, mix,
                          hashProfile, canonical, diffWords, uniqueName };
})();
