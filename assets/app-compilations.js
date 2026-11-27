// The Compilations department page (WEB 11-27, wave 8 "departments on"; behind the per-account switch 'compilations').
// A compilation finds every time a phrase is said in the person's OWN footage and strings the moments together. The footage, the matches and the finished film stay on the person's computer
// (tools/check-compilation-stays-local.py): this page only saves a REQUEST (the words, the NAMES of folders, a few switches) that the Ryagram app on the person's computer reads and builds from.
// It never sends or reads a video, a picture or a path. The server calls are my_compilation_set and my_compilation_get (BUILDER's, branch builder-compilations-server-1127; the request has the connector's own shape, ryagram.compilation-request/0).
// FOR RYAN'S YES: every public word on this page is new. The eleven error reasons are FACES' words with a next step each (proposals/FACES-COMPILATION-WORDS-1127.md, 11-27), verbatim; the keys are ours.
(() => {
  const BS = String.fromCharCode(92);
  // A folder or picture is a NAME: no slash, no colon, nothing a path is made of (the connector's NAME_PATTERN).
  const NAME = new RegExp('^[^' + BS + BS + '/:*?"<>|\\u0000-\\u001f\\u007f-\\u009f]{1,80}$');
  // A drive letter and a slash, a network share, a parent folder or a path from the root: a place on a computer (the connector's looksLikePlace).
  const PLACE = new RegExp('[A-Za-z]:[' + BS + BS + '/]|' + BS + BS + BS + BS + '|(^|\\s)/[A-Za-z]|\\.\\.[' + BS + BS + '/]'
    // what the server migration also refuses (its value check): a home path, %NAME%, $HOME, a percent-encoded slash/backslash/colon, a fullwidth slash or colon
    + '|(^|\\s)~[a-z0-9_]*[' + BS + BS + '/]|%[a-z_]+%|\\$home\\b|%2f|%5c|%3a|[\\uff0f\\uff3c\\u2215\\uff1a]'
    // and a known top folder after ANY punctuation, like "(/home/x", and a link (the same two the migration checks)
    + '|(^|[^a-z0-9._-])/(users|home|mnt|volumes|private|tmp|var|media|etc|srv|opt|root)/|[a-z][a-z0-9+.-]*://', 'i');
  // the server strips these invisible characters before it checks; so does the page
  const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
  const isPlace = t => PLACE.test(String(t).replace(INVISIBLE, ''));
  const LIMITS = { phrase: 200, folders: 10, note: 500 };

  // Cut text to a length and SAY it was cut (an ellipsis), never silently.
  const cut = (s, max) => { const t = String(s == null ? '' : s); return t.length > max ? t.slice(0, max).trimEnd() + '…' : t; };
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
    if ([phrase, note].some(w => w && isPlace(w))) return { error: 'Write words, not a place on your computer. Folders are named, never located.' };
    const folders = folderList(f.folders);
    if (!folders.length) return { error: 'Name at least one folder of yours that holds the videos.' };
    if (folders.length > LIMITS.folders) return { error: 'Name at most 10 folders.' };
    const bad = folders.find(n => !NAME.test(n) || n === '.' || n === '..' || isPlace(n));
    if (bad) return { error: 'That is not a folder name. Type only the folder’s name, like Interviews, never where it is.' };      // never echoes what was typed: it may be a place on the person’s computer
    return { request: { schema: 'ryagram.compilation-request/0', phrase, search: f.search === 'words' ? 'words' : 'every', folders, song: false, clean_cuts: false, rules: [], texts: [], note } };
  }

  // A saved request -> the line a person reads about it.
  function requestLine(row, when) {
    const q = (row && row.request) || {};
    const n = Array.isArray(q.folders) ? q.folders.length : 0;
    const how = q.search === 'words' ? 'these words in this order' : 'every time it is said';
    return `“${cut(q.phrase, 120)}”: ${how}, in ${n} folder${n === 1 ? '' : 's'}${q.song ? ', as a song' : ''}. Saved ${when ? when(row.updated_at) : ''}`.trim();
  }

  // The newest run -> the line under a request. Counts only; no path, no transcript text ever arrives.
  function runLine(run, W) {
    if (!run || typeof run.state !== 'string') return W.waiting;
    if (run.current === false) return W.earlier;      // a run that belongs to an older save of the request is not shown as this one's (absent = current)
    if (run.state === 'stale') return W.errors.stale;      // its words sit with the reasons; no counts under it
    const base = W.states[run.state];
    if (!base) return W.waiting;      // a state this page does not know: only the waiting line, never counts
    if (run.state === 'failed') return `${base} ${W.errors[run.error_code] || 'Something went wrong. Try again from the app.'}`;
    const bits = [];
    if (Number.isFinite(Number(run.matches)) && run.matches !== null && run.matches !== undefined) bits.push(`${Number(run.matches)} match${Number(run.matches) === 1 ? '' : 'es'}`);
    if (Number.isFinite(Number(run.clips)) && run.clips !== null && run.clips !== undefined) bits.push(`${Number(run.clips)} clip${Number(run.clips) === 1 ? '' : 's'}`);
    if (run.state === 'done' && Number.isFinite(Number(run.film_seconds)) && run.film_seconds !== null) { const sec = Math.round(Number(run.film_seconds)); bits.push(`${sec} second${sec === 1 ? '' : 's'} long`); };
    return bits.length ? `${base} ${bits.join(', ')}, counted on your computer.` : base;
  }

  const WORDS = {
    intro: 'Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together.',
    local: 'Your videos never leave your computer. This page saves only your request: the words, the names of your folders, your note and the name of your compilation. The Ryagram app on your computer finds the matches and makes the film there.',
    waiting: 'Waiting for the Ryagram app on your computer.',
    earlier: 'This is for an earlier version of your request. Save again to start over.',
    states: { planning: 'The Ryagram app is planning your film.', matching: 'The Ryagram app is finding the matches on your computer.', building: 'The Ryagram app is making your film on your computer.', done: 'Done. Your film is on your computer.', failed: 'It did not finish.', cancelled: 'Stopped.' },
    // the closed list of reasons the app can report (FACES 08:16, docs/COMPILATION-REPORT-1127.md); anything else reads as the generic line
    errors: { request_invalid: 'The request could not be read. Save it again, or ask your AI to write it again.', song_request: 'Compilations do not make songs. Take out the song and save again.', folder_not_chosen: 'A folder in your request is not chosen on your computer yet. Open the Ryagram app and choose where that folder is.', folder_missing: 'A folder you chose is not there any more. Open the Ryagram app and choose it again.', folder_empty: 'A folder you chose has no videos in it. Choose the folder that holds your videos.', folders_overlap: 'Two of your folders hold the same videos. Choose folders that do not overlap.', no_speech: 'No speech was found in your videos. Try videos where people talk.', not_said: 'Your videos do not say these words. Try other words, or add more folders.', edit_failed: 'The matches could not be turned into a film. Try again; if it happens twice, use Contact at the bottom of the page.', build_failed: 'The film could not be built. Nothing left your computer. Try again in the Ryagram app.', stale: 'The build stopped reporting. You can start it again from the app.', crash: 'Something went wrong on your computer. Nothing left it. Close the app, open it and try again.' },
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
        picked.textContent = 'Added one folder. Only its name is used; nothing was read or sent.';
        picker.value = '';
      });
      const note = h('textarea', { id: 'comp-note', rows: '2', maxlength: '500' });
      const save = h('button', { class: 'button primary', type: 'button', id: 'comp-save' }, 'Save my request');
      save.addEventListener('click', () => {
        error.hidden = true; status.textContent = '';
        const built = buildRequest({ phrase: phrase.value, search: search.value, folders: folders.value, note: note.value });
        if (built.error) { error.textContent = built.error; error.hidden = false; return; }      // the page's own plain sentence: shown as it is (plainRefusal would turn it into the generic line)
        return busy(save, 'Saving…', async () => {
          try {
            const name = clean(title.value, 120) || clean(phrase.value, 80);
            const made = await data.createProject(name);
            try { await data.setMyCompilationRequest(made.project.id, built.request); }
            catch (err) {      // a refused save must not leave an empty project behind: archive it (the data layer's own call), then show the refusal
              try { if (typeof data.archiveProject === 'function') await data.archiveProject(made.project.id); } catch { /* nothing more to do */ }
              throw err;
            }
            status.textContent = SAVED;
            title.value = ''; phrase.value = ''; note.value = '';
            await drawRequests();
            savedNote.textContent = SAVED;      // the same line on the tab we are about to show, so a screen reader hears it where the person lands
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
        h('p', { id: 'comp-pick-note', class: 'form-note' }, 'Your browser lists the folder’s files to this page only to read the folder’s name, and may use the word upload for it. Nothing is uploaded: nothing leaves your computer.'), picked,
        h('label', { for: 'comp-note' }, 'A note to yourself (optional)'), note,
        h('div', { class: 'actions-row' }, save), status, error);

      // ---- tab 2: your requests
      const SAVED = 'Saved. Open the Ryagram app on your computer to find the matches and make a preview.';
      const savedNote = h('p', { class: 'form-note comp-saved', role: 'status', 'aria-live': 'polite' });
      const list = h('div', { class: 'comp-requests' });
      async function drawRequests() {
        let rows;
        try { rows = await data.myCompilationRequests(); } catch (err) { list.replaceChildren(h('p', { class: 'form-note', role: 'alert' }, window.ryagramJobs ? window.ryagramJobs.plainRefusal(err && err.message) : 'Couldn’t load your requests.')); return; }
        rows = Array.isArray(rows) ? rows.slice(0, 50) : [];
        let haveApp = null;      // true/false only when the list of the person's signed-in computers loaded; the tester flag is not this question
        try { const mine = typeof data.myComputers === 'function' ? await data.myComputers() : null; haveApp = Array.isArray(mine) ? mine.length > 0 : null; } catch { haveApp = null; }
        list.replaceChildren(...[
          haveApp === false && !rows.some(r => r && r.run && typeof r.run.state === 'string') ? h('p', { class: 'form-note comp-noapp' }, WORDS.noApp, ' ', h('a', { href: '/get-app/', class: 'comp-link' }, 'Get the Ryagram app')) : null,
          rows.length ? h('ul', { class: 'project-list comp-rows' }, rows.map(r => h('li', {},
            h('strong', {}, cut(r.title || 'A compilation', 120)), h('span', { class: 'meta' }, ` ${requestLine(r, date)}`),
            h('p', { class: 'form-note comp-run', role: 'status' }, runLine(r.run, WORDS))))) : h('p', { class: 'form-note' }, 'No compilation requests yet. Start one on the first tab.')].filter(Boolean));
      }
      await drawRequests();

      flip = window.ryagramFlip.create({ h, label: 'Compilations', address: false, sections: [
        { id: 'start', label: 'Start', el: start },
        { id: 'requests', label: 'Requests', el: h('div', {}, savedNote, list) }
      ] });
      return [h('a', { href: '#/', class: 'back' }, '← All projects'), h('h1', { tabindex: '-1' }, 'Compilations'), flip.el];
    }
    return { pageView };
  }

  window.ryagramCompilations = { NAME, PLACE, isPlace, LIMITS, WORDS, folderList, buildRequest, requestLine, runLine, create };
})();
