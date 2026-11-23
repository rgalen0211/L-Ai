// Must-fail proof for tests/connect-join-sendfail.test.mjs (what the join function does when the sign-up email cannot be sent, and the wiring of join_release in index.ts): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_join_sendfail_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-joinsendfail');
const SUITE = 'connect-join-sendfail.test.mjs';
const JN = 'supabase/functions/join/join.ts', IX = 'supabase/functions/join/index.ts', MGJ = 'supabase/migrations/20261121000800_join_open.sql';
const SW = 'export const SEND_FAILED_WORDS = "We couldn\\u2019t send the email just now. Please try again in a few minutes.";';
const EXISTS = 'if ((e as { code?: string }).code === "email_exists") return reply(200, { message: SENT });';
const REL = 'try { await deps.release?.(email, ipHash); } catch (re) { console.error(`join release: ${(re as Error).message}`); }';
const FAIL = 'return reply(503, { error: SEND_FAILED_WORDS });';
const mutants = [
  ['a failed send answers 200 "sent" again (the stranger reads success, no mail comes)', JN, FAIL, 'return reply(200, { message: SENT });'],
  ['a failed send answers 500 instead of 503', JN, FAIL, 'return reply(500, { error: SEND_FAILED_WORDS });'],
  ['the failed-send words send the person to a waitlist', JN, SW, 'export const SEND_FAILED_WORDS = "We couldn\\u2019t send the email just now. Join the waitlist instead.";'],
  ['the failed-send words send the person to an invite', JN, SW, 'export const SEND_FAILED_WORDS = "We couldn\\u2019t send the email just now. Ask for an invite.";'],
  ['the failed-send words stop saying to try again', JN, SW, 'export const SEND_FAILED_WORDS = "We couldn\\u2019t send the email just now.";'],
  ['a failed send does not give the try back', JN, REL, ''],
  ['a failed send gives back a try for another caller', JN, REL, 'try { await deps.release?.(email, "other"); } catch (re) { console.error(`join release: ${(re as Error).message}`); }'],
  ['a failed send gives back a try for another address', JN, REL, 'try { await deps.release?.("other@example.test", ipHash); } catch (re) { console.error(`join release: ${(re as Error).message}`); }'],
  ['a release that fails breaks the answer', JN, REL, 'await deps.release?.(email, ipHash);'],
  ['a known address (email_exists) answers 503 (probing: only unknown addresses would see it)', JN, EXISTS, 'if ((e as { code?: string }).code === "email_exists") return reply(503, { error: SEND_FAILED_WORDS });'],
  ['a known address (email_exists) answers 200 but with other words', JN, EXISTS, 'if ((e as { code?: string }).code === "email_exists") return reply(200, { message: SENT + " " });'],
  ['a known address (email_exists) gets its try released as well', JN, EXISTS, 'if ((e as { code?: string }).code === "email_exists") { await deps.release?.(email, ipHash); return reply(200, { message: SENT }); }'],
  ['an address Auth refuses gets its try released (a way past the limits)', JN, 'return reply(400, { error: BAD_ADDRESS_WORDS });', 'await deps.release?.(email, ipHash); return reply(400, { error: BAD_ADDRESS_WORDS });'],
  ['an address Auth refuses reads as a send failure (503)', JN, 'return reply(400, { error: BAD_ADDRESS_WORDS });', 'return reply(503, { error: SEND_FAILED_WORDS });'],
  ['index.ts calls the release with another argument name', IX, 'service.rpc("join_release", { p_email: email, p_ip_hash: ipHash })', 'service.rpc("join_release", { email, ip_hash: ipHash })'],
  ['index.ts stops passing Auth\'s status on', IX, ', status: error.status', ''],
  ['index.ts no longer recognises a known address by message', IX, '/already (been )?registered/i.test(error.message)', 'false'],
  ['a sent mail also gives a try back', JN, 'await deps.invite(email, `${deps.siteUrl}/app/`, { adult_confirmed: true });', 'await deps.invite(email, `${deps.siteUrl}/app/`, { adult_confirmed: true }); await deps.release?.(email, ipHash);'],
];

function run(cwd) { return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'supabase', 'migrations'), { recursive: true });
  fs.copyFileSync(path.join(root, MGJ), path.join(scratch, MGJ));
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
