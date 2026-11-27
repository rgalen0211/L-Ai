// Must-fail proof for tests/connect-desktop-gate.test.mjs (the desktop-app gate, the listed-only faces and the migration's rule): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_desktop_gate_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-desktopgate');
const SUITE = 'connect-desktop-gate.test.mjs';
const TL = 'supabase/functions/connect-core/tools.ts', DP = 'supabase/functions/connect-core/dispatch.ts', MC = 'supabase/functions/connect-core/mcp.ts', RS = 'supabase/functions/connect-core/rest.ts', FK = 'supabase/functions/connect-core/fake.ts';
const MG = 'supabase/migrations/20261123000500_connect_whoami_desktop_app.sql', RB = 'supabase/rollbacks/20261123000500_connect_whoami_desktop_app_rollback.sql', DL = 'supabase/migrations/20261026000500_app_downloads.sql';
const mutants = [
  ['the compilation request no longer asks whether the account has the app', TL, '{ const gate = await noDesktopApp(ctx, "A compilation request", true); if (gate) return gate; }', ''],
  ['the download request no longer asks', TL, '{ const gate = await noDesktopApp(ctx, "A download request"); if (gate) return gate; }', ''],
  ['listing downloads no longer asks', TL, '{ const gate = await noDesktopApp(ctx, "Download requests"); if (gate) return gate; }', ''],
  ['the gate lets an account without the app through', TL, 'if (w.desktop_app !== false) return null;', 'return null;'],
  ['an older server that does not say is refused (fail closed)', TL, 'if (w.desktop_app !== false) return null;', 'if (w.desktop_app === true) return null;'],
  ['the refusal saves nothing but does not say so', TL, 'NOTHING was saved or written down. ', ''],
  ['the compilation question no longer checks the account', TL, 'if (step.kind === "compilation" && (await ctx.data.whoami()).desktop_app === false && !(await compilationsOpen(ctx))) {', 'if (false) {'],
  ['the MCP face calls unlisted tools by name again', MC, 'preparedData: preparedDataOn(deps.mcpApp), listedOnly: true };', 'preparedData: preparedDataOn(deps.mcpApp) };'],
  ['the REST face calls unlisted tools by name again', RS, 'deps: deps.deps, listedOnly: true };', 'deps: deps.deps };'],
  ['the full render loses its polite refusal', DP, ' && name !== "request_full_render"', ''],
  ['dispatch refuses unlisted tools for direct callers too', DP, '(env.listedOnly && found.listed === false', '(found.listed === false'],
  ['the migration drops the worker clause', MG, 'desk := not exists (select 1 from public.workers w where w.user_id = me)\n          and (', 'desk := ('],
  ['the migration lets every account have the app', MG, 'coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) or exists', 'true or exists'],
  ['the migration forgets the answer', MG, ", 'desktop_app', desk);", ");"],
  ['the rollback keeps the answer', RB, "return jsonb_build_object('label', coalesce(mail, 'your account'), 'available', avail, 'held', held);", "return jsonb_build_object('label', coalesce(mail, 'your account'), 'available', avail, 'held', held, 'desktop_app', true);"],
];

function run(cwd) { return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
  for (const f of [MG, RB, DL]) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(scratch, f)); }
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
