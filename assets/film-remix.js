// "See your county" on a public film page (NEXT-WEB 131, growth plan #1). A viewer of a film made from PUBLIC data picks a state and county and sees a local version
// right here, free, in the browser, with no account; the normal "make the final film" path (sign-in, credits) comes after. Off until ryagramConfig.seeYourCounty is true.
//
// The privacy gate is in eligible(): a film made from a customer's own uploaded data NEVER gets the button, whatever else the page says. A remix carries only the film's
// public reference and the chosen place (buildSpec, a whitelist); it never reads the source film's values. The places file is a fixed public file next to the page
// (/film/remix/<places>.json, the page names it, the code builds the address), same origin only. Every value goes in as text, never as HTML.
(() => {
  const REF = /^[a-z0-9-]{1,40}$/;
  const FIPS2 = /^\d{2}$/, FIPS3 = /^\d{3}$/;

  // true only for a film made from public data, on a page that says it can be remixed, with the flag on
  function eligible(page, cfg) {
    try {
      if (!cfg || cfg.seeYourCounty !== true) return false;
      if (!page || typeof page !== 'object') return false;
      const s = page.summary || {};
      if (s.uploaded_data !== false) return false;                          // missing or true: not public. Only an explicit false passes
      const r = page.remix;
      if (!r || r.version !== 1 || r.public !== true || r.kind !== 'county') return false;
      if (!REF.test(r.film_ref || '') || !REF.test(r.places || '')) return false;
      return true;
    } catch { return false; }
  }

  // The whole of a remix request: the film's public reference and the chosen place. Built from named fields only, so nothing else on the page can ride along.
  function buildSpec(page, place) {
    const r = (page && page.remix) || {};
    if (!REF.test(r.film_ref || '') || !place || !FIPS2.test(place.state_fips || '') || !FIPS3.test(place.county_fips || '')) return null;
    return { v: 1, film_ref: r.film_ref, state_fips: place.state_fips, county_fips: place.county_fips };
  }

  // The preview in the page: the chosen county's public series drawn as bars growing with the years. A stand-in for the engine's scene bundle (contract: a bundle per place).
  function frame(ctx, w, h, data, years, i) {
    ctx.fillStyle = '#14141a'; ctx.fillRect(0, 0, w, h);
    const max = Math.max(1, ...data), pad = 28, bw = (w - pad * 2) / data.length;
    ctx.fillStyle = '#3ec8a8';
    for (let k = 0; k <= i; k++) { const bh = (data[k] / max) * (h - pad * 2 - 24); ctx.fillRect(pad + k * bw + 1, h - pad - bh, Math.max(1, bw - 2), bh); }
    ctx.fillStyle = '#f2f2ee'; ctx.font = '600 20px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.fillText(String(years[i]), pad, 30);
    ctx.textAlign = 'right'; ctx.fillText(String(data[i]), w - pad, 30);
  }

  function section(page, deps) {
    const { h, cta, funnel, fetchJson } = deps;
    const state = { opened: false, places: null };
    const err = h('p', { class: 'film-remix-error', role: 'alert', hidden: true });
    const stateSel = h('select', { id: 'remix-state', 'aria-label': 'Your state', disabled: true }, h('option', { value: '' }, 'Choose your state'));
    const countySel = h('select', { id: 'remix-county', 'aria-label': 'Your county', disabled: true }, h('option', { value: '' }, 'Choose your county'));
    const go = h('button', { type: 'button', class: 'button primary', id: 'remix-go', disabled: true }, 'See it');
    const canvas = h('canvas', { id: 'remix-canvas', width: '960', height: '400', 'aria-hidden': 'true', hidden: true });
    const live = h('p', { class: 'film-meta', id: 'remix-live', role: 'status' });
    const final = h('div', { class: 'film-remix-final', hidden: true },
      h('p', {}, 'Like it? Make the full film for your county. That needs an account and uses credits.'),
      h('a', { class: 'button primary', id: 'remix-final', href: cta }, 'Make the final film'));
    const picker = h('div', { class: 'film-remix-picker', hidden: true },
      h('label', {}, 'State ', stateSel), h('label', {}, 'County ', countySel), go, err, canvas, live, final);
    const open = h('button', { type: 'button', class: 'button secondary', id: 'remix-open', 'aria-expanded': 'false' }, 'See your county');
    const fail = text => { err.textContent = text; err.hidden = false; };

    open.addEventListener('click', async () => {
      picker.hidden = !picker.hidden; open.setAttribute('aria-expanded', String(!picker.hidden));
      if (state.opened || picker.hidden) return;
      state.opened = true;
      if (funnel) funnel.filmEvent('remix_click');
      try {
        const data = await fetchJson(`/film/remix/${page.remix.places}.json`);
        if (!data || !Array.isArray(data.states)) throw new Error('shape');
        state.places = data;
        for (const s of data.states) if (FIPS2.test(s.fips || '') && s.name) stateSel.append(h('option', { value: s.fips }, s.name));
        stateSel.disabled = false;
      } catch { fail('The list of places could not be loaded just now. Try again in a minute.'); }
    });
    stateSel.addEventListener('change', () => {
      countySel.replaceChildren(h('option', { value: '' }, 'Choose your county')); go.disabled = true;
      const s = (state.places?.states || []).find(x => x.fips === stateSel.value);
      for (const c of s ? s.counties : []) if (FIPS3.test(c.fips || '') && c.name) countySel.append(h('option', { value: c.fips }, c.name));
      countySel.disabled = !s;
    });
    countySel.addEventListener('change', () => { go.disabled = !countySel.value; });
    go.addEventListener('click', () => {
      err.hidden = true;
      const s = (state.places?.states || []).find(x => x.fips === stateSel.value), c = s && s.counties.find(x => x.fips === countySel.value);
      const spec = c && buildSpec(page, { state_fips: s.fips, county_fips: c.fips });
      const data = c && Array.isArray(c.series) && c.series.length && c.series.every(n => typeof n === 'number' && isFinite(n)) ? c.series : null;
      const years = state.places.years;
      if (!spec || !data || !Array.isArray(years) || years.length !== data.length) { fail('That place is not in the list.'); return; }
      if (funnel) funnel.filmEvent('preview_created');
      canvas.hidden = false; final.hidden = false;
      const ctx = canvas.getContext && canvas.getContext('2d');
      const note = state.places.practice ? ' (practice numbers, to show how this works; not real data)' : '';
      live.textContent = `${c.name}, ${s.name}: ${state.places.measure?.label || 'value'} reached ${data[data.length - 1]} ${state.places.measure?.unit || ''} by ${years[years.length - 1]}.${note}`;
      if (!ctx) return;
      const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      let i = still ? data.length - 1 : 0;
      const tick = () => { frame(ctx, canvas.width, canvas.height, data, years, i); if (i < data.length - 1) { i++; setTimeout(tick, 90); } };
      tick();
    });
    return h('section', { class: 'film-section film-remix', id: 'remix', 'aria-labelledby': 'remix-title' },
      h('h2', { id: 'remix-title' }, 'See your county'),
      h('p', {}, 'This film was made from public data, so you can see a version for where you live. It is free, it runs right here in your browser, and you do not need an account.'),
      open, picker);
  }

  window.ryagramFilmRemix = { eligible, buildSpec, section, frame };
})();
