// What the server does with the model's answer. The model may only CHOOSE: catalog ids, a fit, and a claimed reason
// code. Everything a person reads (title, source, coverage, licence, why-recommended, what's missing) is written here
// from the catalog table's own fields, and every claim is checked against those fields. Pure functions; tested in
// tests/source-search.test.mjs without a model. Design: proposals/WEB-PROMPT-FIRST-SOURCING.md, 2.2 to 2.5.

export interface CatalogRow {
  id: string; title: string; publisher: string; source_url: string; coverage: string; licence_short: string;
  licence_full: string; runnable: boolean; level: string | null; year_first: number | null; year_last: number | null;
  cadence: string; topic: string; measure: string; summary: string; derived: boolean;
}
export type Fit = "full" | "partial";
export type Level = "state" | "county" | "other" | "unspecified";
export interface Need { topic: string; measure: string; level: Level; year_first: number | null; year_last: number | null; places: string[] }

export const REASON_CODES = ["only_full_fit", "official_series_not_derived", "finer_geography", "longer_coverage"] as const;
export const VERDICTS = ["no_such_data", "geography_too_fine", "years_outside_coverage", "needs_private_data",
                         "exists_not_runnable_yet", "partly_supported"] as const;
export type ReasonCode = typeof REASON_CODES[number];
export type Verdict = typeof VERDICTS[number];
export const MAX_SUGGESTIONS = 6;
export const MAX_UNAVAILABLE = 3;

export interface Card {
  id: string; title: string; publisher: string; source_url: string; coverage: string; licence_short: string;
  licence_full: string; fit: Fit; recommended: boolean; reason: string;
}
export interface Gap { reason: Verdict; nearest: string[] }
export interface Result {
  need: Need; needKey: string;
  suggestions: Card[]; recommended: string | null;
  verdict: { code: Verdict; message: string } | null;
  unavailable: { id: string; title: string; message: string }[];
  gaps: Gap[];
  dropped: number;                 // ids the model named that aren't in the catalog or aren't runnable (never shown)
}

// Text from the model or the person: no control or invisible characters, collapsed, clamped.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
export const clean = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().slice(0, max);
const year = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 1700 && (v as number) <= 2200 ? (v as number) : null);

export function cleanNeed(raw: any): Need {
  const r = raw && typeof raw === "object" ? raw : {};
  const level: Level = ["state", "county", "other", "unspecified"].includes(r.level) ? r.level : "unspecified";
  let first = year(r.year_first), last = year(r.year_last);
  if (first !== null && last !== null && first > last) [first, last] = [last, first];
  const places = Array.isArray(r.places) ? r.places.slice(0, 10).map((p: unknown) => clean(p, 60)).filter(Boolean) : [];
  return { topic: clean(r.topic, 80), measure: clean(r.measure, 80), level, year_first: first, year_last: last, places };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60).trim();
// The queue's dedupe key: the same need, however it was worded, counts together.
export function needKey(n: Need): string {
  return `${norm(n.topic) || "unknown"}|${norm(n.measure) || "unknown"}|${n.level}`.slice(0, 200);
}

const rank = (level: string | null) => (level === "county" ? 2 : level === "state" ? 1 : 0);
const span = (r: CatalogRow) => (r.year_first !== null && r.year_last !== null ? r.year_last - r.year_first : null);

// The model's "full" is honoured only if the table agrees on level and years; it is never raised, only lowered.
function checkedFit(claimed: string, row: CatalogRow, need: Need): Fit | null {
  if (claimed !== "full" && claimed !== "partial") return null;       // weak and anything odd are dropped
  if (claimed === "partial") return "partial";
  if ((need.level === "state" || need.level === "county") && row.level !== need.level) return "partial";
  if (need.year_first !== null && row.year_first !== null && need.year_first < row.year_first) return "partial";
  if (need.year_last !== null && row.year_last !== null && need.year_last > row.year_last) return "partial";
  return "full";
}

// 2.4: a card is recommended only when the claimed reason is TRUE in the table. Tied: none.
export function recommendedReason(rec: CatalogRow, others: CatalogRow[], code: string): ReasonCode | null {
  if (!(REASON_CODES as readonly string[]).includes(code)) return null;
  const c = code as ReasonCode;
  if (c === "only_full_fit") return others.length === 0 ? c : null;
  if (others.length === 0) return null;                                // the other three are comparisons
  if (c === "official_series_not_derived") return !rec.derived && others.every((o) => o.derived) ? c : null;
  if (c === "finer_geography") return others.every((o) => rank(rec.level) > rank(o.level)) ? c : null;
  const mine = span(rec);
  return mine !== null && others.every((o) => { const s = span(o); return s !== null && mine > s; }) ? c : null;
}

function reasonText(code: ReasonCode, rec: CatalogRow, others: CatalogRow[]): string {
  switch (code) {
    case "only_full_fit": return "The only data we have that covers what you asked for.";
    case "official_series_not_derived": return "An official published series. The others are worked out from published counts.";
    case "finer_geography": return `Finer detail: by ${rec.level}, where the others are by ${others[0]?.level ?? "state"}.`;
    case "longer_coverage": return `Covers more years: ${rec.year_first} to ${rec.year_last}.`;
  }
}

const MESSAGES: Record<Verdict, string> = {
  no_such_data: "We don't have data that answers that yet.",
  geography_too_fine: "We don't have data at that level of detail.",
  years_outside_coverage: "We don't have data for those years.",
  needs_private_data: "That needs data that isn't public. You can upload your own data instead.",
  exists_not_runnable_yet: "We have data on this, but can't use it in a film yet.",
  partly_supported: "Part of that is covered. What's below doesn't match everything you asked for.",
};
const NOTED = " We've noted your request.";

export interface ModelAnswer {
  need?: unknown;
  candidates?: { id?: unknown; fit?: unknown }[];
  recommended?: { id?: unknown; reason_code?: unknown } | null;
  unavailable?: unknown[];
  verdict?: unknown;
}

export function interpret(answer: ModelAnswer, catalog: CatalogRow[]): Result {
  const byId = new Map(catalog.map((r) => [r.id, r]));
  const need = cleanNeed(answer?.need);
  let dropped = 0;

  const seen = new Set<string>();
  const chosen: { row: CatalogRow; fit: Fit }[] = [];
  for (const c of Array.isArray(answer?.candidates) ? answer.candidates : []) {
    const id = typeof c?.id === "string" ? c.id : "";
    const row = byId.get(id);
    if (!row || !row.runnable || seen.has(id)) { if (!seen.has(id) && id) dropped++; continue; }
    seen.add(id);
    const fit = checkedFit(String(c.fit), row, need);
    if (fit) chosen.push({ row, fit });
  }
  chosen.sort((a, b) => (a.fit === b.fit ? 0 : a.fit === "full" ? -1 : 1));   // stable: the model's order inside a fit
  const shown = chosen.slice(0, MAX_SUGGESTIONS);

  // Recommended: the id must be a shown full fit and the claimed reason must be true against the table.
  let recommended: string | null = null;
  let why = "";
  const claim = answer?.recommended;
  if (claim && typeof claim === "object" && typeof claim.id === "string") {
    const fulls = shown.filter((s) => s.fit === "full").map((s) => s.row);
    const rec = fulls.find((r) => r.id === claim.id);
    if (rec) {
      const others = fulls.filter((r) => r.id !== rec.id);
      const code = recommendedReason(rec, others, String(claim.reason_code));
      if (code) { recommended = rec.id; why = reasonText(code, rec, others); }
    }
  }

  const suggestions: Card[] = shown.map(({ row, fit }) => ({
    id: row.id, title: row.title, publisher: row.publisher, source_url: row.source_url, coverage: row.coverage,
    licence_short: row.licence_short, licence_full: row.licence_full, fit,
    recommended: row.id === recommended, reason: row.id === recommended ? why : "",
  }));

  const unavailable: Result["unavailable"] = [];
  for (const raw of Array.isArray(answer?.unavailable) ? answer.unavailable : []) {
    const row = typeof raw === "string" ? byId.get(raw) : undefined;
    if (!row || row.runnable || unavailable.some((u) => u.id === row.id)) continue;
    if (unavailable.length < MAX_UNAVAILABLE) {
      unavailable.push({ id: row.id, title: row.title, message: `We have "${row.title}", but can't use it in a film yet.` });
    }
  }

  const nearest = [...shown.map((s) => s.row.id), ...unavailable.map((u) => u.id)].slice(0, 6);
  const gaps: Gap[] = [];
  let verdict: Result["verdict"] = null;
  if (!shown.length) {
    const said = (VERDICTS as readonly string[]).includes(String(answer?.verdict)) ? (answer.verdict as Verdict) : "no_such_data";
    const code: Verdict = unavailable.length ? "exists_not_runnable_yet" : (said === "partly_supported" || said === "exists_not_runnable_yet" ? "no_such_data" : said);
    verdict = { code, message: MESSAGES[code] + NOTED };
    gaps.push({ reason: code, nearest });
  } else if (!shown.some((s) => s.fit === "full")) {
    // Only partial matches: the request is noted, ONE row (an unavailable id rides along in `nearest`, never as a second row).
    verdict = { code: "partly_supported", message: MESSAGES.partly_supported + NOTED };
    gaps.push({ reason: "partly_supported", nearest });
  }
  // A FULL fit is shown: the data supports the request, so NOTHING of the person's words is kept, whatever else the model named.
  // (An unavailable match is still told to the person plainly, in `unavailable`.)
  return { need, needKey: needKey(need), suggestions, recommended, verdict, unavailable, gaps, dropped };
}
