// Must-fail proof for the two Calibrate tools (CONNECT 11-27): each mutant breaks ONE thing in a scratch copy of the connector and at least one of these suites must then FAIL:
//   connect-calibration-1127 (the tools themselves), connect-dept-flip-1127 (the switch), connect-hard-rule-1127 (no credit moves, no paths), connect-words-lint-1127 (the public words), connect-tool-coverage-1127 (every tool's guards).
// A baseline run on the unbroken copy must PASS first. Run ALONE:  node tests/connect_calibration_mutants.mjs   (exit 0 only when every mutant is caught; 2 = the baseline failed, nothing was proved).
// It deletes nothing: the scratch copy (.mut-calibration, untracked) is copied once, each fault is written over one file, and the original text is written back before the next.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-calibration');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-calibration-1127.test.mjs', 'connect-dept-flip-1127.test.mjs', 'connect-hard-rule-1127.test.mjs', 'connect-words-lint-1127.test.mjs', 'connect-tool-coverage-1127.test.mjs'];
const T = C + 'calibration_tools.ts';
const DB = 'supabase/functions/connect/db.ts';
const FAKE = C + 'fake.ts';
const TYPES = C + 'types.ts';
const TOOLS = C + 'tools.ts';
const OPEN = 'name: "open_calibration", title: "Find Calibrate", scope: "read", readOnly: true,';
const STATUS = 'name: "calibration_status", title: "Your Calibrate totals", scope: "read", readOnly: true,';
const mutants = [
  // ---- the tools' permissions and honesty hints
  ['open_calibration needs write permission', T, 'name: "open_calibration", title: "Find Calibrate", scope: "read"', 'name: "open_calibration", title: "Find Calibrate", scope: "write"'],
  ['calibration_status needs write permission', T, 'name: "calibration_status", title: "Your Calibrate totals", scope: "read"', 'name: "calibration_status", title: "Your Calibrate totals", scope: "write"'],
  ['open_calibration is not marked read-only', T, OPEN, OPEN.replace('readOnly: true', 'readOnly: false')],
  ['calibration_status is not marked read-only', T, STATUS, STATUS.replace('readOnly: true', 'readOnly: false')],
  ['calibration_status takes an answer argument', T, '    inputSchema: obj(),\n    async run(_a, ctx) {\n      const g = await calibrationGate(ctx);\n      if (!g.on) return g.result;\n      const f = await fetchStatus(ctx);\n      if ("result" in f) return f.result;\n      const s = f.read;\n      if (!s.open) return closedNow();\n      return ok([`Calibrate totals',
    '    inputSchema: obj({ answer: { type: "string" } }),\n    async run(_a, ctx) {\n      const g = await calibrationGate(ctx);\n      if (!g.on) return g.result;\n      const f = await fetchStatus(ctx);\n      if ("result" in f) return f.result;\n      const s = f.read;\n      if (!s.open) return closedNow();\n      return ok([`Calibrate totals'],
  ['the tools are not registered', TOOLS, 'TOOLS.push(...makeCalibrationTools());', ''],
  // ---- the switch
  ['the switch is not checked at all', T, 'if (switches.includes(CALIBRATE_SWITCH)) return { on: true };', 'return { on: true };'],
  ['the switch is looked for under another name', T, 'export const CALIBRATE_SWITCH = "calibrate";', 'export const CALIBRATE_SWITCH = "calibration";'],
  ['a switch list that cannot be read counts as on', T, 'if (switches === null) return { on: false, result: refuse("Whether', 'if (switches === null) return { on: true }; if (false) return { on: false, result: refuse("Whether'],
  ['a switch list that is a string is searched as text', T, 'switches = Array.isArray(s) ? s : null;', 'switches = s as unknown as string[];'],
  ['a department saying working opens it', T, 'if (switches.includes(CALIBRATE_SWITCH)) return { on: true };', 'if (switches.includes(CALIBRATE_SWITCH) || (await ctx.data.departments().catch(() => [] as { status: string }[])).some((r) => r.status === "working")) return { on: true };'],
  ['the closed answer promises a date', T, 'and do not promise a date. Nothing was looked up."', 'and say it opens tomorrow. Nothing was looked up."'],
  // ---- the closed shape of the server's answer
  ['an extra key in the server answer is allowed', T, 'for (const k of Object.keys(doc)) if (!CALIBRATION_KEYS.includes(k)) return null;', ''],
  ['a content-like key joins the allowed list', T, '"earned_total", "page_path"]);', '"earned_total", "page_path", "task"]);'],
  ['the schema name is not checked', T, 'if (doc.schema !== CALIBRATION_SCHEMA) return null;', ''],
  ['the page path is not checked', T, 'if (typeof doc.page_path !== "string" || !CALIBRATION_PAGE_RE.test(doc.page_path)) return null;', 'if (typeof doc.page_path !== "string") return null;'],
  ['the page path may carry a query or words', T, String.raw`export const CALIBRATION_PAGE_RE = /^(\/app\/)?#\/[a-z0-9_]+(\/[a-z0-9_-]+){0,3}$/;`, String.raw`export const CALIBRATION_PAGE_RE = /^(\/app\/)?#\/.*$/;`],
  ['more left today than the daily limit is accepted', T, 'if (remainingToday > dailyCap) return null;', ''],
  ['more earned today than in all is accepted', T, 'if (earnedToday > earnedTotal) return null;', ''],
  ['a count may be negative or a fraction', T, '(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : null)', '(typeof v === "number" && Number.isFinite(v) ? v : null)'],
  ['a flag may be any text', T, 'if (typeof doc.open !== "boolean" || typeof doc.eligible !== "boolean" || typeof doc.consent_given !== "boolean") return null;', ''],
  // ---- the numbers are the server's
  ['the remaining number is worked out here', T, '${s.remainingToday} more can be earned today (the daily limit is ${s.dailyCap}), ${sayNumber(s.earnedTotal, "credit", "credits")} earned in all.`);\n      lines.push(s.consentGiven', '${s.dailyCap - s.earnedToday} more can be earned today (the daily limit is ${s.dailyCap}), ${sayNumber(s.earnedTotal, "credit", "credits")} earned in all.`);\n      lines.push(s.consentGiven'],
  ['the status data gives today in place of the total', T, 'earned_total: s.earnedTotal, answers_by_person_only: true });', 'earned_total: s.earnedToday, answers_by_person_only: true });'],
  ['the round size is off by one', T, 'tasks_per_round: s.tasksPerRound,', 'tasks_per_round: s.tasksPerRound + 1,'],
  ['the account is told it can earn when the server says it cannot', T, 'if (!s.eligible) lines.push(', 'if (false) lines.push('],
  ['open_calibration shows numbers when the server says it is closed', T, 'if (!s.open) return closedNow();\n      const lines = [', 'const lines = ['],
  ['calibration_status shows numbers when the server says it is closed', T, 'if (!s.open) return closedNow();\n      return ok([`Calibrate totals', 'return ok([`Calibrate totals'],
  // ---- what an answer must never hold
  ['the answer data carries a task', T, 'answers_by_person_only: true, ai_can: [...AI_CAN], ai_cannot: [...AI_CANNOT],', 'answers_by_person_only: true, task: "left or right", ai_can: [...AI_CAN], ai_cannot: [...AI_CANNOT],'],
  ['the answer names the person', T, '"Calibrate is open for this account. It is a page', '"Calibrate is open for " + ctx.principal.userId + ". It is a page'],
  ['the answer reports credits used', T, 'earned_total: s.earnedTotal, answers_by_person_only: true });', 'earned_total: s.earnedTotal, answers_by_person_only: true, credits: 5 });'],
  ['the answer says a reason for not being eligible', T, 'The page explains why; do not guess a reason and do not promise a date.', 'The account is too new. Do not promise a date.'],
  // ---- the words an AI reads
  ['the AI is told it may suggest an answer', T, 'and you must not suggest, hint at or recommend an answer.', 'and you may suggest an answer.'],
  ['the description no longer says to never suggest or read questions', T, 'so never suggest, hint at or recommend an answer, and never ask the person to read you a question so you can answer it. "', 'so be helpful. "'],
  ['the opt-in rule loses its condition', T, 'only if they opt in on the page, and that the page shows', 'and that the page shows'],
  ['consent wording is written here', T, 'Do not summarise or reword the terms yourself.', 'By taking part the person agrees that Ryagram may use their answers to train a model.'],
  ['a description says free', T, 'Ryagram adds credits for the answers it accepts. "', 'Ryagram adds free credits for the answers it accepts. "'],
  ['the person is told what the AI cannot do, minus earning', T, 'earn credits for them, so never suggest', 'help them, so never suggest'],
  // ---- the server call
  ['no hourly limit', T, 'if (!(await ctx.policy.hit(ctx.principal, "calibration_reads", LIMITS.calibrationReadsPerHourPerUser, 3600))) {', 'if (false) {'],
  ['the hourly limit is another number', TYPES, 'calibrationReadsPerHourPerUser: 60,', 'calibrationReadsPerHourPerUser: 600,'],
  ['a missing function is not handled', T, 'if (code === "unavailable") return unavailable();', ''],
  ['the database says no and its words are repeated', T, 'return unavailable("Calibrate is not open for this account just now.");', 'return unavailable(String((e as Error).message));'],
  ['a connector with no way to ask still answers', T, 'if (!ctx.data.calibrationStatus) return unavailable();', ''],
  ['the database layer does not turn a missing function into unavailable', DB, 'if (code === "42883" || code === "PGRST202") throw Object.assign(new Error("Calibrate numbers', 'if (false) throw Object.assign(new Error("Calibrate numbers'],
  ['the database layer sends more than the token hash', DB, 'self.fn("connect_calibration_status", ["text"], [h])', 'self.fn("connect_calibration_status", ["text", "text"], [h, "x"])'],
  ['the database layer calls a function that opens a round', DB, 'self.fn("connect_calibration_status", ["text"], [h])', 'self.fn("connect_calibration_open_round", ["text"], [h])'],
  ['the stand-in\'s read moves a credit', FAKE, 'this.calibrationCalls.push(userId);', 'this.calibrationCalls.push(userId); user.credits += 1;'],
  ['the stand-in data gains a method that answers', FAKE, '      calibrationStatus: async () => {', '      answerCalibrationTask: async () => ({ ok: true }),\n      calibrationStatus: async () => {'],
  ['a tool writes something (a project)', T, 'const s = f.read;\n      if (!s.open) return closedNow();\n      const lines = [', 'const s = f.read;\n      await ctx.data.createProject("x");\n      if (!s.open) return closedNow();\n      const lines = ['],
];

const run = () => spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd: scratch, timeout: 600000, killSignal: 'SIGKILL' });
const hung = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 10 minutes'); return r; };

fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
fs.cpSync(path.join(root, 'supabase/migrations'), path.join(scratch, 'supabase/migrations'), { recursive: true });
for (const s of SUITES) fs.copyFileSync(path.join(root, 'tests', s), path.join(scratch, 'tests', s));
if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));

const base = hung(run());
if (base.status !== 0) { console.log('BASELINE FAILS (nothing proved):\n' + String(base.stdout).slice(-1500)); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  const target = path.join(scratch, file);
  const original = fs.readFileSync(path.join(root, file), 'utf8');              // always the real file's text, so a faulted copy can never carry over
  const src = original.replace(/\r\n/g, '\n');
  const copies = src.split(from).length - 1;
  if (copies !== 1) { console.log(`BROKEN MUTANT (${copies} copies of the text, expected 1): ${name}`); missed++; fs.writeFileSync(target, original); continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = hung(run()).status !== 0;
  fs.writeFileSync(target, original);                                           // put it back before the next one
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
const after = hung(run());
if (after.status !== 0) { console.log('RESTORE CHECK FAILS: the scratch copy no longer passes after the last fault was put back'); process.exit(2); }
console.log(missed ? `${missed} of ${mutants.length} not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
