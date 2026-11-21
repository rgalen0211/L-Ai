// ops-tick's render-orders step (PIPE-1, JOB-CONTRACT-v1 4/5): expire waiting finals, remove expired films' objects,
// and never let a failure there stop the health tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle as tick } from '../supabase/functions/ops-tick/tick.ts';
import { dryRunSender } from '../supabase/functions/_shared/ops_mail.ts';

const req = () => new Request('https://x/functions/v1/ops-tick', { method: 'POST', headers: { Authorization: 'Bearer secret' } });
const healthy = async () => ({ rendering: 'ok', reaped: 0, expired: 0, alert_mail_budget: 20, new_alerts: [] });
const base = () => ({ serviceKey: 'secret', tick: healthy, markNotified: async () => 0,
                      sender: dryRunSender({ add: async () => true }) });

test('expired films are removed in batches of 100 and counted', async () => {
  const removed = [];
  const paths = Array.from({ length: 230 }, (_, i) => `u/p/v/j${i}/final.mp4`);
  const res = await tick(req(), { ...base(), orders: async () => ({ approvals_expired: 2, delete_objects: paths }),
                                  removeArtifacts: async (b) => { removed.push(b.length); } });
  assert.equal(res.status, 200);
  assert.deepEqual(removed, [100, 100, 30]);
  assert.deepEqual((await res.json()).orders, { approvals_expired: 2, films_removed: 230 });
});

test('a failing orders step never stops the tick', async () => {
  const res = await tick(req(), { ...base(), orders: async () => { throw new Error('db down'); } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).orders, { error: true });
});

// WORKER 2026-11-21 (GEO's privacy review M2): a film is counted removed only when SQL confirms its file is gone, and
// one failing remove never stops the other removes or the marking; what failed stays due for the next tick.
test('a failing remove batch does not stop the others, and only what SQL confirms gone is counted', async () => {
  const tried = [];
  const marked = [];
  const paths = Array.from({ length: 230 }, (_, i) => `u/p/v/j${i}/final.mp4`);
  const ids = paths.map((_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const res = await tick(req(), { ...base(),
    orders: async () => ({ approvals_expired: 0, delete_objects: paths, due_deliveries: ids }),
    removeArtifacts: async (b) => { tried.push(b.length); if (tried.length === 2) throw new Error('storage 503'); },
    markDeliveriesRemoved: async (d) => { marked.push(d.length); return 130; } });
  assert.equal(res.status, 200);
  assert.deepEqual(tried, [100, 100, 30], 'the third batch is still tried after the second fails');
  assert.deepEqual(marked, [230], 'every due delivery is offered for marking; SQL marks only the really gone');
  assert.deepEqual((await res.json()).orders, { approvals_expired: 0, films_removed: 130, films_still_due: 100, remove_errors: 1 });
});

test('with the marking hook a remove that reported success is not counted until SQL confirms it', async () => {
  const res = await tick(req(), { ...base(),
    orders: async () => ({ approvals_expired: 1, delete_objects: ['a/b/final.mp4'], due_deliveries: ['00000000-0000-4000-8000-000000000001'] }),
    removeArtifacts: async () => {},
    markDeliveriesRemoved: async () => 0 });
  assert.deepEqual((await res.json()).orders, { approvals_expired: 1, films_removed: 0, films_still_due: 1 });
});

test('a failing mark never stops the tick, and the film stays due', async () => {
  const res = await tick(req(), { ...base(),
    orders: async () => ({ approvals_expired: 0, delete_objects: ['a/b/final.mp4'], due_deliveries: ['00000000-0000-4000-8000-000000000001'] }),
    removeArtifacts: async () => {},
    markDeliveriesRemoved: async () => { throw new Error('db down'); } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).orders, { error: true });
});

test('without the orders hook the tick is unchanged', async () => {
  const body = await (await tick(req(), base())).json();
  assert.equal('orders' in body, false);
});
