// What the person reads while a final render runs (NEXT-WEB 152; proposals\WEB-LIVE-EDITOR.md section 5; WORKER 41 part (b)): frames done of total, a time left that is only ever
// marked as a guess, a bar that never runs backwards, and a plain sentence when the job has stopped reporting. Pure logic, no DOM, so every rule has a unit test.
// Input is the worker's `progress_detail` as it is today: { stage, done, total, unit, eta_s, eta_is_a_guess, total_is_provisional }, read as untrusted data
// (numbers are checked, unknown stages get a plain label, no text from the render is shown).
(() => {
  const STALL_MS = 120000;                              // no new number for two minutes: say so instead of showing a bar that looks alive
  const STAGES = { drawing: 'Drawing frames', encoding: 'Putting the video together', checking: 'Running the checks', uploading: 'Saving the film', validating: 'Running the checks' };
  const ORDER = ['drawing', 'encoding', 'checking'];
  // The bar spans the whole job so it does not sit at 100% while the video is put together: drawing is most of the work, then encoding, then the checks. The widths are a
  // fixed guess, never shown as numbers; the bar only moves forward.
  const BANDS = { drawing: [0, 0.85], encoding: [0.85, 0.95], checking: [0.95, 1] };
  const bandOf = stage => BANDS[stage === 'validating' || stage === 'uploading' ? 'checking' : stage] || BANDS.checking;
  const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const group = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // "about 6 min" / "about 40 seconds" / "finishing up": never "0 seconds" and then a wait.
  function etaWords(etaS) {
    const s = num(etaS);
    if (s === null) return null;
    if (s < 5) return 'finishing up';
    if (s < 60) return `about ${Math.round(s / 5) * 5} seconds left`;
    const m = Math.round(s / 60);
    if (m < 90) return `about ${m} min left`;
    return `about ${Math.round(s / 360) / 10} hours left`;
  }
  const agoWords = ms => ms < 90000 ? 'a moment ago' : ms < 5400000 ? `${Math.round(ms / 60000)} minutes ago` : `${Math.round(ms / 360000) / 10} hours ago`;

  class Tracker {
    constructor() { this.best = 0; this.stage = null; this.lastKey = null; this.lastChangeAt = null; this.state = 'running'; }
    // reading: the progress_detail object (or null before the first report); now: ms. Returns the view model the page draws.
    feed(reading, now) {
      if (this.state !== 'running') return this.view(null, now);
      const r = reading && typeof reading === 'object' ? reading : null;
      if (!r) return this.view(null, now);
      const done = num(r.done), total = num(r.total);
      const key = `${r.stage}|${done}|${total}`;
      if (key !== this.lastKey) { this.lastKey = key; this.lastChangeAt = now; }
      if (r.stage !== this.stage) this.stage = r.stage;
      if (done !== null && total && total > 0) { const [lo, hi] = bandOf(r.stage); this.best = Math.max(this.best, lo + Math.min(1, done / total) * (hi - lo)); }
      return this.view(r, now);
    }
    finish(state) { this.state = state; }          // 'complete' | 'failed' | 'cancelled'
    view(r, now) {
      if (this.state === 'complete') return { state: 'complete', headline: 'Your film is ready.', fraction: 1, eta: null, then: null, stalled: false, stalledText: null };
      if (this.state === 'failed') return { state: 'failed', headline: 'The render did not finish.', fraction: this.best, eta: null, then: 'Your draft is as you left it. Nothing was spent on a film that did not finish; you can try again.', stalled: false, stalledText: null };
      if (this.state === 'cancelled') return { state: 'cancelled', headline: 'The render was cancelled.', fraction: this.best, eta: null, then: 'Your draft is as you left it.', stalled: false, stalledText: null };
      if (!r) return { state: 'waiting', headline: 'Waiting for your computer to start.', fraction: this.best, eta: null, then: null, stalled: false, stalledText: null };
      const stage = STAGES[r.stage] || 'Working';
      const done = num(r.done), total = num(r.total);
      const counted = done !== null && total ? `${stage}: ${group(done)} of ${r.total_is_provisional ? 'at least ' : ''}${group(total)}${r.unit && r.unit !== 'frames' ? ' ' + String(r.unit).replace(/[^a-z ]/gi, '').slice(0, 20) : ''}` : stage;
      // The time left: only a number the worker gave; with no rate yet there is no number at all, never an invented one. "about", and a guess, unless the worker says it is not one.
      const left = etaWords(r.eta_s);
      const guess = r.eta_is_a_guess !== false;
      const eta = left === null ? 'working out how long this takes' : left === 'finishing up' ? left : `${left}${guess ? ' (a guess, rechecked as it runs)' : ''}`;
      const idx = ORDER.indexOf(r.stage);
      const rest = idx >= 0 ? ORDER.slice(idx + 1).map(s => (s === 'encoding' ? 'putting the video together' : 'the checks')) : [];
      const then = rest.length ? `Then: ${rest.join(', then ')}. The time left counts all of them, so it will not say 0 and then wait.` : null;
      const quiet = now - this.lastChangeAt;
      const stalled = quiet > STALL_MS;
      return { state: 'running', headline: counted, fraction: this.best, eta, then, stalled,
        stalledText: stalled ? `Waiting for your computer to report back. It last reported ${agoWords(quiet)}.` : null };
    }
  }

  window.ryagramEditorProgress = { STALL_MS, STAGES, BANDS, etaWords, agoWords, group, Tracker };
})();
