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

test('without the orders hook the tick is unchanged', async () => {
  const body = await (await tick(req(), base())).json();
  assert.equal('orders' in body, false);
});
