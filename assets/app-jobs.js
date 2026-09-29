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
    TYPE_LABELS, STATE_LABELS, isActive, versionTakesJobs, problem, progressNote, canRetry, ladder, parsePeriods, parseWindow
  };
})();
