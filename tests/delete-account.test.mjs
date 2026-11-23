// delete-account: confirmation, the running-render and credit-history rules, files before the login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/delete-account/remove.ts';

const ME = '00000000-0000-4000-8000-000000000001';
function world(check = {}, over = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      allowedOrigins: ['https://uselai.com'],
      verifyUser: async jwt => (jwt === 'good' ? { id: ME, email: 'Ryan@Example.com' } : null),
      check: async () => ({ active_jobs: 0, has_credit_history: false,
                            storage_paths: Array.from({ length: 250 }, (_, i) => `${ME}/p/v/j${i}/film.mp4`), ...check }),
      removeFiles: async (paths, bucket) => { calls.push([bucket === 'uploads' ? 'remove-uploads' : 'remove', paths.length]); },
      redactContact: async (owner, email) => { calls.push(['redact', owner, email]); },
      eraseContent: async owner => { calls.push(['erase', owner]); return { uploads_left: 0, films_left: 0 }; },
      requestDeletion: async (owner, email, reason) => { calls.push(['request', owner, reason]); },
      blockLogin: async owner => { calls.push(['block', owner]); },
      deleteUser: async owner => { calls.push(['deleteUser', owner]); },
      ...over,
    }
  };
}
const call = (deps, body, { jwt = 'good', origin = 'https://uselai.com', method = 'POST' } = {}) =>
  handle(new Request('https://x.supabase.co/functions/v1/delete-account', { method,
    headers: { origin, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined }), deps);

test('typing your email deletes files in batches, then the login', async () => {
  const w = world();
  const res = await call(w.deps, { confirm_email: '  ryan@example.COM ' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'deleted', files_removed: 250 });
  assert.deepEqual(w.calls, [['remove', 100], ['remove', 100], ['remove', 50], ['redact', ME, 'Ryan@Example.com'], ['deleteUser', ME]]);
});

test('nothing is deleted without the right confirmation, sign-in and page', async () => {
  const w = world();
  for (const body of [{}, { confirm_email: 'someone@else.com' }, { confirm_email: '' }, { confirm_email: 42 }]) {
    assert.equal((await call(w.deps, body)).status, 400);
  }
  assert.equal((await call(w.deps, { confirm_email: 'ryan@example.com' }, { jwt: 'bad' })).status, 401);
  assert.equal((await call(w.deps, { confirm_email: 'ryan@example.com' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(w.deps, {}, { method: 'GET' })).status, 405);
  assert.deepEqual(w.calls, []);
});

test('a running render blocks it; credit history still deletes files and uploads NOW, then records a request (GEO 11-21 M1)', async () => {
  let w = world({ active_jobs: 1 });
  assert.equal((await call(w.deps, { confirm_email: 'ryan@example.com' })).status, 409);
  assert.deepEqual(w.calls, []);
  w = world({ has_credit_history: true, storage_paths: [`${ME}/p/film.mp4`], upload_paths: [`${ME}/d1/source.csv`] });
  const res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.status, 'requested');
  assert.equal(body.files_removed, 2);
  assert.match(body.message, /films and uploaded files are deleted, and you can no longer sign in/);
  // MUST-FAIL (GEO 11-23): the kept record is CREDIT history, which includes welcome credits that were never paid for (an invite or an
  // approved waiting account), and the free preview takes no payments; the page and the preview Terms say 'credit history' too (WEB ad64ecb9)
  assert.match(body.message, /Your credit history is kept as a financial record/);
  assert.doesNotMatch(body.message, /payment/i);
  // nothing in the code reads account_deletion_requests or sets a deadline, so the reply promises none (the preview Terms say the same)
  assert.doesNotMatch(body.message, /\d+ days/);
  // MUST-FAIL: before the fix only the request was recorded and NO file was touched
  assert.deepEqual(w.calls, [['remove', 1], ['remove-uploads', 1], ['redact', ME, 'Ryan@Example.com'], ['erase', ME], ['request', ME, 'credit history'], ['block', ME]]);
  assert.ok(!w.calls.some(c => c[0] === 'deleteUser'));                       // the login and the ledger stay
});

test('a paid account whose files are not all gone is not recorded as done (GEO 11-21 M1)', async () => {
  const quiet = console.error; console.error = () => {};
  const w = world({ has_credit_history: true }, { eraseContent: async owner => { w.calls.push(['erase', owner]); return { uploads_left: 1, films_left: 0 }; } });
  const res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  console.error = quiet;
  assert.equal(res.status, 500);
  const said = (await res.json()).error;
  assert.match(said, /not all of your files could be confirmed as deleted/);   // CC1 11:15 LOW b
  assert.doesNotMatch(said, /nothing else was changed/);                    // MUST-FAIL: r2 said so, after files and contacts were already removed
  assert.ok(!w.calls.some(c => c[0] === 'request'));                         // asked again, it retries
});

test('a missing count from the erase step is a failure, never read as zero (CC1 10:57 LOW 6)', async () => {
  for (const left of [null, {}, { uploads_left: 0 }, { films_left: 0 }, { uploads_left: '0', films_left: 0 }]) {
    const quiet = console.error; console.error = () => {};
    const w = world({ has_credit_history: true }, { eraseContent: async () => left });
    const res = await call(w.deps, { confirm_email: 'ryan@example.com' });
    console.error = quiet;
    assert.equal(res.status, 500, JSON.stringify(left));                     // MUST-FAIL: before r2 a missing count read as 0
    assert.ok(!w.calls.some(c => c[0] === 'request' || c[0] === 'block'));
  }
});

test('a login block that fails is a 500, and asking again is safe (CC1 11:15 LOW c)', async () => {
  const quiet = console.error; console.error = () => {};
  let fail = true;
  const w = world({ has_credit_history: true, storage_paths: [`${ME}/p/film.mp4`] },
                  { blockLogin: async owner => { w.calls.push(['block', owner]); if (fail) throw new Error('auth down'); } });
  let res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  assert.equal(res.status, 500);                                            // pins r2's behaviour; planted 'swallow the block error' fails here
  assert.match((await res.json()).error, /couldn't be finished/);
  fail = false;
  res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  console.error = quiet;
  assert.equal(res.status, 202);                                            // the retry runs every step again (each is safe twice) and blocks
  assert.equal(w.calls.filter(c => c[0] === 'request').length, 2);          // account_request_deletion: on conflict do nothing
  assert.deepEqual(w.calls.at(-1), ['block', ME]);
  assert.ok(!w.calls.some(c => c[0] === 'deleteUser'));
});

test('the email is removed from support and invite rows before the login goes; a failure there keeps the login (GEO 11-21 M5)', async () => {
  let w = world({ storage_paths: [] });
  await call(w.deps, { confirm_email: 'ryan@example.com' });
  assert.deepEqual(w.calls, [['redact', ME, 'Ryan@Example.com'], ['deleteUser', ME]]);   // MUST-FAIL: before the fix no redaction
  const quiet = console.error; console.error = () => {};
  w = world({ storage_paths: [] }, { redactContact: async () => { throw new Error('db down'); } });
  const res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  console.error = quiet;
  assert.equal(res.status, 500);
  assert.ok(!w.calls.some(c => c[0] === 'deleteUser'));
});

test('only the person’s own folder is touched, and failures say what state things are in', async () => {
  let w = world({ storage_paths: [`${ME}/a.mp4`, 'someone-else/b.mp4', `x${ME}/c.mp4`] });
  await call(w.deps, { confirm_email: 'ryan@example.com' });
  assert.deepEqual(w.calls[0], ['remove', 1]);
  const quiet = console.error; console.error = () => {};
  w = world({}, { removeFiles: async () => { throw new Error('storage down'); } });
  let res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /Nothing was deleted/);
  assert.ok(!w.calls.some(c => c[0] === 'deleteUser'));
  w = world({}, { deleteUser: async () => { throw new Error('auth down'); } });
  res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  console.error = quiet;
  assert.match((await res.json()).error, /files were removed/);
});

test('uploaded spreadsheets are removed from their own bucket, only from the person’s own folder', async () => {
  const w = world({ storage_paths: [], upload_paths: [`${ME}/d1/source.csv`, `${ME}/d2/source.xlsx`, 'someone-else/d3/source.csv'] });
  const res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  assert.equal(res.status, 200);
  assert.deepEqual(w.calls, [['remove-uploads', 2], ['redact', ME, 'Ryan@Example.com'], ['deleteUser', ME]]);
  assert.equal((await res.json()).files_removed, 2);
});
