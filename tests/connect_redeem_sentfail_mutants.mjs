// Must-fail proof for tests/connect-redeem-sentfail.test.mjs (redeem-invite when the email went out but recording it failed): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_redeem_sentfail_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-redeemsentfail');
const SUITE = 'connect-redeem-sentfail.test.mjs';
const RD = 'supabase/functions/redeem-invite/redeem.ts';
const FIRST = '  try { await deps.sent(redemption, userId); }\n  catch (e1) {';
const SECOND = '    try { await deps.sent(redemption, userId); }\n    catch (e2) {';
const REL = '    await deps.release(redemption).catch(() => {});\n';
const EXISTS = 'if ((e as { code?: string }).code === "email_exists") return reply(200, { message: SENT });';
const mutants = [
  ['a failed recording is not tried again', RD, SECOND, '    try { }\n    catch (e2) {'],
  ['a recording that keeps failing releases the code (the email went out)', RD, 'catch (e2) { console.error(', 'catch (e2) { await deps.release(redemption); console.error('],
  ['a recording that keeps failing answers "we could not send" (false: the mail is on its way)', RD, 'catch (e2) { console.error(', 'catch (e2) { return reply(503, { error: "We couldn’t send the email just now." }); console.error('],
  ['a recording that fails once breaks the answer', RD, FIRST, '  await deps.sent(redemption, userId);\n  try { }\n  catch (e1) {'],
  ['a normal redemption records the mail twice', RD, FIRST, '  await deps.sent(redemption, userId);\n  try { await deps.sent(redemption, userId); }\n  catch (e1) {'],
  ['a normal redemption never records the mail', RD, FIRST, '  try { }\n  catch (e1) {'],
  ['a real send failure no longer gives the code back', RD, REL, ''],
  ['a known address (email_exists) answers 503', RD, EXISTS, 'if ((e as { code?: string }).code === "email_exists") return reply(503, { error: "We couldn’t send the email just now." });'],
  ['a known address (email_exists) answers other words', RD, EXISTS, 'if ((e as { code?: string }).code === "email_exists") return reply(200, { message: SENT + " " });'],
];

function run(cwd) { return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
    fs.copyFileSync(path.join(root, 'tests', SUITE), path.join(scratch, 'tests', SUITE));
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`BROKEN MUTANT (text found ${n} times, need 1): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
