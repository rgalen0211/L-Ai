// NEXT-WEB 174: My films. One row per film with where it stands, in words that come from app-jobs.js; Try again only where the free contact sheet may be retried; films that need a person come first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8');
const ctx = { Math, Number, String, Object, Array, JSON, Date, Error, Promise, Set, Map, setTimeout, clearTimeout }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('assets/app-jobs.js'), ctx); vm.runInContext(read('assets/app-films.js'), ctx);
const F = ctx.ryagramFilms, J = ctx.ryagramJobs, W = x => JSON.parse(JSON.stringify(x));
const P = (id, title, t = '2026-10-30T09:00:00Z') => ({ id, title, updated_at: t });
const V = (id, number = 1, state = 'draft') => ({ id, project_id: 'p', number, state });
const job = (state, type = 'contact_sheet', t = '2026-10-30T09:10:00Z', extra = {}) => ({ id: `j-${state}-${type}-${t}`, job_type: type, state, created_at: t, attempt: 1, ...extra });

test('a film with no jobs is not started; with no version it opens its project', () => {
  const r = F.rowFor({ project: P('p1', 'Rent'), version: V('v1'), jobs: [] }, J);
  assert.equal(r.status, 'none'); assert.equal(r.word, 'Not started'); assert.equal(r.href, '#/v/v1'); assert.equal(r.again, null);
  const n = F.rowFor({ project: P('p2', 'New'), version: null, jobs: [] }, J);
  assert.equal(n.status, 'none'); assert.equal(n.href, '#/p/p2');
});

test('waiting, being made, ready, stopped and failed each say so, with the jobs own words', () => {
  const row = (jobs, vs = 'sampling') => W(F.rowFor({ project: P('p', 'T'), version: V('v', 1, vs), jobs }, J));
  assert.deepEqual([row([job('queued')]).status, row([job('queued')]).word], ['waiting', 'Waiting']);
  assert.match(row([job('queued')]).why, /Contact sheet: Queued/);
  assert.equal(row([job('running', 'preview')]).status, 'making'); assert.match(row([job('running', 'preview')]).why, /Preview: Rendering/);
  const ready = row([job('complete', 'final_render', '2026-10-30T10:00:00Z'), job('complete', 'preview')], 'complete');
  assert.equal(ready.status, 'ready'); assert.equal(ready.why, 'The film is ready');
  assert.equal(row([job('complete')]).why, 'The contact sheet is ready');
  const stopped = row([job('cancelled', 'preview', '2026-10-30T09:30:00Z'), job('complete')]);
  assert.equal(stopped.status, 'stopped'); assert.match(stopped.why, /Preview was stopped\. The contact sheet is ready/);
  const failed = row([job('failed', 'contact_sheet', '2026-10-30T09:10:00Z', { error_class: 'infrastructure', error_detail: '' })]);
  assert.equal(failed.status, 'failed'); assert.ok(failed.why.length > 5 && !/null|undefined/.test(failed.why));
});

test('the reason a film did not finish is the jobs file plain sentence, never the raw text', () => {
  const r = W(F.rowFor({ project: P('p', 'T'), version: V('v', 1, 'sampling'), jobs: [job('failed', 'contact_sheet', '2026-10-30T09:10:00Z', { error_class: 'validation', error_detail: "$: unknown key 'outro'" })] }, J));
  assert.match(r.why, /recognise/); assert.ok(!r.why.includes('$:'));
});

test('Try again appears only for a failed or stopped contact sheet that app-jobs allows to retry; other jobs say open the film', () => {
  const f = (type, vs, extra) => W(F.rowFor({ project: P('p', 'T'), version: V('v', 1, vs), jobs: [job('failed', type, '2026-10-30T09:10:00Z', extra)] }, J));
  const sheet = f('contact_sheet', 'sampling', { error_class: 'infrastructure' });
  assert.deepEqual(sheet.again, { versionId: 'v', jobType: 'contact_sheet' }); assert.equal(sheet.openToRun, false);
  const preview = f('preview', 'sampling', { error_class: 'infrastructure' });
  assert.equal(preview.again, null); assert.equal(preview.openToRun, true);
  assert.equal(f('final_render', 'ready_to_render', { error_class: 'infrastructure' }).again, null);      // a final render costs credits: the film page decides
  const hard = f('contact_sheet', 'sampling', { error_class: 'validation', error_detail: 'x' });
  assert.equal(hard.again, null); assert.equal(hard.openToRun, false);                                    // a failure that repeating cannot fix
  assert.equal(f('contact_sheet', 'complete', { error_class: 'infrastructure' }).again, null);            // a finished version takes no new jobs
});

test('films that need a person come first: failed, waiting, being made, stopped, ready, not started; newest first inside a group', () => {
  const mk = (id, status, updated) => ({ id, status, updated, title: id });
  const order = F.sorted([mk('a', 'ready', '2026-10-30T08'), mk('b', 'failed', '2026-10-29'), mk('c', 'none', '2026-10-30'), mk('d', 'waiting', '2026-10-28'), mk('e', 'failed', '2026-10-30'), mk('f', 'making', '2026-10-27')]).map(r => r.id);
  assert.deepEqual(order, ['e', 'b', 'd', 'f', 'a', 'c']);
  assert.deepEqual(W(F.rowsFor(undefined, J)), []);
});

test('wiring: behind a switch that is OFF; three reads; the page builds nothing from the server except text', () => {
  const cfg = read('assets/ryagram-config.js'), lib = read('assets/app-library.js'), html = read('app/index.html'), src = read('assets/app-films.js'), data = read('assets/app-data.js');
  assert.match(cfg, /\n  myFilms: false,/);
  assert.match(lib, /const myFilmsOn = \(\) => window\.ryagramSwitches\?\.featureOn\('myFilms'\) === true;/);
  assert.match(lib, /myFilmsOn\(\) && window\.ryagramFilms && hash === '#\/films'/);
  assert.match(lib, /const filmsLink = myFilmsOn\(\) && window\.ryagramFilms/);
  assert.ok(html.indexOf('/assets/app-jobs.js') < html.indexOf('/assets/app-films.js') && html.indexOf('/assets/app-films.js') < html.indexOf('/assets/app-library.js'));
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|fetch\(|localStorage/.test(src));
  const lf = data.slice(data.indexOf('async listFilms()'), data.indexOf('// A project always starts with r1.'));
  assert.equal((lf.match(/client\.from\(/g) || []).length, 3); assert.match(lf, /\.limit\(50\)/);
});

// ---- NEXT-WEB 186: a tester account's films say where they are on THEIR computer (behind testerFilmProgress, off) ----
const NOW = Date.parse('2026-10-31T12:00:00Z');
const comp = (secsAgo, extra = {}) => ({ id: 'c1', computer_name: 'DESKTOP-SAM-PC', last_used_at: secsAgo === null ? null : new Date(NOW - secsAgo * 1000).toISOString(), ...extra });
const own = (computers) => ({ tester: true, computers, now: NOW });
const film = (state, type = 'contact_sheet') => ({ project: P('p', 'T'), version: V('v', 1, 'sampling'), jobs: [job(state, type)] });

test('TESTER: a queued film says what the computer is doing: none signed in, signed in and seen, or signed in and not seen', () => {
  const none = W(F.rowFor(film('queued'), J, own([])));
  assert.equal(none.status, 'waiting'); assert.match(none.why, /No computer is signed in to your account\. Open the Ryagram app on your computer and sign in\./);
  const seen = W(F.rowFor(film('queued'), J, own([comp(30)])));
  assert.match(seen.why, /Waiting for your computer to pick it up\. It is signed in and was seen a moment ago\./);
  const stale = W(F.rowFor(film('queued'), J, own([comp(2 * 86400)])));
  assert.match(stale.why, /DESKTOP-SAM-PC was last seen 2 days ago\. Open the Ryagram app on it/);
  const never = W(F.rowFor(film('queued'), J, own([comp(null)])));
  assert.match(never.why, /last seen not yet/);
});

test('TESTER: a film being made says it is on the computer and to keep the app open; done and failed are unchanged', () => {
  const making = W(F.rowFor(film('running', 'preview'), J, own([comp(10)])));
  assert.equal(making.status, 'making'); assert.equal(making.word, 'Being made on your computer'); assert.match(making.why, /Preview: Rendering\. Keep the Ryagram app open until it finishes\./);
  const ready = W(F.rowFor(film('complete'), J, own([comp(10)]))), plainReady = W(F.rowFor(film('complete'), J));
  assert.deepEqual(ready, plainReady);
  const failed = W(F.rowFor(film('failed'), J, own([comp(10)]))), plainFailed = W(F.rowFor(film('failed'), J));
  assert.deepEqual(failed, plainFailed);
});

test('TESTER: no claim without a tester account or a readable computer list; a revoked computer does not count; the 3 minute edge', () => {
  const q = film('queued');
  for (const o of [undefined, null, { tester: false, computers: [] }, { tester: true }, { tester: true, computers: 'x' }]) assert.equal(W(F.rowFor(q, J, o)).why, 'Contact sheet: Queued.', JSON.stringify(o));
  assert.equal(W(F.computerState(own([comp(10, { revoked_at: '2026-10-30T00:00:00Z' })]))).state, 'none');
  assert.equal(F.computerState(own([comp(179)])).state, 'seen'); assert.equal(F.computerState(own([comp(181)])).state, 'stale');
  assert.equal(F.computerState(own([comp(400), comp(5)])).state, 'seen', 'the freshest computer counts');
  assert.equal(F.agoWords(new Date(NOW - 90000).toISOString(), NOW), '2 minutes ago'); assert.equal(F.agoWords(new Date(NOW - 3 * 3600000).toISOString(), NOW), '3 hours ago'); assert.equal(F.agoWords('nonsense', NOW), 'a while ago');
});

test('TESTER wiring: behind its own switch (off), read only when the account is a tester, failing reads make no claim', () => {
  const cfg = read('assets/ryagram-config.js'), src = read('assets/app-films.js');
  assert.match(cfg, /\n  testerFilmProgress: false,/);
  assert.match(src, /window\.ryagramConfig\.testerFilmProgress === true && data\.myLocalCompute/);
  assert.match(src, /catch \{ own = null; \}/);
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|fetch\(|localStorage/.test(src));
});
