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

test('HIGH 2 queue line: a contact sheet behind a line says about 5 minutes for each film ahead, "about", and "may take longer"; no promise', () => {
  const sheet = n => J.progressNote({ state: 'queued', attempt: 1, job_type: 'contact_sheet' }, n);
  const check = s => assert.equal(s, 'Number 20 in line. The machine makes one film at a time. At about 5 minutes for each film ahead of yours, that is about 1 hour 35 minutes, and it may take longer.');
  check(sheet(20));
  goesRed(check, 'Number 20 in line.');
  assert.equal(sheet(2), 'Number 2 in line. The machine makes one film at a time. At about 5 minutes for each film ahead of yours, that is about 5 minutes, and it may take longer.');
  assert.equal(sheet(13), 'Number 13 in line. The machine makes one film at a time. At about 5 minutes for each film ahead of yours, that is about 1 hour, and it may take longer.');
  assert.equal(sheet(1), 'Next in line.', 'nothing ahead: no estimate');
  assert.equal(sheet(0), 'Waiting in line.', 'position unknown: no number invented');
});

test('HIGH 2 queue line: a preview or a final render (no defensible time) gets no number, only the plain line', () => {
  for (const t of ['preview', 'final_render', undefined]) {
    const s = J.progressNote({ state: 'queued', attempt: 1, job_type: t }, 20);
    assert.equal(s, 'Number 20 in line. The machine makes one film at a time. Each film ahead of yours takes a few minutes.');
    assert.doesNotMatch(s, /\d+ minutes|hour/);
  }
  assert.match(J.progressNote({ state: 'queued', attempt: 2, job_type: 'contact_sheet' }, 3), /Retrying once after a render-machine problem \(attempt 2 of 2\)\.$/, 'the retry sentence is kept');
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
    const check = s => { assert.equal(s, 'This took too long and was stopped. You can try again.'); assert.doesNotMatch(s, /credits/); };
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
  assert.equal(J.plainRefusal('You have 2 films waiting. You can start another when one is done.'), 'You have 2 films waiting. You can start another when one is done.');
  assert.match(panel, /h\('h2', \{ id: 'jobs-list-title' \}, 'Jobs'\)/, 'the list the sentence points to is called Jobs');
});
