// What the two purge functions tell the SCHEDULER (CONNECT 2026-11-23, GAMES 09:15 and 09:56: live step 56 could not tell a purge job's 200 from ops-tick's, because every cron job's reply is just {"ok":true} and pg_net's reply
// table has no url; the request queue cannot be joined because pg_net deletes a request once sent). The scheduled reply now also carries the function's own NAME, nothing else: no count, no file, no secret.
// A call by Ryan (the service-role key) keeps the detailed body it always had. A refusal or a failure carries no name (the check reads the missing name as "not answered 200").
// Runs the real sweep with fake dependencies and reads purge-partial-uploads' source (it has no handler to import); talks to nothing. Must-fails: tests/connect_purge_job_reply_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle } from '../supabase/functions/purge-uploads/sweep.ts';

const JOB = 'j'.repeat(40);
const world = (over = {}) => ({ serviceKey: 'service-key', jobSecret: JOB, due: async () => [{ dataset_id: 'd1', storage_path: 'u/d1/source.csv' }], remove: async () => {}, markRemoved: async (ids) => ids.length, ...over });
const call = (deps, auth) => handle(new Request('https://x/functions/v1/purge-uploads', { method: 'POST', headers: { Authorization: auth } }), deps);

test('the scheduler is told ok:true and the name of the function, and nothing about what was removed', async () => {
  const r = await call(world(), 'Bearer ' + JOB);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, fn: 'purge-uploads' });
});

test('Ryan\'s own call (the service-role key) keeps the detailed answer', async () => {
  const r = await call(world(), 'Bearer service-key');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { due: 1, removed: 1 });
});

test('a failure or a refusal carries no name: the scheduler reads {ok:false} and a refused call reads 403', async () => {
  const bad = await call(world({ due: async () => { throw new Error('db down'); } }), 'Bearer ' + JOB);
  assert.equal(bad.status, 500);
  const body = await bad.json();
  assert.equal(body.ok, false);
  assert.ok(!('fn' in body));
  const refused = await call(world(), 'Bearer nope');
  assert.equal(refused.status, 403);
  assert.ok(!/purge-uploads/.test(await refused.text()));
});

test('purge-partial-uploads answers the scheduler with its own name too, and keeps the service-role answer', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/purge-partial-uploads/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /import \{ json, reply, whoCalls \} from "\.\.\/_shared\/ops_mail\.ts";/);
  assert.match(src, /if \(caller === "job"\) return json\(200, \{ ok: true, fn: "purge-partial-uploads" \}\);\n  return reply\(caller, 200, \{ due: due\?\.length \?\? 0, removed \}\);/);
  assert.ok(!/fn: "purge-uploads"/.test(src), 'each function says only its own name');
  const sweep = fs.readFileSync(new URL('../supabase/functions/purge-uploads/sweep.ts', import.meta.url), 'utf8');
  assert.ok(!/fn: "purge-partial-uploads"/.test(sweep));
});
