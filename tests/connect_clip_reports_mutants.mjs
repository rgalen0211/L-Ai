// Must-fail proof for tests/connect-clip-reports.test.mjs (NEXT-CONNECT 179): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_clip_reports_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-cr2');
const T = 'supabase/functions/connect-core/tools.ts';
const SUITES = ['connect-clip-reports.test.mjs'];
const mutants = [
  ['the why-clip schema name is not checked', T, 'doc.schema !== WHY_SCHEMA || ', ''],
  ['the draft-messages schema name is not checked', T, 'doc.schema !== MSG_SCHEMA || ', ''],
  ['text with a place, markup or a control character is accepted', T, 'typeof v === "string" && textOk(v, max) ? v : null', 'typeof v === "string" ? v : null'],
  ['a report sentence is shown outside the untrusted fence', T, 'for (const w of c.why) lines.push(`    ${untrusted("report-sentence", w)}`);', 'for (const w of c.why) lines.push(`    ${w}`);'],
  ['a suggested fix is shown outside the untrusted fence', T, 'for (const f of m.fix) out.push(`      fix: ${untrusted("report-sentence", f)}`);', 'for (const f of m.fix) out.push(`      fix: ${f}`);'],
  ['the suggested fixes are dropped', T, 'for (const f of m.fix) out.push(', 'for (const f of []) out.push('],
  ['the why-clip tool is not read-only', T, 'name: "get_clip_explanations", title: "Why each clip was chosen", scope: "read", readOnly: true, listed: false,', 'name: "get_clip_explanations", title: "Why each clip was chosen", scope: "read", readOnly: false, listed: false,'],
  ['the why-clip tool is listed', T, 'name: "get_clip_explanations", title: "Why each clip was chosen", scope: "read", readOnly: true, listed: false,', 'name: "get_clip_explanations", title: "Why each clip was chosen", scope: "read", readOnly: true,'],
  ['the draft-messages tool is listed', T, 'name: "get_draft_messages", title: "What still stands in the way of a song film", scope: "read", readOnly: true, listed: false,', 'name: "get_draft_messages", title: "What still stands in the way of a song film", scope: "read", readOnly: true,'],
  ['another person\'s report can be read (why-clip)', T, 'const r = await ctx.data.clipReports(String(a.project_id));\n    if (!r) return NOT_YOURS("project");\n    if (r.why_clip === null', 'const r = (await ctx.data.clipReports(String(a.project_id))) ?? { why_clip: ctx.data.__leak ?? null, draft_messages: null };\n    if (r.why_clip === null'],
  ['the stand-in filter shows every clip', T, '(only === "stand_ins" && c.stand_in)', '(only === "stand_ins")'],
  ['the voice-unsure filter shows every clip', T, '(only === "voice_unsure" && c.voice_unsure)', '(only === "voice_unsure")'],
  ['the held-back filter shows every clip', T, '(only === "held_back" && c.flags.length > 0)', '(only === "held_back")'],
  ['the line filter is ignored', T, '&& (a.line === undefined || c.line === Number(a.line)));', ');'],
  ['the limit is ignored', T, 'const shown = keep.slice(0, limit);', 'const shown = keep;'],
  ['a missing reports table fails instead of saying so', T, 'if (!ctx.data.clipReports) return refuse("Reports on song films are not available through this connection yet.", "unavailable");', 'if (!ctx.data.clipReports) throw new Error("no table");'],
  ['no report is reported as an empty success without the words', T, 'if (r.why_clip === null || r.why_clip === undefined) return ok(NO_REPORT, { shared: false, clips: [] });', 'if (r.why_clip === null || r.why_clip === undefined) return ok("", { shared: false, clips: [] });'],
  ['the closing line that nothing was worked out is removed', T, 'lines.push("This is the app\'s own report, shown as it came; nothing was worked out here.");', ''],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
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
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
