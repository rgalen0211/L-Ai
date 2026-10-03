// A pretend render worker for mock mode and tests. Each tick() moves the
// fake queue one step with the same rules as the real one: claim the oldest
// queued job, run -> validate -> upload -> complete, retry crashes up to
// 3 attempts, and end gate failures, timeouts, bad input and limits without
// retrying. `outcome` picks how the NEXT claimed job ends.
(function (root) {
  const OUTCOMES = {
    succeed: 'Succeeds',
    crash_once: 'Crashes once, then succeeds on retry',
    crash_always: 'Crashes on all 3 attempts',
    gate: 'Fails a correctness check',
    timeout: 'Times out',
    invalid: 'Story rejected',
    limit: 'Goes over a size limit'
  };
  const FILES = {
    contact_sheet: [['contact_sheet', 'sheet.png', 'image/png', 412000]],
    preview: [['preview', 'preview.mp4', 'video/mp4', 6100000], ['thumbnail', 'thumb.jpg', 'image/jpeg', 88000]],
    final_render: [['final_video', 'film.mp4', 'video/mp4', 48200000], ['thumbnail', 'thumb.jpg', 'image/jpeg', 91000],
                   ['receipt', 'receipt.sequence.json', 'application/json', 5100]]
  };
  const ERRORS = {
    crash: ['infrastructure', 'crash', 'The engine process exited unexpectedly (mock).'],
    gate: ['gate', 'gate_failed', 'Bars must start at zero: the “Top states” axis starts at 12 (mock).'],
    timeout: ['timeout', 'timeout', 'Stopped after the 10-minute limit for previews (mock).'],
    invalid: ['invalid_input', 'schema_rejected', 'Unknown key “colour” in clip 2 (mock).'],
    limit: ['limit', 'limit_exceeded', 'The output passed 60 MB (mock).']
  };

  function createMockWorker(client, { outcome = 'succeed' } = {}) {
    const db = client.db;
    let paused = false;
    let current = null;          // { job, plan }
    const plans = new Map();     // job id -> outcome chosen when first claimed

    const update = (job, patch) => { Object.assign(job, patch); client.jobChanged(job); };

    function finish(job, state, [errorClass, errorCode, detail]) {
      update(job, { state, error_class: errorClass, error_code: errorCode, error_detail: detail,
                    ended_at: client.now(), progress: null, progress_note: null });
      current = null;
    }

    function crash(job) {
      if (job.attempt < 3) {
        update(job, { state: 'queued', attempt: job.attempt + 1, error_class: 'infrastructure', error_code: 'crash',
                      error_detail: null, progress: null, progress_note: null, started_at: null });
        current = null;
      } else {
        finish(job, 'failed', ERRORS.crash);
      }
    }

    function claim() {
      const job = db.jobs.filter(j => j.state === 'queued').sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
      if (!job) return;
      if (!plans.has(job.id)) plans.set(job.id, outcome);
      update(job, { state: 'claimed', error_class: null, error_detail: null });
      current = { job, plan: plans.get(job.id) };
    }

    function tick() {
      if (!current) { if (!paused) claim(); return; }
      const { job, plan } = current;
      if (job.cancel_requested) { finish(job, 'cancelled', ['cancelled', 'cancelled', null]); return; }
      switch (job.state) {
        case 'claimed':
          if (plan === 'invalid') return finish(job, 'failed', ERRORS.invalid);
          return update(job, { state: 'running', started_at: client.now(), progress: 0, progress_note: 'Building the data.',
                               progress_detail: { stage: 'starting' }, engine_commit: client.engineCommit });
        case 'running': {
          if ((plan === 'crash_once' && job.attempt === 1) || plan === 'crash_always') return crash(job);
          if (plan === 'timeout') return finish(job, 'failed', ERRORS.timeout);
          const progress = Math.min(1, Math.round(((job.progress || 0) + 0.1) * 100) / 100);
          const total = job.job_type === 'final_render' ? 1560 : 300;
          if (progress < 1) {
            return update(job, { progress, progress_note: `Drawing frames: ${Math.round(progress * 100)}%`,
                                 progress_detail: { stage: 'drawing', done: Math.round(progress * total), total, unit: 'frames',
                                                    eta_s: Math.round((1 - progress) * 150), eta_is_a_guess: true } });
          }
          return update(job, { state: 'validating', progress: 1, progress_note: null,
                               progress_detail: { stage: 'checks', done: 0, total: 1, unit: 'clips', eta_s: null, eta_is_a_guess: true } });
        }
        case 'validating':
          update(job, { progress_detail: { stage: 'uploading' } });
          if (plan === 'gate') return finish(job, 'editorial_action_required', ERRORS.gate);
          if (plan === 'limit') return finish(job, 'failed', ERRORS.limit);
          return update(job, { state: 'uploading' });
        case 'uploading': {
          for (const [kind, file, mime, bytes] of FILES[job.job_type]) {
            db.artifacts.push({
              id: client.newId(), owner_id: job.owner_id, project_id: job.project_id, version_id: job.version_id,
              job_id: job.id, kind, storage_path: `${job.owner_id}/${job.project_id}/${job.version_id}/${job.id}/${file}`,
              mime, bytes, duration_s: null, width: null, height: null, created_at: client.now(), deleted_at: null
            });
          }
          update(job, { state: 'complete', ended_at: client.now(), error_class: null, error_code: null, progress: 1 });
          current = null;
          return;
        }
        default:
          current = null;
      }
    }

    return {
      tick,
      get paused() { return paused; },
      pause() { paused = true; },
      resume() { paused = false; },
      get outcome() { return outcome; },
      setOutcome(o) { if (OUTCOMES[o]) outcome = o; }
    };
  }

  const api = { createMockWorker, OUTCOMES };
  if (typeof module !== 'undefined') module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
