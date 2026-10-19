// RUN BEFORE ANY DEPLOY of the guarded live functions (ai-editor, delete-account, film-page, get-delivery-url, stripe-checkout) and of `connect`.
//   node tools/connect_predeploy_check.mjs
// For each guarded function it runs two named sets of tests and refuses to say OK unless BOTH pass and at least the expected number ran:
//   APP SESSION UNAFFECTED   the function's own existing suite (a signed-in person's calls behave as before) AND the guard file's control case
//                            "<name>: control - an app session IS verified"
//   CONNECTION TOKEN REFUSED the guard file's case "<name> answers 401 to an AI token and never reaches its other dependencies"
// Plus the classification test (a function added without a decision fails) and the Deno boot of `connect` (prints Listening) is a separate manual line.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const GUARD = 'tests/connect-oauth-guard.test.mjs';
const FUNCTIONS = [
  { name: 'ai-editor',        guardName: 'ai-editor',        own: ['tests/ai-editor.test.mjs'] },
  { name: 'delete-account',   guardName: 'delete-account',   own: ['tests/delete-account.test.mjs'] },
  { name: 'film-page',        guardName: 'film-page',        own: ['tests/film-page.test.mjs'] },
  { name: 'get-delivery-url', guardName: 'get-delivery-url', own: ['tests/get-delivery-url.test.mjs'] },
  { name: 'stripe-checkout',  guardName: 'stripe-checkout',  own: ['tests/stripe.test.mjs'] },
];

function run(files, pattern) {
  const args = ['--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...files];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 240000 });
  const n = (k) => Number((new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(r.stdout) ?? [0, 0])[1]);
  return { pass: n('pass'), fail: n('fail'), status: r.status, out: r.stdout };
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let bad = 0;
const row = (name, what, r, min) => {
  const ok = r.status === 0 && r.fail === 0 && r.pass >= min;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${name.padEnd(17)} ${what.padEnd(26)} ran ${r.pass} (needs at least ${min}), failed ${r.fail}`);
};

for (const f of FUNCTIONS) {
  if (!fs.existsSync(`supabase/functions/${f.name}`)) { console.log(`SKIP  ${f.name.padEnd(17)} not in this checkout`); continue; }
  row(f.name, 'app session unaffected', run(f.own), 3);
  row(f.name, '  guard control case', run([GUARD], `^${esc(f.guardName)}.*control`), 1);
  row(f.name, 'connection token refused', run([GUARD], `^${esc(f.guardName)} answers 401`), 1);
}
row('(all functions)', 'every function classified', run([GUARD], 'every function directory is classified'), 1);
row('(helper)', 'guard helper itself', run([GUARD], '^helper'), 2);
console.log(bad ? `\n${bad} CHECK(S) FAILED: do not deploy.` : '\nALL PASS: the guarded functions are safe to deploy.');
process.exit(bad ? 1 : 0);
