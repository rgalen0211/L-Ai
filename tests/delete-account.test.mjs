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
      requestDeletion: async (owner, email, reason) => { calls.push(['request', owner, reason]); },
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
  assert.deepEqual(w.calls, [['remove', 100], ['remove', 100], ['remove', 50], ['deleteUser', ME]]);
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

test('a running render blocks it; credit history records a request instead', async () => {
  let w = world({ active_jobs: 1 });
  assert.equal((await call(w.deps, { confirm_email: 'ryan@example.com' })).status, 409);
  assert.deepEqual(w.calls, []);
  w = world({ has_credit_history: true });
  const res = await call(w.deps, { confirm_email: 'ryan@example.com' });
  assert.equal(res.status, 202);
  assert.equal((await res.json()).status, 'requested');
  assert.deepEqual(w.calls, [['request', ME, 'credit history']]);           // no files touched, login kept
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
  assert.deepEqual(w.calls, [['remove-uploads', 2], ['deleteUser', ME]]);
  assert.equal((await res.json()).files_removed, 2);
});
