// The delete-account dialog says what the server does (WEB 11-23; preview Terms section 9). Each sentence below fails on the old words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CREDIT = 'If your account has any credit history, we keep that record, we block your login at once, and we record your request. An administrator then closes the account by hand.';
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
  assert.match(rm, /closed by hand/);   // (remove.ts still says "within 30 days"; reported to CONNECT/GEO, the page and Terms no longer give a date)
  assert.match(rm, /status: "deleted"/);
  assert.match(rm, /A render is still running/);
});
