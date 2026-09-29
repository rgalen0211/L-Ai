// Story templates: a new version starts from a valid story instead of a blank {}.
// Each template is one view over catalog datasets with a period window that has been
// rendered before (map and paired from real Ryagram stories; line and bars rendered by CC1 on
// the engine's main, 2026-09-29, both passing the_film_actually_moves). The output follows
// the worker's story schema v1 (Ryagram branch worker, ryagram/worker/schema.py): closed
// keys, canvas/fps/theme from its lists, render views map | bars | line | paired | panel.
// The engine draws each dataset's source credit on every frame, so templates add none.
(() => {
  const DATASETS = {
    state_obesity_fastfood: { label: 'Obesity and fast food by state (CDC + Census, annual)', start: '2011', end: '2023' },
    bps_county_permits: { label: 'Residential building permits per 1,000 residents, by county', start: '1990', end: '2024' },
    bls_state_unemployment: { label: 'State unemployment rate (BLS LAUS, monthly)', start: '2019-01', end: '2022-12' }
  };

  const TEMPLATES = [
    { id: 'line', view: 'line', label: 'Line', blurb: 'How a handful of places move over time.',
      datasets: ['bls_state_unemployment'], settings: { line_top_n: 6 }, confirmed: true },
    { id: 'map', view: 'map', label: 'Map', blurb: 'Where it is high and low, and how that shifts.',
      datasets: ['state_obesity_fastfood', 'bps_county_permits'], confirmed: true },
    { id: 'bars', view: 'bars', label: 'Bars', blurb: 'A ranked bar race: who leads, year by year.',
      datasets: ['bls_state_unemployment'], settings: { top_n: 10, axis: 'fixed' }, confirmed: true },
    { id: 'paired', view: 'paired', label: 'Paired', blurb: 'A map and a bar race side by side, one timeline.',
      datasets: ['state_obesity_fastfood'], confirmed: true }
  ];

  // What the schema allows in text drawn on a frame: no control or invisible characters.
  const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
  const cleanText = (text, max) => String(text || '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  // Story "name": ^[A-Za-z0-9][A-Za-z0-9-]{0,63}$
  function slug(text) {
    const s = String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
    return s || 'ryagram-story';
  }

  function build(templateId, datasetId, headline) {
    const t = TEMPLATES.find(x => x.id === templateId);
    if (!t) throw new Error('Unknown template.');
    if (!t.datasets.includes(datasetId)) throw new Error('That dataset isn’t offered for this template.');
    const d = DATASETS[datasetId];
    const title = cleanText(headline, 160) || cleanText(d.label, 160);
    const render = { kind: 'render', id: 'main', dataset: datasetId, view: t.view, start: d.start, end: d.end,
                     transition: { kind: 'crossfade', seconds: 0.6 } };
    if (t.settings) render.settings = { ...t.settings };
    return {
      schema: 1,
      name: slug(title),
      engine: 'sequence',
      notes: cleanText(`Started from the ${t.label} template. Edit the headline, the years (start and end) or the view, then make a contact sheet.`, 4000),
      sequence: {
        canvas: [1920, 1080],
        fps: 30,
        theme: 'dark',
        hold_seconds: 0.5,
        clips: [
          { kind: 'title', id: 'open', seconds: 3, fade: 0.4, headline: title, subhead: cleanText(d.label, 160) },
          render
        ]
      }
    };
  }

  // A story is "blank" when there is nothing to lose by replacing it.
  const isBlank = story => !story || typeof story !== 'object' || Object.keys(story).length === 0;

  window.ryagramTemplates = { TEMPLATES, DATASETS, build, slug, isBlank };
})();
