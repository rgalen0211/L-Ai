// Mock mode for /app/?mock on localhost: a fake signed-in account with one
// project, and a pretend worker that moves jobs along every 1.2 s. A bar at
// the bottom picks how the next job ends and pauses the worker (to see queue
// positions). Loaded only by app-auth.js on localhost; never on uselai.com.
(function () {
  window.createMockApp = function createMockApp() {
    // Mock mode starts with 30 beta credits so the credit screens can be tried.
    const client = window.createFakeClient({ credits: 30 }, { user: { id: 'mock-user', email: 'mock@localhost' } });
    const db = client.db;
    const project = { id: client.newId(), owner_id: 'mock-user', title: 'Obesity and fast food (mock)',
                      created_at: client.now(), updated_at: client.now(), archived_at: null };
    db.projects.push(project);
    db.versions.push({
      id: client.newId(), project_id: project.id, number: 1, parent_version_id: null, state: 'draft',
      story_spec: { schema: 1, engine: 'sequence', name: 'obesity-fast-food',
                    sequence: { canvas: [1920, 1080], fps: 30, theme: 'dark', hold_seconds: 0.5, clips: [
                      { kind: 'title', id: 'open', seconds: 3, fade: 0.4, headline: 'Obesity and fast food, 2011-2023' },
                      { kind: 'render', id: 'main', dataset: 'state_obesity_fastfood', view: 'paired', start: '2011', end: '2023' }] } },
      story_sha256: 'sha-mock-1', dataset_id: null, restorability: 'unknown', note: null,
      created_at: client.now(), updated_at: client.now()
    });

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
