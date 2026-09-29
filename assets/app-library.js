// Ryagram library views (2A-2): projects -> versions (r1, r2, ...) -> one version.
// Routes: #/ (projects), #/p/<id> (a project), #/v/<id> (a version, with its
// render panel: 2A-3).
// Everything from the database goes in as text nodes, never as HTML.
(() => {
  const EDITABLE = ['draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render'];
  const STATE_LABELS = {
    draft: 'Draft', sampling: 'Sampling', previewing: 'Previewing',
    editorial_action_required: 'Needs a decision', ready_to_render: 'Ready to render',
    queued: 'Queued', rendering: 'Rendering', validating: 'Checking', uploading: 'Uploading',
    complete: 'Complete', failed: 'Failed', archived: 'Archived', non_restorable: 'Can’t be rebuilt'
  };
  const KIND_LABELS = {
    final_video: 'Final film', preview: 'Preview', contact_sheet: 'Contact sheet', thumbnail: 'Thumbnail',
    receipt: 'Receipt (JSON)', receipt_text: 'Receipt', metering: 'Metering'
  };
  const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else if (key === 'value') el.value = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child != null && child !== false) el.append(child);   // strings become text nodes
    }
    return el;
  }

  const date = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const badge = state => h('span', { class: `state state-${state}` }, STATE_LABELS[state] || state);
  function bytes(n) {
    if (n == null) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return `${i ? n.toFixed(1) : n} ${units[i]}`;
  }

  // Credits show once the 2B ledger is live (credits: true in ryagram-config.js), or in mock mode.
  const creditsOn = () => window.ryagramConfig?.credits === true || !!window.ryagramMock;

  function mount(root, data) {
    let token = 0;
    let stopView = () => {};                      // timers and subscriptions of the page on screen

    async function route() {
      const mine = ++token;
      const hash = location.hash;
      const stops = [];
      const onStop = fn => stops.push(fn);
      if (!root.childElementCount) root.replaceChildren(h('p', { class: 'form-intro' }, 'Loading…'));
      let view;
      try {
        let m;
        if ((m = hash.match(new RegExp(`^#/p/${UUID}$`)))) view = await projectView(m[1]);
        else if ((m = hash.match(new RegExp(`^#/v/${UUID}$`)))) view = await versionView(m[1], onStop);
        else view = await libraryView();
      } catch (err) {
        view = [h('h1', { tabindex: '-1' }, 'Something went wrong'),
                h('p', { class: 'app-error', role: 'alert' }, err.message),
                h('a', { href: '#/' }, 'Back to your projects')];
      }
      if (mine !== token) { stops.forEach(fn => fn()); return; }   // a newer page load won
      stopView();
      stopView = () => stops.forEach(fn => fn());
      root.replaceChildren(...view);
      root.querySelector('h1')?.focus();
    }

    function errorLine() {
      return h('p', { class: 'form-note app-error', role: 'alert', hidden: true });
    }
    function showError(el, err) {
      el.textContent = err.message;
      el.hidden = false;
    }
    async function busy(button, label, work) {
      const was = button.textContent;
      button.disabled = true;
      button.textContent = label;
      try { await work(); } finally { button.disabled = false; button.textContent = was; }
    }

    // --- #/  all projects
    async function libraryView() {
      const projects = await data.listProjects();
      const error = errorLine();
      const input = h('input', { id: 'np-title', name: 'title', required: true, maxlength: '200', autocomplete: 'off',
                                 placeholder: 'What’s the story?' });
      const create = h('button', { class: 'button primary', type: 'submit' }, 'Create');
      const form = h('form', { class: 'inline-form', onsubmit: async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        error.hidden = true;
        await busy(create, 'Creating…', async () => {
          try {
            const { version } = await data.createProject(input.value);
            location.hash = `#/v/${version.id}`;
          } catch (err) { showError(error, err); }
        });
      } }, h('label', { for: 'np-title' }, 'New project'), h('div', { class: 'inline-row' }, input, create), error);

      const list = projects.length
        ? h('ul', { class: 'project-list' }, projects.map(p => h('li', {},
            h('a', { href: `#/p/${p.id}` }, p.title),
            h('span', { class: 'meta' },
              p.latest ? [`r${p.latest.number} · `, badge(p.latest.state), ` · updated ${date(p.updated_at)}`]
                       : `No versions · updated ${date(p.updated_at)}`))))
        : h('p', { class: 'form-intro' }, 'No projects yet. Name one above and it starts as r1.');
      const credits = creditsOn() ? h('p', { class: 'credit-balance' }, 'Loading credits…') : null;
      if (credits) data.creditBalances().then(rows => { credits.textContent = window.ryagramCredits.balanceLine(rows); })
        .catch(() => { credits.textContent = 'Couldn’t load your credits.'; });
      return [h('h1', { tabindex: '-1' }, 'Your projects'), credits, form, list];
    }

    // --- #/p/<id>  one project and its versions
    async function projectView(id) {
      const { project, versions } = await data.getProject(id);
      const numberOf = Object.fromEntries(versions.map(v => [v.id, v.number]));
      const error = errorLine();

      const renameInput = h('input', { name: 'title', required: true, maxlength: '200', value: project.title, 'aria-label': 'Project name' });
      const renameButton = h('button', { class: 'button primary', type: 'submit' }, 'Save name');
      const renameForm = h('form', { class: 'inline-form', hidden: true, onsubmit: async event => {
        event.preventDefault();
        if (!renameForm.reportValidity()) return;
        await busy(renameButton, 'Saving…', async () => {
          try { await data.renameProject(project.id, renameInput.value); await route(); }
          catch (err) { showError(error, err); }
        });
      } }, h('div', { class: 'inline-row' }, renameInput, renameButton));

      const actions = h('div', { class: 'actions-row' },
        h('button', { class: 'button secondary', type: 'button', onclick: () => {
          renameForm.hidden = !renameForm.hidden;
          if (!renameForm.hidden) renameInput.focus();
        } }, 'Rename'),
        h('button', { class: 'button secondary', type: 'button', onclick: async event => {
          if (!confirm(`Archive “${project.title}”? Its versions and files are kept.`)) return;
          await busy(event.currentTarget, 'Archiving…', async () => {
            try { await data.archiveProject(project.id); location.hash = '#/'; }
            catch (err) { showError(error, err); }
          });
        } }, 'Archive project'));

      const rows = [...versions].reverse().map(v => h('li', {},
        h('a', { href: `#/v/${v.id}`, class: 'version-link' }, `r${v.number}`),
        badge(v.state),
        h('span', { class: 'meta' },
          v.parent_version_id && numberOf[v.parent_version_id] ? `from r${numberOf[v.parent_version_id]} · ` : '',
          date(v.created_at)),
        h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
          await busy(event.currentTarget, 'Copying…', async () => {
            try { const nv = await data.createVersion(project.id, v.id); location.hash = `#/v/${nv.id}`; }
            catch (err) { showError(error, err); }
          });
        } }, `New version from r${v.number}`)));

      return [
        h('a', { href: '#/', class: 'back' }, '← All projects'),
        h('h1', { tabindex: '-1' }, project.title),
        actions, renameForm, error,
        h('h2', {}, 'Versions'),
        h('p', { class: 'form-intro' }, 'Each version keeps its own story and files. Making a new version copies the story and leaves the old one as it was.'),
        h('ul', { class: 'version-list' }, rows)
      ];
    }

    // --- #/v/<id>  one version
    async function versionView(id, onStop) {
      const { version: v, project, parent, artifacts } = await data.getVersion(id);
      const locked = !EDITABLE.includes(v.state);
      const error = errorLine();
      const saved = h('p', { class: 'form-note', role: 'status' });

      const newVersion = async event => {
        await busy(event.currentTarget, 'Copying…', async () => {
          try { const nv = await data.createVersion(v.project_id, v.id); location.hash = `#/v/${nv.id}`; }
          catch (err) { showError(error, err); }
        });
      };

      const files = filesSection(v, artifacts);
      const jobs = jobsPanel(v, {
        settled: () => files.refresh(),
        versionChanged: () => route()
      });
      onStop(jobs.stop);

      const story = h('textarea', { id: 'story', class: 'story', spellcheck: 'false', readonly: locked,
                                    'aria-describedby': 'story-help', value: JSON.stringify(v.story_spec, null, 2) });
      const save = h('button', { class: 'button primary', type: 'submit', disabled: locked }, 'Save story');
      const storyForm = h('form', { onsubmit: async event => {
        event.preventDefault();
        error.hidden = true;
        saved.textContent = '';
        let parsed;
        try { parsed = JSON.parse(story.value); } catch (err) {
          showError(error, new Error(`That isn’t valid JSON: ${err.message}`));
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          showError(error, new Error('The story must be a JSON object.'));
          return;
        }
        await busy(save, 'Saving…', async () => {
          try {
            const result = await data.saveStory(v.id, parsed);
            saved.textContent = 'Saved. Earlier sheets and previews were of the old story, so the final render needs new ones.';
            jobs.storyChanged(result.story_sha256);
          } catch (err) { showError(error, err); }
        });
      } },
        h('label', { for: 'story' }, 'Story'),
        h('p', { id: 'story-help', class: 'form-note' }, locked
          ? `This version is ${(STATE_LABELS[v.state] || v.state).toLowerCase()} and can’t change. Make a new version from it to keep working.`
          : 'The story file this version renders from. The render worker checks it in full before drawing anything.'),
        story, locked ? null : save, saved, error);

      const picker = locked ? null : templatePicker(project, v, async built => {
        const blank = window.ryagramTemplates.isBlank(v.story_spec);
        if (!blank && !confirm('Replace the current story with this template? Save a new version first if you want to keep it.')) return false;
        const result = await data.saveStory(v.id, built);
        v.story_spec = built;
        story.value = JSON.stringify(built, null, 2);
        saved.textContent = 'Template applied and saved. Change the headline or years if you like, then make a contact sheet.';
        jobs.storyChanged(result.story_sha256);
        return true;
      });

      const editorOn = window.ryagramConfig?.aiEditor === true || !!window.ryagramMock;
      const chat = editorOn && !locked ? editorPanel(v, {
        storyChanged: () => route(),
        refreshJobs: () => jobs.refresh()
      }) : null;

      return [
        h('a', { href: `#/p/${project.id}`, class: 'back' }, `← ${project.title}`),
        h('h1', { tabindex: '-1' }, `r${v.number} `, badge(v.state)),
        h('p', { class: 'meta' }, parent ? `Made from r${parent.number} · ` : '', `created ${date(v.created_at)}`),
        h('div', { class: 'actions-row' },
          h('button', { class: 'button secondary', type: 'button', onclick: newVersion }, `New version from r${v.number}`),
          v.state === 'complete'
            ? h('button', { class: 'button secondary', type: 'button', onclick: async event => {
                await busy(event.currentTarget, 'Archiving…', async () => {
                  try { await data.setVersionState(v.id, 'archived'); await route(); }
                  catch (err) { showError(error, err); }
                });
              } }, 'Archive this version')
            : null),
        picker,
        chat,
        storyForm,
        jobs.el,
        files.el
      ];
    }

    // The AI editor, as a panel on the version page. Replies are text nodes only.
    function editorPanel(v, { storyChanged, refreshJobs }) {
      const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
      const error = errorLine();
      const input = h('textarea', { id: 'chat-input', rows: '2', maxlength: '4000', placeholder: 'Ask the editor: “make it a map of 2016 to 2022”, “why did the check stop this?”' });
      const send = h('button', { class: 'button primary', type: 'submit' }, 'Send');
      const line = (role, text) => log.append(h('div', { class: `chat-msg chat-${role}` },
        h('span', { class: 'chat-who' }, role === 'user' ? 'You' : 'Editor'), h('p', {}, text)));

      data.editorHistory(v.id).then(rows => rows.forEach(r => line(r.role, r.content))).catch(() => {});

      const form = h('form', { class: 'chat-form', onsubmit: async event => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message) return;
        error.hidden = true;
        line('user', message);
        input.value = '';
        await busy(send, 'Thinking…', async () => {
          try {
            const res = await data.askEditor(v.id, message);
            line('assistant', res.reply);
            for (const a of res.actions || []) {
              if (a.type === 'needs_approval') line('assistant', 'Ready when you are: press “Render final film” in the Render panel below. That click is your approval.');
              if (a.type === 'version_created') log.append(h('p', { class: 'form-note' }, h('a', { href: `#/v/${a.version_id}` }, `Open r${a.number}`)));
              if (a.type === 'job_submitted') refreshJobs();
            }
            if ((res.actions || []).some(a => a.type === 'story_changed')) storyChanged();
          } catch (err) { showError(error, err); }
        });
      } }, h('label', { for: 'chat-input', class: 'visually-hidden' }, 'Message to the editor'), input, send, error);

      return h('section', { class: 'chat-panel', 'aria-labelledby': 'chat-title' },
        h('h2', { id: 'chat-title' }, 'Editor'),
        h('p', { class: 'form-note' }, 'Describe the film you want or ask about a check. It edits this version’s story and can start sheets and previews; only you can start the final film.'),
        log, form);
    }

    // "Start from a template": a view, a dataset, a headline -> a valid story.
    function templatePicker(project, v, apply) {
      const T = window.ryagramTemplates;
      const blank = T.isBlank(v.story_spec);
      const error = errorLine();
      let chosen = T.TEMPLATES.find(t => t.id === 'map') || T.TEMPLATES[0];

      const datasetSelect = h('select', { id: 'tpl-dataset' });
      const headline = h('input', { id: 'tpl-headline', maxlength: '160', value: project.title, autocomplete: 'off' });
      const note = h('p', { class: 'form-note' });
      const cards = h('div', { class: 'template-grid', role: 'radiogroup', 'aria-label': 'Template' });

      function fillDatasets() {
        datasetSelect.replaceChildren(...chosen.datasets.map(id => h('option', { value: id }, T.DATASETS[id].label)));
        note.textContent = chosen.confirmed
          ? ''
          : 'This view hasn’t been rendered on this dataset before, so check the contact sheet closely.';
      }
      function drawCards() {
        cards.replaceChildren(...T.TEMPLATES.map(t => h('label', { class: `template-card${t === chosen ? ' is-chosen' : ''}` },
          h('input', { type: 'radio', name: 'tpl', value: t.id, checked: t === chosen,
                       onchange: () => { chosen = t; drawCards(); fillDatasets(); } }),
          h('strong', {}, t.label), h('span', {}, t.blurb))));
      }
      drawCards();
      fillDatasets();

      const use = h('button', { class: 'button primary', type: 'submit' }, 'Use this template');
      const form = h('form', { class: 'template-form', onsubmit: async event => {
        event.preventDefault();
        error.hidden = true;
        await busy(use, 'Applying…', async () => {
          try {
            if (await apply(T.build(chosen.id, datasetSelect.value, headline.value))) details.open = false;
          } catch (err) { showError(error, err); }
        });
      } },
        cards,
        h('div', { class: 'template-fields' },
          h('div', {}, h('label', { for: 'tpl-dataset' }, 'Data'), datasetSelect),
          h('div', {}, h('label', { for: 'tpl-headline' }, 'Headline'), headline)),
        note, use, error);

      const details = h('details', { class: 'template-picker', open: blank },
        h('summary', {}, blank ? 'Start from a template' : 'Start again from a template'),
        h('p', { class: 'form-note' }, 'Pick a kind of film and the data. You get a complete story you can then adjust.'),
        form);
      return details;
    }

    // Files for a version, refreshed on its own when a job finishes so the
    // story editor above is never reset.
    function filesSection(v, initial) {
      const list = h('div');
      const el = h('section', { 'aria-labelledby': 'files-title' }, h('h2', { id: 'files-title' }, 'Files'), list);
      async function draw(artifacts) {
        list.replaceChildren(artifacts.length
          ? h('ul', { class: 'file-list' }, await Promise.all(artifacts.map(async a => {
              let url = null;
              try { url = await data.fileUrl(a.storage_path); } catch { /* shown as unavailable */ }
              const label = [KIND_LABELS[a.kind] || a.kind, bytes(a.bytes) && ` · ${bytes(a.bytes)}`];
              let preview = null;
              if (url && (a.kind === 'final_video' || a.kind === 'preview')) {
                preview = h('video', { controls: true, preload: 'metadata', src: url });
              } else if (url && (a.kind === 'thumbnail' || a.kind === 'contact_sheet')) {
                preview = h('img', { src: url, alt: KIND_LABELS[a.kind], loading: 'lazy' });
              }
              return h('li', {}, preview,
                h('span', {}, label),
                url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open') : h('span', { class: 'meta' }, 'unavailable'));
            })))
          : h('p', { class: 'form-intro' }, 'Nothing rendered for this version yet.'));
      }
      draw(initial);
      return {
        el,
        async refresh() {
          try { draw((await data.getVersion(v.id)).artifacts); } catch { /* keep what is shown */ }
        }
      };
    }

    // 2A-3: submit sheet / preview / final, queue position, live state.
    // Realtime pushes changes; every 10 s it also re-reads while anything is
    // in flight (queue positions move with other people's jobs) or whenever
    // Realtime is not connected.
    function jobsPanel(v, { settled, versionChanged }) {
      const J = window.ryagramJobs;
      let jobs = [];
      let positions = {};
      let engine = null;                           // the worker's current engine version, if known
      let quotes = {};                             // job type -> credit_quote, when credits are on
      let accounting = {};                         // job id -> job_accounting row
      let balance = null;
      const C = window.ryagramCredits;
      const balanceNote = h('p', { class: 'form-note credit-balance', hidden: !creditsOn() });
      let storySha = v.story_sha256;
      let stopped = false;
      let seen;                                    // job id -> state at the last read
      const error = errorLine();
      const liveNote = h('span', { class: 'meta live-note' }, 'Connecting…');
      const listEl = h('div', { 'aria-live': 'polite' }, h('p', { class: 'form-intro' }, 'Loading jobs…'));

      const periods = h('input', { id: 'run-periods', inputmode: 'numeric', placeholder: '2016, 2018, 2020', autocomplete: 'off' });
      const winStart = h('input', { id: 'run-start', type: 'number', min: '0', step: '0.5', placeholder: '0', 'aria-label': 'Preview start, seconds' });
      const winEnd = h('input', { id: 'run-end', type: 'number', min: '0', step: '0.5', placeholder: '10', 'aria-label': 'Preview end, seconds' });
      const sheetButton = h('button', { class: 'button secondary', type: 'button' }, 'Make contact sheet');
      const previewButton = h('button', { class: 'button secondary', type: 'button' }, 'Make preview');
      const finalButton = h('button', { class: 'button primary', type: 'button' }, 'Render final film');
      const finalNote = h('p', { class: 'form-note' });
      const lockedNote = h('p', { class: 'form-note', hidden: true });
      const controls = h('div', { class: 'run-controls' },
        h('div', { class: 'run-step' },
          h('label', { for: 'run-periods' }, '1. Contact sheet ', h('span', {}, '(years, optional)')),
          h('div', { class: 'inline-row' }, periods, sheetButton)),
        h('div', { class: 'run-step' },
          h('label', { for: 'run-start' }, '2. Preview ', h('span', {}, '(seconds; 10 s at most; blank = the first 10 s)')),
          h('div', { class: 'inline-row' }, winStart, winEnd, previewButton)),
        h('div', { class: 'run-step' },
          h('span', { class: 'step-label' }, '3. Final film'),
          finalNote, finalButton));

      async function submit(button, type, params, ladder) {
        error.hidden = true;
        await busy(button, 'Submitting…', async () => {
          try {
            await data.submitJob(v.id, type, params, ladder);
            if (type === 'final_render') { versionChanged(); return; }
            await refresh();
          } catch (err) { showError(error, err); }
        });
      }

      sheetButton.addEventListener('click', () => {
        const p = J.parsePeriods(periods.value);
        if (p.error) return showError(error, new Error(p.error));
        submit(sheetButton, 'contact_sheet', p.value ? { periods: p.value } : {});
      });
      previewButton.addEventListener('click', () => {
        const w = J.parseWindow(winStart.value, winEnd.value);
        if (w.error) return showError(error, new Error(w.error));
        const q = quotes.preview;
        if (creditsOn() && q && !q.error && q.credits > 0
            && !confirm(`Your free previews are used up for now, so this one costs ${C.plural(q.credits)}. Go ahead?`)) return;
        submit(previewButton, 'preview', { window_s: w.value || [0, 10] });   // the worker requires a window
      });
      finalButton.addEventListener('click', () => {
        const ladder = J.ladder(jobs, storySha, engine);
        if (!ladder.ready) return showError(error, new Error(ladder.missing));
        const q = quotes.final_render;
        const cost = creditsOn() && q && !q.error && q.credits
          ? ` It uses ${C.plural(q.credits)}, held now and returned if the render fails.` : '';
        if (!confirm(`Render the final film of r${v.number}? Its story locks while it renders; later changes need a new version.${cost}`)) return;
        submit(finalButton, 'final_render', {}, { sheetJobId: ladder.sheet.id, previewJobId: ladder.preview.id });
      });

      function syncControls() {
        const takes = J.versionTakesJobs(v.state);
        controls.hidden = !takes;
        lockedNote.hidden = takes;
        lockedNote.textContent = `This version is ${(STATE_LABELS[v.state] || v.state).toLowerCase()}, so it can’t take new jobs.`;
        const busyType = type => jobs.some(j => j.job_type === type && J.isActive(j));
        sheetButton.disabled = busyType('contact_sheet');
        previewButton.disabled = busyType('preview');
        const ladder = J.ladder(jobs, storySha, engine);
        finalButton.disabled = !ladder.ready || busyType('final_render');
        finalNote.textContent = ladder.ready
          ? `Uses the contact sheet from ${date(ladder.sheet.created_at)} and the preview from ${date(ladder.preview.created_at)}. Clicking is your approval.`
          : ladder.missing;
        if (creditsOn()) {
          const label = (button, base, type) => {
            const q = quotes[type];
            button.textContent = q && !q.error ? `${base} · ${C.priceLabel(q)}` : base;
            const can = q && !q.error ? C.affordable(q) : { ok: true };
            if (!can.ok) button.disabled = true;
            return q?.error ? q.error : can.ok ? '' : can.reason;
          };
          const sheetWhy = label(sheetButton, 'Make contact sheet', 'contact_sheet');
          const previewWhy = label(previewButton, 'Make preview', 'preview');
          const finalWhy = label(finalButton, 'Render final film', 'final_render');
          if (quotes.final_render?.error) finalButton.disabled = true;
          if (finalWhy && ladder.ready) finalNote.textContent = finalWhy;
          balanceNote.textContent = [balance ? `Credits: ${C.balanceLine(balance)}.` : '', sheetWhy, previewWhy].filter(Boolean).join(' ');
        }
      }

      function jobItem(j) {
        const active = J.isActive(j);
        const failed = ['failed', 'editorial_action_required', 'cancelled'].includes(j.state);
        const note = active ? J.progressNote(j, positions[j.id]) : failed ? J.problem(j) : '';
        return h('li', { class: `job job-row-${j.state}` },
          h('strong', {}, J.TYPE_LABELS[j.job_type] || j.job_type),
          h('span', { class: `state job-${j.state}` }, J.STATE_LABELS[j.state] || j.state),
          h('span', { class: 'meta' }, date(j.created_at)),
          creditsOn() && accounting[j.id] ? h('span', { class: 'meta credit-line' }, C.jobCredits(accounting[j.id])) : null,
          j.state === 'running' && j.progress != null
            ? h('progress', { max: '1', value: String(j.progress), 'aria-label': `${J.TYPE_LABELS[j.job_type]} progress` }) : null,
          note ? h('p', { class: failed && j.state !== 'cancelled' ? 'form-note job-problem' : 'form-note' }, note) : null,
          active && !j.cancel_requested
            ? h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
                await busy(event.currentTarget, 'Cancelling…', async () => {
                  try { await data.cancelJob(j.id); await refresh(); } catch (err) { showError(error, err); }
                });
              } }, 'Cancel') : null,
          J.canRetry(j, v.state, jobs)
            ? h('button', { class: 'button secondary small', type: 'button', onclick: event =>
                submit(event.currentTarget, j.job_type,
                       j.job_type === 'preview' && !j.params?.window_s ? { ...j.params, window_s: [0, 10] } : j.params || {},
                       j.job_type === 'final_render' ? { sheetJobId: j.sheet_job_id, previewJobId: j.preview_job_id } : undefined)
              }, 'Try again') : null);
      }

      function draw() {
        syncControls();
        listEl.replaceChildren(jobs.length
          ? h('ul', { class: 'job-list' }, jobs.map(jobItem))
          : h('p', { class: 'form-intro' }, 'No jobs yet. Start with a contact sheet.'));
        liveNote.textContent = watch.live() ? '● Live' : 'Updating every 10 seconds';
      }

      let running = null;
      let again = false;
      async function refresh() {
        if (stopped) return;
        if (running) { again = true; return running; }
        running = (async () => {
          do {
            again = false;
            try {
              const [fresh, currentEngine] = await Promise.all([data.listJobs(v.id), data.currentEngine()]);
              engine = currentEngine;
              if (creditsOn()) {
                const types = ['contact_sheet', 'preview', 'final_render'];
                const [q, acct, bal] = await Promise.all([
                  Promise.all(types.map(t => data.creditQuote(v.id, t).catch(err => ({ error: err.message })))),
                  data.jobAccounting(v.id).catch(() => ({})),
                  data.creditBalances().catch(() => null)
                ]);
                quotes = Object.fromEntries(types.map((t, i) => [t, q[i]]));
                accounting = acct;
                balance = bal;
              }
              const pos = {};
              await Promise.all(fresh.filter(j => j.state === 'queued').map(async j => {
                try { pos[j.id] = await data.queuePosition(j.id); } catch { /* position unknown */ }
              }));
              if (stopped) return;
              const before = seen;
              seen = new Map(fresh.map(j => [j.id, j.state]));
              jobs = fresh;
              positions = pos;
              error.hidden = true;
              if (before) {
                const changed = fresh.filter(j => before.get(j.id) !== j.state);
                // A final render's state is the version's state: redraw the whole page.
                if (changed.some(j => j.job_type === 'final_render')) { versionChanged(); return; }
                if (changed.some(j => j.state === 'complete')) settled();
              }
            } catch (err) {
              if (!stopped) showError(error, err);
            }
            if (!stopped) draw();
          } while (again && !stopped);
        })();
        try { await running; } finally { running = null; }
      }

      const watch = data.watchJobs(v.id, () => refresh());
      const timer = setInterval(() => {
        if (!watch.live() || jobs.some(J.isActive)) refresh();
        else liveNote.textContent = '● Live';
      }, 10000);
      refresh();

      const el = h('section', { class: 'jobs-panel', 'aria-labelledby': 'jobs-title' },
        h('div', { class: 'jobs-head' }, h('h2', { id: 'jobs-title' }, 'Render'), liveNote),
        h('p', { class: 'form-intro' }, 'A contact sheet and a preview of the current story come first; the final film uses both.'),
        controls, balanceNote, lockedNote, error, listEl);

      return {
        el,
        refresh,
        storyChanged(sha) { storySha = sha; v.story_sha256 = sha; syncControls(); },
        stop() { stopped = true; clearInterval(timer); watch.stop(); }
      };
    }

    window.addEventListener('hashchange', route);
    route();
    return () => { token++; stopView(); window.removeEventListener('hashchange', route); root.replaceChildren(); };
  }

  window.ryagramLibrary = { mount };
})();
