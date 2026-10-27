// Test bridge for supabase/tests/test_ops_readiness.py: runs the REAL ops-tick / ops-digest handlers and the app's banner wording over
// results the Python test fetched from the REAL database, and reports what they would do. Nothing is sent anywhere: the sender is the
// dry-run sender writing into an in-memory outbox that the Python test then applies to the real ops_outbox table.
//   stdin: one JSON object  { kind: 'tick'|'digest'|'banner', ... }     stdout: one JSON object
import fs from 'node:fs';
import vm from 'node:vm';
import { handle as tick } from '../supabase/functions/ops-tick/tick.ts';
import { handle as digest } from '../supabase/functions/ops-digest/digest.ts';
import { chooseSender } from '../supabase/functions/_shared/ops_mail.ts';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const adds = [];
const outbox = { add: async (kind, mode, to, subject, body) => { adds.push({ kind, mode, to, subject, body }); return true; } };
// The real chooser with the REAL secrets situation Ryan is in today: key and from set, MODE unset -> dry-run.
const sender = chooseSender(k => ({ RESEND_API_KEY: 'k', OPS_MAIL_FROM: 'Ryagram <noreply@uselai.com>' })[k], outbox, null);
const req = new Request('https://x/f', { method: 'POST', headers: { Authorization: 'Bearer service' } });

if (input.kind === 'tick') {
  const marked = [];
  const res = await tick(req, { serviceKey: 'service', tick: async () => input.tick, markNotified: async keys => { marked.push(...keys); return keys.length; }, sender });
  console.log(JSON.stringify({ response: await res.json(), adds, marked, mode: sender.mode }));
} else if (input.kind === 'digest') {
  const res = await digest(req, { serviceKey: 'service', data: async () => input.data, sender });
  console.log(JSON.stringify({ response: await res.json(), adds, mode: sender.mode }));
} else if (input.kind === 'banner') {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../assets/app-ops.js', import.meta.url), 'utf8'), { window });
  console.log(JSON.stringify({ banner: window.ryagramOps.bannerText(input.status, 'UTC') }));
}
