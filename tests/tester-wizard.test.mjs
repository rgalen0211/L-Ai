// NEXT-WEB 192: the tester first-run wizard (#/tester-start, behind testerWizard, OFF). The steps are worked out from what the page can see; the disk step is the person's own yes and says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/app-tester-wizard.js'), { window: win, setTimeout, setInterval, clearInterval });
const W = win.ryagramTesterWizard, J = x => JSON.parse(JSON.stringify(x));
const NOW = Date.parse('2026-10-31T12:00:00Z'), ago = s => new Date(NOW - s * 1000).toISOString(), ahead = d => new Date(NOW + d * 86400000).toISOString();
const comp = (name, usedSecs, extra = {}) => ({ id: 'c', computer_name: name, created_at: ago(5 * 86400), expires_at: ahead(20), revoked_at: null, last_used_at: usedSecs === null ? null : ago(usedSecs), ...extra });
const run = over => J(W.steps({ tester: true, computers: [], films: [], diskChecked: false, now: NOW, startHref: '#/start', ...over }));
const states = r => r.steps.map(s => `${s.id}:${s.state}`).join(' ');

test('an account that is not a tester sees no steps, only the plain sentence', () => {
  for (const t of [false, null, undefined, 'yes']) { const r = J(W.steps({ tester: t, now: NOW })); assert.equal(r.notTester, true); assert.deepEqual(r.steps, []); }
  assert.match(W.WORDS.notTester, /invited testers/);
});

test('a new tester: no computer is the step to do now, the rest wait; nothing is done early', () => {
  const r = run({});
  assert.equal(states(r), 'signin:done computer:now disk:next film:next'); assert.equal(r.current, 'computer'); assert.equal(r.allDone, false);
  assert.match(r.steps[1].words, /No computer is signed in yet/); assert.equal(r.steps[1].action.href, '#/account');
});

test('a computer signed in but not seen lately is not awake; seen in the last 3 minutes is; the edge and bad dates', () => {
  assert.equal(states(run({ computers: [comp('PC', 2 * 86400)] })), 'signin:done computer:now disk:next film:next');
  assert.match(run({ computers: [comp('PC', 2 * 86400)] }).steps[1].words, /^PC is signed in, but it was last seen 2 days ago\. Open the Ryagram app/);
  assert.match(run({ computers: [comp('PC', null)] }).steps[1].words, /not seen yet/);
  assert.equal(run({ computers: [comp('PC', 179)] }).steps[1].state, 'done'); assert.equal(run({ computers: [comp('PC', 181)] }).steps[1].state, 'now');
  assert.equal(W.SEEN_MS, 180000);
  assert.equal(run({ computers: [comp('PC', 10, { last_used_at: 'garbage' })] }).steps[1].state, 'now');
});

test('a removed computer and an expired sign-in never count; one awake computer among others is enough', () => {
  assert.equal(run({ computers: [comp('GONE', 10, { revoked_at: ago(100) })] }).steps[1].state, 'now');
  assert.equal(run({ computers: [comp('OLD', 10, { expires_at: ago(60) })] }).steps[1].state, 'now');
  const r = run({ computers: [comp('SLEEPY', 5 * 86400), comp('AWAKE', 30)] });
  assert.equal(r.steps[1].state, 'done'); assert.match(r.steps[1].words, /^AWAKE is awake/);
});

test('the disk step is the person\'s own yes: it says the page cannot see the disk, leaves the number to Ryan, and moves on only when they say so', () => {
  const r = run({ computers: [comp('PC', 10)] });
  assert.equal(states(r), 'signin:done computer:done disk:now film:next');
  assert.match(r.steps[2].words, /cannot see your computer.s disk, so only you can say yes/); assert.match(r.steps[2].words, /\[DRAFT: Ryan to set how many GB\]/);
  const yes = run({ computers: [comp('PC', 10)], diskChecked: true });
  assert.equal(states(yes), 'signin:done computer:done disk:done film:now'); assert.equal(yes.steps[3].action.href, '#/start');
  assert.equal(run({ diskChecked: true }).steps[2].state, 'done');                      // the yes is the person's; it does not depend on the computer step
  assert.equal(run({ computers: [comp('PC', 10)], diskChecked: 'true' }).steps[2].state, 'now');                     // only a real true counts
});

test('the first film: done once any film exists, with a link to My films; all four done says so', () => {
  const r = run({ computers: [comp('PC', 10)], diskChecked: true, films: [{ id: 'f' }] });
  assert.equal(r.allDone, true); assert.equal(r.current, null); assert.equal(r.steps[3].action.href, '#/films'); assert.match(r.steps[3].words, /You have a film already/);
  assert.match(run({ computers: [comp('PC', 10)], diskChecked: true, films: [{}, {}] }).steps[3].words, /You have 2 films already.*they stand/);
  assert.equal(run({ films: 'x' }).steps[3].state, 'next');
});

test('a hostile computer name cannot break the sentence; the name is cut', () => {
  const r = run({ computers: [comp('A'.repeat(300) + '\u0007\n', 10)] });
  assert.ok(r.steps[1].words.length < 200); assert.doesNotMatch(r.steps[1].words, /[\u0000-\u001f]/);
});

test('wiring: behind testerWizard (off), its own route, loaded before the library, the mock has the two wizard computers, no other file names it', () => {
  assert.match(read('assets/ryagram-config.js'), /\n  testerWizard: false,/);
  assert.match(read('assets/app-library.js'), /wizardOn\(\) && hash === '#\/tester-start'/);
  const html = read('app/index.html'); assert.ok(html.indexOf('app-tester-wizard.js') > 0 && html.indexOf('app-tester-wizard.js') < html.indexOf('app-library.js'));
  assert.match(read('tests/fake-supabase.js'), /wz\(awake\|quiet\)/);
  assert.equal(W.flagOn(), false);
});
