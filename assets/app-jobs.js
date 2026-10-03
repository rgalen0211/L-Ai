// Ryagram job rules for the browser (2A-3): what a job's state means to the
// person, whether they may try again, and whether the final render is
// unlocked. Pure functions; the database makes the real decisions and these
// only decide what to offer.
(() => {
  const ACTIVE = ['queued', 'claimed', 'running', 'validating', 'uploading'];
  // Mirrors submit_job: a failed version may still retry, a complete one is finished.
  const LOCKED_VERSION = ['queued', 'rendering', 'validating', 'uploading', 'complete', 'archived', 'non_restorable'];
  const TYPE_LABELS = { contact_sheet: 'Contact sheet', preview: 'Preview', final_render: 'Final render' };
  const STATE_LABELS = {
    queued: 'Queued', claimed: 'Starting', running: 'Rendering', validating: 'Checking', uploading: 'Uploading',
    complete: 'Complete', failed: 'Failed', editorial_action_required: 'Needs a decision', cancelled: 'Cancelled'
  };

  const isActive = job => ACTIVE.includes(job.state);
  const versionTakesJobs = versionState => !LOCKED_VERSION.includes(versionState);

  // One sentence for a finished job that did not complete, by error class.
  function problem(job) {
    const detail = job.error_detail ? ` ${job.error_detail}` : '';
    if (job.state === 'cancelled') return 'Cancelled.';
    if (job.state === 'editorial_action_required' || job.error_class === 'gate') {
      return `Ryagram’s checks stopped this render.${detail} Change the story, then make a new preview.`;
    }
    switch (job.error_class) {
      case 'infrastructure':
        return `The render machine had a problem, not your story. It tried ${job.attempt} time${job.attempt === 1 ? '' : 's'}.${detail} You can try again.`;
      case 'timeout':
        return `It ran too long and was stopped.${detail} It wasn’t retried, because it would stop again: shorten the film or the preview window first.`;
      case 'invalid_input':
        return `The story or its settings weren’t accepted.${detail} Fix the story and submit again.`;
      case 'limit':
        return `It went over a size or memory limit.${detail}`;
      default:
        return `It failed for a reason Ryagram doesn’t recognise.${detail} You can try again.`;
    }
  }

  // What to show while it runs.
  function progressNote(job, queuePosition) {
    if (job.state === 'queued') {
      const place = queuePosition ? (queuePosition === 1 ? 'Next in line.' : `Number ${queuePosition} in line.`) : 'Waiting in line.';
      return job.attempt > 1 ? `${place} Retrying after a render-machine problem (attempt ${job.attempt} of 3).` : place;
    }
    if (job.cancel_requested) return 'Stopping…';
    if (job.state === 'claimed') return 'The render machine picked it up.';
    if (job.state === 'running') return job.progress_note || 'Drawing frames.';
    if (job.state === 'validating') return 'Checking the film against its data.';
    if (job.state === 'uploading') return 'Uploading the files.';
    return '';
  }

  // Live progress from the worker's heartbeat (jobs.progress_detail, agreed with WORKER in the
  // mailbox, 2026-10-03): the engine's stage and that stage's count. Every count is the STAGE's
  // own -- drawing counts frames, checks count clips, encoding and the data build count nothing.
  // Nothing is ever shown that the data doesn't give: an unknown value reads "\u2014".
  const STAGES = {
    starting: 'Building the data', drawing: 'Drawing frames', encoding: 'Encoding the film',
    checks: 'Checking the film against its data', uploading: 'Uploading the files', done: 'Finishing'
  };
  const UNKNOWN = '\u2014';
  const ACTIVE_STATES = ['claimed', 'running', 'validating', 'uploading'];

  function duration(seconds) {
    if (!(seconds >= 0)) return '';
    if (seconds < 60) return 'under a minute';
    const m = Math.round(seconds / 60);
    if (m < 60) return `${m} min`;
    const hrs = Math.floor(m / 60), rest = m % 60;
    return rest ? `${hrs} h ${rest} min` : `${hrs} h`;
  }

  // The count a job row carries right now, or null: a stage with a positive total and a done.
  function countOf(job) {
    const d = job && job.progress_detail && typeof job.progress_detail === 'object' ? job.progress_detail : null;
    if (!d || !STAGES[d.stage]) return null;
    const done = Number(d.done), total = Number(d.total);
    if (d.total == null || !(total > 0) || d.done == null || !(done >= 0)) return null;
    return { stage: d.stage, done: Math.min(done, total), total, unit: d.unit === 'clips' ? 'clips' : 'frames' };
  }

  // What the page has seen of one job: [{ at (ms), stage, done, total }], oldest first. A sample is
  // kept only when the count moved, so a page polled often doesn't flatten the rate; at most 60.
  function addSample(samples, job, nowMs = Date.now()) {
    const c = countOf(job);
    if (!c) return samples;
    const last = samples[samples.length - 1];
    if (last && last.stage === c.stage && last.total === c.total && last.done === c.done) return samples;
    return [...samples, { at: nowMs, stage: c.stage, done: c.done, total: c.total }].slice(-60);
  }

  // Seconds left in this stage, from elapsed time and frames done: frames done since the first
  // sighting of THIS stage (same total), over the time elapsed since then UP TO NOW, applied to
  // what's left. Measured to now, not to the last change, so a stalled count slows the rate and the
  // ETA grows instead of promising a finish that isn't coming (a real county preview drew 90 frames
  // in 6 s, then stalled 30 s: tests/progress-real-rows.test.cjs). Null, shown as a dash, until
  // there are two sightings with the count moving and at least 5 s have passed.
  function etaSeconds(samples, nowMs) {
    const last = samples && samples[samples.length - 1];
    if (!last || last.done >= last.total) return null;
    const run = samples.filter(x => x.stage === last.stage && x.total === last.total);
    const first = run[0];
    const until = Number.isFinite(nowMs) && nowMs > last.at ? nowMs : last.at;
    const dt = (until - first.at) / 1000, dd = last.done - first.done;
    if (run.length < 2 || dt < 5 || dd <= 0) return null;
    return (last.total - last.done) / (dd / dt);
  }

  // The fields the render panel shows for an active job, each a string ("\u2014" when unknown):
  // { stage, countLabel, count, fraction (0..1 or null), eta, running }
  function progressView(job, nowMs = Date.now(), samples = []) {
    if (!job || !ACTIVE_STATES.includes(job.state) || job.cancel_requested) return null;
    const d = job.progress_detail && typeof job.progress_detail === 'object' ? job.progress_detail : null;
    const c = countOf(job);
    const started = job.started_at ? Date.parse(job.started_at) : NaN;
    // Not shown past 12 h: no job runs that long (the worker stops them at 1.5 h), so it would be a clock problem.
    const secs = (nowMs - started) / 1000;
    const eta = c ? etaSeconds(samples.filter(x => x.stage === c.stage && x.total === c.total), nowMs) : null;
    return {
      stage: d && STAGES[d.stage] ? STAGES[d.stage] : UNKNOWN,
      countLabel: c && c.unit === 'clips' ? 'Clips' : 'Frames',
      count: c ? `${c.done.toLocaleString('en-US')} / ${c.total.toLocaleString('en-US')}` : UNKNOWN,
      fraction: c ? c.done / c.total : null,
      // An estimate, so "~", and never "under a minute": it reads ~1 min at the least.
      eta: eta == null ? UNKNOWN : `~${duration(Math.max(60, eta))} left in this step`,
      running: Number.isFinite(started) && secs >= 0 && secs < 12 * 3600 ? duration(secs) : UNKNOWN
    };
  }

  // Try again = submit a new job of the same kind. Offered only where a
  // repeat can help; gate, bad input, limit and timeout need a change first.
  function canRetry(job, versionState, jobs) {
    if (!['failed', 'cancelled'].includes(job.state)) return false;
    if (job.state === 'failed' && !['infrastructure', 'unknown', null, undefined].includes(job.error_class)) return false;
    if (!versionTakesJobs(versionState)) return false;
    // Only the newest job of its kind: an older failure already has a successor.
    const same = j => j === job || (j.id != null && j.id === job.id);
    return !jobs.some(j => j.job_type === job.job_type && !same(j)
                           && (isActive(j) || j.created_at > job.created_at));
  }

  // The final render needs a finished contact sheet and preview of the story exactly as
  // it is now (same story hash), drawn by one engine version, and that version must still
  // be the one the worker runs: an approval is of a picture, and the picture changes when
  // the engine does. The database and the engine refuse otherwise; this only says why first.
  // currentEngine is null when unknown (then only sheet vs preview is checked).
  function ladder(jobs, storySha, currentEngine = null) {
    const done = type => jobs
      .filter(j => j.job_type === type && j.state === 'complete' && j.story_sha256 === storySha)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const sheets = done('contact_sheet');
    const preview = done('preview')[0] || null;
    const sheet = preview
      ? sheets.find(s => s.engine_commit && s.engine_commit === preview.engine_commit) || null
      : sheets[0] || null;
    let missing = null;
    if (!sheets.length && !preview) missing = 'Make a contact sheet and a preview of this story first.';
    else if (!preview) missing = 'Make a preview of this story first.';
    else if (!preview.engine_commit) missing = 'This preview has no engine version recorded. Make a new preview.';
    else if (!sheets.length) missing = 'Make a contact sheet of this story first.';
    else if (!sheet) missing = 'The contact sheet and the preview were drawn by different versions of the engine. Make a new contact sheet so both match.';
    else if (currentEngine && currentEngine !== preview.engine_commit) {
      missing = 'Ryagram’s engine has been updated since this preview. Make a new contact sheet and preview, so you approve what the current engine draws.';
    }
    return { sheet, preview, ready: !missing, missing };
  }

  // "2016, 2018 2020" -> ["2016", "2018", "2020"]; empty -> null (engine default).
  function parsePeriods(text) {
    const parts = String(text || '').split(/[\s,]+/).filter(Boolean);
    if (!parts.length) return { value: null };
    if (parts.length < 3 || parts.length > 5 || parts.some(p => !/^\d{4}$/.test(p))) {
      return { error: 'Periods must be 3 to 5 years, like 2016, 2018, 2020.' };
    }
    return { value: parts };
  }

  // Start and end seconds; both empty -> null (engine default).
  function parseWindow(startText, endText) {
    const s = String(startText ?? '').trim();
    const e = String(endText ?? '').trim();
    if (!s && !e) return { value: null };
    const a = Number(s), b = Number(e);
    if (s === '' || e === '' || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b - a > 10) {
      return { error: 'The preview window needs a start and end in seconds, at most 10 seconds apart.' };
    }
    return { value: [a, b] };
  }

  window.ryagramJobs = {
    TYPE_LABELS, STATE_LABELS, isActive, versionTakesJobs, problem, progressNote, progressView, addSample, etaSeconds, duration, canRetry, ladder, parsePeriods, parseWindow
  };
})();
