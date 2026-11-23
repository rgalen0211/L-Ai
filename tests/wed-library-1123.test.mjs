// WEB 11-23, Wednesday customer step: a stranger makes a first contact sheet and a free preview with no dead end and reads only true words.
// Every changed sentence here fails on the old wording (proposals/WEB-WED-LIBRARY-FIXES-1123.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = f => { const win = {}; vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout }); return win; };
const J = load('app-jobs.js').ryagramJobs;
const O = load('app-ops.js').ryagramOps;
const lib = read('assets/app-library.js');

test('1 the next-step strip says where the contact sheet is, and does not promise a full film a 0-credit person cannot get', () => {
  const strip = lib.slice(lib.indexOf('nextStrip.replaceChildren'), lib.indexOf('} else nextStrip.hidden = true;'));
  assert.ok(strip.includes("' Your contact sheet is under Files. '"), 'says where it is');
  assert.ok(strip.includes("cantBuy ? 'You have a preview too.' : 'You have a preview too, so the full film is next.'"));
  assert.ok(strip.includes("cantBuy ? 'Next make a short preview.' : 'Next make a short preview, then the full film.'"));
  assert.match(lib, /const cantBuy = !!q && typeof q\.credits === 'number' && \(q\.available \|\| 0\) < q\.credits && !buyingOn\(\);/);
  assert.ok(strip.includes('C.filmVsBalance(q, cantBuy)'), 'still says the cost and the balance (words in app-credits.js filmVsBalance, tested in welcome-credits-1123.test.mjs)');
  assert.match(lib, /\{ id: 'files', label: 'Files'/, 'the tab it points to is called Files');
});

test('2 at the free-preview limit the page says both limits and the next step, once', () => {
  assert.equal(J.FREE_PREVIEW_USED, 'Your free previews are used up: each project gets 6, and 15 across all projects in any 24 hours. Start a new project if this one used its 6, or try again later.');
  assert.match(lib, /if \(type === 'preview' && q && !q\.error && !q\.free_preview && q\.credits > 0 && !can\.ok\) can\.reason = `\$\{J\.FREE_PREVIEW_USED\} \$\{can\.reason\}`;/);
  assert.match(lib, /\$\{q\.free_preview \? '' : J\.FREE_PREVIEW_USED \+ ' '\}This preview needs/);
  assert.ok(lib.includes("const FREE_PREVIEW_RULE = 'Each project gets 6 free previews (15 across all projects in any 24 hours); then 1 credit each. A failed free one caused by your story still counts.';"), 'the train rule sentence is untouched');
});

test('3a a failed job shows no raw machine words on the page; only the plain problem words and a way to send it to us', () => {
  assert.doesNotMatch(lib, /in its own words/);
  assert.doesNotMatch(lib, /J\.rawDetail\(j\)/);
  assert.match(lib, /failed && j\.state !== 'cancelled' && opsOn\(\)/);
  assert.match(lib, /h\('summary', \{\}, 'Get help with this'\),\s+h\('a', \{ class: 'meta', href: `#\/help\?job=\$\{j\.id\}` \}, 'Send this to us'\)/);
  // problem() on a raw path-and-code detail carries none of it
  const said = J.problem({ state: 'failed', job_type: 'preview', error_class: 'infrastructure', error_code: 'worker_crash', attempt: 2, error_detail: 'exit 1 at D:\\work\\job_12\\out\\render.log line 40: Traceback' });
  assert.doesNotMatch(said, /D:|render\.log|Traceback|exit 1|job_12/);
  assert.match(J.plainDetail('Traceback (most recent call last): boom'), /Open “Get help with this” and send it to us\.$/);
});

test('3b a refusal from the server is shown in plain words: the paused words are mapped; a code name or database phrase never reaches the page', () => {
  assert.equal(J.plainRefusal('contact_sheet jobs are paused.'), 'Making contact sheets is paused for now. Please try again later.');
  assert.equal(J.plainRefusal('preview jobs are paused.'), 'Making previews is paused for now. Please try again later.');
  assert.equal(J.plainRefusal('final_render jobs are paused.'), 'Making full films is paused for now. Please try again later.');
  assert.equal(J.plainRefusal('mystery jobs are paused.'), 'This is paused for now. Please try again later.');
  const generic = 'Something went wrong. Please try again, or ask us to help.';
  for (const raw of ['new row violates row-level security policy for table "jobs"', 'TypeError: x is undefined', 'duplicate key value violates unique constraint "jobs_pkey"', 'at D:/a/b/c.js', 'PGRST116', '', null, undefined]) assert.equal(J.plainRefusal(raw), generic, String(raw));
  assert.equal(J.plainRefusal('TypeError: Failed to fetch'), 'Ryagram could not be reached. Check your internet connection and try again.');
  for (const plain of ['This version is complete and cannot take new jobs.', 'Real-frame previews are paused.', 'Version not found.', 'This needs 1 credit and you have 0 credits.']) assert.equal(J.plainRefusal(plain), plain);
  assert.ok(lib.includes('el.textContent = window.ryagramJobs.plainRefusal(err && err.message);'), 'every refusal line goes through it');
  assert.ok(lib.includes("window.ryagramJobs.plainRefusal(err && err.message)),\n             h('a', { href: '#/' }, 'Back to your projects')"), 'the Something went wrong page too');
  assert.doesNotMatch(lib, /h\('p', \{ class: 'app-error', role: 'alert' \}, err\.message\)/);
});

test('3c a dataset the machine cannot draw no longer sends a stranger to a catalog that is off', () => {
  const said = J.plainDetail("$.sequence.clips[1].dataset: 'x_y' is not on this worker's dataset allowlist");
  assert.match(said, /can’t be drawn here\. Start again from a ready-made film\.$/);
  assert.doesNotMatch(said, /catalog/);
});

test('4a Help no longer says every film page has a Report link while film pages are off (public help and in-app help)', () => {
  const html = read('help/index.html');
  assert.match(html, /<summary>How do I report a film\?<\/summary>\s*<p>Public film pages are not open yet\. To report a film, use the <a href="\/report\/">report form<\/a>\./);
  assert.doesNotMatch(html, /Every public film page has/);
  assert.ok(lib.includes("['Public film pages are not open yet. To report a film, use the ', h('a', { href: '/report/' }, 'report form'), '. For reports about"));
  assert.ok(!lib.includes('Every public film page has'));
});

test('4b the Help Connect entry opens with the same Connect sentence as the Terms (Connect-an-AI open, L5), in one sentence to swap', () => {
  const html = read('help/index.html');
  const m = /<summary>How do I connect Claude or ChatGPT to Ryagram\?<\/summary>\s*<p>([^<]*)<\/p>/.exec(html);
  assert.ok(m);
  assert.ok(m[1].startsWith('You can connect an AI assistant such as Claude or ChatGPT to your account. If you do not see Connected AIs under Account, it is not available on your account; write to ryagram@uselai.com.'));
  assert.doesNotMatch(m[1], /invited|waitlist/i);
});

test('4c the help form offers "My own data (upload)" only while uploads are on', () => {
  const ids = on => [...O.topicsFor(on)].map(([id]) => id);
  assert.ok(!ids(false).includes('upload') && !ids(undefined).includes('upload'));
  assert.ok(ids(true).includes('upload'));
  assert.equal(ids(false).join(), 'render,credits,account,other');
  assert.ok(lib.includes('O.topicsFor(uploadsOn()).map('));
  assert.ok(O.TOPICS.some(([id]) => id === 'upload'), 'the server still accepts the topic');
});
