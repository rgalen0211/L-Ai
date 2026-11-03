// CLOUD-SITE 11-03: ONE command to run before merging anything into main. It runs, in order:
//   1. the node tests (every tests/*.test.mjs and *.test.cjs);
//   2. the public-pages audits: tools/check-public-pages.mjs (Node) and tools/audit-public-pages.py (Python, standard library only);
//   3. the page checks in a real browser: every tools/check-*.mjs / audit-*.mjs page check this branch has (Playwright, local server only; SKIP if Playwright is not installed);
//      and the desktop maker's copy of the editor (tools/build-maker-live.mjs --check);
//   4. the connector mutants: every tests/connect_*mutants.mjs (each breaks one rule in a scratch copy, and its tests must notice).
// and prints ONE table: step, PASS / FAIL / SKIP, what it said, how long it took. Exit 0 only if nothing FAILED. Nothing here touches the network, a database or a deploy.
//   node tools/pre-merge-check.mjs            everything (a few minutes)
//   node tools/pre-merge-check.mjs --quick    the node tests and the public-pages audits only
//   node tools/pre-merge-check.mjs --sql <python>   also the supabase/tests SQL suites with that Python (which needs pgserver and psycopg, as supabase/tests/test_2a_core.py says)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/** The node test runner's own totals from its TAP output. */
export function nodeTotals(out) {
  const n = (k) => { const m = new RegExp(`^# ${k} (\\d+)$`, 'm').exec(out); return m ? Number(m[1]) : null; };
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped') };
}

/** Is Playwright available to the browser checks (the same lookup they use)? */
export function hasPlaywright() {
  const require = createRequire(import.meta.url);
  for (const p of ['playwright', process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright']) { try { require.resolve(p); return true; } catch { /* next */ } }
  return false;
}

// the browser page checks, if this branch has them (names in order); each prints its own count and exits 1 on a finding
export const PAGE_CHECKS = ['tools/check-phone-keyboard-pass.mjs', 'tools/check-game-phone.mjs', 'tools/audit-a11y-switched.mjs'];

/** The steps, as [group, name, argv, how to read the result]. */
export function steps({ quick = false, sql = null } = {}) {
  const S = [];
  const node = process.execPath;
  const testFiles = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => /\.test\.(mjs|cjs)$/.test(f)).map((f) => `tests/${f}`);
  S.push(['tests', 'node tests', [node, '--test', ...testFiles], 'node']);
  if (exists('tools/check-public-pages.mjs')) S.push(['public pages', 'check-public-pages.mjs', [node, 'tools/check-public-pages.mjs'], 'last']);
  if (exists('tools/audit-public-pages.py')) S.push(['public pages', 'audit-public-pages.py', [process.platform === 'win32' ? 'python' : 'python3', 'tools/audit-public-pages.py'], 'last']);
  if (quick) return S;
  for (const c of PAGE_CHECKS) if (exists(c)) S.push(['page checks', path.basename(c), [node, c], hasPlaywright() ? 'last' : 'skip:Playwright is not installed']);
  if (exists('tools/build-maker-live.mjs')) S.push(['page checks', 'build-maker-live.mjs --check', [node, 'tools/build-maker-live.mjs', '--check'], 'last']);
  for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((x) => /^connect_.*mutants\.mjs$/.test(x)).sort()) S.push(['connector mutants', f, [node, `tests/${f}`], 'last']);
  if (sql) for (const f of ['test_connect.py', 'test_connect_oauth_mustfail.py', 'test_connect_abuse.py', 'test_invites.py', 'test_invite_signup_mustfail.py'].filter((x) => exists(`supabase/tests/${x}`))) {
    S.push(['sql (local Postgres)', f, [sql, '-m', 'unittest', `supabase/tests/${f}`], 'unittest']);
  }
  return S;
}

function run([group, name, argv, read]) {
  if (read.startsWith('skip:')) return { group, name, result: 'SKIP', said: read.slice(5), secs: 0 };
  const t0 = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  const secs = Math.round((Date.now() - t0) / 1000);
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (r.error) return { group, name, result: r.error.code === 'ENOENT' ? 'SKIP' : 'FAIL', said: r.error.code === 'ENOENT' ? `${argv[0]} is not installed` : String(r.error.message).slice(0, 80), secs };
  let said;
  if (read === 'node') { const t = nodeTotals(out); said = t.tests == null ? 'no totals printed' : `${t.pass} pass, ${t.fail} fail, ${t.skipped} skipped`; }
  else if (read === 'unittest') said = (/^(OK.*|FAILED.*)$/m.exec(out) || [, ''])[1] + ((/^Ran (\d+) tests?/m.exec(out) || [, ''])[1] ? ` (${/^Ran (\d+)/m.exec(out)[1]} tests)` : '');
  else said = out.trim().split('\n').filter((l) => l.trim() && !/^\(node:|ExperimentalWarning|--trace-warnings|Reparsing as ES module|To eliminate this warning/.test(l)).pop() || '';
  return { group, name, result: r.status === 0 ? 'PASS' : 'FAIL', said: said.slice(0, 90), secs, out };
}

export function table(rows) {
  const w = [Math.max(5, ...rows.map((r) => r.group.length)), Math.max(4, ...rows.map((r) => r.name.length)), 6];
  const line = (a, b, c, d, e) => `${a.padEnd(w[0])}  ${b.padEnd(w[1])}  ${c.padEnd(w[2])}  ${d.padStart(5)}  ${e}`;
  const L = [line('GROUP', 'STEP', 'RESULT', 'TIME', 'WHAT IT SAID'), line('-'.repeat(w[0]), '-'.repeat(w[1]), '------', '-----', '-'.repeat(12))];
  for (const r of rows) L.push(line(r.group, r.name, r.result, `${r.secs}s`, r.said));
  const failed = rows.filter((r) => r.result === 'FAIL').length, skipped = rows.filter((r) => r.result === 'SKIP').length;
  L.push('', `OVERALL: ${failed ? 'FAIL' : 'PASS'} (${rows.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped)`);
  return { text: L.join('\n'), failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const sqlAt = args.indexOf('--sql');
  const list = steps({ quick: args.includes('--quick'), sql: sqlAt >= 0 ? args[sqlAt + 1] : null });
  const rows = [];
  for (const s of list) {
    process.stderr.write(`running ${s[1]} ...\n`);
    const r = run(s); rows.push(r);
    if (r.result === 'FAIL' && r.out) process.stderr.write(r.out.split('\n').filter((l) => /^not ok|FAIL|MISSED|BROKEN|HARD|Error/.test(l)).slice(0, 15).join('\n') + '\n');
  }
  const { text, failed } = table(rows);
  console.log(text);
  process.exit(failed ? 1 : 0);
}
