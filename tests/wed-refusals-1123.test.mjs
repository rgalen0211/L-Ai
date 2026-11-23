// BUILDER 11-23 (page audit of the two Tuesday refusals, migrations 20261123000200 queue cap and 20261123000300 blocked views): a stranger who is refused
// reads the server's plain words plus where to go next, the step-by-step builder never makes a second project after a refused submit, the mock can produce
// both refusals so a page walk can see them, and Help says how many films can wait. One test per sentence; each fails on the old behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = src => { const win = {}; vm.runInNewContext(src, { window: win, setTimeout, clearTimeout }); return win.ryagramJobs; };
const jobsSrc = read('assets/app-jobs.js');
const J = load(jobsSrc);
const CAP = 'You have 2 films waiting. You can start another when one is done.';
const VIEW = 'This film is not available yet. Please pick another view. A line view always works.';   // the server's words (20261123000300, CONNECT 13:37)

test('the 2-films-waiting refusal keeps the server words and says where the waiting films are (also for another number)', () => {
  assert.equal(J.plainRefusal(CAP), `${CAP} Your waiting films are listed under Jobs on each film’s page.`);
  assert.equal(J.plainRefusal('You have 3 films waiting. You can start another when one is done.'),
               'You have 3 films waiting. You can start another when one is done. Your waiting films are listed under Jobs on each film’s page.');
  const old = load(jobsSrc.replace("    if (/^You have \\d+ films? waiting\\./.test(text)) return `${text} ${QUEUE_FULL_NEXT}`;\n", ''));
  assert.notEqual(old.plainRefusal(CAP), J.plainRefusal(CAP), 'PLANTED: without the line the next step is gone');
});

test('the blocked-film refusal says "choose another film" (the app never calls them views), and is not hidden as code', () => {
  assert.equal(J.plainRefusal(VIEW), 'This film is not available yet. Please choose another film.');
  assert.doesNotMatch(J.plainRefusal(VIEW), /view|Something went wrong/);
  const old = load(jobsSrc.replace("    if (/^This film is not available yet\\./.test(text)) return VIEW_BLOCKED;\n", ''));
  assert.equal(old.plainRefusal(VIEW), VIEW, 'PLANTED: without the line the server word "view" reaches the stranger');
});

test('other refusals are unchanged (the generic line, the paused line, already in progress)', () => {
  assert.equal(J.plainRefusal('A contact_sheet job for this version is already in progress.'), 'This film is already being made. You will see it under Jobs.');
  assert.equal(J.plainRefusal('contact_sheet jobs are paused.'), 'Making contact sheets is paused for now. Please try again later.');
  assert.equal(J.plainRefusal('relation "x" does not exist'), 'Something went wrong. Please try again, or ask us to help.');
});

test('the builder: after a refused submit the project exists, so Make is hidden and the person is sent to the film (no second project on a second press)', () => {
  const b = read('assets/app-builder.js');
  const click = b.slice(b.indexOf("if (!sample) make.addEventListener('click'"), b.indexOf('        check();\n'));
  assert.match(b, /\n        let madeId = null;[^\n]*\n        if \(sample\) make\.hidden = true;\n        if \(!sample\) make\.addEventListener\('click'/, 'the made project is remembered across presses');
  assert.match(click, /error\.append\(' ', h\('a', \{ href: `#\/v\/\$\{made\.version\.id\}` \}, 'Open the film'\), ' and make its contact sheet there\.'\);/);
  // a BLOCKED film: no Open link (its page would be refused again every time), the way on is another film type here (GAMES 11:27 MEDIUM)
  const blocked = click.slice(click.indexOf("if (/^This film is not available yet\\./.test("), click.indexOf('} else', click.indexOf("if (/^This film is not available yet\\./.test(")));
  assert.ok(blocked.length > 0, 'the blocked refusal has its own branch');
  assert.match(blocked, /'Choose another film type'/);
  assert.match(blocked, /go\(STEPS\.findIndex\(\(\[id\]\) => id === 'type'\)\)/);
  assert.doesNotMatch(blocked, /Open the film/);
  // the CAP: the film is saved, and the sheet waits for one of the waiting films (no promise it can be made now: FACES/GAMES 13:03)
  const capAt = click.indexOf("} else if (/^You have \\d+ films? waiting\\./.test(");
  assert.ok(capAt > 0, 'the cap refusal has its own branch');
  const cap = click.slice(capAt, click.indexOf('} else {', capAt));
  assert.match(cap, /' Your film is saved\. ', h\('a', \{ href: `#\/v\/\$\{made\.version\.id\}` \}, 'Open the film'\), '; when one of your waiting films is done, make its contact sheet there\.'/);
  assert.doesNotMatch(cap, /and make its contact sheet there/);
  assert.match(click, /madeId = made\.version\.id;/);
  assert.match(click, /\n          if \(madeId\) make\.hidden = true;\n        \}\);/, 'Make hides AFTER busy() has turned it back on');
  assert.ok(click.indexOf('if (madeId) make.hidden = true;') > click.lastIndexOf('await busy(make'), 'after the busy block');
});

test('the mock produces both refusals word for word, for contact sheets and previews only (so a page walk can see them)', () => {
  const fake = read('tests/fake-supabase.js');
  const sub = fake.slice(fake.indexOf('      submit_job(args) {'), fake.indexOf('const params = args.p_params', fake.indexOf('      submit_job(args) {')));
  assert.match(sub, /if \(\(type === 'contact_sheet' \|\| type === 'preview'\) && typeof location !== 'undefined'\) \{/);
  assert.ok(sub.includes(`if (/[?&]queuefull/.test(location.search || '')) return fail('${CAP}');`));
  assert.ok(sub.includes(`if (/[?&]viewnotready/.test(location.search || '')) return fail('${VIEW}');`));
});

test('Help says how many films can wait, on both Help pages (the number is ops_settings.queue_cap_per_owner, default 2)', () => {
  const LINE = 'The Render panel shows your place in line. You can have 2 films waiting at once.';
  assert.ok(read('help/index.html').includes(LINE));
  assert.ok(read('assets/app-library.js').includes(LINE));
});
