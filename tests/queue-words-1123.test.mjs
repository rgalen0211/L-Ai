// WEB 11-23, BUILDER's queue audit (08:52): a stranger who waits in a busy hour is told the truth about the wait. Each sentence below fails on the old wording (goesRed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
vm.runInNewContext(read('assets/app-jobs.js'), { window: win, setTimeout, clearTimeout });
const J = win.ryagramJobs;
const opsWin = {};
vm.runInNewContext(read('assets/app-ops.js'), { window: opsWin, Date, Intl });
const goesRed = (check, oldText) => assert.throws(() => check(oldText), undefined, 'the check must fail on the old wording');
const lib = read('assets/app-library.js');
const panel = lib.slice(lib.indexOf('function jobsPanel('), lib.indexOf("window.addEventListener('hashchange', route)"));

const T20OLD = 'Number 20 in line. We make one film at a time. At about 5 minutes for each film ahead of yours, that is about 1 hour 35 minutes, and it may take longer.';   // the old count: (position - 1) x 5
const ONE = 'We make one film at a time.';
const HALF = 'A full film ahead of yours can take up to half an hour, so it may take longer.';
const FULL = 'A full film takes up to about half an hour once it starts';
// WEB 11-24, public launch (FACES 09:33 bands, GAMES 09:33, CC1 09:33): a stranger in a line of any length reads a wait that is true. Measured: sheet about 4.5 min, preview about 4.7, an approved full film about 17 min and up to about 30.
test('PUBLIC QUEUE: a contact sheet or preview, places 2 to 24: minutes with "about", the full-film caveat and the move-back sentence', () => {
  for (const type of ['contact_sheet', 'preview']) {
    const n = p => J.progressNote({ state: 'queued', attempt: 1, job_type: type }, p);
    assert.equal(n(20), `Number 20 in line. ${ONE} It may be working on another film right now. Yours starts in about 1 hour 40 minutes and takes about 5 more. ${HALF}`);
    assert.equal(n(2), `Number 2 in line. ${ONE} It may be working on another film right now. Yours starts in about 10 minutes and takes about 5 more. ${HALF}`);
    assert.equal(n(12), `Number 12 in line. ${ONE} It may be working on another film right now. Yours starts in about 1 hour and takes about 5 more. ${HALF}`);
    assert.equal(n(24), `Number 24 in line. ${ONE} It may be working on another film right now. Yours starts in about 2 hours and takes about 5 more. ${HALF}`);
  }
  const check = s => { assert.match(s, /so it may take longer./); assert.doesNotMatch(s, /move back/); assert.doesNotMatch(s, /at least/i); };
  check(J.progressNote({ state: 'queued', attempt: 1, job_type: 'contact_sheet' }, 8));
  goesRed(check, T20OLD);
});

test('PUBLIC QUEUE: places 25 to 149 say whole hours (rounded up), never hours-and-minutes; 150 and more say a day or more and that the place is kept', () => {
  const n = (p, t = 'contact_sheet') => J.progressNote({ state: 'queued', attempt: 1, job_type: t }, p);
  assert.equal(n(25), `Number 25 in line. ${ONE} Yours starts in about 3 hours, maybe more if full films are ahead of yours.`);
  assert.equal(n(60, 'preview'), `Number 60 in line. ${ONE} Yours starts in about 5 hours, maybe more if full films are ahead of yours.`);
  assert.equal(n(149), `Number 149 in line. ${ONE} Yours starts in about 13 hours, maybe more if full films are ahead of yours.`);
  const LONG = (p) => `Number ${p} in line. ${ONE} The line is very long right now. Yours may take a day or more. You can close this page and come back; your film keeps its place in line while the render machine is running.`;
  for (const t of ['contact_sheet', 'preview', 'final_render', undefined]) {
    assert.equal(n(150, t), LONG(150));
    assert.equal(n(1000, t), LONG(1000));
  }
  for (const p of [25, 40, 100, 149, 150, 400]) assert.doesNotMatch(n(p), /d+ hours? d+ minutes|83 hours/, 'no hours-and-minutes number in a long line');
  assert.match(J.progressNote({ state: 'queued', attempt: 2, job_type: 'contact_sheet' }, 3), /This was put back in line after a problem on our side.$/, 'the retry sentence is kept');
});

test('PUBLIC QUEUE: a full film names its own length, not "a few minutes" per film; next in line says it starts when the film being made now finishes; position unknown invents no number', () => {
  const n = p => J.progressNote({ state: 'queued', attempt: 1, job_type: 'final_render' }, p);
  assert.equal(n(2), `Number 2 in line. ${ONE} ${FULL}, so yours may start after a few films, not a few minutes.`);
  assert.equal(n(24), `Number 24 in line. ${ONE} ${FULL}, so yours may start after a few films, not a few minutes.`);
  assert.equal(n(25), `Number 25 in line. ${ONE} ${FULL}, and a sheet or preview ahead of yours takes a few minutes, so it may be hours with this many ahead.`);
  assert.doesNotMatch(n(30), /Each film ahead of yours takes a few minutes/);
  for (const t of ['contact_sheet', 'preview', 'final_render']) assert.equal(J.progressNote({ state: 'queued', attempt: 1, job_type: t }, 1), `Next in line. ${ONE} It starts when the film being made now finishes, which can take up to about half an hour.`);
  assert.equal(J.progressNote({ state: 'queued', attempt: 1, job_type: 'contact_sheet' }, 0), `Waiting in line. ${ONE} At busy times yours may take hours, or more than a day when many people join at once.`, 'position unknown: no number invented');
});

test('HIGH 2 Help, the banner and the in-app help no longer say "If it waits more than an hour we stop it" (expire_stale_queue acts only when rendering is delayed and every worker has been silent the whole timeout)', () => {
  const sql = read('supabase/migrations/20261010000100_ops_readiness.sql');
  assert.match(sql, /service_state\(\) <> 'delayed'\s+or \(select max\(last_seen_at\) from public\.workers where enabled\) > now\(\) - make_interval\(mins => s\.queue_timeout_min\) then\s+return 0;/);
  const NEW = 'If the render machine stays down for a long time, we stop the films waiting for it and give back any credits held for them. Otherwise a waiting film keeps its place in line.';
  const help = read('help/index.html');
  const check = h => { assert.ok(h.includes(NEW)); assert.doesNotMatch(h, /more than an hour we stop it/); };
  check(help);
  goesRed(check, help.replace(NEW, 'If it waits more than an hour we stop it and give your credits back.'));
  check(lib);
  const banner = opsWin.ryagramOps.bannerText({ rendering: 'delayed', last_check_in: '2026-10-10T18:02:00Z' }, 'UTC');
  assert.ok(banner.endsWith('Your film will start as soon as it is back. If the render machine stays down for a long time, we stop the films waiting for it and give back any credits held for them.'));
  assert.doesNotMatch(banner, /an hour/);
});

test('MEDIUM 5 the delayed banner is read inside the Version page\'s own refresh (one request chain, no second timer), shown and cleared there', () => {
  assert.match(panel, /const statusRead = opsOn\(\) && \(fresh\.some\(j => j\.state === 'queued'\) \|\| root\.querySelector\('\.delayed-notice'\)\) \? data\.serviceStatus\(\) : Promise\.resolve\(undefined\);/);
  assert.match(panel, /if \(status !== undefined\) setDelayedNotice\(window\.ryagramOps\.bannerText\(status\)\);/);
  assert.equal((panel.match(/setInterval\(/g) || []).length, 1, 'still one timer');
  assert.ok(lib.includes("class: 'app-status delayed-notice'"), 'the page-load notice and the refreshed one are the same element');
  assert.match(lib, /function setDelayedNotice\(text\) \{[\s\S]*?if \(!text\) \{ if \(now\) now\.remove\(\); return; \}[\s\S]*?root\.prepend\(/);
});

test('LOW 6 an expired contact sheet or free preview does not say credits were returned; a final render keeps it', () => {
  const SERVER = 'Rendering was delayed, so this film could not start. Your credits were returned.';
  const exp = t => J.problem({ state: 'failed', attempt: 1, error_class: 'infrastructure', error_code: 'queue_timeout', error_detail: SERVER, job_type: t });
  for (const t of ['contact_sheet', 'preview']) {
    const check = s => { assert.equal(s, 'The render machine did not get to it in time, so we stopped it. This is not your story. You can try again.'); assert.doesNotMatch(s, /credits|too long/); };
    check(exp(t));
    goesRed(check, 'The render machine had a problem, not your story. Rendering was delayed, so this film could not start. Your credits were returned. You can try again.');
  }
  assert.match(exp('final_render'), /Your credits were returned\. You can try again\.$/);
  assert.match(exp(undefined), /Your credits were returned\./);
});

test('LOW 7 a contact sheet or preview that only waits says so; one that runs keeps "is already being made"', () => {
  assert.match(panel, /jobs\.some\(j => j\.job_type === 'contact_sheet' && j\.state === 'queued'\) \? 'Your contact sheet is waiting in line\.' : 'A contact sheet is already being made\.'/);
  assert.match(panel, /jobs\.some\(j => j\.job_type === 'preview' && j\.state === 'queued'\) \? 'Your preview is waiting in line\.' : 'A preview is already being made\.'/);
});

test('LOW 8 a refusal holding "already in progress" becomes the plain line; the cap text passes through unchanged', () => {
  const PLAIN = 'This film is already being made. You will see it under Jobs.';
  const check = f => {
    assert.equal(f('A contact_sheet job for this version is already in progress.'), PLAIN);
    assert.equal(f('A preview job for this version is already in progress.'), PLAIN);
  };
  check(J.plainRefusal);
  goesRed(check, () => 'Something went wrong. Please try again, or ask us to help.');
  assert.equal(J.plainRefusal('You have 2 films waiting. You can start another when one is done.'),          // the server's words, then where to go (BUILDER 11-23)
               'You have 2 films waiting. You can start another when one is done. Your waiting films are listed under Jobs on each film’s page.');
  assert.match(panel, /h\('h2', \{ id: 'jobs-list-title' \}, 'Jobs'\)/, 'the list the sentence points to is called Jobs');
});
