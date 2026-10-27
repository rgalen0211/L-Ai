// purge-uploads: only the scheduler (its own per-job secret) or Ryan (the service-role key) may call it; files are removed before rows are marked; failures retry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/purge-uploads/sweep.ts';

const rows = n => Array.from({ length: n }, (_, i) => ({ dataset_id: `d${i}`, storage_path: `u/d${i}/source.csv` }));
function world(n, over = {}) {
  const calls = [];
  return { calls, deps: { serviceKey: 'secret',
    due: async () => rows(n),
    remove: async paths => { calls.push(['remove', paths.length]); },
    markRemoved: async ids => { calls.push(['mark', ids.length]); return ids.length; }, ...over } };
}
const call = (deps, auth = 'Bearer secret') => handle(new Request('https://x/functions/v1/purge-uploads', { method: 'POST', headers: auth ? { Authorization: auth } : {} }), deps);

test('nobody but the service role can run it', async () => {
  for (const auth of [null, 'Bearer nope', 'secret', 'Bearer ']) {
    const w = world(3);
    assert.equal((await call(w.deps, auth)).status, 403);
    assert.deepEqual(w.calls, []);
  }
  assert.equal((await call({ ...world(1).deps, serviceKey: '' }, 'Bearer ')).status, 403);
});

test('files are removed in batches, then marked', async () => {
  const w = world(250);
  const res = await call(w.deps);
  assert.deepEqual(await res.json(), { due: 250, removed: 250 });
  assert.deepEqual(w.calls, [['remove', 100], ['mark', 100], ['remove', 100], ['mark', 100], ['remove', 50], ['mark', 50]]);
});

test('a failed storage delete marks nothing and the rest carry on', async () => {
  let n = 0;
  const quiet = console.error; console.error = () => {};
  const w = world(150, { remove: async paths => { if (n++ === 0) throw new Error('storage down'); w.calls.push(['remove', paths.length]); } });
  const res = await call(w.deps);
  console.error = quiet;
  assert.deepEqual(await res.json(), { due: 150, removed: 50 });
  assert.deepEqual(w.calls, [['remove', 50], ['mark', 50]]);
});

test('odd rows are skipped and a database error is a plain 500', async () => {
  let w = world(0, { due: async () => [{ dataset_id: 'a', storage_path: '' }, { dataset_id: 'b', storage_path: null }, null, ...rows(1)] });
  assert.deepEqual(await (await call(w.deps)).json(), { due: 1, removed: 1 });
  const quiet = console.error; console.error = () => {};
  w = world(0, { due: async () => { throw new Error('boom'); } });
  const res = await call(w.deps);
  console.error = quiet;
  assert.equal(res.status, 500);
  assert.doesNotMatch(JSON.stringify(await res.json()), /boom/);
});

const JOB = 'purge-job-secret-0123456789abcdef0123456789abcdef';
const OTHER_JOB = 'ops-tick-job-secret-0123456789abcdef0123456789abc';
const jobWorld = (n, over = {}) => { const w = world(n, over); w.deps.jobSecret = JOB; return w; };

test('the scheduler own job secret runs it and the reply is ok and nothing else (pg_net keeps replies where logins can read them)', async () => {
  const w = jobWorld(250);
  const res = await call(w.deps, 'Bearer ' + JOB);
  assert.equal(res.status, 200);
  assert.equal(JSON.stringify(await res.json()), '{"ok":true}');
  assert.equal(w.calls.length, 6);                                                     // it really swept: 3 batches, remove then mark
});

test('the service-role key still runs it by hand, with the counts', async () => {
  const res = await call(jobWorld(3).deps);
  assert.deepEqual(await res.json(), { due: 3, removed: 3 });
});

test('another job secret, a near miss, a short secret and nothing are refused and nothing runs', async () => {
  for (const [auth, secret] of [['Bearer ' + OTHER_JOB, JOB], ['Bearer ' + JOB + 'x', JOB], ['Bearer ' + JOB.slice(0, -1), JOB], ['Bearer short', 'short'], ['Bearer ', ''], ['Bearer undefined', undefined], [null, JOB]]) {
    const w = jobWorld(3); w.deps.jobSecret = secret;
    assert.equal((await call(w.deps, auth)).status, 403, String(auth));
    assert.deepEqual(w.calls, []);
  }
});

test('a failed sweep is "failed" to the scheduler with no error text, and the words to Ryan', async () => {
  const boom = { due: async () => { throw new Error('relation uploads_secret does not exist'); } };
  const job = await call(jobWorld(1, boom).deps, 'Bearer ' + JOB);
  assert.equal(job.status, 500);
  assert.equal(JSON.stringify(await job.json()), '{"ok":false}');
  const hand = await call(jobWorld(1, boom).deps);
  assert.equal(hand.status, 500);
  assert.match((await hand.json()).error, /sweep failed/);
});
