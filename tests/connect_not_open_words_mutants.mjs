// Must-fail proof for tests/connect-not-open-words.test.mjs (a person who cannot connect an AI is told the truth in plain words): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_not_open_words_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it; a timeout is neither "caught" nor "missed"
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '): end its node child by its own PID and write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-notopen');
const SUITE = 'connect-not-open-words.test.mjs';
const AC = 'assets/app-connect.js', LS = 'supabase/directory/anthropic-listing.json';
const mutants = [
  ['the line goes back to by invitation', AC, "const INVITE_ONLY = 'Connecting an AI is not open to your account yet. To ask for it, write to ryagram@uselai.com.';", "const INVITE_ONLY = 'Connecting an AI is by invitation for now.';"],
  ['the line forgets where to write', AC, "Connecting an AI is not open to your account yet. To ask for it, write to ryagram@uselai.com.';", "Connecting an AI is not open to your account yet.';"],
  ['the consent page shows the server reason again', AC, "c && c.invited === false ? INVITE_ONLY : c && c.reason ? c.reason : NOT_ALLOWED", "c && c.reason ? c.reason : NOT_ALLOWED"],
  ['the connector-address line says ask Ryan again', AC, "Write to ryagram@uselai.com and we will send it.'", "Ask Ryan for it.'"],
  ['the listing says invited again', LS, 'A Ryagram account that is allowed to connect an AI (Account, then Connected AIs, shows when it is).', 'A Ryagram account that has been invited to connect an AI (invite-only for now).'],
  ['the listing loses the allowed words', LS, 'A Ryagram account that is allowed to connect an AI (Account, then Connected AIs, shows when it is).', 'A Ryagram account.'],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  for (const f of [AC, LS]) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(scratch, f)); }
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
