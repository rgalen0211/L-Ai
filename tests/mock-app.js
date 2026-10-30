// Mock mode for /app/?mock on localhost: a fake signed-in account with one
// project, and a pretend worker that moves jobs along every 1.2 s. A bar at
// the bottom picks how the next job ends and pauses the worker (to see queue
// positions). Loaded only by app-auth.js on localhost; never on uselai.com.
(function () {
  window.createMockApp = function createMockApp() {
    // The AI-first door is ON in the committed config since Q303 (Ryan 2026-10-28), so a plain /app/?mock would land every library walk on the door. The mock therefore starts with 'Not now'
    // already pressed (the door's own 7-day snooze) UNLESS the address asks for the door (?door) or for a connected AI (?aiconnected). Mock mode only; the real app is untouched.
    try {
      const asked = /[?&](door|aiconnected)(&|$|#)/.test(location.search || ''), key = 'ryagram.start.notnow', first = !window.sessionStorage.getItem('ryagram.mock.doorinit');
      if (!asked) window.localStorage.setItem(key, String(Date.now()));
      else if (first && /[?&]door(&|$|#)/.test(location.search || '')) window.localStorage.removeItem(key);        // ?door starts without the snooze, once per tab: Not now and a reload still hold
      window.sessionStorage.setItem('ryagram.mock.doorinit', '1');
    } catch { /* blocked storage: the door simply shows */ }
    // Mock mode starts with 30 beta credits so the credit screens can be tried.
    const client = window.createFakeClient({ credits: 30 }, { user: { id: 'mock-user', email: 'mock@localhost' } });
    const db = client.db;
    const project = { id: client.newId(), owner_id: 'mock-user', title: 'Obesity and fast food (mock)',
                      created_at: client.now(), updated_at: client.now(), archived_at: null };
    // /app/?mock&empty starts with no project, to see a newcomer's first screen.
    const seeded = !/[?&]empty/.test(location.search || '');
    if (seeded) db.projects.push(project);
    if (seeded) db.versions.push({
      id: client.newId(), project_id: project.id, number: 1, parent_version_id: null, state: 'draft',
      story_spec: { schema: 1, engine: 'sequence', name: 'obesity-fast-food',
                    sequence: { canvas: [1920, 1080], fps: 30, theme: 'dark', hold_seconds: 0.5, clips: [
                      { kind: 'title', id: 'open', seconds: 3, fade: 0.4, headline: 'Obesity and fast food, 2011-2023' },
                      { kind: 'render', id: 'main', dataset: 'state_obesity_fastfood', view: 'paired', start: '2011', end: '2023' }] } },
      story_sha256: 'sha-mock-1', dataset_id: null, restorability: 'unknown', note: null,
      created_at: client.now(), updated_at: client.now()
    });

    // The live editor's draft (CONNECT's stand-in of the SQL): loaded here so /app/?mock has the five editor_* functions; the computer's track summary is posted for the compilation editor.
    window.RYAGRAM_MOCK_EDITOR_PROJECT = '00000000-0000-4000-8000-0000000000a1';
    // The film's drawing data for the data-film editor (NEXT-WEB 154): the mock serves a SYNTHETIC bundle (3 made-up areas, 4 periods; see tests/fixtures/look-bundle-synthetic.PROVENANCE.txt).
    // The real one comes from the host's bundle(project) call once a route for it exists; `?nobundle` shows the editor with no drawing data, to see the failure state.
    // (A script, not a fetch: the app's policy lets the page connect only to Supabase.)
    // ?bars serves a REAL engine bar-race scene (first 2 seconds); ?stream serves the synthetic map as a STREAM (a head, then one chunk per period): every 150 ms, or by hand with ?streamstep
    // (window.ryagramMockStreamStep() lets the next chunk through; ?streamfail breaks the stream after the first chunk).
    if (!/[?&]standin/.test(location.search || '')) window.ryagramMockLookBundle = () => (/[?&]nobundle/.test(location.search || '') ? Promise.reject(new Error('no bundle')) : new Promise((resolve, reject) => {
      const q = location.search || '', banded = /[?&]banded/.test(q), bars = /[?&]bars/.test(q), streamed = /[?&]stream(?![a-z])/.test(q);
      const file = bars ? 'look-bars-scene' : streamed ? 'look-bundle-synthetic-stream' : `look-bundle-synthetic${banded ? '-banded' : ''}`;
      const key = bars ? 'RYAGRAM_MOCK_LOOK_BARS' : streamed ? 'RYAGRAM_MOCK_LOOK_STREAM' : banded ? 'RYAGRAM_MOCK_LOOK_BUNDLE_BANDED' : 'RYAGRAM_MOCK_LOOK_BUNDLE';           // ?banded serves the solid-band fixture
      const done = () => {
        if (!streamed) { resolve(window[key]); return; }
        const s = window[key], order = s.head.period_list.slice(); let i = 0, gate = Promise.resolve();
        const waiting = [];
        window.ryagramMockStreamStep = () => { const w = waiting.shift(); if (w) w(); };
        resolve({ stream: { head: s.head, next: async () => {
          if (i >= order.length) return null;
          if (/[?&]streamfail/.test(q) && i >= 1) throw new Error('stream broke');
          if (/[?&]streamstep/.test(q)) await new Promise(r => waiting.push(r)); else await new Promise(r => setTimeout(r, 150));
          const p = order[i++]; return { period: p, chunk: s.periods[p] };
        } } });
      };
      if (window[key]) { done(); return; }
      const sc = document.createElement('script');
      sc.src = `/tests/fixtures/${file}.js?t=${Date.now()}`;
      sc.onload = done;
      sc.onerror = () => reject(new Error('no bundle'));
      document.body.append(sc);
    }));
    if (window.createEditorRpcs) {
      const FIVE = ['set_clip_style', 'set_music', 'set_rule', 'delete_rule', 'set_film_look'], OLD = ['move_clip', 'trim_clip', 'reorder_clip', 'set_clip_text', 'delete_clip', 'add_clip'], DATA = ['set_look', 'unset_look'];
      const m = window.createEditorRpcs({ check: (mode, op) => (op && (mode === 'data' ? DATA : OLD.concat(FIVE)).includes(op.op) ? null : `"${String(op && op.op).slice(0, 40)}" is not a change this editor knows.`) });
      const sum = window.ryagramEditorPage ? window.ryagramEditorPage.CLIPS_BASE() : { duration: 12, clips: [] };
      m.app.post(window.RYAGRAM_MOCK_EDITOR_PROJECT, { mirror: true, aiVisible: true, summary: sum });
      window.ryagramMockRpcs = m.rpcs;
      window.ryagramMockEditor = m;
    }

    const worker = window.createMockWorker(client);
    setInterval(() => worker.tick(), 1200);

    const select = document.createElement('select');
    select.id = 'mock-outcome';
    for (const [value, label] of Object.entries(window.OUTCOMES)) select.append(new Option(label, value));
    select.addEventListener('change', () => worker.setOutcome(select.value));
    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'button secondary small';
    pause.textContent = 'Pause worker';
    pause.addEventListener('click', () => {
      if (worker.paused) worker.resume(); else worker.pause();
      pause.textContent = worker.paused ? 'Resume worker' : 'Pause worker';
    });
    // Simulate Ryan updating the worker: jobs after this run on a new engine version.
    const upgrade = document.createElement('button');
    upgrade.type = 'button';
    upgrade.className = 'button secondary small';
    upgrade.textContent = 'Update the engine';
    upgrade.addEventListener('click', () => {
      client.engineCommit = Math.random().toString(16).slice(2, 9).padEnd(7, '0');
      upgrade.textContent = `Engine ${client.engineCommit}`;
    });
    const label = document.createElement('label');
    label.htmlFor = 'mock-outcome';
    label.textContent = 'Next job:';
    const tag = document.createElement('strong');
    tag.textContent = 'Mock mode, fake data';
    const bar = document.createElement('div');
    bar.className = 'mock-bar';
    bar.append(tag, label, select, pause, upgrade);
    document.body.append(bar);

    window.ryagramMock = { client, worker };
    return client;
  };
})();
