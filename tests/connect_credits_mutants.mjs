// Must-fail proof for tests/connect-credits-estimate.test.mjs (NEXT-CONNECT 170): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_credits_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-ce');
const T = 'supabase/functions/connect-core/tools.ts';
const SUITES = ['connect-credits-estimate.test.mjs'];
const mutants = [
  ['another person\'s project can be priced', T, 'const pv = await projectVersion(ctx, String(a.project_id));\n    if (!pv) return NOT_YOURS("project");\n    const v = pv.view.version;', 'const pv = await projectVersion(ctx, String(a.project_id));\n    if (!pv) return ok("x", { credits: 0 });\n    const v = pv.view.version;'],
  ['a project with no saved story is priced', T, 'if (v.state === "queued" || !(v.story_spec && (v.story_spec as { schema?: number }).schema === 1)) {\n      return refuse("This project has no saved story yet, and what', 'if (false) {\n      return refuse("This project has no saved story yet, and what'],
  ['the step is ignored when quoting', T, 'const q = await ctx.data.quote(pv.versionId, step);\n    const enough', 'const q = await ctx.data.quote(pv.versionId, "contact_sheet");\n    const enough'],
  ['a connection may start the final render', T, 'const connectionCanStart = step !== "final_render" && q.credits === 0;', 'const connectionCanStart = true;'],
  ['a connection may start a step that costs credits', T, 'const connectionCanStart = step !== "final_render" && q.credits === 0;', 'const connectionCanStart = step !== "final_render";'],
  ['"enough" is always true', T, 'const enough = q.available >= q.credits;', 'const enough = true;'],
  ['the balance left can go negative', T, 'left_after: enough ? q.available - q.credits : null,', 'left_after: q.available - q.credits,'],
  ['the tool is not read-only', T, 'name: "get_cost_estimate", title: "What a step costs", scope: "read", readOnly: true,', 'name: "get_cost_estimate", title: "What a step costs", scope: "read", readOnly: false,'],
  ['asking uses up the render ladder', T, 'name: "get_cost_estimate", title: "What a step costs", scope: "read", readOnly: true,', 'name: "get_cost_estimate", title: "What a step costs", scope: "read", readOnly: true, ladder: true,'],
  ['the tool takes a confirm argument', T, 'inputSchema: obj({ project_id: uuid, step: { type: "string", enum: [...COST_STEPS], description: "Which step to price." } }, ["project_id", "step"]),', 'inputSchema: obj({ project_id: uuid, confirm: CONFIRM, step: { type: "string", enum: [...COST_STEPS], description: "Which step to price." } }, ["project_id", "step"]),'],
  ['any step word is accepted', T, 'enum: [...COST_STEPS], description: "Which step to price." } }, ["project_id", "step"]),', 'description: "Which step to price." } }, ["project_id", "step"]),'],
  ['the answer does not say nothing was started', T, '    parts.push("Nothing was started and no credits were used.");\n', ''],
  ['a final render does not point to the app button', T, 'if (step === "final_render") parts.push("A connection cannot start it: the person presses \'Render final film\' in the Ryagram app.");', 'if (step === "final_render") parts.push("It can be started.");'],
  ['a preview does not mention the sheet it waits for', T, 'if (step === "preview" && !sheetDone) parts.push(', 'if (false) parts.push('],
  ['the free preview flag is lost', T, 'free_preview: step === "preview" ? q.free : undefined,', 'free_preview: undefined,'],
  ['the project id is echoed back', T, 'step, credits: q.credits, free: q.credits === 0,', 'step, project_id: a.project_id, credits: q.credits, free: q.credits === 0,'],
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
