// The dataset catalog (behind ryagramConfig.catalog): what the engine registers, grouped by topic,
// each with one line about it and its source, and marked by what the worker can run today.
// The data is GENERATED (tools/gen-catalog.py -> app-catalog-data.js); this file only arranges it.
//
//   usable  on the installed worker's allowlist: can start a film now
//   next    measured, arrives with the next worker update
//   later   registered by the engine, not measured for the worker's cache yet
//
// "Coming soon" (next + later) is only shown when ryagramConfig.catalogComingSoon is on; by default
// the catalog lists what can run, and nothing it can't.
(() => {
  const GROUPS = [
    { key: 'work', name: 'Work and industry', intro: 'Jobs, businesses and unemployment: who works where, and how that has shifted.' },
    { key: 'housing', name: 'Housing', intro: 'What gets built, where, and in what kind of building.' },
    { key: 'population', name: 'Population', intro: 'How many people live where, decade by decade.' },
    { key: 'health', name: 'Health', intro: 'Public-health measures by state.' },
    { key: 'roads', name: 'Roads', intro: 'The country’s road network over time.' },
    { key: 'income', name: 'Income', intro: 'Household income by place.' },
    { key: 'banking', name: 'Banking', intro: 'Bank branches and the places left without one.' },
    { key: 'politics', name: 'Politics', intro: 'Maps and counts from politics and elections.' },
    { key: 'other', name: 'More', intro: '' }
  ];
  const FAMILIES = {
    'cbp-share-state': 'Share of jobs by industry, by state',
    'cbp-share-county': 'Share of jobs by industry, by county',
    'cbp-employment': 'Jobs by industry, by county',
    'cbp-establishments': 'Number of businesses by industry, by county',
    'county-population': 'County population, by decade',
    'bps-unit-share': 'Share of new housing by building size, by county'
  };
  const STATUS_ORDER = { usable: 0, next: 1, later: 2 };
  const BUILD_VIEWS = ['map', 'bars', 'line', 'paired'];       // what a story from the catalog can use

  // What contact sheets have shown for the exact story the catalog builds (engine main 56f652e,
  // 2026-10-04). A view that fails the engine's own checks is not offered: it would stop at the gate.
  // Add to this list from a measured sheet, never from a guess.
  const MEASURED = {
    ok: { cbp_county_grocery: ['map'], cbp_suppression: ['line'] },
    blocked: {
      bls_state_unemployment: { map: 'its dots change too little to see, so the engine\u2019s check stops it' },
      cbp_suppression: { bars: 'it has too few rows for a ten-row race' },
      state_obesity_fastfood: { bars: 'states missing in some years make the rows jump' }
    }
  };

  const data = () => window.ryagramCatalogData || { engine: '', allow: [], next: {}, entries: [] };

  // Load the (large) generated data only when the catalog is opened.
  function load(base) {
    if (window.ryagramCatalogData) return Promise.resolve(window.ryagramCatalogData);
    return new Promise((resolve, reject) => {
      const here = typeof document !== 'undefined' ? document.querySelector('script[src*="app-catalog.js"]') : null;
      const script = document.createElement('script');
      script.src = (here ? here.getAttribute('src') : 'app-catalog.js').replace('app-catalog.js', 'app-catalog-data.js');
      script.onload = () => (window.ryagramCatalogData ? resolve(window.ryagramCatalogData) : reject(new Error('The catalog is empty.')));
      script.onerror = () => reject(new Error('Couldn’t load the catalog.'));
      (base || document.body).append(script);
    });
  }

  // The entries to show: usable always; the rest only in "coming soon" mode. Optional text filter.
  function visible(entries, { soon = false, text = '' } = {}) {
    const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(e => (soon || e.status === 'usable')
      && words.every(w => `${e.title} ${e.short} ${e.blurb} ${e.source} ${e.level}`.toLowerCase().includes(w)));
  }

  // [{ key, name, intro, ready, total, items: [entry], families: [{ key, title, items }] }] in display order,
  // empty groups left out. Within a group usable entries come first, then next, then later.
  function layout(entries, opts = {}) {
    const shown = visible(entries, opts);
    const out = [];
    for (const g of GROUPS) {
      const mine = shown.filter(e => (GROUPS.some(x => x.key === e.group) ? e.group : 'other') === g.key)
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
      if (!mine.length) continue;
      const items = mine.filter(e => !e.family);
      const families = [];
      for (const e of mine.filter(x => x.family)) {
        let f = families.find(x => x.key === e.family);
        if (!f) { f = { key: e.family, title: FAMILIES[e.family] || e.family, items: [] }; families.push(f); }
        f.items.push(e);
      }
      for (const f of families) f.items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.short.localeCompare(b.short));
      out.push({ key: g.key, name: g.name, intro: g.intro, ready: mine.filter(e => e.status === 'usable').length,
                 total: mine.length, items, families });
    }
    return out;
  }

  const statusLabel = e => (e.status === 'usable' ? 'Ready' : 'Coming soon');

  // Views a story from this dataset can use, each marked by whether Ryagram has drawn that
  // combination before (a confirmed template), so the page can say so.
  function viewChoices(entry, templates) {
    const tested = new Set(MEASURED.ok[entry.id] || []);
    for (const t of templates || []) {
      if (t.confirmed && t.datasets.includes(entry.id)) tested.add(t.view);
    }
    const blocked = MEASURED.blocked[entry.id] || {};
    return entry.views.filter(v => BUILD_VIEWS.includes(v))
      .map(v => ({ view: v, tested: tested.has(v) && !blocked[v], blocked: blocked[v] || '' }));
  }

  const VIEW_LABELS = { map: 'Map', bars: 'Bar race (top 10)', line: 'Lines (top 6)', paired: 'Map and bar race together' };

  // The story options for a catalog dataset, for window.ryagramTemplates.buildFor().
  function storyInfo(entry, view) {
    if (!entry.window) throw new Error('This dataset has no ready-made period yet.');
    if ((MEASURED.blocked[entry.id] || {})[view]) throw new Error('That view isn\u2019t offered for this dataset.');
    const style = {};
    if (view === 'map' && /counties/i.test(entry.level)) style.choropleth = { mode: 'solid', continuous: true };   // too small to hatch
    if (view === 'bars') style.bars = { swap_seconds: 0.5 };
    const settings = view === 'bars' ? { top_n: 10, axis: 'fixed' } : view === 'line' ? { line_top_n: 6 } : undefined;
    return { id: entry.id, label: entry.title, start: entry.window[0], end: entry.window[1], view, settings, style,
             hold: view === 'bars' ? 3 : undefined, headline: entry.family ? '' : entry.title, tplLabel: 'catalog' };
  }

  window.ryagramCatalog = { MEASURED, GROUPS, FAMILIES, BUILD_VIEWS, VIEW_LABELS, data, load, visible, layout, statusLabel, viewChoices, storyInfo };
})();
