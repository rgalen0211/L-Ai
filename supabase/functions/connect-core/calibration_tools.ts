// CALIBRATE FOR THE PERSON'S AI (CONNECT, 2026-11-27, Ryan's idea of 11:40). Contract and reasons: Ryagram-logs/proposals/CONNECT-CALIBRATE-1127.md.
// WHAT CALIBRATE IS (from the launch order, FACES' design, BUILDER's earn rules, WEB's page; none of it is decided here): a page where the PERSON helps tune Ryagram by answering short questions with their own clicks,
// and Ryagram adds credits for answers it accepts. The questions, the clips, the hidden known-answer checks and every award live on the server and on the page.
// THE HARD RULE, built into the shape of this file: THE AI NEVER ANSWERS AND NEVER EARNS. Two tools, both read-only, and neither of them takes an argument at all:
//   open_calibration     says whether Calibrate is open for this account, what a round is in plain words, where the page is, and the numbers Ryagram keeps (round size, the daily limit, what the person has earned)
//   calibration_status   the person's own totals, numbers only
// There is NO write tool and NO tool that returns a question, a clip, a line of words, a candidate answer or a known answer, so an AI cannot answer for the person and cannot learn the hidden checks.
// "Opening a round" means telling the person where the page is: no round is made, reserved or started from here (a round made by an AI could use up the person's questions or the daily limit, and the page makes its own).
// Credits are awarded only by the person's own signed-in page session; nothing in this file can award, undo or move a credit.
//
// ONE SERVER CALL, read-only, named in the paper for BUILDER to adopt or rename: public.connect_calibration_status(p_token_hash text) returns jsonb (schema ryagram.calibration-status/0). The shape is CLOSED: a key not in the list below makes
// the whole answer refused (a server that ever starts to carry content here is caught loudly, and nothing of it is passed on). Every number is the server's, shown as returned: nothing is added up or worked out here.
//   { schema, open: boolean, eligible: boolean, consent_given: boolean, tasks_per_round: int, daily_cap: int, earned_today: int, remaining_today: int, earned_total: int, credits_per_task?: int|null, page_path: text }
// THE GATE: the per-account switch `calibrate` (account_settings.switches_on, read through World.switches()), and ONLY that. A list that cannot be read is "not available just now", never "on". All words here are DRAFTS for Ryan's yes. Pure TypeScript, no network.
import type { ToolCtx, ToolDef, ToolResult } from "./types.ts";
import { LIMITS } from "./types.ts";

export const CALIBRATE_SWITCH = "calibrate";
export const CALIBRATION_SCHEMA = "ryagram.calibration-status/0";
/** The Ryagram site's own address form for a page ("#/..." or "/app/#/..."): never an address with a host, a key or a query in it. WEB names the page; the server reports it; the connector only checks its shape. */
export const CALIBRATION_PAGE_RE = /^(\/app\/)?#\/[a-z0-9_]+(\/[a-z0-9_-]+){0,3}$/;
/** The keys the server's answer may carry, and no others. */
export const CALIBRATION_KEYS: readonly string[] = Object.freeze(["schema", "open", "eligible", "consent_given", "tasks_per_round", "daily_cap", "earned_today", "remaining_today", "earned_total", "credits_per_task", "page_path"]);
const MAX_COUNT = 1_000_000;

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data });
const refuse = (text: string, code: string, data?: Record<string, unknown>): ToolResult => ({ text, isError: true, code, ...(data ? { data } : {}) });
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : null);

/** What the AI can and cannot do here, said in the words the AI reads and as data. */
export const AI_CAN: readonly string[] = Object.freeze(["say whether Calibrate is open for the person", "say where the Calibrate page is and what a round is", "read the numbers Ryagram keeps: round size, daily limit, credits earned"]);
export const AI_CANNOT: readonly string[] = Object.freeze(["see a question, a clip, a line of words or any answer", "answer for the person, click for them or start a round", "earn, add, move or take back a credit", "suggest which answer to pick"]);
const RULES_FOR_THE_AI = "You cannot see any question, clip or answer, you cannot answer for the person or earn credits for them, and you must not suggest, hint at or recommend an answer. Do not ask the person to read a question to you so that you can answer it: the answers have to be the person's own. If they ask you which answer is right, say you cannot know and that the choice is theirs.";
const CONSENT_RULE = "Tell the person that their answers are used to improve Ryagram only if they opt in on the page, and that the page shows the full wording and asks them first. Do not summarise or reword the terms yourself.";

export interface CalibrationRead {
  open: boolean; eligible: boolean; consentGiven: boolean; tasksPerRound: number; dailyCap: number; earnedToday: number; remainingToday: number; earnedTotal: number; creditsPerTask: number | null; pagePath: string;
}

/** The server's answer, checked. null = not in the closed shape (so nothing of it is shown). Numbers are kept exactly; none is computed. */
export function readCalibration(doc: unknown): CalibrationRead | null {
  if (!isObj(doc)) return null;
  for (const k of Object.keys(doc)) if (!CALIBRATION_KEYS.includes(k)) return null;
  if (doc.schema !== CALIBRATION_SCHEMA) return null;
  if (typeof doc.open !== "boolean" || typeof doc.eligible !== "boolean" || typeof doc.consent_given !== "boolean") return null;
  const tasksPerRound = count(doc.tasks_per_round), dailyCap = count(doc.daily_cap), earnedToday = count(doc.earned_today), remainingToday = count(doc.remaining_today), earnedTotal = count(doc.earned_total);
  if (tasksPerRound === null || dailyCap === null || earnedToday === null || remainingToday === null || earnedTotal === null) return null;
  if (remainingToday > dailyCap) return null;                                  // more left than the limit cannot be
  if (earnedToday > earnedTotal) return null;                                  // today is part of the total
  const cpt = doc.credits_per_task === undefined || doc.credits_per_task === null ? null : count(doc.credits_per_task);
  if (doc.credits_per_task !== undefined && doc.credits_per_task !== null && cpt === null) return null;
  if (typeof doc.page_path !== "string" || !CALIBRATION_PAGE_RE.test(doc.page_path)) return null;
  return { open: doc.open, eligible: doc.eligible, consentGiven: doc.consent_given, tasksPerRound, dailyCap, earnedToday, remainingToday, earnedTotal, creditsPerTask: cpt, pagePath: doc.page_path };
}

type Gate = { on: true } | { on: false; result: ToolResult };
const OFF_WORDS = "Calibrate is not open for this account yet: it is not switched on for this person. Tell them plainly that it is not available to them yet, and do not promise a date. Nothing was looked up.";
/** Is Calibrate on for the connected person? Fails closed: a switch list that cannot be read is "not available just now", never "on". The switch is the only key. */
export async function calibrationGate(ctx: ToolCtx): Promise<Gate> {
  let switches: string[] | null = null;
  try { const s = await ctx.data.switches(); switches = Array.isArray(s) ? s : null; } catch { switches = null; }
  if (switches === null) return { on: false, result: refuse("Whether Calibrate is on for this account could not be read just now, so nothing was looked up. Try again in a minute.", "unavailable", { ok: false, looked_up: false, available: false }) };
  if (switches.includes(CALIBRATE_SWITCH)) return { on: true };
  return { on: false, result: refuse(OFF_WORDS, "not_available", { ok: false, looked_up: false, on: false }) };
}

type Fetched = { read: CalibrationRead } | { result: ToolResult };
/** The one server call both tools make, with the same limit, the same missing-function answer and the same checking. */
async function fetchStatus(ctx: ToolCtx): Promise<Fetched> {
  const unavailable = (why = "Calibrate numbers are not available just now.") => ({ result: refuse(`${why} Nothing was looked up.`, "not_available", { ok: false, looked_up: false }) });
  if (!ctx.data.calibrationStatus) return unavailable();
  if (!(await ctx.policy.hit(ctx.principal, "calibration_reads", LIMITS.calibrationReadsPerHourPerUser, 3600))) {
    return { result: refuse(`The limit of ${LIMITS.calibrationReadsPerHourPerUser} Calibrate checks an hour is reached. Do not check again; tell the person. Nothing was looked up.`, "rate", { ok: false, looked_up: false, retry_after_seconds: 3600 }) };
  }
  let doc: unknown;
  try { doc = await ctx.data.calibrationStatus(); }
  catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "unavailable") return unavailable();                              // the database has no such function yet (not applied): said plainly, none of the database's text is passed on
    if (code === "42501" || code === "PT503") return unavailable("Calibrate is not open for this account just now.");   // the database's own switch said no: its text is never repeated
    throw e;
  }
  const read = readCalibration(doc);
  if (!read) return { result: refuse("The answer was not in a shape this connection knows, so none of it is shown. Nothing was looked up.", "bad_report", { ok: false, looked_up: false }) };
  return { read };
}

const sayNumber = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const closedNow = (): ToolResult => ok("Ryagram says Calibrate is not open for this account just now. Tell the person plainly, and do not promise a date. " + RULES_FOR_THE_AI,
  { ok: true, looked_up: true, open: false, ai_can: [...AI_CAN], ai_cannot: [...AI_CANNOT], answers_by_person_only: true });

export function makeCalibrationTools(): ToolDef[] {
  const openCalibration: ToolDef = {
    name: "open_calibration", title: "Find Calibrate", scope: "read", readOnly: true, idempotent: true,
    description: "Tells the person where Calibrate is in Ryagram, what a round is, and the numbers Ryagram keeps for their account: whether Calibrate is open for them, how many questions a round has, how many credits they have earned today and in all, "
      + "how many more can be earned today and the daily limit. Every number is Ryagram's own, shown as returned. Calibrate is a page where the PERSON helps tune Ryagram by answering short questions with their own clicks; Ryagram adds credits for the answers it accepts. "
      + "Read-only: it opens nothing, starts no round and changes nothing. You cannot see any question, clip or answer, cannot answer for the person and cannot earn credits for them, so never suggest, hint at or recommend an answer, and never ask the person to read you a question so you can answer it. "
      + "Tell the person their answers are used to improve Ryagram only if they opt in on the page, which shows the full wording and asks first; do not reword it yourself. "
      + "It only works for an account that has Calibrate switched on, and says so plainly when it is not.",
    inputSchema: obj(),
    async run(_a, ctx) {
      const g = await calibrationGate(ctx);
      if (!g.on) return g.result;
      const f = await fetchStatus(ctx);
      if ("result" in f) return f.result;
      const s = f.read;
      if (!s.open) return closedNow();
      const lines = [
        "Calibrate is open for this account. It is a page in Ryagram where the person helps tune Ryagram by answering short questions with their own clicks. A round is a set of those questions"
        + ` (${sayNumber(s.tasksPerRound, "question", "questions")} in a round). Ryagram adds credits for the answers it accepts${s.creditsPerTask === null ? "" : `, ${sayNumber(s.creditsPerTask, "credit", "credits")} for each accepted answer`}, up to a daily limit; it decides what it accepts, and a hurried or random answer may earn nothing.`,
        `Where it is: ${s.pagePath} (the person has to be signed in). The person opens the page and answers there; nothing is started from here.`,
      ];
      if (!s.eligible) lines.push("Ryagram says this account cannot earn credits from Calibrate yet. The page explains why; do not guess a reason and do not promise a date.");
      lines.push(`The person's numbers, as Ryagram gives them: ${sayNumber(s.earnedToday, "credit", "credits")} earned today, ${s.remainingToday} more can be earned today (the daily limit is ${s.dailyCap}), ${sayNumber(s.earnedTotal, "credit", "credits")} earned in all.`);
      lines.push(s.consentGiven ? "The person has already chosen to take part on the page." : "The person has not yet chosen to take part: that choice is made on the page.");
      lines.push(CONSENT_RULE, RULES_FOR_THE_AI);
      return ok(lines.join("\n"), {
        ok: true, looked_up: true, open: true, eligible: s.eligible, consent_given: s.consentGiven, tasks_per_round: s.tasksPerRound, ...(s.creditsPerTask === null ? {} : { credits_per_task: s.creditsPerTask }),
        daily_cap: s.dailyCap, earned_today: s.earnedToday, remaining_today: s.remainingToday, earned_total: s.earnedTotal, page_path: s.pagePath,
        answers_by_person_only: true, ai_can: [...AI_CAN], ai_cannot: [...AI_CANNOT],
      });
    },
  };

  const calibrationStatus: ToolDef = {
    name: "calibration_status", title: "Your Calibrate totals", scope: "read", readOnly: true, idempotent: true,
    description: "Reads the person's own Calibrate totals from Ryagram: credits earned today, how many more can be earned today, the daily limit and the total earned so far. Numbers only, each exactly as Ryagram returned it; nothing is worked out here. "
      + "Read-only: it changes nothing and cannot add or take back a credit. It shows no question, clip or answer. You cannot answer for the person or earn credits for them, and you must not suggest which answer to pick. "
      + "It only works for an account that has Calibrate switched on, and says so plainly when it is not.",
    inputSchema: obj(),
    async run(_a, ctx) {
      const g = await calibrationGate(ctx);
      if (!g.on) return g.result;
      const f = await fetchStatus(ctx);
      if ("result" in f) return f.result;
      const s = f.read;
      if (!s.open) return closedNow();
      return ok([`Calibrate totals for this person, as Ryagram gives them: ${sayNumber(s.earnedToday, "credit", "credits")} earned today, ${s.remainingToday} more can be earned today (the daily limit is ${s.dailyCap}), ${sayNumber(s.earnedTotal, "credit", "credits")} earned in all.`,
        s.eligible ? "" : "Ryagram says this account cannot earn credits from Calibrate yet; the page explains why. Do not guess a reason and do not promise a date.",
        "These are numbers only. Credits are added by the person's own answers on the page and nowhere else. " + RULES_FOR_THE_AI].filter(Boolean).join("\n"),
      { ok: true, looked_up: true, open: true, eligible: s.eligible, daily_cap: s.dailyCap, earned_today: s.earnedToday, remaining_today: s.remainingToday, earned_total: s.earnedTotal, answers_by_person_only: true });
    },
  };

  return [openCalibration, calibrationStatus];
}
