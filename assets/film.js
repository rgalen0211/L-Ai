// A public Ryagram film page (/film/?s=<slug>): the film, "Made with Ryagram · View sources",
// its sources and method, a short public receipt, and a way to make your own.
// Data comes from the film-page Edge Function; every value goes in as text, never as HTML.
(() => {
  const root = document.getElementById('film');
  const params = new URLSearchParams(location.search);
  const slug = params.get('s') || '';
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const mock = local && params.has('mock');               // sample data, for local checks only
  const SLUG = /^[A-Za-z0-9_-]{22}$/;
  const SAMPLE = /^[a-z0-9-]{1,40}$/;                    // /film/?sample=interstate: a fixed sample page from /film/samples/<name>.json, no server involved
  const sampleName = SAMPLE.test(params.get('sample') || '') ? params.get('sample') : '';

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false && child !== '') el.append(child);
    return el;
  }
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };
  const date = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); };
  // "Make your own data film" goes to the WAITLIST while Ryagram is coming soon (the waitlist section of the Ryagram page), tagged so signups from film pages
  // can be counted. The link a film's "Made with Ryagram · View sources" mark points to is this page's own address plus #sources: /film/?s=<slug>#sources.
  const cta = `/ryagram/?utm_source=film_page&utm_medium=referral&utm_campaign=${encodeURIComponent(sampleName ? `sample_${sampleName}` : SLUG.test(slug) ? slug : 'film')}#waitlist`;

  let handledSources = false;                                                  // true once #sources took the focus (so the title does not)
  const reportLink = document.getElementById('report-link');
  if (reportLink && SLUG.test(slug)) reportLink.href = `/report/?film=${slug}`;

  async function load() {
    if (sampleName) {
      const res = await fetch(`/film/samples/${sampleName}.json`);
      if (!res.ok) return null;
      const page = await res.json();
      const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow'; document.head.append(meta);   // a sample is not a real film page
      return page;
    }
    if (mock) return (await fetch('/tests/fixtures/film/page-sample.json')).json();
    if (!SLUG.test(slug)) return null;
    const base = window.ryagramConfig?.supabaseUrl;
    if (!base) throw new Error('not configured');
    const res = await fetch(`${base}/functions/v1/film-page?s=${slug}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res.json();
  }

  function sourcesSection(s) {
    const datasets = (s.datasets || []).map(d => h('div', { class: 'film-dataset' },
      h('h3', {}, d.label || 'Data'),
      d.credit ? h('p', { class: 'film-meta' }, `Credited in the film as: ${d.credit}`) : null,
      d.sources?.length ? h('ul', { class: 'film-sources' }, d.sources.map(src => {
        const url = safeUrl(src.url);
        return h('li', {},
          url ? h('a', { href: url, rel: 'noopener noreferrer', target: '_blank' }, src.name) : h('strong', {}, src.name),
          src.license ? h('span', { class: 'film-license' }, src.license) : null);
      })) : null,
      s.uploaded_data ? h('p', {}, 'This film was made from data its maker uploaded. The data itself isn’t published here.') : null,
      d.method ? [h('h4', {}, 'Method'), h('p', {}, d.method)] : null,
      d.derivations?.length ? [h('h4', {}, 'Worked out from the published figures'),
        h('ul', {}, d.derivations.map(x => h('li', {}, h('strong', {}, x.measure), `: ${x.method}`)))] : null,
      d.breaks?.length ? [h('h4', {}, 'Where the data changed how it was collected'),
        h('ul', {}, d.breaks.map(x => h('li', {}, x.period ? h('strong', {}, x.period) : null, x.period ? `: ${x.what}` : x.what)))] : null,
      (d.retrieved || d.values_are) ? h('p', { class: 'film-meta' },
        [d.retrieved && `Retrieved ${d.retrieved}.`, d.values_are && `Values: ${d.values_are}.`].filter(Boolean).join(' ')) : null));
    return h('section', { id: 'sources', class: 'film-section', 'aria-labelledby': 'sources-title' },
      h('h2', { id: 'sources-title' }, 'Sources and method'),
      datasets,
      s.measures?.length ? [h('h3', {}, 'What the film shows'),
        h('ul', {}, s.measures.map(m => h('li', {}, m.label, m.unit ? h('span', { class: 'film-unit' }, ` (${m.unit})`) : null)))] : null);
  }

  function receipt(page) {
    const s = page.summary || {}, f = s.film || {}, e = s.engine || {};
    const rows = [
      s.window && ['Period', s.window.start === s.window.end ? s.window.start : `${s.window.start} to ${s.window.end}`],
      s.area && ['Area', s.area],
      page.sample && ['This page', 'A sample, to show what a Ryagram film page contains'],
      f.seconds && ['Length', `${Math.round(f.seconds)} seconds${f.width && f.height ? `, ${f.width}×${f.height}` : ''}${f.fps ? `, ${f.fps} fps` : ''}`],
      e.drawn_at && ['Drawn', e.drawn_at],
      e.commit && ['Engine version', e.commit],
      page.published_at && ['Published', date(page.published_at)],
    ].filter(Boolean);
    return h('section', { class: 'film-section film-receipt', 'aria-labelledby': 'receipt-title' },
      h('h2', { id: 'receipt-title' }, 'Receipt'),
      h('p', { class: 'film-meta' }, 'Every Ryagram film is checked against its data before it’s released, and keeps a record of exactly what drew it.'),
      h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
  }

  // Ryan 2026-10-18: the same words on the public film page and the in-app delivery page (assets/app-library.js).
  const AI_LABEL = 'AI-assisted (Ryagram)';

  // "See your county": only for a film made from public data, only with the flag on (assets/film-remix.js decides)
  function remixSection(page) {
    const R = window.ryagramFilmRemix;
    if (!R || !R.eligible(page, window.ryagramConfig)) return null;
    const campaign = encodeURIComponent(sampleName ? `remix_${sampleName}` : 'remix');
    return R.section(page, { h, funnel: window.ryagramFunnel, fetchJson: async u => { const r = await fetch(u); if (!r.ok) throw new Error('status ' + r.status); return r.json(); },
      cta: `/ryagram/?utm_source=film_page&utm_medium=remix&utm_campaign=${campaign}#waitlist` });
  }

  function render(page) {
    const s = page.summary || {};
    document.title = `${page.title} | Made with Ryagram`;
    const posterUrl = page.poster_url && (/^\/film\/samples\/[a-z0-9-]+\.jpg$/.test(page.poster_url) || safeUrl(page.poster_url)) ? page.poster_url : null;
    const video = page.video_url
      ? h('video', { controls: true, playsinline: true, preload: 'metadata', poster: safeUrl(page.poster_url) || null, src: safeUrl(page.video_url) || null,
                     width: String(s.film?.width || 1920), height: String(s.film?.height || 1080) })
      : page.sample && posterUrl
        ? h('img', { class: 'film-poster', src: posterUrl, alt: `The last frame of the film: ${s.headline || page.title}, ${s.window ? `${s.window.start} to ${s.window.end}` : ''}`, width: String(s.film?.width || 1920), height: String(s.film?.height || 1080) })
        : h('p', { class: 'film-gone' }, 'This film is no longer stored, but its sources are below.');
    root.replaceChildren(...[                                                  // (replaceChildren(null) would print the word "null": drop the empty parts)
      h('h1', { tabindex: '-1' }, page.title),
      s.subhead && s.subhead !== page.title ? h('p', { class: 'film-subhead' }, s.subhead) : null,
      page.sample ? h('p', { class: 'film-sample', role: 'note' }, 'This is a sample page. It shows what every published Ryagram film page contains: the film, where its data came from, how it was drawn, and its receipt.') : null,
      h('figure', { class: 'film-player' }, video,
        h('figcaption', {}, h('strong', { class: 'film-ai-label' }, AI_LABEL), ' · Made with Ryagram · ', h('a', { href: '#sources' }, 'View sources'),
          page.sample && page.preview_url && /^\/(?!\/)[a-z0-9\/_-]*$/.test(page.preview_url) ? [' · ', h('a', { href: page.preview_url }, 'Drag through the film')] : null)),
      h('div', { class: 'film-cta' },
        h('div', {}, h('p', {}, 'Have a question? Ryagram makes the data answer it.'),
          h('p', { class: 'film-meta' }, 'Ryagram is opening by invitation. Join the waitlist and we will tell you when it is your turn.')),
        h('a', { class: 'button primary', href: cta }, 'Make your own data film')),
      remixSection(page),
      sourcesSection(s),
      receipt(page)].filter(Boolean));
    window.ryagramFunnel?.filmEvent('film_view');
    document.getElementById('cta-top').setAttribute('href', cta);
    document.getElementById('sources-title')?.setAttribute('tabindex', '-1');         // so the header "Sources" link can move focus here too
    if (location.hash === '#sources') {                                      // the link an exported film points to: land on the sources
      const at = document.getElementById('sources');
      if (at) { at.scrollIntoView(); document.getElementById('sources-title')?.focus(); handledSources = true; }
    }
  }

  function notFound(text) {
    root.replaceChildren(h('h1', { tabindex: '-1' }, 'No film here'), h('p', {}, text),
      h('p', {}, h('a', { class: 'button primary', href: cta }, 'See what Ryagram makes')));
  }

  load().then(page => (page ? render(page) : notFound('This film page doesn’t exist, or its maker has stopped sharing it.')))
    .catch(() => notFound('The film couldn’t be loaded just now. Try again in a minute.'))
    .finally(() => { if (!handledSources) root.querySelector('h1')?.focus(); });   // a failed load focuses its heading too, #sources or not
})();
