// The guided builder: "Make a film step by step" (#/build). A person picks a dataset, a measure, the years, a film type, a look and a title, reads the source and licence,
// and gets a free contact sheet. Seven steps, one at a time; the raw story is behind "Advanced".
//
// The rules are the ENGINE's. This page does NOT validate datasets, coverage, measures or stories itself: it asks the guided-builder function (ENGINE's compileFilm, which checks
// the story against the worker's own schema) and shows every reason it gives, each pointing back at the step it is about. What this file decides is only wording and order.
// The dataset list is the function's: only entries a person may be shown (listable by RULINGS 2026-10-17, usable on the installed worker), each with its source and licence.
// Everything from the server goes in as text nodes, never as HTML.
//
// A TUTORIAL (NEXT-BUILDER 38; Ryan: the guided builder is for testing and tutorial only): the page says so, each step carries one tip, and "Try a sample" (#/build/sample)
// walks the same seven steps on the bundled sample (assets/app-builder-sample.js, a recording of the function's answers for one ready-made film). The sample makes nothing:
// no project, no story, no job; its review shows the recorded check, and only for the sample's own choices.
(() => {
  const STEPS = [['dataset', 'Dataset'], ['measure', 'Measure'], ['years', 'Years'], ['type', 'Film type'], ['look', 'Look'], ['title', 'Title'], ['review', 'Review']];
  const TYPE_WORDS = {
    map: ['Map', 'Shades each place by its value, year by year.'],
    bars: ['Bar race', 'Ranks the top places as bars that move as the years pass.'],
    line: ['Lines', 'Draws the top places as lines over time.'],
    paired: ['Paired', 'Shows two measures of the same places together.']
  };
  // Ready-made starts (NEXT-WEB 132 G3/G4): one click fills dataset, years, film type and title and lands on the Review (Back still works). Each is a view that has been
  // rendered before (app-templates.js): housing and health as maps, work as lines. A start is offered only when its dataset is in the catalog the function returned.
  // Income is not here: no income dataset is listable yet (proposals/WEB-GUIDED-FIRST-FILM-GAPS.md, G4).
  const READY_MADE = [
    { id: 'housing', label: 'Housing', blurb: 'Where new homes were permitted, county by county, 1990 to 2024.', dataset: 'bps_county_permits', film_type: 'map', title: 'New homes permitted per 1,000 residents, by county', start: '1990', end: '2024' },
    { id: 'health', label: 'Health', blurb: 'Adult obesity, state by state, 2011 to 2023.', dataset: 'state_obesity_fastfood', film_type: 'map', title: 'Adult obesity by state', start: '2011', end: '2023' },
    { id: 'work', label: 'Work', blurb: 'Unemployment, state by state, 2019 to 2022.', dataset: 'bls_state_unemployment', film_type: 'line', title: 'State unemployment rate, 2019 to 2022', start: '2019-01', end: '2022-12' }
  ];
  const readyMade = catalog => READY_MADE.filter(r => (catalog || []).some(d => d.id === r.dataset));
  const FILE_NOTE = 'The contact sheet is a quick still check of the film. It is free; you decide what to do after you have seen it.';
  // One tip per step, for the tutorial: what the step decides and what it never changes.
  const TIPS = {
    dataset: 'Tip: every dataset shows its source and licence before you use it. A ready-made start fills in every step for you.',
    measure: 'Tip: a measure is the number the film shows. “Let the film choose” uses the dataset’s main one.',
    years: 'Tip: leave both boxes empty to use the years the dataset is best at. A method change inside your years is listed here.',
    type: 'Tip: the same data can be a map, a bar race or lines. Only the types this dataset supports are offered.',
    look: 'Tip: a look changes colours and pacing only, never the numbers.',
    title: 'Tip: the title follows your choices until you type your own.',
    review: 'Tip: this is Ryagram’s own check of exactly what you chose. Each problem has a “Fix it” button that takes you to its step.'
  };
  const HEADING = 'Tutorial: make a film step by step';
  const SAMPLE_NOTE = 'This is the sample: it walks every step on bundled sample data and makes nothing. No project, no story and no picture are made.';
  const SAMPLE_ONLY = 'sample: the sample can only check its own ready-made choices. Use “Start the sample again” to put them back, or try your own data.';

  // The data the sample walk-through reads: the bundled recording instead of the function. It answers only what was recorded, and refuses any other request in words.
  function sampleData(rec) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
      builderCatalog: async () => ({ datasets: rec ? [rec.entry] : [] }),
      builderDescribe: async id => { if (!rec || id !== rec.dataset.id) throw new Error('That dataset is not in the sample.'); return { dataset: JSON.parse(JSON.stringify(rec.dataset)) }; },
      builderCompile: async request => { if (!rec || !same(request, rec.request)) { const e = new Error(SAMPLE_ONLY); e.errors = [SAMPLE_ONLY]; throw e; } return { story: JSON.parse(JSON.stringify(rec.story)), report: JSON.parse(JSON.stringify(rec.report)) }; },
      listLooks: async () => []
    };
  }

  // ---------------------------------------------------------------- pure helpers (tested in node)
  const typeWords = id => TYPE_WORDS[id] || [id, ''];
  const periodWord = p => (p ? `${p.from} to ${p.to || 'now'}${p.cadence === 'monthly' ? ', monthly' : ''}` : '');
  // A link from the catalog is shown only as a plain http(s) address: a bad registry entry can never become a javascript: or data: link.
  const webLink = u => (/^https?:\/\/[^\s<>"']{1,290}$/i.test(String(u == null ? '' : u)) ? String(u) : '');
  const sourceLine = d => `Source: ${d.publisher}${webLink(d.url) ? ` (${webLink(d.url)})` : ''}. Licence: ${d.licence_short}.`;

  // The step an engine sentence is about ("years.start: ..." -> years). Anything else belongs to the review.
  function stepOf(error) {
    const m = /^([a-z_]+)/.exec(String(error));
    return { dataset: 'dataset', measure: 'measure', years: 'years', film_type: 'type', places: 'type', look: 'look', title: 'title', subtitle: 'title' }[m && m[1]] || 'review';
  }
  function groupErrors(errors) {
    const by = {};
    for (const e of errors || []) (by[stepOf(e)] = by[stepOf(e)] || []).push(e);
    return by;
  }

  // The request for ENGINE's compileFilm from what the person chose. Years are sent only when they changed the defaults; a blank subtitle or measure is left out.
  function requestFrom(s) {
    const r = { dataset: s.dataset, film_type: s.type, title: String(s.title || '').trim() };
    if (s.subtitle && s.subtitle.trim()) r.subtitle = s.subtitle.trim();
    if (s.measure) r.measure = s.measure;
    const years = {};
    if (s.start && s.start.trim()) years.start = s.start.trim();
    if (s.end && s.end.trim()) years.end = s.end.trim();
    if (Object.keys(years).length) r.years = years;
    if (s.look) r.look = s.look;
    return r;
  }
  // Light format check only, so a typo does not cost a round trip; coverage and everything else is the engine's to say.
  function yearsShape(d, start, end) {
    const monthly = d && d.period && d.period.cadence === 'monthly';
    const ok = v => !v || (monthly ? /^[0-9]{4}(-(0[1-9]|1[0-2]))?$/.test(v.trim()) : /^[0-9]{4}$/.test(v.trim()));
    if (ok(start) && ok(end)) return null;
    return monthly ? 'Use a year like 2019 or a month like 2019-06.' : 'Use a four-digit year, like 2019.';
  }
  function suggestTitle(d, measureId, start, end) {
    const m = d && measureId ? d.measures.find(x => x.id === measureId) : null;
    const w = d ? [start || d.window[0], end || d.window[1]] : [];
    return d ? `${m ? m.label : d.title}, ${w[0]} to ${w[1]}`.slice(0, 160) : '';
  }
  const filterDatasets = (list, text) => {
    const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(d => words.every(w => `${d.title} ${d.topic} ${d.publisher} ${d.geography}`.toLowerCase().includes(w)));
  };

  // ---------------------------------------------------------------- the screens
  function create(ctx) {
    const { h, data, busy, showError, errorLine } = ctx;

    // opts.sample: the tutorial's sample walk-through (#/build/sample): every read goes to the bundled recording, and nothing is ever made.
    async function builderView(onStop, opts = {}) {
      const sample = !!opts.sample;
      const rec = sample ? window.ryagramBuilderSample : null;
      const src = sample ? sampleData(rec) : data;
      let catalog, myLooks = [];
      const error = errorLine();
      try { catalog = (await src.builderCatalog()).datasets; } catch (err) { return [h('a', { href: '#/', class: 'back' }, '← All projects'), h('h1', { tabindex: '-1' }, HEADING), h('p', { class: 'app-error', role: 'alert' }, err.message)]; }
      try { myLooks = await src.listLooks(); } catch { myLooks = []; }                         // the look step offers the person's own looks when they have any
      const s = { step: 0, dataset: null, d: null, measure: '', start: '', end: '', type: '', look: null, lookName: '', title: '', subtitle: '', titleEdited: false, built: null, problems: {} };
      // The sample starts with its recorded choices filled in, on the first step, so the person walks every step and sees what each one is.
      async function sampleChoices() {
        const r = rec.request;
        s.dataset = r.dataset; s.d = (await src.builderDescribe(r.dataset)).dataset; s.measure = r.measure || ''; s.type = r.film_type;
        s.start = (r.years && r.years.start) || ''; s.end = (r.years && r.years.end) || ''; s.title = r.title; s.titleEdited = true; s.subtitle = r.subtitle || ''; s.look = null; s.lookName = '';
      }
      if (sample) { try { await sampleChoices(); } catch (err) { return [h('a', { href: '#/build', class: 'back' }, '← The tutorial'), h('h1', { tabindex: '-1' }, HEADING), h('p', { class: 'app-error', role: 'alert' }, err.message)]; } }
      const root = h('div', { class: 'builder' });
      let compiled = null;                           // { story, report } from ENGINE's compileFilm, for the review

      const stepName = () => STEPS[s.step][0];
      function progress() {
        return h('ol', { class: 'builder-steps', 'aria-label': 'Steps' }, STEPS.map(([id, label], i) => h('li', { class: i === s.step ? 'is-current' : i < s.step ? 'is-done' : '', ...(i === s.step ? { 'aria-current': 'step' } : {}) }, label)));
      }
      function nav(next, { label = 'Next', disabled = false } = {}) {
        return h('div', { class: 'actions-row builder-nav' }, s.step > 0 ? h('button', { class: 'button secondary', type: 'button', onclick: () => go(s.step - 1) }, 'Back') : null,
          next ? h('button', { class: 'button primary', type: 'button', disabled, onclick: next }, label) : null);
      }
      function go(i) { s.step = Math.max(0, Math.min(STEPS.length - 1, i)); error.hidden = true; draw(); root.querySelector('h2')?.focus(); }
      function problems(step) {
        const list = (s.problems[step] || []);
        return list.length ? h('ul', { class: 'builder-problems', role: 'alert' }, list.map(p => h('li', {}, p))) : null;
      }
      // The source and licence, shown as soon as there is a dataset and before anything is made.
      function sourceBox() {
        if (!s.d) return null;
        const d = s.d;
        return h('aside', { class: 'builder-source' }, h('h3', {}, 'Source and licence'), h('p', {}, `Source: ${d.publisher}.`, webLink(d.url) ? [' ', h('a', { href: webLink(d.url), rel: 'noopener noreferrer', target: '_blank' }, 'The data’s page')] : null),
          h('p', {}, `Licence: ${d.licence_short}.`), h('details', {}, h('summary', {}, 'Read the full licence'), h('p', {}, d.licence)));
      }

      // One click to the Review: describe the dataset, set everything the start knows, and jump. A film type the dataset does not offer falls back to its first.
      async function useStart(r, button) {
        error.hidden = true; button.disabled = true;
        try {
          const d = (await src.builderDescribe(r.dataset)).dataset;
          s.dataset = r.dataset; s.d = d; compiled = null; s.measure = '';
          s.type = d.film_types.includes(r.film_type) ? r.film_type : d.film_types[0];
          s.start = r.start; s.end = r.end; s.title = r.title; s.titleEdited = true; s.subtitle = '';
          go(6);
        } catch (err) { button.disabled = false; showError(error, err); }
      }

      function stepDataset() {
        const filter = h('input', { id: 'bd-filter', type: 'search', autocomplete: 'off', placeholder: 'Search by topic or name', 'aria-label': 'Search datasets' });
        const list = h('div', { class: 'builder-list', role: 'radiogroup', 'aria-label': 'Datasets' });
        function drawList() {
          const shown = filterDatasets(catalog, filter.value);
          list.replaceChildren(...(shown.length ? shown.map(d => h('label', { class: `builder-card${s.dataset === d.id ? ' is-chosen' : ''}` },
            h('input', { type: 'radio', name: 'bd-dataset', value: d.id, ...(s.dataset === d.id ? { checked: true } : {}), onchange: () => choose(d.id) }),
            h('strong', {}, d.title), h('span', { class: 'meta' }, `${d.topic} · ${d.geography} · ${periodWord(d.period)}`),
            h('span', { class: 'meta' }, `Source: ${d.publisher} · Licence: ${d.licence_short}`))) : [h('p', { class: 'form-note' }, 'Nothing matches that.')]));
        }
        async function choose(id) {
          error.hidden = true;
          s.dataset = id; s.d = null; compiled = null;
          s.measure = ''; s.start = ''; s.end = ''; s.type = ''; if (!s.titleEdited) s.title = '';
          drawList(); nextBtn.disabled = true;
          try { s.d = (await src.builderDescribe(id)).dataset; } catch (err) { showError(error, err); return; }
          nextBtn.disabled = false;
          sourceHolder.replaceChildren(sourceBox());
        }
        filter.addEventListener('input', drawList);
        const nextBtn = h('button', { class: 'button primary', type: 'button', disabled: !s.d, onclick: () => go(1) }, 'Next');
        const sourceHolder = h('div', {}, sourceBox());
        drawList();
        const starts = readyMade(catalog);
        const ready = starts.length ? h('section', { class: 'builder-ready', 'aria-labelledby': 'bd-ready-title' }, h('h2', { id: 'bd-ready-title', tabindex: '-1' }, 'Start from a ready-made film'),
          h('p', { class: 'form-note' }, 'One click and you are at the last step. You can go back and change anything. The first picture is free.'),
          h('div', { class: 'builder-list' }, starts.map(r => { const b = h('button', { type: 'button', class: 'builder-start', 'data-start': r.id }, h('strong', {}, r.label), h('span', { class: 'meta' }, r.blurb)); b.addEventListener('click', () => useStart(r, b)); return b; }))) : null;
        const trySample = sample ? null : h('p', { class: 'form-note builder-sample-link' }, h('a', { href: '#/build/sample' }, 'Try a sample first'), ': it walks every step on bundled sample data and makes nothing.');
        return [trySample, ready, h('h2', { tabindex: '-1' }, 'Which data?'), h('p', { class: 'form-note' }, (starts.length ? 'Or choose your own. ' : '') + 'Every dataset shows where it comes from and what its licence allows. Pick one to read more.'),
          filter, list, sourceHolder, h('div', { class: 'actions-row builder-nav' }, nextBtn)];
      }

      function stepMeasure() {
        const d = s.d;
        const options = [['', 'Let the film choose', `The dataset’s main measure: ${(d.measures.find(m => m.selectable) || d.measures[0]).label}.`],
                         ...d.measures.filter(m => m.selectable).map(m => [m.id, m.label, m.unit ? `Shown in ${m.unit}.` : ''])];
        return [h('h2', { tabindex: '-1' }, 'What do you want to show?'), h('div', { class: 'builder-list', role: 'radiogroup', 'aria-label': 'Measure' }, options.map(([id, label, note]) => h('label', { class: `builder-card${s.measure === id ? ' is-chosen' : ''}` },
          h('input', { type: 'radio', name: 'bd-measure', value: id, ...(s.measure === id ? { checked: true } : {}), onchange: () => { s.measure = id; compiled = null; draw(); } }), h('strong', {}, label), h('span', { class: 'meta' }, note)))),
          problems('measure'), sourceBox(), nav(() => go(2))];
      }

      function stepYears() {
        const d = s.d;
        const start = h('input', { id: 'bd-start', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '7', value: s.start, placeholder: d.window[0] });
        const end = h('input', { id: 'bd-end', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '7', value: s.end, placeholder: d.window[1] });
        const note = h('p', { class: 'form-note app-error', role: 'alert', hidden: true });
        start.addEventListener('input', () => { s.start = start.value; compiled = null; });
        end.addEventListener('input', () => { s.end = end.value; compiled = null; });
        const crossing = d.methodology_breaks.length ? h('div', { class: 'builder-breaks' }, h('h3', {}, 'Worth knowing about these years'),
          h('ul', {}, d.methodology_breaks.map(b => h('li', {}, `${b.period}: ${b.what} ${b.effect}`)))) : null;
        return [h('h2', { tabindex: '-1' }, 'Which years?'),
          h('p', { class: 'form-note' }, `This data covers ${periodWord(d.period)}. Leave a box empty to use ${d.window[0]} to ${d.window[1]}.`),
          h('div', { class: 'builder-years' }, h('label', { for: 'bd-start' }, 'From'), start, h('label', { for: 'bd-end' }, 'To'), end), note, problems('years'), crossing, sourceBox(),
          nav(() => { const p = yearsShape(d, start.value, end.value); if (p) { note.textContent = p; note.hidden = false; return; } s.start = start.value; s.end = end.value; go(3); })];
      }

      function stepType() {
        const d = s.d;
        const types = d.film_types;
        if (!types.includes(s.type)) s.type = '';
        return [h('h2', { tabindex: '-1' }, 'What kind of film?'), h('div', { class: 'builder-list', role: 'radiogroup', 'aria-label': 'Film type' }, types.map(id => {
          const [label, note] = typeWords(id);
          return h('label', { class: `builder-card${s.type === id ? ' is-chosen' : ''}` }, h('input', { type: 'radio', name: 'bd-type', value: id, ...(s.type === id ? { checked: true } : {}),
            onchange: () => { s.type = id; compiled = null; draw(); } }), h('strong', {}, label), h('span', { class: 'meta' }, note),
            id === 'map' && d.continuous_colour ? h('span', { class: 'meta' }, `Drawn in continuous colour, because these areas are too small to hatch.`) : null);
        })), d.missing_is_ambiguous ? h('p', { class: 'form-note' }, 'In this source a missing value does not say whether it is zero or withheld; the film says so.') : null,
          problems('type'), nav(() => go(4), { disabled: !s.type })];
      }

      function stepLook() {
        const options = [[null, 'The film’s own look', 'Dark page, the engine’s standard colours.'], ...myLooks.map(l => [l, l.title || l.name, l.is_default ? 'Your default look.' : `Based on ${l.based_on || 'your own settings'}.`])];
        if (myLooks.length && !s.lookChosen) { const def = myLooks.find(l => l.is_default); if (def) { s.look = def.spec; s.lookName = def.name; } s.lookChosen = true; }
        return [h('h2', { tabindex: '-1' }, 'Which look?'), h('p', { class: 'form-note' }, 'A look changes colours, theme and pacing. It never changes the data, the scale or the checks.'),
          h('div', { class: 'builder-list', role: 'radiogroup', 'aria-label': 'Look' }, options.map(([l, label, note]) => h('label', { class: `builder-card${(l ? s.lookName === l.name : !s.look) ? ' is-chosen' : ''}` },
            h('input', { type: 'radio', name: 'bd-look', value: l ? l.name : '', ...((l ? s.lookName === l.name : !s.look) ? { checked: true } : {}), onchange: () => { s.look = l ? l.spec : null; s.lookName = l ? l.name : ''; compiled = null; draw(); } }),
            h('strong', {}, label), h('span', { class: 'meta' }, note)))),
          myLooks.length ? null : h('p', { class: 'form-note' }, 'You can make your own looks later under Your look.'), problems('look'), nav(() => go(5))];
      }

      function stepTitle() {
        const d = s.d;
        if (!s.titleEdited) s.title = suggestTitle(d, s.measure, s.start, s.end);        // follows the choices until the person types their own
        const title = h('input', { id: 'bd-title', type: 'text', maxlength: '160', autocomplete: 'off', value: s.title, required: true });
        const sub = h('input', { id: 'bd-subtitle', type: 'text', maxlength: '320', autocomplete: 'off', value: s.subtitle, placeholder: 'Optional' });
        const note = h('p', { class: 'form-note app-error', role: 'alert', hidden: true });
        title.addEventListener('input', () => { s.title = title.value; s.titleEdited = true; compiled = null; });
        sub.addEventListener('input', () => { s.subtitle = sub.value; compiled = null; });
        return [h('h2', { tabindex: '-1' }, 'What is it called?'), h('label', { for: 'bd-title' }, 'Title'), title, h('label', { for: 'bd-subtitle' }, 'Subtitle'), sub, note, problems('title'),
          nav(() => { if (!title.value.trim()) { note.textContent = 'Give the film a title.'; note.hidden = false; return; } s.title = title.value; s.subtitle = sub.value; go(6); })];
      }

      // The review: ENGINE's compile of exactly this request, every reason shown if it refuses, the source and licence, the story behind Advanced.
      function stepReview() {
        const out = h('div', { class: 'builder-review' }, h('p', { class: 'form-note' }, 'Checking this film…'));
        const make = h('button', { class: 'button primary', type: 'button', disabled: true }, 'Make the film and a free contact sheet');
        const story = h('textarea', { id: 'bd-story', rows: '16', spellcheck: 'false', 'aria-label': 'The story (advanced)' });
        const storyNote = h('p', { class: 'form-note app-error', role: 'alert', hidden: true });
        async function check() {
          try {
            compiled = await src.builderCompile(requestFrom(s));
            s.problems = {};
            const r = compiled.report;
            out.replaceChildren(
              h('dl', { class: 'builder-summary' }, [['Data', r.dataset.title], ['Measure', r.measure ? `${r.measure.label}${r.measure.unit ? ` (${r.measure.unit})` : ''}` : 'the film’s own choice'], ['Years', `${r.window.start} to ${r.window.end}`],
                ['Film type', typeWords(r.film_type)[0]], ['Look', r.look.applied ? (s.lookName || 'your look') : 'the film’s own'], ['Title', s.title.trim()]].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
              ...r.warnings.map(w => h('p', { class: 'form-note builder-warning' }, w)),
              r.method_notes.length ? h('details', {}, h('summary', {}, 'Method notes from the source'), h('ul', {}, r.method_notes.map(n => h('li', {}, n)))) : '',
              sample ? '' : h('p', { class: 'form-note' }, FILE_NOTE));
            story.value = JSON.stringify(compiled.story, null, 2);
            make.disabled = false;
          } catch (err) {
            compiled = null;
            const errs = err.errors || [err.message];
            s.problems = groupErrors(errs);
            out.replaceChildren(h('div', { role: 'alert' }, h('p', { class: 'app-error' }, 'This film can’t be made yet:'),
              h('ul', { class: 'builder-problems' }, errs.map(e => h('li', {}, e, ' ', h('button', { class: 'link-button', type: 'button', onclick: () => go(STEPS.findIndex(([id]) => id === stepOf(e))) }, 'Fix it'))))));
          }
        }
        // The sample makes nothing: in place of the Make button, the way back to its own choices and the way to real data.
        const again = sample ? h('button', { class: 'button secondary', type: 'button', onclick: async () => { await sampleChoices(); compiled = null; s.problems = {}; go(0); } }, 'Start the sample again') : null;
        if (sample) make.hidden = true;
        if (!sample) make.addEventListener('click', async () => {
          let finalStory;
          try { finalStory = JSON.parse(story.value); if (!finalStory || typeof finalStory !== 'object' || Array.isArray(finalStory)) throw new Error('not an object'); }
          catch { storyNote.textContent = 'The story is not valid JSON. Put it back or fix it.'; storyNote.hidden = false; return; }
          storyNote.hidden = true; error.hidden = true;
          await busy(make, 'Making…', async () => {
            let made = null;
            try {
              made = await data.createProject(s.title.trim());
              await data.saveStory(made.version.id, finalStory);
              await data.submitJob(made.version.id, 'contact_sheet', {}, null);
              location.hash = `#/v/${made.version.id}`;
            } catch (err) {
              showError(error, err);
              if (made) error.append(' ', h('a', { href: `#/v/${made.version.id}` }, 'Open the film'));       // the project exists; the person can carry on there
            }
          });
        });
        check();
        return [h('h2', { tabindex: '-1' }, 'Review'), out, sourceBox(),
          h('details', { class: 'builder-advanced' }, h('summary', {}, 'Advanced: the story'), h('p', { class: 'form-note' }, 'This is the exact story that will be saved. You can edit it; Ryagram’s checks still run on every render.'), story, storyNote),
          sample ? h('p', { class: 'form-note builder-sample-note' }, SAMPLE_NOTE, ' ', h('a', { href: '#/build' }, 'Try it with your own data')) : null,
          h('div', { class: 'actions-row builder-nav' }, h('button', { class: 'button secondary', type: 'button', onclick: () => go(5) }, 'Back'), sample ? again : make)];
      }

      function draw() {
        const body = { dataset: stepDataset, measure: stepMeasure, years: stepYears, type: stepType, look: stepLook, title: stepTitle, review: stepReview }[stepName()]();
        root.replaceChildren(progress(), h('p', { class: 'form-note builder-tip' }, TIPS[stepName()]), ...body.flat().filter(x => x != null && x !== false), error);
      }
      draw();
      return [h('a', { href: sample ? '#/build' : '#/', class: 'back' }, sample ? '← The tutorial' : '← All projects'), h('h1', { tabindex: '-1' }, sample ? `${HEADING}: the sample` : HEADING),
        h('p', { class: 'form-intro' }, sample ? SAMPLE_NOTE : 'This tutorial is for learning and testing. Choose the data, the years and the kind of film. You see where the data comes from before anything is made, and the first picture is free.'), root];
    }

    return { builderView };
  }

  window.ryagramBuilder = { webLink, create, STEPS, TIPS, HEADING, SAMPLE_NOTE, sampleData, READY_MADE, readyMade, TYPE_WORDS, typeWords, periodWord, sourceLine, stepOf, groupErrors, requestFrom, yearsShape, suggestTitle, filterDatasets };
})();
