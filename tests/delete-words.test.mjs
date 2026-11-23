// The delete-account dialog says what the server does (WEB 11-23; preview Terms section 9). Each sentence below fails on the old words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CREDIT = 'If your account has any credit history, we keep that record, we block your login at once, and we record your request. An administrator then closes the account by hand.';
const goesRed = (check, oldText) => assert.throws(() => check(oldText), undefined, 'the check must fail on the old wording');
const files = { library: read('assets/app-library.js'), waiting: read('assets/app-waiting.js') };

test('the dialogs and sections give no date: Terms 9 and Privacy promise none, so "within 30 days" is gone (WEB 11-23 v2)', () => {
  for (const [n, s] of Object.entries(files)) assert.doesNotMatch(s, /within 30 days/, n);
});

test('NO FALSE "can\'t be undone": neither delete dialog nor its section says it', () => {
  for (const [n, s] of Object.entries(files)) {
    assert.doesNotMatch(s, /can[’']?t be undone|cannot be undone/i, `${n}: the account is not always gone for good`);
  }
});

test('the confirm says, before the person confirms, that films and files go for good and what credit history means (library and waiting page)', () => {
  const lib = files.library.match(/confirm\('(Delete your account\?[^']*)'\)/)[1];
  assert.ok(lib.includes('Your films and uploaded files are removed for good.'));
  assert.ok(lib.includes(CREDIT));
  const wt = files.waiting.match(/confirm\('(Delete your account\?[^']*)'\)/)[1];
  assert.ok(wt.includes(CREDIT));
});

test('the section says the same as Terms 9: files removed, email replaced in support requests and invite records, then the login; credit history kept, login blocked, request recorded, closed by hand with no date promised', () => {
  assert.ok(files.library.includes('We remove your films and uploaded files, replace your email in support requests and invite records, and then delete your login. ' + CREDIT));
  assert.ok(files.waiting.includes('replace your email in support requests and invite records, and then delete your login. ' + CREDIT));
  assert.ok(files.library.includes('A render that is still running has to finish or be cancelled first.'), 'the running-render refusal is said up front');
  assert.doesNotMatch(files.library, /at once\. Renders must have finished|bought or used credits|any public film pages/, 'the old words are gone');
  assert.doesNotMatch(files.waiting, /deletes your login and removes you from the list, at once/);
});

test('what the server answers still matches the words: a credit-history account gets 202 requested with the login blocked, anyone else 200 deleted', () => {
  const rm = read('supabase/functions/delete-account/remove.ts');
  assert.match(rm, /blockLogin\(user\.id\)[\s\S]*status: "requested"/);
  assert.match(rm, /closed by hand/);
  // The reply a credit-history person reads, the mock of it and the page words say the same and promise no number of days (RENDERER 11-23: the mock kept "within 30 days" after the page dropped it).
  // GEO's ffbcdd16 (origin/geo-delete-free-1123) changes remove.ts to NEW; until it is merged this tree's remove.ts still holds OLD, so either is accepted from the server file, never the mock.
  const NEW = 'Your films and uploaded files are deleted, and you can no longer sign in. Your credit history is kept as a financial record, so your account itself is closed by hand.';
  const OLD = 'Your films and uploaded files are deleted, and you can no longer sign in. Your payment history is kept as a financial record, so your account itself is closed by hand within 30 days.';
  assert.ok(rm.includes(NEW) || rm.includes(OLD), 'remove.ts replies with NEW (or, until GEO ffbcdd16 lands, OLD)');
  const mock = read('tests/fake-supabase.js');
  const check = m => { assert.ok(m.includes(`message: '${NEW}'`), 'the mock replies with the server words'); assert.doesNotMatch(m.match(/status: 'requested', message: '[^']*'/)[0], /\d+ days|within/); };
  check(mock);
  goesRed(check, mock.replace(NEW, 'Your account has credit history, which is kept as a financial record. Your request is recorded, and your account and files will be deleted by hand within 30 days.'));
  for (const s of Object.values(files)) assert.doesNotMatch(s.slice(s.indexOf('Delete your account?'), s.indexOf('Delete your account?') + 450), /\b\d+ days\b/, 'the page promises no number of days either');
  assert.match(rm, /status: "deleted"/);
  assert.match(rm, /A render is still running/);
});
