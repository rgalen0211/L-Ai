// Wednesday Help (WEB 11-23, BUILDER help audit 08:33): every Help answer is true for what is ON, and the public Help and the in-app Help agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const help = read('help/index.html');
const lib = read('assets/app-library.js');
const ops = read('assets/app-ops.js');

test('1 Help does not say plain "Get help" attaches a film: only Send this to us on a film does', () => {
  assert.doesNotMatch(help, /it attaches the film you came from/);
  assert.ok(help.includes('To ask about one film, use Send this to us on that film: it attaches the film'));
  assert.match(lib, /Send this to us/, 'the film page has that link');
});

test('2 the queue answer says a full film is checked by a person first, on both Help pages', () => {
  const S = 'A full film is checked by a person before it starts, and it joins the end of the line when it is approved.';
  assert.ok(help.includes(S));
  assert.ok(lib.includes(S));
  assert.match(read('assets/app-jobs.js'), /We approve each one by hand for now/, 'the app says the same hand approval');
  assert.match(read('supabase/migrations/20261017000600_pipe1_orders.sql'), /auto_render boolean not null default false/, 'auto render is off by default: revisit this sentence if it is switched on');
});

test('3 both Helps answer "How do I get credits?" with the free-account words, buying-open variant on the Credits switch', () => {
  const AP = String.fromCharCode(0x2019), BS = String.fromCharCode(92);
  const Q = `Why can${AP}t I make a full film? How do I get credits?`;
  assert.ok(help.includes('<summary>Why can\'t I make a full film? How do I get credits?</summary>'));
  assert.ok(lib.includes(Q.replace(AP, BS + 'u2019')));
  const win = { ryagramConfig: {} };
  vm.runInNewContext(read('assets/free-account-line.js'), { window: win, document: { querySelectorAll: () => [] } });
  const { CLOSED } = win.ryagramFreeAccountLine;
  assert.ok(help.includes(`<p data-free-account-line>${CLOSED}</p>`), 'the static Help words are the CLOSED line, word for word');
  assert.match(help, /free-account-line\.js\?v=\d{8}[a-z0-9]*"/);
  assert.ok(help.indexOf('free-account-line.js?v=') > help.indexOf('ryagram-config.js?v='), 'the config is read before the swap');
  const mine = lib.slice(lib.indexOf(Q.replace(AP, BS + 'u2019')));
  assert.ok(mine.includes("WELCOME_LINE + ' A free account can make free contact sheets. ' + FREE_PREVIEW_RULE + (buyingOn() ? ' Credits pay for full films.' : ' ' + FILM_COST_CLOSED + ' Buying credits is not open yet.')"));
  assert.match(lib, /const FREE_PREVIEW_RULE = 'Each project gets 6 free previews \(15 across all projects in any 24 hours\); then 1 credit each\. A failed free one caused by your story still counts\.'/);
  assert.ok(CLOSED.startsWith('When you confirm your email you get 8 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead. A free account can make free contact sheets. Each project gets 6 free previews (15 across all projects in any 24 hours); then 1 credit each.'));
  assert.ok(CLOSED.endsWith('A full film costs 6 to 10 credits, depending on the film type: 8 covers the smaller ones. Buying credits is not open yet.'));
  assert.ok(lib.includes("const WELCOME_LINE = 'When you confirm your email you get 8 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead.';"));
  assert.ok(lib.includes("const FILM_COST_CLOSED = 'A full film costs 6 to 10 credits, depending on the film type: 8 covers the smaller ones.';"));
  assert.equal((help.match(/<details(?![^>]*data-flag)/g) || []).length, 9, 'not hidden by a help flag');
});

test('4 the in-app uploads answer shows only with uploads on; the public one keeps its Coming soon words', () => {
  assert.match(lib, /uploadsOn\(\) \? null : qa\('My own data \(spreadsheet\) won\\u2019t read\.'/);
  assert.match(lib, /items\.filter\(Boolean\)/, 'a null answer leaves no empty slot');
  assert.match(help, /<summary>My own data \(spreadsheet\) won't read\.<\/summary>\s*<p>Coming soon: when uploading your own data opens, /);
});

test('5 the "stop the films waiting" words match what expire_stale_queue does, in all three places', () => {
  const S = 'If the render machine stays down for a long time, we stop the films waiting for it and give back any credits held for them.';
  assert.ok(help.includes(S + ' Otherwise a waiting film keeps its place in line.'));
  assert.ok(lib.includes(S + ' Otherwise a waiting film keeps its place in line.'));
  assert.ok(ops.includes(S));
  for (const t of [help, lib, ops]) assert.doesNotMatch(t, /more than an hour/);
  const sql = read('supabase/migrations/20261010000100_ops_readiness.sql');
  assert.match(sql, /where j\.state = 'queued' and j\.created_at < now\(\) - make_interval\(mins => s\.queue_timeout_min\)/, 'only queued films are timed out');
});

test('6 a failed check frees credits but a failed free preview still counts, on both Help pages', () => {
  const S = 'A film that fails a check does not use your credits (a failed free preview still counts toward your free ones).';
  assert.ok(help.includes(S));
  assert.ok(lib.includes(S));
});

test('7 the in-app report answer links the report form', () => {
  assert.ok(lib.includes("['Public film pages are not open yet. To report a film, use the ', h('a', { href: '/report/' }, 'report form'), '. For reports about"));
  assert.ok(fs.existsSync(path.join(root, 'report/index.html')));
});

test('the public Help and the in-app Help use the same words for the shared answers', () => {
  const AP = String.fromCharCode(0x2019);
  const shared = [
    `Your film is made on our render machine, and it hasn${AP}t checked in for a few minutes. Nothing is wrong with your film. It will start as soon as the machine is back.`,
    'Films are made one at a time, oldest first. Yours starts when the ones ahead of it finish. A contact sheet or preview usually takes about 5 minutes and a full film up to about half an hour, so a long line can mean hours, or a day or more when many people join at once, such as a launch day. A full film is checked by a person before it starts, and it joins the end of the line when it is approved. The Render panel shows your place in line. You can have 2 films waiting at once. We do not send an email when a film is ready, so come back to this page to check.',
    'Every film goes through checks before you get it, and the message on the film says which one stopped it and why. Change the story (for example the years or the view) and try again.',
    'Yes when a film fails, or when you cancel it before it has started: the credits held for it are released straight away. Credits for a film that finished are used.',
    'Public film pages are not open yet.',
    'Coming soon: when uploading your own data opens, this answer will say how your files are read and deleted. Until then nothing can be uploaded.'
  ];
  for (const s of shared) {
    assert.ok(help.includes(s.replace(AP, "'")) || help.includes(s), `public Help: ${s.slice(0, 50)}`);
    assert.ok(lib.includes(s.replace(AP, String.fromCharCode(92) + 'u2019')), `in-app Help: ${s.slice(0, 50)}`);
  }
});
