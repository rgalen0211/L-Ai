// The Compilations department page (WEB 11-27, wave 8 "departments on"; behind the per-account switch 'compilations').
// A compilation finds every time a phrase is said in the person's OWN footage and strings the moments together. The footage, the matches and the finished film stay on the person's computer
// (tools/check-compilation-stays-local.py): this page only saves a REQUEST (the words, the NAMES of folders, a few switches) that the Ryagram app on the person's computer reads and builds from.
// It never sends or reads a video, a picture or a path. The server calls are my_compilation_set and my_compilation_get (BUILDER's, branch builder-compilations-server-1127; the request has the connector's own shape, ryagram.compilation-request/0).
// FOR RYAN'S YES: every public word on this page is new.
(() => {
  const BS = String.fromCharCode(92);
  // A folder or picture is a NAME: no slash, no colon, nothing a path is made of (the connector's NAME_PATTERN).
  const NAME = new RegExp('^[^' + BS + BS + '/:*?"<>|\\u0000-\\u001f]{1,80}$');
  // A drive letter and a slash, a network share, a parent folder or a path from the root: a place on a computer (the connector's looksLikePlace).
  const PLACE = new RegExp('[A-Za-z]:[' + BS + BS + '/]|' + BS + BS + BS + BS + '|(^|\\s)/[A-Za-z]|\\.\\.[' + BS + BS + '/]');
  const LIMITS = { phrase: 200, folders: 10, note: 500 };

  const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
  // "Interviews, B-roll" or one per line -> ['Interviews', 'B-roll'] (names only, each once).
  function folderList(text) {
    const seen = new Set(), out = [];
    for (const part of String(text || '').split(/[\n,;]+/)) { const n = part.trim(); if (n && !seen.has(n)) { seen.add(n); out.push(n); } }
    return out;
  }

  // The form -> the request, or { error } in a plain sentence. The server checks everything again; this only saves a round trip and never lets a path leave the page.
  function buildRequest(f) {
    const phrase = clean(f.phrase, LIMITS.phrase + 50);
    if (!phrase) return { error: 'Type the words to look for.' };
    if (phrase.length > LIMITS.phrase) return { error: 'The words to look for can be at most 200 characters.' };
    const note = clean(f.note, LIMITS.note + 50);
    if (note.length > LIMITS.note) return { error: 'The note can be at most 500 characters.' };
    if ([phrase, note].some(w => w && PLACE.test(w))) return { error: 'Write words, not a place on your computer. Folders are named, never located.' };
    const folders = folderList(f.folders);
    if (!folders.length) return { error: 'Name at least one folder of yours that holds the videos.' };
    if (folders.length > LIMITS.folders) return { error: 'Name at most 10 folders.' };
    const bad = folders.find(n => !NAME.test(n) || n === '.' || n === '..');
    if (bad) return { error: `“${bad.slice(0, 40)}” is not a folder name. Type only the folder’s name, like Interviews, never where it is.` };
    return { request: { schema: 'ryagram.compilation-request/0', phrase, search: f.search === 'words' ? 'words' : 'every', folders, song: f.song === true, clean_cuts: f.cleanCuts === true, rules: [], texts: [], note } };
  }

  // A saved request -> the line a person reads about it.
  function requestLine(row, when) {
    const q = (row && row.request) || {};
    const n = Array.isArray(q.folders) ? q.folders.length : 0;
    const how = q.search === 'words' ? 'these words in this order' : 'every time it is said';
    return `“${String(q.phrase || '').slice(0, 120)}”: ${how}, in ${n} folder${n === 1 ? '' : 's'}${q.song ? ', as a song' : ''}. Saved ${when ? when(row.updated_at) : ''}`.trim();
  }

  // The newest run -> the line under a request. Counts only; no path, no transcript text ever arrives.
  function runLine(run, W) {
    if (!run || typeof run.state !== 'string') return W.waiting;
    const base = W.states[run.state] || W.waiting;
    if (run.state === 'failed') return `${base} ${W.errors[run.error_code] || 'Something went wrong. Try again from the app.'}`;
    const bits = [];
    if (Number.isFinite(Number(run.matches)) && run.matches !== null && run.matches !== undefined) bits.push(`${Number(run.matches)} match${Number(run.matches) === 1 ? '' : 'es'}`);
    if (Number.isFinite(Number(run.clips)) && run.clips !== null && run.clips !== undefined) bits.push(`${Number(run.clips)} clip${Number(run.clips) === 1 ? '' : 's'}`);
    if (run.state === 'done' && Number.isFinite(Number(run.film_seconds)) && run.film_seconds !== null) bits.push(`${Math.round(Number(run.film_seconds))} seconds long`);
    return bits.length ? `${base} ${bits.join(', ')}.` : base;
  }

  const WORDS = {
    intro: 'Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together.',
    local: 'Your videos never leave your computer. This page saves only your request: the words, and the names of your folders. The Ryagram app on your computer finds the matches and makes the film there.',
    waiting: 'Waiting for the Ryagram app on your computer.',
    states: { planning: 'The Ryagram app is planning your film.', matching: 'The Ryagram app is finding the matches on your computer.', building: 'The Ryagram app is making your film on your computer.', done: 'Done. Your film is on your computer.', failed: 'It did not finish.', cancelled: 'Stopped.' },
    // the closed list of reasons the app can report (FACES 08:16, docs/COMPILATION-REPORT-1127.md); anything else reads as the generic line
    errors: { request_invalid: 'Your AI’s request could not be read.', song_request: 'Songs are made in the song tools, not here.', folder_not_chosen: 'Choose where these videos are on your computer.', folder_missing: 'A folder you chose is not there any more.', folder_empty: 'A folder you chose has no videos.', folders_overlap: 'Two folders hold the same videos.', no_speech: 'No speech was found in your videos.', not_said: 'Your videos do not say it.', edit_failed: 'The draft could not be made into a film list.', build_failed: 'The film could not be built. Nothing left your computer.', crash: 'Something went wrong on your computer.' },
    noApp: 'The Ryagram app is not on a computer of yours yet. You can save a request now; the app reads it when you open it.'
  };

  // h(), data, busy, showError, errorLine: the page's own helpers (app-library.js). Returns { pageView } building the whole page body.
  function create({ h, data, busy, showError, errorLine, date }) {
    async function pageView() {
      const error = errorLine();
      const status = h('p', { class: 'form-note', role: 'status', 'aria-live': 'polite' });
      let flip = null;

      // ---- tab 1: start
      const title = h('input', { id: 'comp-title', type: 'text', maxlength: '120', autocomplete: 'off' });
      const phrase = h('input', { id: 'comp-phrase', type: 'text', maxlength: '200', autocomplete: 'off', 'aria-describedby': 'comp-phrase-note' });
      const search = h('select', { id: 'comp-search' }, h('option', { value: 'every' }, 'Every time it is said'), h('option', { value: 'words' }, 'These words in this order, one place each'));
      const folders = h('textarea', { id: 'comp-folders', rows: '3', maxlength: '800', placeholder: 'Interviews\nB-roll', spellcheck: 'false', 'aria-describedby': 'comp-folders-note' });
      const picked = h('p', { class: 'form-note', role: 'status' });
      const picker = h('input', { id: 'comp-pick', type: 'file', webkitdirectory: '', multiple: '', class: 'comp-pick', 'aria-describedby': 'comp-pick-note' });
      picker.addEventListener('change', () => {
        // Only the folder's NAME is read (the first part of the relative path) and how many files it holds; nothing is read from any file, nothing is sent.
        const files = [...(picker.files || [])];
        const first = files[0] && files[0].webkitRelativePath ? String(files[0].webkitRelativePath).split('/')[0] : '';
        if (!first) return;
        const have = folderList(folders.value);
        if (!have.includes(first)) { have.push(first); folders.value = have.join('\n'); }
        picked.textContent = `Added the folder name “${first.slice(0, 80)}” (${files.length} file${files.length === 1 ? '' : 's'} in it). Only its name is used; nothing was read or sent.`;
        picker.value = '';
      });
      const song = h('input', { id: 'comp-song', type: 'checkbox' });
      const cuts = h('input', { id: 'comp-cuts', type: 'checkbox' });
      const note = h('textarea', { id: 'comp-note', rows: '2', maxlength: '500' });
      const save = h('button', { class: 'button primary', type: 'button', id: 'comp-save' }, 'Save my request');
      save.addEventListener('click', () => {
        error.hidden = true; status.textContent = '';
        const built = buildRequest({ phrase: phrase.value, search: search.value, folders: folders.value, song: song.checked, cleanCuts: cuts.checked, note: note.value });
        if (built.error) { error.textContent = built.error; error.hidden = false; return; }      // the page's own plain sentence: shown as it is (plainRefusal would turn it into the generic line)
        return busy(save, 'Saving…', async () => {
          try {
            const name = clean(title.value, 120) || clean(phrase.value, 80);
            const made = await data.createProject(name);
            await data.setMyCompilationRequest(made.project.id, built.request);
            status.textContent = 'Saved. Open the Ryagram app on your computer to find the matches and make a preview.';
            title.value = ''; phrase.value = ''; note.value = '';
            await drawRequests();
            if (flip) flip.go('requests');
          } catch (err) { showError(error, err); }
        });
      });
      const start = h('div', { class: 'comp-start' },
        h('p', { class: 'form-intro' }, WORDS.intro),
        h('p', { class: 'form-note comp-local' }, WORDS.local),
        h('label', { for: 'comp-title' }, 'Name your compilation (optional)'), title,
        h('label', { for: 'comp-phrase' }, 'The words to find'), phrase,
        h('p', { id: 'comp-phrase-note', class: 'form-note' }, 'Up to 200 characters.'),
        h('label', { for: 'comp-search' }, 'How to find them'), search,
        h('label', { for: 'comp-folders' }, 'Your folders (the names, one per line)'), folders,
        h('p', { id: 'comp-folders-note', class: 'form-note' }, 'Type only a folder’s name, like Interviews. Never where it is on your computer.'),
        h('label', { for: 'comp-pick' }, 'Or pick a folder to add its name'), picker,
        h('p', { id: 'comp-pick-note', class: 'form-note' }, 'Your browser lists the folder’s files to this page only to read the folder’s name. Nothing is uploaded.'), picked,
        h('div', { class: 'choice' }, song, h('label', { for: 'comp-song' }, 'Sing the words to a tune (song mode)')),
        h('div', { class: 'choice' }, cuts, h('label', { for: 'comp-cuts' }, 'Move each cut to the nearest shot change, without cutting a word')),
        h('label', { for: 'comp-note' }, 'A note to yourself (optional)'), note,
        h('div', { class: 'actions-row' }, save), status, error);

      // ---- tab 2: your requests
      const list = h('div', { class: 'comp-requests' });
      async function drawRequests() {
        let rows;
        try { rows = await data.myCompilationRequests(); } catch (err) { list.replaceChildren(h('p', { class: 'form-note', role: 'alert' }, err.message)); return; }
        rows = Array.isArray(rows) ? rows.slice(0, 50) : [];
        let haveApp = null;
        try { haveApp = typeof data.myLocalCompute === 'function' ? await data.myLocalCompute() : null; } catch { haveApp = null; }
        list.replaceChildren(...[
          haveApp === false ? h('p', { class: 'form-note comp-noapp' }, WORDS.noApp, ' ', h('a', { href: '/get-app/' }, 'Get the Ryagram app')) : null,
          rows.length ? h('ul', { class: 'project-list comp-rows' }, rows.map(r => h('li', {},
            h('strong', {}, String(r.title || 'A compilation').slice(0, 120)), h('span', { class: 'meta' }, ` ${requestLine(r, date)}`),
            h('p', { class: 'form-note comp-run', role: 'status' }, runLine(r.run, WORDS))))) : h('p', { class: 'form-note' }, 'No compilation requests yet. Start one on the first tab.')].filter(Boolean));
      }
      await drawRequests();

      flip = window.ryagramFlip.create({ h, label: 'Compilations', address: false, sections: [
        { id: 'start', label: 'Start a compilation', el: start },
        { id: 'requests', label: 'Your requests', el: h('div', {}, h('p', { class: 'form-note comp-local' }, WORDS.local), list) }
      ] });
      return [h('a', { href: '#/', class: 'back' }, '← All projects'), h('h1', { tabindex: '-1' }, 'Compilations'), flip.el];
    }
    return { pageView };
  }

  window.ryagramCompilations = { NAME, PLACE, LIMITS, WORDS, folderList, buildRequest, requestLine, runLine, create };
})();
