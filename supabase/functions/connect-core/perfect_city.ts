// PERFECT CITY, the connector's side (CONNECT, 2026-11-27, Ryan's "turn the other departments on", 08:10).
// The department is the geographic site-selection one (department id geo_intelligence, called Perfect City since Ryan's 2026-11-20 14:36 answer). GEO OWNS the department, its page and its data; this file only lets the person's
// AI say what the page offers and send the person to it. It does NOT run an analysis and has no server call of its own: nothing here reads a place, a business or a person's data. Every number the page shows is made and labelled
// by GEO's page; the AI is told the BASIS WORDS and the limits, never a number.
//
// WHO OWNS THE VALUES BELOW: GEO. They are "as announced by GEO 08:10; GEO to confirm" (MAILBOX, GEO TAKEN, L-Ai branch geo-perfect-city-1127). When GEO's page changes the places, the business types or the labels, GEO changes this
// file (or tells CONNECT to) in the same step: tests/connect-perfect-city.test.mjs pins the page path against assets/app-departments.js so a move of the page cannot go unnoticed.
//
// THE GATE: the per-account switch `perfectCity` (account_settings.switches_on, read through World.switches(), the token-checked twin of my_switches()). Off = both tools refuse in words and say it is owner-only for now.
// A read that fails is "off" (never a half-open department). A department the server already calls 'working' for this person (the public flip, later) counts as on too.
import type { ToolCtx, ToolDef, ToolResult } from "./types.ts";

export const PERFECT_CITY_SWITCH = "perfectCity";
export const PERFECT_CITY_DEPARTMENT = "geo_intelligence";
/** The site's own address for a department page (assets/app-departments.js pathOf); a test compares it with the site's code. */
export const PERFECT_CITY_PAGE = "#/d/geo_intelligence";
export const PERFECT_CITY_ANNOUNCED = "As announced by GEO on 2026-11-27 08:10 (L-Ai branch geo-perfect-city-1127); GEO owns these values and will confirm them.";

export type Basis = "observed" | "calculated" | "estimated";
export interface PcPlace { id: string; label: string; note: string }
export interface PcBusinessType { id: string; label: string; note: string }
export interface PcLayer { id: string; label: string; basis: Basis; source: string; note: string }
export interface PcMeasure { id: string; label: string; basis: Basis; note: string }

/** The places the first path covers: counties, because that is the geography the data covers today. A county is not a city; the page says so. */
export const PC_PLACES: readonly PcPlace[] = Object.freeze([
  { id: "montgomery_oh", label: "Dayton and Montgomery County, Ohio", note: "The whole county, which includes Dayton." },
  { id: "greene_oh", label: "Greene County, Ohio", note: "The whole county, which includes Beavercreek and Xenia." },
]);
/** The kinds of business the first path can look at. */
export const PC_BUSINESS_TYPES: readonly PcBusinessType[] = Object.freeze([
  { id: "fast_food", label: "Fast food", note: "Places that sell fast food." },
  { id: "food_places", label: "All food places", note: "Restaurants, cafes, fast food and other places that serve food." },
  { id: "grocery", label: "Grocery", note: "Grocery shops." },
]);
/** What the page draws, and the word each is labelled with. */
export const PC_LAYERS: readonly PcLayer[] = Object.freeze([
  { id: "population", label: "People who live in each small area (a Census block group)", basis: "observed", source: "U.S. Census Bureau, 2020 Census (public domain)", note: "A count made by the Census." },
  { id: "population_density", label: "People per square kilometre in each small area", basis: "calculated", source: "The Census count divided by the area of the boundary, worked out by Ryagram", note: "Worked out, not counted." },
  { id: "median_household_income", label: "Median household income in each small area", basis: "estimated", source: "U.S. Census Bureau, American Community Survey, 5-year (public domain)", note: "A survey estimate with a margin of error. Some small areas have none." },
]);
/** What the page works out from the spot the person clicks, in rings. */
export const PC_RINGS_KM: readonly number[] = Object.freeze([1, 2, 5]);
export const PC_MEASURES: readonly PcMeasure[] = Object.freeze([
  { id: "nearest_distance", label: "Straight-line distance from the clicked spot to the nearest similar businesses", basis: "calculated", note: "Straight line only, not a drive or a walk." },
  { id: "businesses_within_rings", label: "How many similar businesses lie within 1, 2 and 5 kilometres of the spot", basis: "calculated", note: "Worked out from the mapped points. Where the points come from can be incomplete." },
  { id: "people_within_rings", label: "About how many people live within 1, 2 and 5 kilometres of the spot", basis: "estimated", note: "An estimate from the small areas the ring touches; the ring cuts across them." },
]);
/** What the department does NOT know or do. The AI must say these when it describes the department; every line is a fact about the design GEO announced. */
export const PC_NOT_KNOWN: readonly string[] = Object.freeze([
  "It has no sales or customer data, so it cannot say whether a business would do well at a spot.",
  "There is no success score and no ranking of spots or places.",
  "Distances are straight lines. There are no drive times or walking times.",
  "The places are whole counties, not neighbourhoods or city limits.",
  "The business points come from a private source that may not be loaded yet; when they are not, the page says so and shows no businesses.",
  "Only the places and kinds of business listed here are covered today.",
]);

/** The words a person's AI gets when the switch is off. The switch is owner-only for now: say that, never pretend the department does not exist. */
export const PC_OFF_WORDS = "Perfect City is not switched on for this Ryagram account. It is being tried by the account owner first (an owner-only switch), so it is not open to other accounts yet. Nothing was looked up.";

const refuse = (text: string, code: string, extra: Partial<ToolResult> = {}): ToolResult => ({ text, isError: true, code, ...extra });
const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data });
const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const ID = "^[a-z][a-z0-9_]{1,30}$";

type Gate = { on: true } | { on: false; result: ToolResult };
/** Is Perfect City on for the connected person? Fails closed: a switch list that cannot be read is "not available just now", never "on". */
export async function perfectCityGate(ctx: ToolCtx): Promise<Gate> {
  let switches: string[] | null = null;
  try { const s = await ctx.data.switches(); switches = Array.isArray(s) ? s : null; } catch { switches = null; }
  if (switches === null) return { on: false, result: refuse("Whether Perfect City is on for this account could not be read just now, so nothing was looked up. Try again in a minute.", "unavailable", { data: { ok: false, available: false, switch: PERFECT_CITY_SWITCH } }) };
  if (switches.includes(PERFECT_CITY_SWITCH)) return { on: true };
  // the public flip (later): the server calls the department 'working' for this person even though their own list does not name the switch
  const rows = await ctx.data.departments().catch(() => null);
  if (Array.isArray(rows) && rows.some((r) => r && r.id === PERFECT_CITY_DEPARTMENT && r.status === "working")) return { on: true };
  return { on: false, result: refuse(PC_OFF_WORDS, "not_available", { data: { ok: false, switch: PERFECT_CITY_SWITCH, on: false, owner_only: true, looked_up: false } }) };
}

/** The options as data: only values GEO announced, each with its basis word. Contains no number about any place. */
export function perfectCityOptions() {
  return {
    department: { id: PERFECT_CITY_DEPARTMENT, label: "Perfect City", switch: PERFECT_CITY_SWITCH },
    status: PERFECT_CITY_ANNOUNCED,
    places: PC_PLACES.map((p) => ({ ...p })),
    business_types: PC_BUSINESS_TYPES.map((b) => ({ ...b })),
    layers: PC_LAYERS.map((l) => ({ ...l })),
    rings_km: [...PC_RINGS_KM],
    measures: PC_MEASURES.map((m) => ({ ...m })),
    not_known: [...PC_NOT_KNOWN],
    basis_words: ["observed", "calculated", "estimated"],
    page: PERFECT_CITY_PAGE,
    shows_numbers_here: false,
  };
}

const optionsText = () => [
  "Perfect City is on for this account. It works out nothing in this chat: the person does it on the Ryagram page, and every number there is labelled observed, calculated or estimated.",
  `Places: ${PC_PLACES.map((p) => p.label).join("; ")}.`,
  `Kinds of business: ${PC_BUSINESS_TYPES.map((b) => b.label).join("; ")}.`,
  "On the page the person picks a place and a kind of business, then clicks a spot on the map. They see:",
  ...PC_LAYERS.map((l) => `  - ${l.label} (${l.basis}; ${l.source}).`),
  ...PC_MEASURES.map((m) => `  - ${m.label} (${m.basis}). ${m.note}`),
  "What it does not know or do:",
  ...PC_NOT_KNOWN.map((n) => `  - ${n}`),
  `${PERFECT_CITY_ANNOUNCED} Do not say more than this about what the page shows, and never give a number for a place: you cannot see the page's numbers.`,
].join("\n");

const pick = <T extends { id: string }>(list: readonly T[], v: unknown): T | null | undefined =>
  v === undefined ? undefined : (typeof v === "string" ? (list.find((x) => x.id === v) ?? null) : null);

const listPerfectCityOptions: ToolDef = {
  name: "list_perfect_city_options", title: "What Perfect City can look at today", scope: "read", readOnly: true, idempotent: true,
  description: "Perfect City is Ryagram's map for checking a place for a kind of business with free public data. This lists what it supports today: the places, the kinds of business, what the page shows for each spot the person clicks (people, people per square kilometre, income, "
    + "distances to similar businesses) with the word each number carries (observed, calculated or estimated), and what it does not know. It reads no place and gives no numbers about any place. Read-only: it changes nothing and spends no credits. It only works for an account that has Perfect City switched on, and says so plainly when it is not.",
  inputSchema: obj(),
  async run(_a, ctx) {
    const g = await perfectCityGate(ctx);
    if (!g.on) return g.result;
    return ok(optionsText(), perfectCityOptions() as unknown as Record<string, unknown>);
  },
};

const openPerfectCity: ToolDef = {
  name: "open_perfect_city", title: "Send the person to Perfect City", scope: "read", readOnly: true, idempotent: true,
  description: "Tells the person where to open Perfect City on the Ryagram website and what to pick there. Optionally name a place and a kind of business from list_perfect_city_options to say what to choose; they are only words for the person, nothing is chosen or looked up for them. "
    + "The numbers are on the Ryagram page, not in this chat: you cannot see them, so do not guess or quote any. Read-only: it changes nothing and spends no credits. It only works for an account that has Perfect City switched on, and says so plainly when it is not.",
  inputSchema: obj({
    place: { type: "string", pattern: ID, description: "Optional: a place id from list_perfect_city_options." },
    business_type: { type: "string", pattern: ID, description: "Optional: a kind-of-business id from list_perfect_city_options." },
  }),
  async run(a, ctx) {
    const g = await perfectCityGate(ctx);
    if (!g.on) return g.result;
    const place = pick(PC_PLACES, a.place), biz = pick(PC_BUSINESS_TYPES, a.business_type);
    const allowed = Object.keys(a).every((k) => k === "place" || k === "business_type");
    if (!allowed || place === null || biz === null) {
      return refuse(`That place or kind of business is not one Perfect City covers today. Places: ${PC_PLACES.map((p) => `${p.id} (${p.label})`).join("; ")}. Kinds of business: ${PC_BUSINESS_TYPES.map((b) => `${b.id} (${b.label})`).join("; ")}. Nothing was opened or looked up.`, "args",
        { data: { ok: false, places: PC_PLACES.map((p) => p.id), business_types: PC_BUSINESS_TYPES.map((b) => b.id) } });
    }
    const steps = [
      "Open Perfect City in the top bar of the Ryagram website (the page is " + PERFECT_CITY_PAGE + "). The person has to be signed in.",
      `Pick the place${place ? `: ${place.label}` : ""}.`,
      `Pick the kind of business${biz ? `: ${biz.label}` : ""}.`,
      "Click a spot on the map. The page then shows the people, the people per square kilometre and the income around it, the distances to the nearest similar businesses, and how many lie within 1, 2 and 5 kilometres. Every number is labelled observed, calculated or estimated.",
    ];
    return ok([`Perfect City is a page on the Ryagram website; the numbers are there, not in this chat, and you cannot see them. Tell the person:`, ...steps.map((s, i) => `${i + 1}. ${s}`),
      "What it does not know:", ...PC_NOT_KNOWN.map((n) => `  - ${n}`), PERFECT_CITY_ANNOUNCED].join("\n"),
    { ok: true, page: PERFECT_CITY_PAGE, place: place ? place.id : null, business_type: biz ? biz.id : null, steps, not_known: [...PC_NOT_KNOWN], shows_numbers_here: false, chosen_for_the_person: false });
  },
};

export const perfectCityTools: ToolDef[] = [listPerfectCityOptions, openPerfectCity];
