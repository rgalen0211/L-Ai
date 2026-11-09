// WEB 11-08 (CC1 burn item): the interactive map panel, layers side panel and time slider, as a STATIC page on MADE-UP data. No map library, no outside request, no live data:
// the "map" is an invented grid of squares, every number is invented, the places are "County A" and so on. It shows where things sit and what each status says; nothing here is a claim about any place.
// Shown only when the site switch mapPanelDemo is ON (OFF). Every word is a draft for Ryan. Design: proposals/WEB-MAP-PANEL-SKETCH-1107.md (and the interactive-map design papers).
// The three "no number" states are kept apart everywhere (GEO's design): NOT PUBLISHED at this level, NOT HELD (published, not fetched yet), WITHHELD or no figure.
(function () {
  const on = cfg => !!cfg && cfg.mapPanelDemo === true;
  const NS = 'http://www.w3.org/2000/svg';
  const STILL_MS = 3000;       // (Ryan's Q520 answer 1 = A): a place that is not held fills in by itself once the view has been still for this long
  const RETRY_SECONDS = 20;    // invented; the real panel shows the seconds the service asks for
  const FC_MAX = 2029;         // invented; the real limit comes from the forecast core
  const FIRST = 2012, LAST = 2023;
  const BREAKS = [{ y: 2017, w: 'industry code changed' }];
  const LAYERS = [
    { id: 'fill', name: 'Main measure (fill)', note: 'The question your AI set. One level at a time.', on: () => true, from: 0, lock: null },
    { id: 'outl', name: 'State lines over counties', note: 'Outlines only, no values.', on: z => z >= 7, from: 7, lock: null },
    { id: 'names', name: 'Place names', note: 'States from zoom 5, counties from zoom 9.', on: z => z >= 5, from: 5, lock: null },
    { id: 'second', name: 'Second measure: per 10,000 residents', note: 'Calculated. Names its inputs and the population estimate it used.', on: () => false, from: null, lock: null },
    { id: 'points', name: 'Points (places)', note: 'Private data is not shown in a shared view.', on: () => false, from: 11, lock: 'Locked: private until the legal review is done.' },
    { id: 'fcast', name: 'Forecast years', note: 'Dashed and labelled Estimated; some places may have no estimate.', on: () => false, from: null, lock: null }
  ];
  const STATES = [
    ['loading', '(2) not held: published, not fetched yet'],
    ['drawn', 'drawn: every place has a value'],
    ['level', '(1) not published at this level'],
    ['nofig', '(3) withheld or no figure for one place'],
    ['offline', 'service unreachable'],
    ['blocked', 'this chat blocks detail (coarse map only)'],
    ['slow', 'slowing down (try again in N seconds)'],
    ['newer', 'map newer than the panel']
  ];
  const ERROR_STATES = ['offline', 'blocked', 'slow', 'newer'];

  const level = z => (z <= 3 ? 'None' : z <= 6 ? 'States' : 'Counties');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clampYear = (y, max) => Math.max(FIRST, Math.min(max, Math.round(Number(y)) || FIRST));

  function create(host, win) {
    const doc = host.ownerDocument || document;
    const setT = (win && win.setTimeout) || setTimeout, clearT = (win && win.clearTimeout) || clearTimeout;
    const S = { z: 8, st: 'loading', year: LAST, play: false, user: {}, sheet: false, phone: false };
    let timer = null, playTimer = null;
    const isOn = L => (L.id in S.user ? S.user[L.id] : L.on(S.z));
    const fcOn = () => isOn(LAYERS[5]);
    const yMax = () => (fcOn() ? FC_MAX : LAST);

    function mapSvg() {
      const lvl = level(S.z);
      if (lvl === 'None') return '<svg viewBox="0 0 400 300" role="img" aria-label="No map data at this zoom"><text x="200" y="150" fill="#9fb0cf" text-anchor="middle" font-size="14">No data is published at this level yet.</text></svg>';
      const n = lvl === 'States' ? 3 : 7, cw = 400 / n, ch = 300 / n, fc = fcOn() && S.year > LAST;
      let g = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const k = (r * 7 + c * 3 + S.year) % 9, hue = fc ? 38 : 210, light = 22 + k * 4;
        const none = (S.st === 'nofig' && r === 1 && c === 2) || S.st === 'level';
        const load = S.st === 'loading' && c >= n - 2 && r <= 1;
        let fill = `hsl(${hue} 55% ${light}%)`, extra = '';
        if (none) { fill = '#0e1730'; extra = ' stroke-dasharray="4 3"'; }
        if (load) fill = 'url(#h)';
        const tip = none ? (S.st === 'level' ? 'Not published at this level' : 'No figure, withheld by the source (not a zero)') : load ? 'Not fetched yet' : 'Invented value';
        g += `<rect x="${(c * cw + 1).toFixed(1)}" y="${(r * ch + 1).toFixed(1)}" width="${(cw - 2).toFixed(1)}" height="${(ch - 2).toFixed(1)}" fill="${fill}" stroke="#2a3856"${extra}><title>${tip}</title></rect>`;
        if (isOn(LAYERS[2]) && ((lvl === 'States' && S.z >= 5) || (lvl === 'Counties' && S.z >= 9))) {
          g += `<text x="${(c * cw + cw / 2).toFixed(1)}" y="${(r * ch + ch / 2 + 4).toFixed(1)}" fill="#e8edf7" font-size="${n > 5 ? 9 : 12}" text-anchor="middle">${lvl === 'States' ? 'State' : 'County'} ${String.fromCharCode(65 + ((r * n + c) % 26))}</text>`;
        }
      }
      if (isOn(LAYERS[1]) && lvl === 'Counties') g += `<path d="M0 ${(ch * 3).toFixed(1)} H400 M${(cw * 4).toFixed(1)} 0 V300" stroke="#e8b84a" stroke-width="2" fill="none"/>`;
      return `<svg viewBox="0 0 400 300" role="img" aria-label="Invented sketch map: ${lvl}, year ${S.year}"><defs><pattern id="h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#16213a"/><line x1="0" y1="0" x2="0" y2="8" stroke="#5b6f99" stroke-width="3"/></pattern></defs>${g}</svg>`;
    }

    function statusText() {
      const lvl = level(S.z), fc = fcOn();
      if (S.st === 'offline') return '<b>Can\'t reach the map service.</b> You are seeing what was already loaded. The data may be out of date. <a href="#" data-open>Open Ryagram</a>';
      if (S.st === 'blocked') return '<b>This chat does not let the map load detail.</b> You are seeing the coarse map. <a href="#" data-open>Open Ryagram</a> for the full map.';
      if (S.st === 'slow') return `<b>Slowing down.</b> Too many requests; the map stays as drawn. Try again in ${RETRY_SECONDS} seconds.`;
      if (S.st === 'newer') return '<b>This map is newer than this panel.</b> Close it and reopen it from the chat.';
      if (S.st === 'level') return '<b>Not published at this level.</b> The agency publishes nothing this fine, or this coarse, for this measure. Ryagram does not spread it down or add it up to make a number.';
      if (S.st === 'loading') return '<b>Not fetched yet.</b> This is published, and Ryagram does not hold it yet. It is fetching 4 counties now, about 4 seconds. It fills in by itself once you have held the view still for 3 seconds.';
      if (S.st === 'nofig') return '<b>Withheld, or no figure.</b> The agency hides the value for this place or has none. It is not a zero and it is not filled in.';
      if (lvl === 'None') return '<b>Nothing is published at this zoom yet.</b> Zoom in to see states.';
      if (fc && S.year > FC_MAX) return '<b>No estimate that far ahead.</b>';
      if (fc && S.year > LAST) return '<b>Estimated:</b> 2 places have no estimate (fewer than three measured years). They are left blank, not carried forward.';
      return '';
    }

    function placeMarks() {                                    // positions are set through the style object (the page's policy forbids style attributes)
      host.querySelectorAll('[data-pct]').forEach(el => { el.style.left = el.getAttribute('data-pct') + '%'; if (el.hasAttribute('data-w')) el.style.width = el.getAttribute('data-w') + '%'; });
    }

    function updateMap() {                                     // the map, status and year readout only: a dragged slider keeps its focus
      const lvl = level(S.z), est = fcOn() && S.year > LAST;
      const mw = host.querySelector('[data-map]'), st = host.querySelector('.status'), yr = host.querySelector('.yr'), sl = host.querySelector('#mp-yr');
      if (mw) mw.innerHTML = mapSvg();
      const t = statusText(); if (st) { st.innerHTML = t; st.hidden = !t; }
      if (yr) yr.textContent = String(S.year);
      if (sl) sl.setAttribute('aria-valuetext', `${S.year}${est ? ', estimated' : ''}`);
      const chip = host.querySelector('[data-label]'); if (chip) { const lab = labelOf(); chip.className = 'chip ' + lab[0]; chip.textContent = lab[1]; }
      const lc = host.querySelector('.levelchip'); if (lc) lc.textContent = lvl === 'None' ? 'No level' : lvl;
    }
    function labelOf() { return fcOn() && S.year > LAST ? ['est', 'Estimated'] : (isOn(LAYERS[3]) ? ['calc', 'Calculated'] : ['obs', 'Observed']); }

    function render() {
      const ae = doc.activeElement, keep = ae && ae.getAttribute && (ae.id || ae.getAttribute('data-keep'));
      const lvl = level(S.z), est = fcOn() && S.year > LAST, lab = labelOf(), st = statusText(), nOn = LAYERS.filter(isOn).length;
      const max = yMax(), span = max - FIRST, pct = y => ((y - FIRST) / span * 100).toFixed(2);
      S.year = clampYear(S.year, max);
      const rows = LAYERS.map(L => {
        const o = isOn(L), you = L.id in S.user, locked = !!L.lock;
        let why = L.note;
        if (locked) why = L.lock; else if (!you && L.from != null && !o && L.id !== 'second' && L.id !== 'fcast') why += ` Shows from zoom ${L.from}.`;
        return `<div class="lrow ${o ? '' : 'off'}"><input type="checkbox" id="l-${L.id}" ${o ? 'checked' : ''} ${locked ? 'disabled' : ''} data-l="${L.id}" aria-describedby="d-${L.id}"><label class="t" for="l-${L.id}"><b>${esc(L.name)}</b>${you ? '<span class="pill you">you set this</span>' : ''}<span class="why" id="d-${L.id}">${esc(why)}</span></label></div>`;
      }).join('');
      const marks = [`<span data-pct="0">${FIRST}</span>`, `<span data-pct="${pct(LAST)}">${LAST}</span>`]
        .concat(BREAKS.map(b => `<i class="brk" data-pct="${pct(b.y)}" title="${b.y}: ${esc(b.w)}"></i>`))
        .concat(fcOn() ? [`<span class="fcend" data-pct="${pct(FC_MAX)}">${FC_MAX}</span>`, `<i class="fc" data-pct="${pct(LAST)}" data-w="${(100 - pct(LAST)).toFixed(2)}"></i>`] : []).join('');
      const open = !S.phone || S.sheet;
      const stateOpts = STATES.map(([v, l]) => `<option value="${v}" ${v === S.st ? 'selected' : ''}>${esc(l)}</option>`).join('');
      host.innerHTML = `
        <div class="banner">DEMO: invented grid and figures, not real data. Dark by default. Every word is a draft for Ryan.</div>
        <fieldset class="demo-controls"><legend>Demo controls (not part of the panel)</legend>
          <label>Panel state <select id="mp-st">${stateOpts}</select></label>
        </fieldset>
        <section class="mp ${S.phone ? 'phone' : ''}" aria-label="Map panel demo">
          <header><span class="title">Limited-service restaurants (invented)</span><span class="chip ${lab[0]}" data-label>${lab[1]}</span><span class="chip levelchip" title="One level per answer, never mixed">${lvl === 'None' ? 'No level' : lvl}</span></header>
          <div class="mapwrap"><div data-map>${mapSvg()}</div>
            <div class="status" role="status" ${st ? '' : 'hidden'}>${st}</div>
            <div class="src">Source: U.S. Census Bureau, County Business Patterns (invented sketch)</div>
            <div class="zoomctl"><button type="button" aria-label="Zoom in" data-zoom="1" data-keep="zin">+</button><button type="button" aria-label="Zoom out" data-zoom="-1" data-keep="zout">&minus;</button></div>
          </div>
          ${S.phone ? `<button type="button" class="sheethandle" id="mp-sheet" aria-expanded="${S.sheet}" aria-controls="lay"><span>Layers, ${nOn} on</span><span aria-hidden="true">${S.sheet ? '&#9662;' : '&#9652;'}</span></button>` : ''}
          <div class="layers" id="lay" ${open ? '' : 'hidden'}><h2>Layers</h2><fieldset><legend class="sr">Map layers</legend>${rows}</fieldset>
            <button type="button" class="reset" data-reset ${Object.keys(S.user).length ? '' : 'disabled'}>Back to the standard layers</button>
            <p class="fine">The standard layers change with the zoom. A layer you set stays as you set it.</p></div>
          <div class="time"><div class="row"><button type="button" class="play" data-play data-keep="play" aria-label="${S.play ? 'Pause' : 'Play'} the years">${S.play ? '&#10074;&#10074;' : '&#9654;'}</button>
            <div class="sl"><input id="mp-yr" type="range" min="${FIRST}" max="${max}" step="1" value="${S.year}" aria-label="Year" aria-valuetext="${S.year}${est ? ', estimated' : ''}"><div class="marks">${marks}</div></div>
            <span class="yr" aria-hidden="true">${S.year}</span></div>
            <div class="fine">${BREAKS.map(b => `Purple mark ${b.y}: ${esc(b.w)}.`).join(' ')}${fcOn() ? ' Dashed stretch: estimates, not observed.' : ''}</div></div>
          <div class="actions"><button type="button" class="btn" data-film>Make this a film</button><button type="button" class="btn sec" data-open>Open in Ryagram</button></div>
        </section>`;
      placeMarks();
      if (keep) { const el = host.querySelector('#' + keep.replace(/[^A-Za-z0-9_-]/g, '')) || host.querySelector(`[data-keep="${keep}"]`); if (el && el.focus) el.focus(); }
    }

    function armFill() {                                       // (Ryan's Q520 answer 1 = A): the view has been still for STILL_MS, so the places that were not held fill in by themselves
      clearT(timer); timer = null;
      if (S.st === 'loading') timer = setT(() => { timer = null; S.st = 'drawn'; render(); }, STILL_MS);
    }
    function moved() {                                         // a zoom or pan to a view that is not held yet (demo: any zoom, unless an error state is being shown)
      if (!ERROR_STATES.includes(S.st) && S.st !== 'level' && S.st !== 'nofig') S.st = 'loading';
      armFill();
    }

    host.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button, a'); if (!b) return;
      if (b.hasAttribute('data-open')) e.preventDefault();      // the demo opens nothing
      if (b.dataset.zoom) { S.z = Math.max(0, Math.min(12, S.z + Number(b.dataset.zoom))); moved(); render(); }
      else if (b.hasAttribute('data-reset')) { S.user = {}; render(); }
      else if (b.id === 'mp-sheet') { S.sheet = !S.sheet; render(); }
      else if (b.hasAttribute('data-play')) { S.play = !S.play; clearT(playTimer); playTimer = null; if (S.play) tick(); render(); }
    });
    host.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'mp-st') setState(t.value);
      else if (t.dataset && t.dataset.l) { S.user[t.dataset.l] = !!t.checked; render(); }
    });
    host.addEventListener('input', e => {
      if (e.target.id === 'mp-yr') { S.year = clampYear(e.target.value, yMax()); updateMap(); }
    });
    function setState(v) { if (STATES.some(s => s[0] === v)) { S.st = v; armFill(); render(); } }
    function tick() {
      playTimer = setT(() => { const mx = yMax(); S.year = S.year >= mx ? FIRST : S.year + 1; render(); if (S.play) tick(); }, 900);
    }
    render(); armFill();
    return { S, render, setState, setPhone(p) { p = !!p; if (S.phone !== p) { S.phone = p; render(); } }, stop() { clearT(timer); clearT(playTimer); } };
  }

  function mount(root) {
    const win = window;
    const p = document.createElement('p');
    p.textContent = 'The layers side panel and the time slider, on invented data. Nothing here is a claim about any place.';
    const stage = document.createElement('div');
    root.classList.add('mpd'); root.append(p, stage);
    const api = create(stage, win);
    const mq = win.matchMedia ? win.matchMedia('(max-width: 640px)') : null;
    if (mq) { api.setPhone(mq.matches); if (mq.addEventListener) mq.addEventListener('change', ev => api.setPhone(ev.matches)); }
    return api;
  }

  window.ryagramMapPanelDemo = Object.freeze({ on, mount, create, level, STILL_MS, STATES, LAYERS });
  const root = document.getElementById('map-panel-demo'), off = document.getElementById('not-available');
  if (root) { const enabled = on(window.ryagramConfig); root.hidden = !enabled; if (off) off.hidden = enabled; if (enabled) mount(root); }
})();
