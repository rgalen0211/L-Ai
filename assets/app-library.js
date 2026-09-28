// Ryagram library views (2A-2): projects -> versions (r1, r2, ...) -> one version.
// Routes: #/ (projects), #/p/<id> (a project), #/v/<id> (a version).
// Everything from the database goes in as text nodes, never as HTML.
(() => {
  const EDITABLE = ['draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render'];
  const STATE_LABELS = {
    draft: 'Draft', sampling: 'Sampling', previewing: 'Previewing',
    editorial_action_required: 'Needs a decision', ready_to_render: 'Ready to render',
    queued: 'Queued', rendering: 'Rendering', validating: 'Checking', uploading: 'Uploading',
    complete: 'Complete', failed: 'Failed', archived: 'Archived', non_restorable: 'Can’t be rebuilt'
  };
  const JOB_LABELS = { contact_sheet: 'Contact sheet', preview: 'Preview', final_render: 'Final render' };
  const JOB_STATE_LABELS = {
    queued: 'Queued', claimed: 'Starting', running: 'Rendering', validating: 'Checking', uploading: 'Uploading',
    complete: 'Complete', failed: 'Failed', editorial_action_required: 'Needs a decision', cancelled: 'Cancelled'
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

  function mount(root, data) {
    let token = 0;

    async function route() {
      const mine = ++token;
      const hash = location.hash;
      root.replaceChildren(h('p', { class: 'form-intro' }, 'Loading…'));
      let view;
      try {
        let m;
        if ((m = hash.match(new RegExp(`^#/p/${UUID}$`)))) view = await projectView(m[1]);
        else if ((m = hash.match(new RegExp(`^#/v/${UUID}$`)))) view = await versionView(m[1]);
        else view = await libraryView();
      } catch (err) {
        view = [h('h1', { tabindex: '-1' }, 'Something went wrong'),
                h('p', { class: 'app-error', role: 'alert' }, err.message),
                h('a', { href: '#/' }, 'Back to your projects')];
      }
      if (mine !== token) return;                 // a newer page load won
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
      return [h('h1', { tabindex: '-1' }, 'Your projects'), form, list];
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
    async function versionView(id) {
      const { version: v, project, parent, artifacts, jobs } = await data.getVersion(id);
      const locked = !EDITABLE.includes(v.state);
      const error = errorLine();
      const saved = h('p', { class: 'form-note', role: 'status' });

      const newVersion = async event => {
        await busy(event.currentTarget, 'Copying…', async () => {
          try { const nv = await data.createVersion(v.project_id, v.id); location.hash = `#/v/${nv.id}`; }
          catch (err) { showError(error, err); }
        });
      };

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
          try { await data.saveStory(v.id, parsed); saved.textContent = 'Saved.'; }
          catch (err) { showError(error, err); }
        });
      } },
        h('label', { for: 'story' }, 'Story'),
        h('p', { id: 'story-help', class: 'form-note' }, locked
          ? `This version is ${(STATE_LABELS[v.state] || v.state).toLowerCase()} and can’t change. Make a new version from it to keep working.`
          : 'The story file this version renders from. The render worker checks it in full before drawing anything.'),
        story, locked ? null : save, saved, error);

      const files = artifacts.length
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
        : h('p', { class: 'form-intro' }, 'Nothing rendered for this version yet.');

      const jobList = jobs.length
        ? h('ul', { class: 'job-list' }, jobs.map(j => h('li', {},
            h('strong', {}, JOB_LABELS[j.job_type] || j.job_type),
            h('span', { class: `state job-${j.state}` }, JOB_STATE_LABELS[j.state] || j.state),
            j.attempt > 1 ? h('span', { class: 'meta' }, `attempt ${j.attempt}`) : null,
            h('span', { class: 'meta' }, date(j.created_at)),
            j.error_detail ? h('p', { class: 'form-note' }, j.error_detail) : null)))
        : h('p', { class: 'form-intro' }, 'No jobs yet.');

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
        storyForm,
        h('h2', {}, 'Files'), files,
        h('h2', {}, 'Jobs'), jobList
      ];
    }

    window.addEventListener('hashchange', route);
    route();
    return () => { token++; window.removeEventListener('hashchange', route); root.replaceChildren(); };
  }

  window.ryagramLibrary = { mount };
})();
