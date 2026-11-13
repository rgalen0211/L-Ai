// The page's film API for the editor's real frames (CONNECT, 2026-11-13; CC1 item 1, the adapter WEB asked for at 10:06). WEB's editor (assets/app-editor-film.js) uses
//   window.ryagramFilmApi(project) -> { plan(): Promise<plan>, window('A:B', { onProgress(0..1|null) }): Promise<Uint8Array> }
// This file builds that from three things the page already has: the database call (request_film_bundle, migration 20261113000400), the storage signed link (the ordinary artifact link, the owner's own file)
// and a download. Nothing is invented: a window is asked for, waited for (the same call answers 'building' with the same job until it is ready: no new job, so polling is free of limits but never faster than
// every 3 seconds), then fetched. The refusals are told apart by their SQLSTATE: 22023 (a bad window, a window past the film's end) and a 'failed' status are FINAL for this story; 42501 (six parts already being
// drawn, sixty an hour, paused) is NOT a failure of the film: it is asked again after a pause, a few times, and then said in words with retryLater = true; anything else is passed up in words.
// No Supabase key, no address and no film data lives here: the three functions are handed in. Pure logic, tested offline (tests/film-api.test.mjs).
(() => {
  'use strict';
  const POLL_MS = 3000, MAX_WAIT_MS = 20 * 60 * 1000, BUSY_PAUSE_MS = 5000, BUSY_TRIES = 6, FIRST_WINDOW = '0:10';
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isInt = v => Number.isInteger(v);
  const range = (a, b) => String.fromCharCode(a) + '-' + String.fromCharCode(b);
  const BAD = new RegExp('[' + range(0x00, 0x1f) + range(0x7f, 0x9f) + range(0x202a, 0x202e) + range(0x2066, 0x2069) + range(0x200e, 0x200f) + ']', 'g');
  const clean = s => String(s == null ? '' : s).replace(BAD, ' ').trim().slice(0, 300);
  const WINDOW = /^(0|[1-9][0-9]{0,5}):[1-9][0-9]{0,5}$/;

  class FilmApiError extends Error {
    constructor(message, props = {}) { super(message); this.name = 'FilmApiError'; Object.assign(this, { final: false, retryLater: false, code: null }, props); }
  }

  /** (A short clip's plan names its windows by the clip's length, e.g. '0:4', so the store's first window then differs from the '0:10' asked here: that case costs one extra window, cached after.) ENGINE's manifest.film (any window carries it) as the plan WEB's checkPlan reads. The film's clips are not in the manifest, so the timeline has none (the title block and the film are drawn as one lane). */
  function planFromManifest(manifest) {
    const film = isObj(manifest) ? manifest.film : null;
    const fail = () => { throw new FilmApiError('The plan of your film is not valid.', { final: true }); };
    if (!isObj(film)) fail();
    const fps = Number(manifest.fps);
    if (!(fps > 0 && fps <= 240)) fail();
    const secs = Number(film.film_seconds), frames = film.film_frames, rs = Number(film.render_start);
    if (!(secs > 0) || !isInt(frames) || frames < 1 || !(rs >= 0) || !Array.isArray(film.windows) || !film.windows.length || film.windows.length > 100000) fail();
    const windows = [];
    let at = 0;
    for (const text of film.windows) {
      if (typeof text !== 'string' || !WINDOW.test(text)) fail();
      const a = Number(text.split(':')[0]), b = Number(text.split(':')[1]);
      if (a !== at || b <= a || b - a > 10) fail();
      windows.push({ seconds: [a, b], window: text });
      at = b;
    }
    return { fps, windows, timeline: { render_start: rs, total_seconds: secs, total_frames: frames, clips: [] } };
  }

  /**
   * request(versionId, 'A:B') -> { status, job_id, storage_path, engine_commit, error_detail }  (the database call; it throws an Error with .code = the SQLSTATE and .message = the sentence)
   * jobProgress(jobId) -> Promise<number 0..1|null> (OPTIONAL: the owner's own job row's progress, which the worker writes while it draws; without it, or when it answers nothing, onProgress gets null: no number is invented).
   * fileUrl(path) -> Promise<string> (the storage signed link), fetchBytes(url) -> Promise<Uint8Array|ArrayBuffer>, readManifest(bytes) -> manifest object (WEB's zip reader), sleep(ms).
   */
  function makeFilmApi({ versionId, request, fileUrl, fetchBytes, readManifest, jobProgress, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(), pollMs = POLL_MS, maxWaitMs = MAX_WAIT_MS }) {
    if (typeof request !== 'function' || typeof fileUrl !== 'function' || typeof fetchBytes !== 'function') throw new FilmApiError('The film API needs a request, a link and a download.', { final: true });
    const poll = Math.max(POLL_MS, Number(pollMs) || POLL_MS);                                   // never faster than every 3 seconds, whatever the caller says
    const ask = async text => {
      let busy = 0;
      for (;;) {
        try { return await request(versionId, text); }
        catch (e) {
          const code = e && e.code ? String(e.code) : null, message = clean(e && e.message) || 'This part of your film could not be asked for.';
          if (code === '42501' && ++busy < BUSY_TRIES) { await sleep(BUSY_PAUSE_MS); continue; }                 // a limit or a pause is not the film's failure: wait and ask again
          throw new FilmApiError(message, { code, final: code === '22023', retryLater: code === '42501' });
        }
      }
    };
    async function windowBytes(text, { onProgress = () => {} } = {}) {
      if (typeof text !== 'string' || !WINDOW.test(text)) throw new FilmApiError('That is not a part of a film.', { final: true, code: '22023' });
      const t0 = now();
      for (;;) {
        const r = await ask(text);
        if (!isObj(r)) throw new FilmApiError('The answer about your film was not understood.');
        if (r.status === 'ready' && typeof r.storage_path === 'string' && r.storage_path) {
          const url = await fileUrl(r.storage_path);
          const bytes = await fetchBytes(url);
          const out = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          if (!out.length) throw new FilmApiError('This part of your film came back empty.');
          onProgress(1);
          return out;
        }
        if (r.status === 'failed') throw new FilmApiError(clean(r.error_detail) || 'The engine could not draw this part of your film.', { final: true });
        if (r.status !== 'building') throw new FilmApiError('The answer about your film was not understood.');
        if (now() - t0 > maxWaitMs) throw new FilmApiError('This part of your film is taking longer than expected. Try again in a few minutes.', { retryLater: true });
        let fraction = null;                                                                       // only a number the worker really wrote, 0 to 1
        if (typeof jobProgress === 'function' && typeof r.job_id === 'string' && r.job_id) {
          try { const v = await jobProgress(r.job_id); if (typeof v === 'number' && v >= 0 && v < 1) fraction = v; } catch (e) { fraction = null; }   // a failed look is not a failed build
        }
        onProgress(fraction);
        await sleep(poll);
      }
    }
    return {
      window: windowBytes,
      plan: async () => planFromManifest(readManifest(await windowBytes(FIRST_WINDOW))),
    };
  }

  window.ryagramFilmApiTools = { makeFilmApi, planFromManifest, FilmApiError, POLL_MS, WINDOW };
})();
