// Ryagram job rules for the browser (2A-3): what a job's state means to the
// person, whether they may try again, and whether the final render is
// unlocked. Pure functions; the database makes the real decisions and these
// only decide what to offer.
(() => {
  const ACTIVE = ['queued', 'claimed', 'running', 'validating', 'uploading'];
  // Mirrors submit_job: a failed version may still retry, a complete one is finished.
  const LOCKED_VERSION = ['queued', 'rendering', 'validating', 'uploading', 'complete', 'archived', 'non_restorable'];
  const TYPE_LABELS = { contact_sheet: 'Contact sheet', preview: 'Preview', final_render: 'Final render', film_bundle: 'Film files' };
  // A job type in plain words, never the raw name: a type this page does not know yet is spoken from its own name ('some_new_kind' reads 'Some new kind').
  const typeLabel = type => {
    if (typeof type !== 'string' || !type) return 'Job';
    if (Object.hasOwn(TYPE_LABELS, type)) return TYPE_LABELS[type];
    const words = type.replace(/[_-]+/g, ' ').trim();
    return words ? words[0].toUpperCase() + words.slice(1) : 'Job';
  };
  const STATE_LABELS = {
    queued: 'Queued', claimed: 'Starting', running: 'Rendering', validating: 'Checking', uploading: 'Uploading',
    complete: 'Complete', failed: 'Failed', editorial_action_required: 'Stopped', cancelled: 'Cancelled'
  };

  const isActive = job => ACTIVE.includes(job.state);
  const versionTakesJobs = versionState => !LOCKED_VERSION.includes(versionState);

  // The worker's refusal text is for engineers: ryagram.worker.schema joins EVERY fault with "; " ("$: unknown key 'outro'; $.sequence.fps: \"x\" is not one of 24, 25, 30").
  // plainDetail splits it, turns each fault into a sentence a person can act on, and for a fault it does not know says so plainly -- never nothing. The raw text is kept
  // (rawDetail) and shown behind "Get help with this". Golden strings in tests/smoke-fixes.test.mjs come from the real validate_story on planted stories.
  // Also (WEB 11-21, WORKER's table proposals/WORKER-FREE-PREVIEW-FAILURES-1121.md): an "...Error" word (KeyError), "exit 1:", a file name (preview.mp4, x.json), a bare limit number ("limit 52428800", "61234567 bytes")
  // and the lower-case jargon "sidecar", "engine commit", "preflight". A full stop in ordinary prose is not caught: a file name needs one of the listed endings right after its dot.
  const LOOKS_LIKE_CODE = /[$\[\]{}]|::|Traceback|\bat line\b|\bException\b|\b[a-z]+_[a-z_]+\b|\b[A-Z][a-z]+Error\b|^\s*exit \d+\b|\b[\w-]+\.(?:mp4|json|png|csv|py|log|txt)\b|\blimit \d{3,}|\b\d{5,} bytes\b|\b(?:[Ss]idecar|[Ee]ngine commit|[Pp]reflight)\b/;
  const UNREADABLE = 'The render machine gave a reason Ryagram cannot put into plain words. Open “Get help with this” and send it to us.';
  const unquote = t => String(t).trim().replace(/^(['"“])(.*)\1$/, '$2');
  function where(path) {
    const parts = String(path || '').replace(/^\$\.?/, '').split('.').filter(Boolean)
      .map(p => { const m = /^([A-Za-z_]+)\[(\d+)\]$/.exec(p); return m ? `${m[1] === 'clips' ? 'clip' : m[1]} ${Number(m[2]) + 1}` : p; });
    return parts.length ? ` (in ${parts.join(' > ')})` : '';
  }
  // The worker keeps at most 500 characters of a refusal (ryagram/worker/engine.py sanitise limit=500; tools/ryagram_node.py _report [:500]), and the engine's own sentences end with
  // the next step ("show 8 lines or fewer", "Please contact Ryagram"). So a sentence is kept whole up to 500; past that it is cut at the last full stop, never mid-sentence ('' if there is none).
  const DETAIL_MAX = 500;
  function wholeSentences(text) {
    if (text.length <= DETAIL_MAX) return text;
    const head = text.slice(0, DETAIL_MAX + 1);
    const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
    return stop > 0 ? head.slice(0, stop + 1) : '';
  }
  function plainFault(fault) {
    const f = /^(\$[^:]*):\s*(.*)$/s.exec(fault.trim());
    if (!f) return fault.trim() && !LOOKS_LIKE_CODE.test(fault) ? wholeSentences(fault.trim()) : '';
    const at = where(f[1]), msg = f[2].trim();
    let m;
    if ((m = /^unknown key '([^']+)'/i.exec(msg))) return `The story has a setting Ryagram doesn’t recognise: “${m[1]}”${at}.`;
    if ((m = /^(?:missing|required)(?: key)? '?([^']*)'?/i.exec(msg))) return `The story is missing a required setting${m[1] ? `: “${m[1]}”` : ''}${at}.`;
    if ((m = /^(.+?) is not on this worker.s dataset allowlist/i.exec(msg))) return `The dataset “${unquote(m[1])}”${at} can’t be drawn here. Start again from a ready-made film.`;
    if ((m = /^(.+?) is not offered for (\S+) on this worker \(offered: ([^)]*)\)/i.exec(msg))) return `${unquote(m[2])} can’t be drawn as ${unquote(m[1])}${at}. It can be drawn as: ${m[3].trim()}.`;
    if ((m = /^(.+?) is not one of (.+)$/i.exec(msg))) {
      const choices = m[2].replace(/[\[\]"“”']/g, '').split(',').map(x => x.trim()).filter(Boolean);
      return `The value “${unquote(m[1])}”${at} isn’t an allowed choice here. ${choices.length && choices.length <= 6 ? `Allowed: ${choices.join(', ')}.` : 'Pick one of the ready-made choices instead.'}`;
    }
    if (/^(?:expected|must be|should be)\b/i.test(msg)) return `A setting${at} has the wrong kind of value. Check it against a ready-made film.`;
    return `Something in the story${at} wasn’t accepted.`;
  }
  function plainDetail(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    const faults = text.split(/;\s+(?=\$)/).filter(x => x.trim());
    const out = [];
    for (const f of faults) { const s = plainFault(f); if (s && !out.includes(s)) out.push(s); }
    if (!out.length) return text.startsWith('$') || LOOKS_LIKE_CODE.test(text) || text.length > DETAIL_MAX ? UNREADABLE : text;
    const advice = faults.some(f => /unknown key/i.test(f)) ? ' Remove the setting(s) above, or pick a ready-made film and start again.' : '';       // said once, not after every fault
    const shown = out.slice(0, 5).join(' ') + advice;
    return out.length > 5 ? `${shown} And ${out.length - 5} more. Open “Get help with this” and send it to us.` : shown;
  }
  const rawDetail = job => String((job && job.error_detail) || '').trim();      // kept for the help form's own use; the job list never shows it (WEB 11-23: a stranger's page shows only problem()'s words)

  // The words a stranger reads when a click is refused (WEB 11-23). The server's own sentences are shown as they come only when they already are plain; a code name, a path or a database
  // phrase becomes one plain line. 'contact_sheet jobs are paused.' is control.disabled_job_types (an operator switch, 20261017000600_pipe1_orders.sql): nothing says for how long.
  const REFUSAL_GENERIC = 'Something went wrong. Please try again, or ask us to help.';
  const ALREADY_IN_PROGRESS = 'This film is already being made. You will see it under Jobs.';
  const REFUSAL_OFFLINE = 'Ryagram could not be reached. Check your internet connection and try again.';
  const QUEUE_FULL_NEXT = 'Your waiting films are listed under Jobs on each film’s page.';
  const VIEW_BLOCKED = 'This film is not available yet. Please choose another film.';          // the server says 'another view'; the app never calls them views
  const PAUSED_WHAT = { contact_sheet: 'contact sheets', preview: 'previews', final_render: 'full films', film_bundle: 'film files' };
  const DB_WORDS = /row-level security|violates|constraint|\brelation\b|\bcolumn\b|permission denied|\bJWT\b|PGRST|duplicate key|syntax error|schema cache|[\\\/][\w.-]+[\\\/]/i;
  function plainRefusal(message) {
    const text = String(message == null ? '' : message).trim();
    if (!text) return REFUSAL_GENERIC;
    let m;
    if ((m = /^(\w+) jobs are paused\.?$/.exec(text))) return Object.hasOwn(PAUSED_WHAT, m[1]) ? `Making ${PAUSED_WHAT[m[1]]} is paused for now. Please try again later.` : 'This is paused for now. Please try again later.';
    if (/failed to fetch|networkerror|load failed/i.test(text)) return REFUSAL_OFFLINE;
    if (/already in progress/i.test(text)) return ALREADY_IN_PROGRESS;                       // submit_job_for: 'A contact_sheet job for this version is already in progress.' (a second tab): the type name would read as code
    // The two Tuesday refusals (BUILDER 11-23, migrations 20261123000200/000300): the server's words, plus where to go next (BUILDER's 11:22 page audit).
    if (/^You have \d+ films? waiting\./.test(text)) return `${text} ${QUEUE_FULL_NEXT}`;
    if (/^This film is not available yet\./.test(text)) return VIEW_BLOCKED;
    // credits_ledger.sql: 'Not enough credits: this needs 10, and 8 are available.' (or 'Not enough credits for this job.'): what it costs, what you have, and the next step (Q679 B; FACES 11-23).
    if ((m = /^Not enough credits: this needs (\d+), and (\d+) (?:is|are) available\.?$/.exec(text))) return `This needs ${m[1]} credit${m[1] === '1' ? '' : 's'} and you have ${m[2]}. ${buyingOpen() ? 'Buy credits, then try again.' : 'Buying credits is not open yet.'}`;
    if (/^Not enough credits\b/.test(text)) return `You do not have enough credits for this. ${buyingOpen() ? 'Buy credits, then try again.' : 'Buying credits is not open yet.'}`;
    if (LOOKS_LIKE_CODE.test(text) || DB_WORDS.test(text) || text.length > DETAIL_MAX) return REFUSAL_GENERIC;
    return text;
  }
  // The free-preview limit, said once with both limits because credit_quote says only that the preview is not free (credits_ledger.sql: free_previews_per_project 6, free_previews_per_24h 15).
  const FREE_PREVIEW_USED = 'Your free previews are used up: each project gets 6, and 15 across all projects in any 24 hours. Start a new project if this one used its 6, or try again later.';

  // One sentence for a finished job that did not complete, by error class.
  // DRAFT FOR RYAN (WEB 11-21, from WORKER's failure table): the words for a limit with no next step, for the machine's own setup (engine_unsupported), and for checks that did not run.
  const LIMIT_NEXT = 'Try a shorter preview window, or ask us to help.';
  const LIMIT_NEXT_OTHER = 'Ask us to help.';                                                                           // only a preview has a window to shorten (a contact sheet and a final render have none)
  const TOO_LARGE = 'This film is too large for the render machine. Ask us to help.';
  const NOT_APPROVED = 'This render was not approved, so nothing was rendered and your credits came back.';                 // final_close() in pipe1_orders: error_code 'declined', the job 'cancelled', the hold released
  const NOT_APPROVED_IN_TIME = 'This render was not approved in time, so it was cancelled and your credits came back.';    // error_code 'approval_expired'
  const RENDER_HELP = 'Open “Get help with this”.';
  const UNSUPPORTED = 'The render machine cannot make this kind of film yet. Nothing is wrong with your story. Tell us and we will fix it.';
  const LADDER_MISSING = 'This render did not match the contact sheet and preview you approved. Make a new contact sheet and preview, then render again.';
  const CREDITS_RETURNED = ' The credits held for it were returned.';                                                       // credits_ledger.sql: failed/cancelled/editorial_action_required releases the hold in full; only a final render holds any
  const CHECKS_DID_NOT_RUN = 'Ryagram’s checks could not run on this render. Nothing is wrong with your story. You can try again, or open “Get help with this”.';
  const UPLOAD_WORDS = /uploaded data|your data|your columns/i;                                                    // the worker's own lines for a job that ran on an upload (worker/uploads.py)
  function problem(job) {
    const plain = plainDetail(job.error_detail);
    const detail = plain ? ` ${plain}` : '';
    const asksToContact = /contact Ryagram/i.test(plain);                                                        // the sentence's own next step is for us to act: never add "Fix the story"
    if (job.state === 'cancelled') {
      if (job.error_code === 'declined') return NOT_APPROVED;
      if (job.error_code === 'approval_expired') return NOT_APPROVED_IN_TIME;
      return 'Cancelled.';
    }
    if (job.error_code === 'ladder_missing') return LADDER_MISSING + (job.job_type === 'final_render' ? CREDITS_RETURNED : '');   // the approved sheet and preview, not the story; the engine's own text is never shown
    if (job.error_code === 'engine_unsupported' || job.error_class === 'engine_unsupported') return UNSUPPORTED;                   // the machine's setup, not the story: never "Fix the story"
    if (job.state === 'editorial_action_required' || job.error_class === 'gate') {
      if (/checks did not run/i.test(String(job.error_detail || ''))) return CHECKS_DID_NOT_RUN;   // the machine's fault, not the story's: never "Change the story"
      if (/render-anyway|override/i.test(rawDetail(job))) return `Ryagram’s checks stopped this render.${detail} No change to the story can fix this. ${RENDER_HELP}`;   // the local-only override: no web story can carry it
      return `Ryagram’s checks stopped this render.${detail}${asksToContact ? '' : ` Change the story, then ${job.job_type === 'contact_sheet' ? 'make a new contact sheet' : 'make a new preview'}.`}`;
    }
    switch (job.error_class) {
      case 'infrastructure':
        if (job.error_code === 'queue_timeout' && (job.job_type === 'contact_sheet' || job.job_type === 'preview')) return 'The render machine did not get to it in time, so we stopped it. This is not your story. You can try again.';   // queue_timeout fails only a job that NEVER STARTED while the machine was silent (ops_readiness.sql expire_stale_queue). A contact sheet holds none and a free preview holds none, so the server's 'Your credits were returned.' is not repeated here; a PAID preview (1 credit after the 6) gets its true line from the ledger (returnedLine in app-library.js, job_accounting), which the jobs rows do not carry
        if (job.error_code === 'queue_timeout') return `We had a problem on our side, not with your story.${detail} You can try again.`;     // the SERVER's own sentence (ops_readiness.sql), kept: it says what happened to the credits
        return 'We had a problem on our side, not with your story. You can try again. If it keeps happening, open “Get help with this”.';     // no count, and never the worker's own detail (it is an internal message: only the help form carries it)
      case 'timeout':
        return `It ran too long and was stopped.${detail} It wasn’t retried, because it would stop again: shorten the film${job.job_type === 'preview' ? ' or the preview window' : ''} first.`;     // only a preview has a window
      case 'invalid_input':
        if (job.error_code === 'dataset_not_allowed' || UPLOAD_WORDS.test(rawDetail(job))) return detail.trim() || 'The data this film uses was not accepted. Open Your data to check it.';   // the story is fine: the uploaded data is the thing to fix
        return `The story or its settings weren’t accepted.${detail}${asksToContact ? '' : ' Fix the story and submit again.'}`;
      case 'limit': {
        if (job.job_type === 'preview') return `It went over a size or memory limit.${detail} ${LIMIT_NEXT}`;
        if (/preview window|shorter preview/i.test(plain)) return TOO_LARGE;                                       // the worker's own line advises a preview window, which only a preview has
        return `It went over a size or memory limit.${detail} ${LIMIT_NEXT_OTHER}`;
      }
      default:
        return 'It failed for a reason Ryagram doesn’t recognise. You can try again.';          // the worker's own detail stays out of the page
    }
  }

  // Said plainly, no promise about when: the film is made on the person's own computer, and none is signed in (the site itself shows the same fact on Account > Computers signed in).
  const WAITING_FOR_COMPUTER = 'Waiting for your computer. No computer is signed in to your account, so this film cannot start. Open the Ryagram app on your computer and sign in; the film starts once it is signed in.';

  // What to show while it runs.
  // own = { tester, computers } for an account whose films are made on its own computer; computers is how many are signed in, or null when that could not be read (then nothing is claimed).
  // A job reserved for the person's own computer (run_on 'owner_local') says so whatever the account switches are; with no run_on on the row, the account's tester flag decides.
  const WAITING_FOR_COMPUTER_PICKUP = 'Waiting for your computer to pick it up. Open the Ryagram app on your computer and keep it signed in; the film starts there.';
  // How long a place in line may take (WEB 11-23, BUILDER's queue audit). The render PC makes one film at a time. Only a contact sheet has a measured time (the Version page says 'usually about 4 to 5
  // minutes'; WORKER's live run 11-17 took 3 min 52 s), so only a contact sheet gets a number: 5 minutes for each film ahead, said as 'about', never a promise, with 'may take longer' because a film ahead
  // may be a preview or a final render. Any other kind of job says only that each film ahead takes a few minutes (WORKER's preview timings disagree: 2 min 23 s measured, 5 to 7 min in the features list).
  const ONE_AT_A_TIME = 'We make one film at a time.';
  const BUSY_HOURS = 'At busy times yours may take hours, or more than a day when many people join at once.';        // position unknown: no number invented (WEB 11-24, public launch: one PC, one job at a time)
  const NEXT_UP = 'It starts when the film being made now finishes, which can take up to about half an hour.';
  const FULL_FILM = 'A full film takes up to about half an hour once it starts';
  // Measured times (WORKER, Monday live): a contact sheet about 4.5 minutes, a preview about 4.7, an approved full film about 17 minutes and up to about 30 (ENGINE, one renderer).
  // Bands by place in line (P = 1 + the films queued ahead; the film made NOW is not counted). Short line: minutes. Longer: whole hours, never 'hours and minutes'. Very long: a day or more.
  const hoursUp = minutes => { const h = Math.ceil(minutes / 60); return h + (h === 1 ? ' hour' : ' hours'); };
  const waitWords = minutes => { const h = Math.floor(minutes / 60), m = minutes % 60; return h ? `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minutes` : ''}` : `${m} minutes`; };
  function queueWait(job, position) {
    if (position >= 150) return `${ONE_AT_A_TIME} The line is very long right now. Yours may take a day or more. You can close this page and come back; your film keeps its place in line while the render machine is running.`;
    if (job.job_type === 'final_render') {
      return position >= 25
        ? `${ONE_AT_A_TIME} ${FULL_FILM}, and a sheet or preview ahead of yours takes a few minutes, so it may be hours with this many ahead.`
        : `${ONE_AT_A_TIME} ${FULL_FILM}, so yours may start after a few films, not a few minutes.`;
    }
    if (position >= 25) return `${ONE_AT_A_TIME} Yours starts in about ${hoursUp(position * 5)}, maybe more if full films are ahead of yours.`;
    return `${ONE_AT_A_TIME} It may be working on another film right now. Yours starts in about ${waitWords(position * 5)} and takes about 5 more. A full film ahead of yours can take up to half an hour, so it may take longer.`;
  }
  function progressNote(job, queuePosition, own) {
    const ownComputer = job.run_on ? job.run_on === 'owner_local' : !!(own && own.tester === true);
    if (job.state === 'queued' && ownComputer && !job.cancel_requested) return own && own.computers === 0 ? WAITING_FOR_COMPUTER : WAITING_FOR_COMPUTER_PICKUP;
    if (job.state === 'queued') {
      const place = queuePosition ? (queuePosition === 1 ? `Next in line. ${ONE_AT_A_TIME} ${NEXT_UP}` : `Number ${queuePosition} in line. ${queueWait(job, queuePosition)}`) : `Waiting in line. ${ONE_AT_A_TIME} ${BUSY_HOURS}`;
      return job.attempt > 1 ? `${place} This was put back in line after a problem on our side.` : place;
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
    if (!d || !Object.hasOwn(STAGES, d.stage)) return null;
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
      stage: d && Object.hasOwn(STAGES, d.stage) ? STAGES[d.stage] : UNKNOWN,
      // Said for the last step only, where a long count gives no time word (a real preview sat at "454 / 454" while the checks ran). Honest and without a number: no promise of a fixed time.
      note: d && d.stage === 'checks' ? 'This step can take several minutes.' : '',
      countLabel: c && c.unit === 'clips' ? 'Clips' : 'Frames',
      count: c ? `${c.done.toLocaleString('en-US')} / ${c.total.toLocaleString('en-US')}` : UNKNOWN,
      fraction: c ? c.done / c.total : null,
      // An estimate, so "~", and never "under a minute": it reads ~1 min at the least.
      eta: eta == null ? UNKNOWN : `~${duration(Math.max(60, eta))} left in this step`,
      running: Number.isFinite(started) && secs >= 0 && secs < 12 * 3600 ? duration(secs) : UNKNOWN,
      // When the worker has told us none of stage, count or ETA, three dashes say nothing: show "Working" and how long it has been. Like `running`, a time past 12 h is a clock problem or a
      // stale row, never shown (King's Island walk W4: a preview with no started_at showed 'Working... 710 h 46 min'), also when it is counted from created_at.
      working: !(d && STAGES[d.stage]) && !c && eta == null,
      elapsed: Number.isFinite(started) && secs >= 0 && secs < 12 * 3600 ? duration(secs) : (job.created_at && Number.isFinite(Date.parse(job.created_at)) && nowMs >= Date.parse(job.created_at) && (nowMs - Date.parse(job.created_at)) / 1000 < 12 * 3600 ? duration((nowMs - Date.parse(job.created_at)) / 1000) : '')
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

  // Render orders (a full render is requested, then waits for approval, renders and is delivered).
  const ORDER_WORDS = { running: 'Rendering', awaiting_approval: 'Waiting for approval', delivered: 'Delivered', previewed: 'Previewed', failed: 'Failed', declined: 'Not approved',
                        cancelled: 'Cancelled', expired: 'Expired', editorial_action_required: 'Stopped' };
  // The Credits page's own switch (app-library.js buyingOn: credits + payments + buyingOpen, open in mock mode unless ?buyingclosed), read here from the same config so this file needs nothing from app-library.js.
  const buyingOpen = () => {
    const cfg = window.ryagramConfig, mock = !!window.ryagramMock;
    const credits = cfg?.credits === true || mock, payments = credits && (cfg?.payments === true || mock);
    return payments && (cfg?.buyingOpen === true || (mock && !/[?&]buyingclosed/.test((window.location && window.location.search) || '')));
  };
  // Failures whose credits the database really returns (a job failure releases its hold; an order that ended before any hold was taken). Any other code, advance_error above all (the order fails from an exception and refund_job is never called), makes no promise about credits.
  const CREDITS_RETURNED_CODES = /^(?:worker_lost|queue_timeout|delivery_failed|invalid_story|gate|contact_sheet_\w+|preview_\w+)$/;
  // One sentence for the person, from render_order_status().
  function orderLine(st) {
    if (!st) return '';
    const fin = (st.stages || []).find(s => s.stage === 'final_render') || {};
    const held = fin.credits_quoted > 0 ? ` ${fin.credits_quoted} credit${fin.credits_quoted === 1 ? '' : 's'} ${st.state === 'awaiting_approval' || st.state === 'running' ? 'are held' : 'were held'}.` : '';
    const code = st.error_code;
    if (code === 'delivery_expired') return 'Your film was kept for 30 days and has been deleted.';                          // a delivered film passing 30 days: state 'expired', but it was delivered
    if (code === 'cancelled' && st.state === 'failed') return 'You cancelled the full render. Your credits were returned.';
    if (st.state === 'failed') {
      if (code === 'insufficient_credits') return `The full render did not start because you do not have enough credits. Nothing was charged. ${buyingOpen() ? 'Buy credits, then request it again.' : 'Buying credits is not open yet.'}`;   // stage_submit: no job, no hold
      if (code === 'daily_cap') return 'The full render did not start because you reached today’s credit limit. Nothing was charged. You can request it again after 24 hours.';
      if (code === 'ladder_missing') return 'This render did not match the contact sheet and preview you approved. Your credits were returned. Make a new contact sheet and preview, then request it again.';
      if (code === 'engine_refused' || code === 'schema_rejected') return 'The render machine would not make a film from this story, so asking again would be refused the same way. Your credits were returned. Change the story, or make a new contact sheet and preview, then request it again.';
      if (code === 'timeout' || code === 'limit_exceeded') return 'The full render ran over a time or size limit, so asking again would stop it the same way. Your credits were returned. Change the story to make a smaller film, or make a new contact sheet and preview, then request it again.';
    }
    switch (st.state) {
      case 'awaiting_approval': return `Your full render is waiting for approval. We approve each one by hand for now.${held} They come back if it is not approved.`;
      case 'running': return `Your full render is on its way.${held}`;
      case 'delivered': return st.delivery && !st.delivery.deleted ? `Your film is ready, kept for 30 days (until ${String(st.delivery.expires_at).slice(0, 10)}).` : 'Your film was kept for 30 days and has been deleted.';
      case 'declined': return `The full render was not approved, so nothing was rendered and your credits were returned.`;
      case 'expired': return 'The full render was not approved in time, so it was cancelled and your credits were returned.';
      case 'cancelled': return 'You cancelled the full render. Your credits were returned.';
      case 'editorial_action_required': return 'Ryagram\u2019s checks stopped this render. Change the story, then make a new preview. Your credits were returned.';
      case 'failed': return !code || CREDITS_RETURNED_CODES.test(code) ? 'The full render failed. Your credits were returned. You can request it again.' : 'The full render failed. Ask us to help.';
      default: return ORDER_WORDS[st.state] || st.state;
    }
  }
  const orderOpen = state => state === 'running' || state === 'awaiting_approval';

  window.ryagramJobs = { ORDER_WORDS, orderLine, orderOpen,
    TYPE_LABELS, typeLabel, STATE_LABELS, isActive, versionTakesJobs, problem, plainDetail, rawDetail, plainRefusal, FREE_PREVIEW_USED, progressNote, progressView, addSample, etaSeconds, duration, canRetry, ladder, parsePeriods, parseWindow
  };
})();
