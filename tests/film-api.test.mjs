// The page's film API for the editor's real frames (assets/app-film-api.js, CONNECT 2026-11-13): request_film_bundle + the signed link + a download, told apart by SQLSTATE. Offline, with fakes for the three
// functions the page hands in and an instant sleep. Must-fails: tests/film_api_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../assets/app-film-api.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
vm.runInNewContext(src, { window: win, Uint8Array, Promise, Error, Number, String, Array, Object, Math, Date, setTimeout });
const { makeFilmApi, planFromManifest, FilmApiError, POLL_MS } = win.ryagramFilmApiTools;

const err = (message, code) => Object.assign(new Error(message), { code });
function harness(answers, over = {}) {
  const calls = { request: [], sleep: [], url: [], bytes: [] };
  const queue = answers.slice();
  const api = makeFilmApi({
    versionId: 'v1',
    request: async (v, w) => { calls.request.push([v, w]); const a = queue.length > 1 ? queue.shift() : queue[0]; if (a instanceof Error) throw a; return a; },
    fileUrl: async (p) => { calls.url.push(p); return 'signed:' + p; },
    fetchBytes: async (u) => { calls.bytes.push(u); return new Uint8Array([1, 2, 3]); },
    readManifest: (b) => MANIFEST,
    sleep: async (ms) => { calls.sleep.push(ms); },
    ...over,
  });
  return { api, calls };
}
const MANIFEST = { fps: 30, film: { film_seconds: 23.5, film_frames: 705, clip_seconds: 20, clip_frames: 600, render_start: 3, windows: ['0:10', '10:20'] } };
const building = { status: 'building', job_id: 'j1', storage_path: null, engine_commit: null, error_detail: null };
const ready = { status: 'ready', job_id: 'j1', storage_path: 'u/v/j1/film.bundle.zip', engine_commit: 'abc1234', error_detail: null };

test('a window is asked for, waited for without polling faster than every 3 seconds, then its file is fetched through the signed link', async () => {
  const { api, calls } = harness([building, building, ready], { pollMs: 1 });
  const progress = [];
  const bytes = await api.window('10:20', { onProgress: (p) => progress.push(p) });
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.deepEqual(calls.request, [['v1', '10:20'], ['v1', '10:20'], ['v1', '10:20']]);
  assert.deepEqual(calls.sleep, [POLL_MS, POLL_MS], 'a caller cannot make it poll faster than 3 seconds');
  assert.deepEqual(calls.url, ['u/v/j1/film.bundle.zip']); assert.deepEqual(calls.bytes, ['signed:u/v/j1/film.bundle.zip']);
  assert.deepEqual(progress, [null, null, 1], 'no percentage is invented while it builds');
});

test('a window that failed on its input is final, with the engine\'s own words, and nothing is fetched', async () => {
  const { api, calls } = harness([{ ...building, status: 'failed', error_detail: 'No such view: x.' }]);
  await assert.rejects(api.window('0:10'), (e) => e instanceof FilmApiError && e.final === true && e.retryLater === false && e.message === 'No such view: x.');
  assert.equal(calls.url.length, 0);
});

test('the database\'s refusals are told apart: 22023 is final, 42501 is a pause and not the film\'s failure, anything else is passed up in words', async () => {
  await assert.rejects(harness([err('That part of the film is past its end: the film is 12.4 seconds long.', '22023')]).api.window('13:20'),
    (e) => e.final === true && e.retryLater === false && e.code === '22023' && /past its end/.test(e.message));
  const busy = err('Six parts of your film are already being drawn. Try again when one is ready.', '42501');
  const h = harness([busy, busy, ready]);
  assert.deepEqual([...await h.api.window('0:10')], [1, 2, 3], 'asked again after a pause, then it works');
  assert.deepEqual(h.calls.sleep, [5000, 5000]);
  const h2 = harness([busy]);
  await assert.rejects(h2.api.window('0:10'), (e) => e.final === false && e.retryLater === true && e.code === '42501' && /Six parts/.test(e.message));
  assert.equal(h2.calls.request.length, 6, 'six tries, then it says so in words');
  await assert.rejects(harness([err('boom', 'XX000')]).api.window('0:10'), (e) => e.final === false && e.retryLater === false && e.message === 'boom');
  await assert.rejects(harness([new Error('network down')]).api.window('0:10'), (e) => e.message === 'network down');
});

test('a window that is never ready is given up on in words with retryLater, and a bad window is refused before anything is asked', async () => {
  let t = 0;
  const h = harness([building], { now: () => (t += 400000), maxWaitMs: 1000000 });
  await assert.rejects(h.api.window('0:10'), (e) => e.retryLater === true && /taking longer than expected/.test(e.message));
  const h2 = harness([ready]);
  for (const bad of ['0:11x', '5:5x', '', null, undefined, 7, '01:5', '0:010', '1.5:3', ' 0:10', '-1:5', 'a:b']) {
    await assert.rejects(h2.api.window(bad), (e) => e.final === true && e.code === '22023', String(bad));
  }
  assert.equal(h2.calls.request.length, 0);
});

test('an answer that is not understood, and a ready answer with nothing to fetch, are errors in words, never a guessed picture', async () => {
  for (const bad of [null, 'x', { status: 'weird' }, { status: 'ready', storage_path: '' }, { status: 'ready' }]) {
    await assert.rejects(harness([bad]).api.window('0:10'), (e) => /not understood/.test(e.message), JSON.stringify(bad));
  }
  await assert.rejects(harness([ready], { fetchBytes: async () => new Uint8Array(0) }).api.window('0:10'), (e) => /came back empty/.test(e.message));
  const b = await harness([ready], { fetchBytes: async () => new Uint8Array([9]).buffer }).api.window('0:10');
  assert.ok(b instanceof Uint8Array && b[0] === 9, 'an ArrayBuffer is made a Uint8Array');
});

test('plan(): the first window is fetched and ENGINE\'s manifest.film becomes the plan WEB checks (windows tile from zero, render_start, the whole film\'s length)', async () => {
  const { api, calls } = harness([ready]);
  const plan = await api.plan();
  assert.deepEqual(calls.request, [['v1', '0:10']]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), { fps: 30, windows: [{ seconds: [0, 10], window: '0:10' }, { seconds: [10, 20], window: '10:20' }], timeline: { render_start: 3, total_seconds: 23.5, total_frames: 705, clips: [] } });
});

test('planFromManifest refuses what is not a film: no film part, windows that do not tile from zero or are over 10 seconds, bad numbers', () => {
  const f = (over) => ({ fps: 30, film: { ...MANIFEST.film, ...over } });
  const bad = [null, {}, { fps: 30 }, { fps: 0, film: MANIFEST.film }, f({ film_seconds: 0 }), f({ film_frames: 1.5 }), f({ render_start: -1 }), f({ windows: [] }), f({ windows: '0:10' }),
    f({ windows: ['10:20'] }), f({ windows: ['0:10', '11:20'] }), f({ windows: ['0:11'] }), f({ windows: ['0:10', '10:10'] }), f({ windows: ['0:10', 5] }), f({ windows: ['00:10'] })];
  for (const m of bad) assert.throws(() => planFromManifest(m), (e) => e instanceof FilmApiError && e.final === true, JSON.stringify(m));
  assert.equal(planFromManifest(f({ windows: ['0:10', '10:15'] })).windows.length, 2, 'the last window may be shorter');
});

test('the file holds no key, no address and no markup from text, and no invisible character', () => {
  assert.ok(!/service_role|apikey|https?:|innerHTML|eval\(|new Function|document\.write|fetch\(|XMLHttpRequest|localStorage/.test(src), 'the three functions are handed in');
  assert.ok(!/[^\x20-\x7e\n]/.test(src), 'plain ASCII only');
  assert.ok(src.includes("const poll = Math.max(POLL_MS, Number(pollMs) || POLL_MS);"), 'polling is never faster than 3 seconds');
  assert.ok(src.includes("code === '42501' && ++busy < BUSY_TRIES"), 'a limit is a pause, not a failure');
});
