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
  const cta = `/ryagram/?utm_source=film_page&utm_medium=referral&utm_campaign=${encodeURIComponent(SLUG.test(slug) ? slug : 'film')}`;

  async function load() {
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

  function render(page) {
    const s = page.summary || {};
    document.title = `${page.title} | Made with Ryagram`;
    const video = page.video_url
      ? h('video', { controls: true, playsinline: true, preload: 'metadata', poster: page.poster_url || null, src: page.video_url,
                     width: String(s.film?.width || 1920), height: String(s.film?.height || 1080) })
      : h('p', { class: 'film-gone' }, 'This film is no longer stored, but its sources are below.');
    root.replaceChildren(
      h('h1', { tabindex: '-1' }, page.title),
      s.subhead && s.subhead !== page.title ? h('p', { class: 'film-subhead' }, s.subhead) : null,
      h('figure', { class: 'film-player' }, video,
        h('figcaption', {}, 'Made with Ryagram · ', h('a', { href: '#sources' }, 'View sources'))),
      h('div', { class: 'film-cta' },
        h('p', {}, 'Have a question? Ryagram makes the data answer it.'),
        h('a', { class: 'button primary', href: cta }, 'Make your own data film')),
      sourcesSection(s),
      receipt(page));
    document.getElementById('cta-top').setAttribute('href', cta);
  }

  function notFound(text) {
    root.replaceChildren(h('h1', { tabindex: '-1' }, 'No film here'), h('p', {}, text),
      h('p', {}, h('a', { class: 'button primary', href: cta }, 'See what Ryagram makes')));
  }

  load().then(page => (page ? render(page) : notFound('This film page doesn’t exist, or its maker has stopped sharing it.')))
    .catch(() => notFound('The film couldn’t be loaded just now. Try again in a minute.'))
    .finally(() => root.querySelector('h1')?.focus());
})();
