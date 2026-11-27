// PERFECT CITY, the connector's side (CONNECT, 2026-11-27, Ryan's "turn the other departments on", 08:10).
// The department is the geographic site-selection one (department id geo_intelligence, called Perfect City since Ryan's 2026-11-20 14:36 answer). GEO OWNS the department, its page and its data. Three tools:
//   list_perfect_city_options  what the page offers (static words and ids, with the basis word of every number and what it does not know)
//   open_perfect_city          where the page is and what to pick there
//   perfect_city_summary       the numbers the page shows for ONE spot, read from GEO's private helper through CONNECT's token twin
//                              (supabase/migrations/20261127000500_connect_perfect_city_summary.sql -> ryagram_private.perfect_city_summary_for, GEO's migration 20261127000900). ADOPTED by GEO 08:26.
// The first two read no place at all; the third never works a number out: every number, its basis word, the method sentence, the not-known sentences and the credits are the database's, shown as returned, or the whole answer is refused.
//
// WHO OWNS THE VALUES BELOW: GEO. Ids, labels and sentences follow GEO's page (assets/app-perfect-city.js, 2026-11-27) and "GEO TO CONNECT" (MAILBOX 08:26); GEO changes this file (or tells CONNECT to) in the same step as the page.
// tests/connect-perfect-city.test.mjs pins the page path against assets/app-departments.js so a move of the page cannot go unnoticed.
//
// THE GATE: the per-account switch `perfectCity` (account_settings.switches_on, read through World.switches(), the token-checked twin of my_switches()), and ONLY that: GEO's page and GEO's helper treat the switch as the one key (a server 'working' row without it stays
// Coming soon), so the tools do the same. Off = every tool refuses in words and says it is owner-only for now. A read that fails is "off" (never a half-open department).
import { untrusted } from "../ai-editor/prompt.ts";
import { textOk } from "./edit_state.ts";
import { LIMITS, type ToolCtx, type ToolDef, type ToolResult } from "./types.ts";

export const PERFECT_CITY_SWITCH = "perfectCity";
export const PERFECT_CITY_DEPARTMENT = "geo_intelligence";
/** The site's own address for a department page (assets/app-departments.js pathOf); a test compares it with the site's code. */
export const PERFECT_CITY_PAGE = "#/d/geo_intelligence";
export const PERFECT_CITY_ANNOUNCED = "As announced by GEO on 2026-11-27 (L-Ai branch geo-perfect-city-1127; GEO's page words); GEO owns these values and will confirm them.";
export const PERFECT_CITY_SUMMARY_SCHEMA = "ryagram.perfect-city-summary/0";

export type Basis = "observed" | "calculated" | "estimated";
export interface PcPlace { id: string; label: string; note: string; business_types: readonly string[] }
export interface PcBusinessType { id: string; label: string }
export interface PcLayer { id: string; label: string; basis: Basis; source: string; note: string }
export interface PcMeasure { id: string; label: string; basis: Basis; note: string }

/** The kinds of business the first path can look at: the ids are the database's (fast_food, restaurant, grocery), the labels are the page's. */
export const PC_BUSINESS_TYPES: readonly PcBusinessType[] = Object.freeze([
  { id: "fast_food", label: "Fast food" },
  { id: "restaurant", label: "Restaurants" },
  { id: "chicken", label: "Chicken places" },      // chicken, burger, pizza: GEO's page and database (migration 20261127000900) list them too
  { id: "burger", label: "Burger places" },
  { id: "pizza", label: "Pizza places" },
  { id: "grocery", label: "Supermarkets" },
]);
/** The places the first path covers: counties, because that is the geography the data covers today. A county is not a city; the page says so. Supermarkets are in Montgomery County only. */
export const PC_PLACES: readonly PcPlace[] = Object.freeze([
  { id: "montgomery_oh", label: "Montgomery County, Ohio (Dayton)", note: "The whole county, which includes Dayton.", business_types: Object.freeze(["fast_food", "restaurant", "chicken", "burger", "pizza", "grocery"]) },
  { id: "greene_oh", label: "Greene County, Ohio (Beavercreek, Xenia)", note: "The whole county, which includes Beavercreek and Xenia.", business_types: Object.freeze(["fast_food", "restaurant", "chicken", "burger", "pizza"]) },
]);
/** What the page draws, and the word each is labelled with. */
export const PC_LAYERS: readonly PcLayer[] = Object.freeze([
  { id: "population", label: "People who live in each small area (a Census block group)", basis: "observed", source: "U.S. Census Bureau, 2020 Census (public domain)", note: "A count made by the Census." },
  { id: "population_density", label: "People per square kilometre in each small area", basis: "calculated", source: "The Census count divided by the area of the boundary, worked out by Ryagram", note: "Worked out, not counted." },
  { id: "median_household_income", label: "Median household income in each small area", basis: "estimated", source: "U.S. Census Bureau, American Community Survey, 5-year (public domain)", note: "A survey estimate with a margin of error, for the whole block group. Some small areas have none." },
]);
/** What the page works out from the spot the person clicks, in rings. */
export const PC_RINGS_KM: readonly number[] = Object.freeze([1, 2, 5]);
export const PC_MEASURES: readonly PcMeasure[] = Object.freeze([
  { id: "nearest_distance", label: "Straight-line distance from the spot to the nearest similar places", basis: "calculated", note: "Straight line only, not a drive or a walk. The nearest five, within 5 km." },
  { id: "businesses_within_rings", label: "How many similar places lie within 1, 2 and 5 kilometres of the spot", basis: "calculated", note: "Worked out from the mapped points, which come from OpenStreetMap volunteers." },
  { id: "people_within_rings", label: "About how many people live within 1, 2 and 5 kilometres of the spot", basis: "estimated", note: "An estimate: on the page each block group's people are shared by the part of its area inside the ring. perfect_city_summary gives the 5 km figure only." },
]);
/** What the department does NOT know or do: GEO's page sentences, word for word. The AI must say these when it describes the department. */
export const PC_NOT_KNOWN: readonly string[] = Object.freeze([
  "Distances are straight lines, not drive or walk times.",
  "The business points come from OpenStreetMap, made by volunteers: a place can be missing, closed or out of date.",
  "People within a ring are an estimate: each block group's people are shared by the part of its area inside the ring, as if they were spread evenly.",
  "Median income is a survey estimate with a margin of error, for the whole block group.",
  "There is no success score and no prediction. This shows what is there, not whether a business would do well.",
  "The map shows the places near your spot only: within 5 km, and the nearest five.",
]);

/** The words a person's AI gets when the switch is off. The switch is owner-only for now: say that, never pretend the department does not exist. */
export const PC_OFF_WORDS = "Perfect City is not switched on for this Ryagram account. It is being tried by the account owner first (an owner-only switch), so it is not open to other accounts yet. Nothing was looked up.";

const refuse = (text: string, code: string, extra: Partial<ToolResult> = {}): ToolResult => ({ text, isError: true, code, ...extra });
const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data });
const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const ID = "^[a-z][a-z0-9_]{1,30}$";
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && textOk(v, max) ? v : null);

type Gate = { on: true } | { on: false; result: ToolResult };
/** Is Perfect City on for the connected person? Fails closed: a switch list that cannot be read is "not available just now", never "on". The switch is the only key. */
export async function perfectCityGate(ctx: ToolCtx): Promise<Gate> {
  let switches: string[] | null = null;
  try { const s = await ctx.data.switches(); switches = Array.isArray(s) ? s : null; } catch { switches = null; }
  if (switches === null) return { on: false, result: refuse("Whether Perfect City is on for this account could not be read just now, so nothing was looked up. Try again in a minute.", "unavailable", { data: { ok: false, available: false, switch: PERFECT_CITY_SWITCH } }) };
  if (switches.includes(PERFECT_CITY_SWITCH)) return { on: true };
  return { on: false, result: refuse(PC_OFF_WORDS, "not_available", { data: { ok: false, switch: PERFECT_CITY_SWITCH, on: false, owner_only: true, looked_up: false } }) };
}

/** The options as data: only values GEO announced, each with its basis word. Contains no number about any place. */
export function perfectCityOptions() {
  return {
    department: { id: PERFECT_CITY_DEPARTMENT, label: "Perfect City", switch: PERFECT_CITY_SWITCH },
    status: PERFECT_CITY_ANNOUNCED,
    places: PC_PLACES.map((p) => ({ ...p, business_types: [...p.business_types] })),
    business_types: PC_BUSINESS_TYPES.map((b) => ({ ...b })),
    layers: PC_LAYERS.map((l) => ({ ...l })),
    rings_km: [...PC_RINGS_KM],
    measures: PC_MEASURES.map((m) => ({ ...m })),
    not_known: [...PC_NOT_KNOWN],
    basis_words: ["observed", "calculated", "estimated"],
    page: PERFECT_CITY_PAGE,
    numbers_tool: "perfect_city_summary",
    shows_numbers_here: false,
  };
}

const placeLine = (p: PcPlace) => `${p.label} (${p.id}): ${p.business_types.map((t) => PC_BUSINESS_TYPES.find((b) => b.id === t)!.label).join(", ")}`;
const optionsText = () => [
  "Perfect City is on for this account. This answer works out nothing: the person sees the numbers on the Ryagram page, and every number there is labelled observed, calculated or estimated.",
  "Places, and the kinds of business each covers (the names in brackets are the ids the tools take):",
  ...PC_PLACES.map((p) => `  - ${placeLine(p)}`),
  `Kinds of business: ${PC_BUSINESS_TYPES.map((b) => `${b.label} (${b.id})`).join("; ")}.`,
  "On the page the person picks a place and a kind of business, then puts a spot on the map. They see:",
  ...PC_LAYERS.map((l) => `  - ${l.label} (${l.basis}; ${l.source}).`),
  ...PC_MEASURES.map((m) => `  - ${m.label} (${m.basis}). ${m.note}`),
  "To read the numbers for one spot the person names (a latitude and longitude), use perfect_city_summary.",
  "What it does not know or do:",
  ...PC_NOT_KNOWN.map((n) => `  - ${n}`),
  `${PERFECT_CITY_ANNOUNCED} Do not say more than this about what the page shows, and never give a number for a place that did not come from perfect_city_summary.`,
].join("\n");

const pick = <T extends { id: string }>(list: readonly T[], v: unknown): T | null | undefined =>
  v === undefined ? undefined : (typeof v === "string" ? (list.find((x) => x.id === v) ?? null) : null);
const choices = () => `Places: ${PC_PLACES.map((p) => `${p.id} (${p.label})`).join("; ")}. Kinds of business: ${PC_BUSINESS_TYPES.map((b) => `${b.id} (${b.label})`).join("; ")}. Supermarkets (grocery) are covered in montgomery_oh only.`;

// ---------------------------------------------------------------------------------------------- the numbers for one spot
// THE SHAPE IS GEO'S REAL ONE (migration 20261127000900, ryagram_private.perfect_city_summary_for, branch geo-perfect-city-1127 a2abdeb1, checked by CONNECT 11-27 09:00):
//   places_loaded {count, basis:'calculated'}; nearest [{rank, km, basis}] (NO business name: attorney row G11); rings [{km, places:{count, basis}, people_about:{value, basis:'estimated', method}}] where the 1 km and 2 km rings
//   carry people_about {value:null, basis:'estimated', note} (people are given at 5 km only). A name is still accepted when one is sent (fenced, cut), but none is needed.
interface Ring { km: number; places: number; people: number | null; method: string | null; note: string | null }
interface Near { rank: number; name: string | null; km: number }
interface Summary { lat: number; lon: number; placesLoaded: number; nearest: Near[]; rings: Ring[]; notKnown: string[]; credits: string[] }
const BASIS_PLACES = "calculated", BASIS_PEOPLE = "estimated";
/** A place's name (only if the database sends one) comes from OpenStreetMap volunteers: untrusted text, at most 80 characters, and never a reason to refuse the numbers. null = no name sent. */
function nameOf(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.trim() === "") return "(no name in the map data)";
  const cut = v.trim().slice(0, 80);
  return textOk(cut, 80) ? cut : "(name not shown)";
}
/** null = not an answer this connection will show. Every number must carry the basis word the rules give it, and nothing is rounded, ranked or scored here. */
export function readPerfectCitySummary(doc: unknown, place: string, kind: string): Summary | null {
  if (!isObj(doc) || doc.schema !== PERFECT_CITY_SUMMARY_SCHEMA || doc.place !== place || doc.business_type !== kind) return null;
  const spot = doc.spot;
  if (!isObj(spot)) return null;
  const lat = num(spot.lat), lon = num(spot.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (!isObj(doc.places_loaded) || doc.places_loaded.basis !== BASIS_PLACES) return null;
  const loaded = num(doc.places_loaded.count);
  if (loaded === null || !Number.isInteger(loaded) || loaded < 0 || loaded > 1e7) return null;
  if (!Array.isArray(doc.nearest) || doc.nearest.length > 5 || !Array.isArray(doc.rings) || doc.rings.length !== PC_RINGS_KM.length) return null;
  const nearest: Near[] = [];
  let prev = 0;
  for (const [i, n] of doc.nearest.entries()) {
    if (!isObj(n) || n.basis !== "calculated") return null;
    const km = num(n.km);
    if (km === null || km < prev || km > 1000) return null;                   // sorted, nearest first: a list that is not is not one this connection vouches for
    if (n.rank !== undefined && n.rank !== i + 1) return null;                // a rank, when the database gives one, is the place in that list
    prev = km;
    nearest.push({ rank: i + 1, name: nameOf(n.name), km });
  }
  const rings: Ring[] = [];
  for (const [i, r] of doc.rings.entries()) {
    if (!isObj(r) || r.km !== PC_RINGS_KM[i] || !isObj(r.places) || !isObj(r.people_about)) return null;
    if (r.places.basis !== BASIS_PLACES || r.people_about.basis !== BASIS_PEOPLE) return null;
    const places = num(r.places.count), pv = r.people_about.value;
    if (places === null || !Number.isInteger(places) || places < 0 || places > 1e7) return null;
    if (pv === null) {                                                         // people are given at 5 km only: a ring without a figure must say why, in the database's own words
      const note = str(r.people_about.note, 600);
      if (note === null) return null;
      rings.push({ km: r.km as number, places, people: null, method: null, note });
      continue;
    }
    const people = num(pv), method = str(r.people_about.method, 600);
    if (people === null || people < 0 || people > 1e10 || method === null) return null;
    rings.push({ km: r.km as number, places, people, method, note: null });
  }
  const words = (v: unknown, atLeast: number): string[] | null => {
    if (!Array.isArray(v) || v.length < atLeast || v.length > 12) return null;
    const out: string[] = [];
    for (const x of v) { const t = str(x, 600); if (t === null) return null; out.push(t); }
    return out;
  };
  const notKnown = words(doc.not_known, 1), credits = words(doc.credits, 1);   // an answer without its not-known sentences or its credits is not shown at all
  if (!notKnown || !credits) return null;
  if (loaded === 0 && (nearest.length > 0 || rings.some((r) => r.places > 0))) return null;   // no places loaded cannot have a nearest place or a count
  return { lat, lon, placesLoaded: loaded, nearest, rings, notKnown, credits };
}

export function makePerfectCityTools(friendlyError: (e: unknown) => string): ToolDef[] {
  const listPerfectCityOptions: ToolDef = {
    name: "list_perfect_city_options", title: "What Perfect City can look at today", scope: "read", readOnly: true, idempotent: true,
    description: "Perfect City is Ryagram's map for checking a place for a kind of business with free public data. This lists what it supports today: the places, the kinds of business each covers, what the page shows for each spot the person puts on the map (people, people per square kilometre, income, "
      + "distances to similar businesses) with the word each number carries (observed, calculated or estimated), and what it does not know. It reads no place and gives no numbers about any place (perfect_city_summary does that for one spot). Read-only: it changes nothing and spends no credits. "
      + "It only works for an account that has Perfect City switched on, and says so plainly when it is not.",
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
      + "The map is on the Ryagram page; for the numbers at one spot use perfect_city_summary. Read-only: it changes nothing and spends no credits. It only works for an account that has Perfect City switched on, and says so plainly when it is not.",
    inputSchema: obj({
      place: { type: "string", pattern: ID, description: "Optional: a place id from list_perfect_city_options." },
      business_type: { type: "string", pattern: ID, description: "Optional: a kind-of-business id from list_perfect_city_options." },
    }),
    async run(a, ctx) {
      const g = await perfectCityGate(ctx);
      if (!g.on) return g.result;
      const place = pick(PC_PLACES, a.place), biz = pick(PC_BUSINESS_TYPES, a.business_type);
      const allowed = Object.keys(a).every((k) => k === "place" || k === "business_type");
      const covered = !place || !biz || place.business_types.includes(biz.id);
      if (!allowed || place === null || biz === null || !covered) {
        return refuse(`That place or kind of business is not one Perfect City covers today${covered ? "" : " (that kind of business is not covered in that place)"}. ${choices()} Nothing was opened or looked up.`, "args",
          { data: { ok: false, places: PC_PLACES.map((p) => p.id), business_types: PC_BUSINESS_TYPES.map((b) => b.id) } });
      }
      const steps = [
        "Open Perfect City in the top bar of the Ryagram website (the page is " + PERFECT_CITY_PAGE + "). The person has to be signed in.",
        `Pick the place${place ? `: ${place.label}` : ""}.`,
        `Pick the kind of business${biz ? `: ${biz.label}` : ""}.`,
        "Click the map to put a spot on it. The page then shows the people, the people per square kilometre and the income around it, the distances to the nearest similar places, and how many lie within 1, 2 and 5 kilometres. Every number is labelled observed, calculated or estimated.",
      ];
      return ok([`Perfect City is a page on the Ryagram website. Tell the person:`, ...steps.map((s, i) => `${i + 1}. ${s}`),
        "What it does not know:", ...PC_NOT_KNOWN.map((n) => `  - ${n}`), PERFECT_CITY_ANNOUNCED].join("\n"),
      { ok: true, page: PERFECT_CITY_PAGE, place: place ? place.id : null, business_type: biz ? biz.id : null, steps, not_known: [...PC_NOT_KNOWN], shows_numbers_here: false, chosen_for_the_person: false });
    },
  };

  const perfectCitySummary: ToolDef = {
    name: "perfect_city_summary", title: "The Perfect City numbers for one spot", scope: "read", readOnly: true, idempotent: true,
    description: "Reads the Perfect City numbers for ONE spot the person gives (a latitude and longitude) in one place and for one kind of business, from Ryagram's own data: the nearest similar places with their straight-line distance, how many lie within 1, 2 and 5 kilometres, "
      + "and about how many people live within 5 kilometres (the smaller rings give no people figure here). The nearest places come with their distance and rank, not their names. Every number comes back labelled calculated or estimated, with the method, what it does not know and where the data comes from, all of which belong with the numbers when the person is told. It gives no score, no ranking and no view on whether a business would do well. "
      + "If the business points are not loaded yet it says so and gives no distance or count of businesses. Use list_perfect_city_options for the place and kind ids. Read-only: it changes nothing and spends no credits. It only works for an account that has Perfect City switched on, and says so plainly when it is not.",
    inputSchema: obj({
      place: { type: "string", pattern: ID, description: "A place id from list_perfect_city_options." },
      business_type: { type: "string", pattern: ID, description: "A kind-of-business id from list_perfect_city_options (supermarkets only in montgomery_oh)." },
      lat: { type: "number", minimum: -90, maximum: 90, description: "Latitude of the spot, in degrees." },
      lon: { type: "number", minimum: -180, maximum: 180, description: "Longitude of the spot, in degrees (west is negative)." },
    }, ["place", "business_type", "lat", "lon"]),
    async run(a, ctx) {
      const g = await perfectCityGate(ctx);
      if (!g.on) return g.result;
      const place = pick(PC_PLACES, a.place), biz = pick(PC_BUSINESS_TYPES, a.business_type);
      const lat = num(a.lat), lon = num(a.lon);
      const allowed = Object.keys(a).every((k) => k === "place" || k === "business_type" || k === "lat" || k === "lon");
      if (!allowed || !place || !biz || lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return refuse(`Give a place and a kind of business from the options, and a latitude from -90 to 90 and a longitude from -180 to 180. ${choices()} Nothing was looked up.`, "args",
          { data: { ok: false, looked_up: false, places: PC_PLACES.map((p) => p.id), business_types: PC_BUSINESS_TYPES.map((b) => b.id) } });
      }
      if (!place.business_types.includes(biz.id)) {
        return refuse(`${biz.label} (${biz.id}) is not covered in ${place.label} (${place.id}) today. ${choices()} Nothing was looked up.`, "args", { data: { ok: false, looked_up: false } });
      }
      const unavailable = (why = "Perfect City numbers are not available just now.") => refuse(`${why} Nothing was looked up.`, "not_available", { data: { ok: false, looked_up: false } });
      if (!ctx.data.perfectCitySummary) return unavailable();
      if (!(await ctx.policy.hit(ctx.principal, "perfect_city", LIMITS.perfectCitySummariesPerHourPerUser, 3600))) {
        return refuse(`The limit of ${LIMITS.perfectCitySummariesPerHourPerUser} Perfect City checks an hour is reached. Nothing was looked up.`, "rate", { data: { ok: false, looked_up: false, retry_after_seconds: 3600 } });
      }
      let doc: unknown;
      try { doc = await ctx.data.perfectCitySummary({ county: place.id, kind: biz.id, lat, lon }); }
      catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "unavailable") return unavailable();                                         // the database has no such function yet (migration not applied): none of the database's text is passed on
        if (code === "PT503" || code === "42501") return unavailable(friendlyError(e));           // 'not available yet' / the account's switch is off in the database: its own plain sentence
        if (code === "54000") return refuse("Perfect City has answered all it gives this account for today. Do not ask again today; tell the person to try tomorrow. Nothing was looked up.", "rate", { data: { ok: false, looked_up: false, retry_after_seconds: 86400 } });   // GEO's per-account daily cap (300 with the switch): the database's number is not repeated
        if (code === "22023") return refuse(friendlyError(e) + " Nothing was looked up.", "args", { data: { ok: false, looked_up: false } });   // an unknown place or kind, a spot outside the county
        throw e;
      }
      const s = readPerfectCitySummary(doc, place.id, biz.id);
      if (!s) return refuse("The answer was not in a shape this connection knows (a number without its basis word, a missing not-known list or credit, or a nearest place out of order), so none of it is shown.", "bad_report");
      const out: string[] = [
        "Perfect City numbers for one spot. Counts and distances only: no score, no ranking, no view on whether a business would do well.",
        `Place: ${place.label}. Kind of business: ${biz.label}. Spot: ${s.lat}, ${s.lon} (as the database rounded it).`,
      ];
      if (s.placesLoaded === 0) {
        out.push("The businesses for this place and kind are not loaded yet, so there is no distance and no count of businesses. The people numbers below do not depend on them.");
      } else {
        out.push(`Places of this kind loaded for ${place.label}: ${s.placesLoaded}.`);
        out.push(s.nearest.length ? "Nearest similar places (straight line, calculated):" : "No nearest places came back for this spot.");
        s.nearest.forEach((n) => out.push(`  ${n.rank}. ${n.name === null ? "" : untrusted("place-name", n.name) + ": "}${n.km} km`));
      }
      out.push("Within each ring around the spot:");
      for (const r of s.rings) out.push(`  ${r.km} km: ${s.placesLoaded === 0 ? "businesses not loaded" : `${r.places} similar places (calculated)`}; ${r.people === null ? `people not given for this ring (${untrusted("report-sentence", r.note ?? "")})` : `about ${r.people} people (estimated)`}`);
      for (const m of [...new Set(s.rings.map((r) => r.method).filter((m): m is string => m !== null))]) out.push(`How the people are estimated: ${untrusted("report-sentence", m)}`);
      out.push("What this does not know:", ...s.notKnown.map((n) => `  - ${untrusted("report-sentence", n)}`));
      out.push("Where the data comes from:", ...s.credits.map((c) => `  - ${untrusted("report-sentence", c)}`));
      out.push("Tell the person each number with its word (calculated or estimated), the method, and what is not known. Do not add a score, a ranking or advice about where to open.");
      return ok(out.join("\n"), {
        ok: true, looked_up: true, place: place.id, business_type: biz.id, spot: { lat: s.lat, lon: s.lon }, places_loaded: s.placesLoaded, businesses_loaded: s.placesLoaded > 0,
        nearest: s.placesLoaded > 0 ? s.nearest.map((n) => ({ rank: n.rank, ...(n.name === null ? {} : { name: n.name }), km: n.km, basis: "calculated" })) : [], names_are_untrusted_text: true,
        rings: s.rings.map((r) => ({ km: r.km, places: s.placesLoaded > 0 ? { value: r.places, basis: "calculated" } : null,
          people_about: r.people === null ? { value: null, basis: "estimated", note: r.note } : { value: r.people, basis: "estimated", method: r.method } })),
        not_known: s.notKnown, credits: s.credits, score_given: false, ranking_given: false,
      });
    },
  };

  return [listPerfectCityOptions, openPerfectCity, perfectCitySummary];
}
