// The guided builder's back end: a film request in, a valid worker story out.
//
//   compileFilm({ dataset, film_type, title, measure?, years?, subtitle?, look? })  ->  { story, report }
//
// SERVER ONLY, for Ryagram's AI and CONNECT's connect_* wrappers: searchCatalog and describeDataset serve the
// server-side caller, and nothing in assets/ may import this file (tests/film-compile.test.mjs checks). RULINGS
// 2026-10-17 lets the guided builder list datasets to signed-in, invited users with source and licence shown; that
// listing is WEB's front end and is built on the public catalog, not on this module.
//
// What it does, in order, refusing with EVERY reason it finds rather than the first:
//   1. the request has a closed set of keys, each bounded;
//   2. the dataset is in the catalog and usable on the installed worker; the film type, measure and years are
//      ones that dataset supports (years inside its coverage, in its own period format);
//   3. it assembles a story (a title card and one data view; sources and licence recorded in the story notes);
//   4. it applies the person's look through the SAME profile compiler and look-only diff guard as profiles
//      (profile.ts), so a look can change colours, theme and pacing and nothing else;
//   5. it checks the story against the worker's own schema (vendored in catalog_data.ts) before returning it.
// The worker re-validates every job; its check is authoritative and every render check still runs.
//
// What it will NOT do, and says so: choose a subset of places (the story format has no place filter; bar and
// line views choose the top N by value), hold or hide a gap, or touch the scale. The engine owns those.
import { CATALOG, STORY_SCHEMA } from "./catalog_data.ts";
import { applyProfile, ProfileError, validateProfile } from "./profile.ts";
import { checkAgainst } from "./schema_check.ts";

type Json = any;

export class FilmError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.slice(0, 5).join("; "));
    this.errors = errors;
  }
}

const REQUEST_KEYS = ["dataset", "film_type", "title", "subtitle", "measure", "places", "years", "look"];
export const FILM_TYPES = ["map", "bars", "line", "paired"];

// Control, invisible and bidi characters: refused (an AI caller should know), never silently removed.
// Built from code points so this source stays plain ASCII (tests/source-hygiene.test.cjs).
function charClass(ranges: [number, number][]): RegExp {
  return new RegExp("[" + ranges.map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "]");
}
const BAD_TEXT = charClass([[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x202a, 0x202e],
                            [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb]]);
const SLUG_STRIP = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

export function slug(text: string): string {
  const s = String(text ?? "").normalize("NFKD").replace(SLUG_STRIP, "").replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/, "");
  return s || "ryagram-film";
}

/** Who is asking. A caller acting for a PERSON (CONNECT, the guided builder, Ryagram's AI) sees only entries that may be
 *  listed (RULINGS 2026-10-17): a personal, local, ingested or non-public-licence dataset is not merely hidden from a
 *  list, it does not exist to that caller (search, describe and compile all answer "not in the catalog"). 'system' is for
 *  internal tooling and tests and must be asked for by name. The default is the safe one. */
export type Audience = "person" | "system";
const visible = (e: Json, audience: Audience = "person") => audience === "system" || e.listable === true;
const byId = (cat: Json[], audience: Audience = "person") => new Map(cat.filter((e) => visible(e, audience)).map((e) => [e.id as string, e]));

/** What a server-side caller can say about a dataset. Not a user-facing list. */
export function describeDataset(id: string, opts: { audience?: Audience } = {}, catalog: Json[] = CATALOG): Json | null {
  const e = byId(catalog, opts.audience).get(id);
  if (!e) return null;
  return {
    id: e.id, title: e.title, status: e.status, listable: e.listable, listable_class: e.listable_class, publisher: e.publisher,
    source_line: e.source_line, url: e.url, licence: e.licence, licence_short: e.licence_short,
    geography: e.geography, period: e.period, default_window: e.window,
    measures: e.measures.map((m: Json) => ({ id: m.id, label: m.label, unit: m.unit, selectable: m.story_measure !== null })),
    film_types: e.film_types, known_gaps: e.known_gaps, methodology_breaks: e.methodology_breaks,
    missing_is_ambiguous: e.missing_is_ambiguous,
  };
}

/** Datasets whose id, title or measure contains every word of the query; usable ones first. For a person (the default)
 *  only entries RULINGS 2026-10-17 lets them see (catalog_rules.ts). */
export function searchCatalog(query: string, opts: { usableOnly?: boolean; limit?: number; audience?: Audience } = {}, catalog: Json[] = CATALOG): Json[] {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const rank = { usable: 0, next: 1, later: 2 } as Record<string, number>;
  return catalog
    .filter((e) => (!opts.usableOnly || e.status === "usable"))
    .filter((e) => visible(e, opts.audience))
    .filter((e) => {
      const hay = `${e.id} ${e.title} ${e.measures.map((m: Json) => m.label).join(" ")} ${e.topic}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.title.localeCompare(b.title))
    .slice(0, Math.min(Math.max(opts.limit ?? 10, 1), 25))
    .map((e) => ({ id: e.id, title: e.title, status: e.status, film_types: e.film_types, period: e.period }));
}

/** "Today" for the one open-ended question (what is the latest period a series could hold). A date string or a Date; the
 *  default is the real clock, a test passes its own so the answer does not move. */
export type Today = string | Date;

function todayDate(t?: Today): Date {
  const d = t instanceof Date ? t : t ? new Date(`${String(t).slice(0, 10)}T00:00:00Z`) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** How long after a period ENDS its figures are typically PUBLISHED, in days. An assumption, written down here and measured
 *  per dataset later (the registry does not declare a publication lag): state employment series come out about three weeks
 *  after the month ends; annual survey and business-count series months after the year ends. BUILDER's check: on 2026-10-17
 *  BLS state unemployment for 2026-09 is NOT published yet (its release is after the 21st of October). */
export const PUBLICATION_LAG_DAYS: Record<string, number> = { monthly: 21, annual: 270 };

/** The latest period this dataset could possibly hold: its own end, or, for an OPEN-ENDED series (no end in the registry), the
 *  latest period whose figures have been PUBLISHED by today (period end plus the publication lag), not the latest period the
 *  calendar has finished. A request later than that asks for data that does not exist yet. */
export function latestPossible(entry: Json, today?: Today): string {
  if (entry.period.to) return entry.period.to;
  const now = todayDate(today);
  if (entry.period.cadence === "monthly") {
    const lag = PUBLICATION_LAG_DAYS.monthly * 86400000;
    let y = now.getUTCFullYear(), m = now.getUTCMonth();                       // m is 0-based: start from the current month
    for (let i = 0; i < 24; i++) {
      const endOfMonth = Date.UTC(y, m + 1, 0);                                 // last day of month (y, m)
      if (endOfMonth + lag <= now.getTime()) return `${y}-${String(m + 1).padStart(2, "0")}`;
      m -= 1;
      if (m < 0) { m = 11; y -= 1; }
    }
    return entry.period.from;
  }
  const lag = PUBLICATION_LAG_DAYS.annual * 86400000;
  for (let y = now.getUTCFullYear(); y > 1900; y--) if (Date.UTC(y, 11, 31) + lag <= now.getTime()) return String(y);
  return entry.period.from;
}

function periodOk(p: string, cadence: string): boolean {
  return cadence === "monthly" ? /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(p) : /^[0-9]{4}$/.test(p);
}

// Compare two period strings of possibly different lengths at the shorter one's precision ("2025" against "2025-10").
function cmp(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  const x = a.slice(0, n), y = b.slice(0, n);
  return x < y ? -1 : x > y ? 1 : 0;
}

function resolveYears(entry: Json, years: Json, today: Today | undefined, errs: string[], warnings: string[]): [string, string] | null {
  const cad = entry.period.cadence;
  const lo = entry.period.from, last = latestPossible(entry, today);
  const def = entry.window ?? [lo, last];
  const raw = { start: years?.start ?? null, end: years?.end ?? null };
  const given: { start: string | null; end: string | null } = { start: null, end: null };
  for (const which of ["start", "end"] as const) {
    let v = raw[which];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v !== "string" && typeof v !== "number") { errs.push(`years.${which}: expected a year or month as text`); continue; }
    v = String(v);
    // A year is accepted for a monthly series: it means that year's first (start) or last (end) month.
    if (cad === "monthly" && /^[0-9]{4}$/.test(v)) v = which === "start" ? `${v}-01` : `${v}-12`;
    if (!periodOk(v, cad)) {
      errs.push(`years.${which}: '${v}' is not a ${cad === "monthly" ? "month like 2019-06 (or a year like 2019)" : "year like 2019"}; this dataset is ${cad || "annual"}`);
      continue;
    }
    if (v < lo) errs.push(`years.${which}: ${v} is before this dataset's coverage, which starts ${lo}`);
    else if (v > last) {
      errs.push(entry.period.to
        ? `years.${which}: ${v} is outside this dataset's coverage, ${lo} to ${entry.period.to}`
        : `years.${which}: ${v} is later than this series can hold: it is open-ended, and the latest PUBLISHED period is ${last} (a period's figures come out some weeks after it ends)`);
    }
    given[which] = v;
  }
  // Neither end given: the catalog's known-good window. ONE end given: the other end is the dataset's own edge (a start-only request
  // runs to the latest published period; an end-only request starts at coverage), never the known-good window's far end.
  const start = given.start ?? (given.end !== null ? lo : def[0]);
  const end = given.end ?? (given.start !== null ? last : def[1]);
  if (cmp(start, end) > 0) errs.push(`years: start ${start} is after end ${end}`);
  // Periods the source did not collect (known_gaps). A film may not START or END on one; one inside is said out loud.
  for (const [g, why] of Object.entries(entry.known_gaps ?? {}) as [string, string][]) {
    if (cmp(start, g) === 0 || cmp(end, g) === 0) errs.push(`years: ${g} was not published by the source (${why}); a film cannot start or end on it`);
    else if (cmp(start, g) < 0 && cmp(g, end) < 0) warnings.push(`the window contains ${g}, which the source did not publish (${why}); the film shows the gap, it does not fill it`);
  }
  return [start, end];
}

// A methodology break's `period` is a point ("2012", "2012-03": the change happens there) or a span ("1994-2024": the
// note applies across it). Compared as such: a span against a point would compare strings of different kinds.
function breakSpan(p: string): { from: number; to: number; point: boolean; at: string } {
  const r = /^(\d{4})-(\d{4})$/.exec(p);
  if (r) return { from: Number(r[1]), to: Number(r[2]), point: false, at: p };
  return { from: Number(p.slice(0, 4)), to: Number(p.slice(0, 4)), point: true, at: p };
}

function breaksInside(entry: Json, start: string, end: string): Json[] {
  const y0 = Number(start.slice(0, 4)), y1 = Number(end.slice(0, 4));
  return entry.methodology_breaks.filter((b: Json) => {
    const s = breakSpan(String(b.period));
    if (!s.point) return s.from <= y1 && s.to >= y0;                      // a span that overlaps the window
    const p = String(b.period);
    return cmp(p, start) > 0 && cmp(p, end) <= 0;                         // a change that happens inside it
  });
}

const NOTES_MAX = 4000;
const LICENCE_MAX = 1500;

/** The story's `notes`: one line (the worker refuses newlines). ORDER MATTERS because the 4000-character cap cuts from the
 *  END: dataset, source and LICENCE come first and are never cut (a long licence is shortened, with a pointer, not dropped);
 *  then the method changes inside the window; then gaps; then the measure; the engine's long method notes come LAST and are
 *  the first thing to be shortened. */
function buildNotes(entry: Json, window: [string, string], measure: Json | null, breaks: Json[], gaps: string[]): string {
  const licence = String(entry.licence).length > LICENCE_MAX
    ? `${String(entry.licence).slice(0, LICENCE_MAX - 40).trimEnd()}... (full terms at the source)` : String(entry.licence);
  const required = [
    `Dataset: ${entry.title} (${entry.id}). ${window[0]} to ${window[1]}.`,
    `Source: ${entry.publisher}${entry.url ? `, ${entry.url}` : ""}.`,
    `Licence: ${licence}`,
  ];
  const optional = [
    ...breaks.map((b) => `Method change at ${b.period}: ${b.what} ${b.effect}`.trim()),
    ...gaps,
    measure ? `Measure: ${measure.label}${measure.unit ? ` (${measure.unit})` : ""}.` : "",
    entry.missing_is_ambiguous ? "In this source a missing value is ambiguous: it does not say whether it is zero or withheld." : "",
    entry.notes ? `Method notes: ${entry.notes}` : "",
  ].filter(Boolean) as string[];
  let text = required.join(" ");
  for (const part of optional) {
    const next = `${text} ${part}`;
    if (next.length <= NOTES_MAX) { text = next; continue; }
    const room = NOTES_MAX - text.length - 1;
    if (room > 60) text = `${text} ${part.slice(0, room - 3).trimEnd()}...`;
    break;
  }
  return text.slice(0, NOTES_MAX);
}

export type FilmReport = {
  dataset: { id: string; title: string; publisher: string; url: string; licence_short: string };
  film_type: string;
  window: { start: string; end: string };
  measure: { id: string; label: string; unit: string } | null;
  method_notes: string[];
  gaps: Json;
  warnings: string[];
  look: { applied: boolean; changed: string[]; not_applied: string[]; converted: string[] };
};

// What a person is told, in this sentence, whenever their look is shown differently from how it is written: surfaced in the compile
// result (warnings and look.converted) so the looks page and the contact sheet can show it BEFORE a credit is spent.
export const COUNTY_CONTINUOUS_NOTICE = "Your look uses solid colours; on a county map they are shown as a continuous ramp, not as a few bands, because counties are too small to class into bands and a banded county map does not visibly move.";

// A look that holds each year longer than this on a county map is mostly shortened by pacing (measured, see compileFilm).
export const COUNTY_SLOW_HOLD_ABOVE = 1;
export const countySlowPacingNotice = (hold: number) => `On a county map this look's slow pacing (${hold} s per year) is mostly shortened so the film visibly moves: years where little changes are shown for about 0.4 s. The numbers and years are unchanged.`;

// Under the MOTION GATE (RULINGS 5b16d78) a dataset that is not usable is one of two things, and the person is told which, in the
// words the catalog page uses (WEB, catalog-usable 1792f7b: "Not checked yet" / "Not available yet"):
//   next  = Ryagram has not yet checked that a film from this data moves smoothly (it is not measured), so you cannot make one yet;
//   later = Ryagram cannot make a film from this data yet. 'later' means EITHER not set up on the worker at all (17 datasets today) OR
//           measured and failed the motion check; the catalog does not say which, so the sentence says both.
export const NOT_USABLE_WHY = {
  next: "Ryagram has not yet checked that a film from this data moves smoothly, so you cannot make one yet.",
  later: "Ryagram cannot make a film from this data yet: it has not been set up, or a film from it did not pass Ryagram's checks.",
  // the catalog's status_why says which, so each sentence can be TRUE (gen-catalog: failed-checks vs not-set-up):
  "failed-checks": "A film from this data did not pass Ryagram's checks yet, so you cannot make one yet.",
  "not-set-up": "Ryagram has not set up this dataset yet, so you cannot make a film from it yet.",
} as Record<string, string>;

export function compileFilm(req: Json, opts: { catalog?: Json[]; storySchema?: Json; audience?: Audience; today?: Today } = {}): { story: Json; report: FilmReport } {
  const catalog = opts.catalog ?? CATALOG, schema = opts.storySchema ?? STORY_SCHEMA;
  const errs: string[] = [];
  const warnings: string[] = [];
  if (req === null || typeof req !== "object" || Array.isArray(req)) throw new FilmError(["the request must be an object"]);
  for (const k of Object.keys(req)) if (!REQUEST_KEYS.includes(k)) errs.push(`request: unknown key '${k.slice(0, 40)}' (accepted: ${REQUEST_KEYS.join(", ")})`);

  // ---- text
  const text = (key: string, max: number, required: boolean): string => {
    const v = req[key];
    if (v === undefined || v === null || v === "") { if (required) errs.push(`${key}: required`); return ""; }
    if (typeof v !== "string") { errs.push(`${key}: expected text`); return ""; }
    if (BAD_TEXT.test(v)) { errs.push(`${key}: contains control or invisible characters`); return ""; }
    const t = v.replace(/\s+/g, " ").trim();
    if (!t && required) errs.push(`${key}: must not be blank`);
    const cps = Array.from(t);                       // code points, as the worker counts them (an emoji is one)
    if (cps.length > max) errs.push(`${key}: longer than ${max} characters`);
    return cps.slice(0, max).join("");
  };
  const title = text("title", 160, true);
  const subtitle = text("subtitle", 320, false);

  // ---- dataset and film type
  const entry = typeof req.dataset === "string" ? byId(catalog, opts.audience).get(req.dataset) : undefined;
  if (typeof req.dataset !== "string" || !req.dataset) errs.push("dataset: required (an id from the catalog)");
  else if (!entry) errs.push(`dataset: '${String(req.dataset).slice(0, 64)}' is not in the catalog; use searchCatalog`);
  else if (entry.status !== "usable") {
    errs.push(`dataset: '${entry.id}' is not usable yet. ${NOT_USABLE_WHY[entry.status_why] ?? NOT_USABLE_WHY[entry.status] ?? NOT_USABLE_WHY.later}`);
  }
  if (typeof req.film_type !== "string" || !req.film_type) errs.push(`film_type: required, one of ${FILM_TYPES.join(", ")}`);
  else if (!FILM_TYPES.includes(req.film_type)) errs.push(`film_type: '${req.film_type.slice(0, 30)}' is not one of ${FILM_TYPES.join(", ")}`);
  else if (req.film_type === "paired") {
    // A paired film's story must carry keyframes_per_year MEASURED for that story (Ryan, 2026-09-28: the largest K whose worst
    // per-frame step is at most 14 px). The engine measures it by drawing the film once per candidate (minutes to an hour), so
    // it cannot be chosen here, and a paired story without it passes the worker's schema but is refused by the engine at render
    // (BUILDER's review HIGH-1, shown on state_obesity_fastfood). Refused with that reason rather than compiled to a dead end.
    errs.push("film_type: 'paired' is not offered: a paired film needs keyframes_per_year measured for its own story (Ryan, 2026-09-28), which takes minutes of rendering and cannot be chosen at compile time. Use map, bars or line");
  } else if (entry && !entry.film_types.includes(req.film_type)) errs.push(`film_type: '${req.film_type}' is not offered for ${entry.id}; it offers ${entry.film_types.join(", ") || "none"}`);

  // ---- places: the story format has no place filter, so this says so instead of pretending
  const places = req.places;
  const noPlaces = places === undefined || places === null || places === "all" || (Array.isArray(places) && places.length === 0);
  if (!noPlaces) errs.push("places: choosing a subset of places is not supported: the film shows every place in the dataset (bar and line views show the top N by value). Leave places out.");

  // ---- years, measure
  let window: [string, string] | null = null;
  let measure: Json | null = null;
  if (entry) {
    if (req.years !== undefined && req.years !== null && (typeof req.years !== "object" || Array.isArray(req.years) ||
        Object.keys(req.years).some((k) => !["start", "end"].includes(k)))) errs.push("years: an object with start and/or end");
    else window = resolveYears(entry, req.years ?? null, opts.today, errs, warnings);
    if (req.measure !== undefined && req.measure !== null && req.measure !== "") {
      measure = entry.measures.find((m: Json) => m.id === req.measure) ?? null;
      if (!measure) errs.push(`measure: '${String(req.measure).slice(0, 60)}' is not a measure of ${entry.id}; it has ${entry.measures.map((m: Json) => m.id).join(", ") || "none"}`);
      else if (measure.story_measure === null) {
        errs.push(`measure: '${measure.id}' is shown by the engine but a story cannot choose it; choose one of ${entry.measures.filter((m: Json) => m.story_measure !== null).map((m: Json) => m.id).join(", ") || "none (leave measure out)"}`);
        measure = null;
      }
    }
  }
  if (errs.length || !entry || !window) throw new FilmError(errs);

  // ---- assemble
  const breaks = breaksInside(entry, window[0], window[1]);
  warnings.push(...breaks.map((b) => (breakSpan(String(b.period)).point
    ? `the window crosses a method change at ${b.period}: ${b.what} ${b.effect}`
    : `a method note applies across ${b.period.replace("-", " to ")}, which overlaps the window: ${b.what} ${b.effect}`).trim()));
  const gapNotes = Object.entries(entry.known_gaps ?? {}).filter(([g]) => cmp(window![0], g) < 0 && cmp(g, window![1]) < 0)
    .map(([g, why]) => `Not published by the source: ${g} (${why}); shown as a gap, not filled.`);
  const settings: Json = {};
  if (req.film_type === "bars") Object.assign(settings, { top_n: 10, axis: "fixed" });
  if (req.film_type === "line") settings.line_top_n = 6;
  if (measure) settings.measure = measure.story_measure;
  const render: Json = { kind: "render", id: "main", dataset: entry.id, view: req.film_type, start: window[0], end: window[1],
    transition: { kind: "crossfade", seconds: 0.6 } };
  if (Object.keys(settings).length) render.settings = settings;
  const headMeasure = measure ?? entry.measures.find((m: Json) => m.role === "banded") ?? entry.measures[0] ?? null;
  const subhead = subtitle || (headMeasure ? headMeasure.label : entry.title).slice(0, 320);
  let story: Json = {
    schema: 1,
    name: slug(title),
    engine: "sequence",
    notes: buildNotes(entry, window, headMeasure, breaks, gapNotes),
    sequence: {
      canvas: [1920, 1080], fps: 30, theme: "dark",
      ...(entry.style ? { style_overrides: JSON.parse(JSON.stringify(entry.style)) } : {}),
      clips: [{ kind: "title", id: "open", seconds: 3, fade: 0.4, headline: title, subhead }, render],
    },
  };

  // ---- the look: same compiler and diff guard as profiles
  let look = { applied: false, changed: [] as string[], not_applied: [] as string[], converted: [] as string[] };
  if (req.look !== undefined && req.look !== null) {
    // PARSE AND VALIDATE THE LOOK FIRST (CC1 HIGH-2): a look can arrive as JSON text (the AI path sends profile_json), and every
    // rule below reads its fields, so they must read the validated object, never the raw argument.
    let lookObj: Json;
    try {
      lookObj = validateProfile(req.look);
    } catch (e) {
      if (e instanceof ProfileError) throw new FilmError(e.errors.map((x) => `look: ${x}`));
      throw e;
    }
    // A dataset the engine draws as continuous colour (county areas are too small to hatch) cannot take a hatching look.
    // Found by the render proof (2026-10-18): only bps_county_permits was pinned, so a hatching look on any other county dataset
    // compiled and then failed texture_carrying_capacity (12% of counties cannot carry a pattern). Any county-level geography
    // is refused for hatching, pinned or not. Only a MAP film draws the choropleth; a bar or line film ignores the ramp.
    const countyLevel = ["us_counties", "tx_counties"].includes(entry.geography?.id);
    const mapFilm = req.film_type === "map";
    const ramp = lookObj?.look?.ramp;
    if (mapFilm && (entry.style?.choropleth?.continuous || countyLevel) && ramp?.mode === "hatch") {
      throw new FilmError(["look: this dataset is drawn as continuous colour (its areas are too small to hatch); use a look whose ramp mode is 'solid'"]);
    }
    // A county map asked to be BANDED (continuous: false) is the map the render proof measured failing the 90 percent frame count
    // (29 to 53 percent kept): refused with the reason, like a look that undoes a pinned style (CC1 MED-4).
    if (mapFilm && countyLevel && ramp?.continuous === false) {
      throw new FilmError(["look: a county map is drawn as continuous colour (counties are too small to class into a few bands, and a banded county map does not visibly move); leave 'continuous' unset or true"]);
    }
    // A solid look on a county map is drawn as CONTINUOUS colour: counties are too small to class into a few bands, and a
    // banded solid county map is judged by the 90 percent frame count (the render proof measured 29 to 53 percent kept, a
    // fail) while the continuous map passes the half-second windows (50 of 50). So the look is applied with continuous on.
    let lookToApply = lookObj;
    const converted: string[] = [];
    if (countyLevel && mapFilm && ramp && ramp.continuous === undefined) {
      lookToApply = JSON.parse(JSON.stringify(lookObj));
      lookToApply.look.ramp.continuous = true;
      converted.push(COUNTY_CONTINUOUS_NOTICE);
    }
    try {
      const r = applyProfile(lookToApply, story, "restyle");
      story = r.story;
      // A dataset's pinned style (county areas are drawn as continuous colour) must survive the look. A look may restate the
      // same value, but one that CHANGES a pinned key (continuous false, mode hatch) would silently undo it (BUILDER LOW-7).
      const pin = mapFilm ? (entry.style?.choropleth ?? {}) : {}, got = story.sequence.style_overrides?.choropleth ?? {};
      const undone = Object.keys(pin).filter((k) => got[k] !== pin[k]);
      if (undone.length) {
        throw new FilmError([`look: this dataset is drawn with ${undone.map((k) => `choropleth ${k} = ${JSON.stringify(pin[k])}`).join(" and ")} (its areas are too small to hatch or to class into a few bands); this look would change it to ${undone.map((k) => JSON.stringify(got[k])).join(" and ")}. Use a look that leaves it alone`]);
      }
      warnings.push(...r.report.warnings);
      // Measured 2026-10-18 (cbp_arts_establishments, continuous county map): 1 s per year leaves 2 of 50 half-second windows still;
      // 2 s per year leaves 76 of 100 still. A slow hold on a county map is therefore mostly shortened by pacing, to 0.4 s.
      const hold = story.sequence?.hold_seconds;
      if (countyLevel && mapFilm && typeof hold === "number" && hold > COUNTY_SLOW_HOLD_ABOVE) converted.push(countySlowPacingNotice(hold));
      warnings.push(...converted);
      look = { applied: true, changed: r.report.changed, not_applied: r.report.not_applied, converted };
    } catch (e) {
      if (e instanceof ProfileError) throw new FilmError(e.errors.map((x) => `look: ${x}`));
      throw e;
    }
  }

  // ---- the worker's own schema, before anything is returned
  const bad = checkAgainst(schema, story);
  if (bad.length) throw new FilmError(bad.map((x) => `the story would be refused by the worker: ${x}`));

  return {
    story,
    report: {
      dataset: { id: entry.id, title: entry.title, publisher: entry.publisher, url: entry.url, licence_short: entry.licence_short },
      film_type: req.film_type, window: { start: window[0], end: window[1] },
      measure: headMeasure ? { id: headMeasure.id, label: headMeasure.label, unit: headMeasure.unit } : null,
      method_notes: [...breaks.map((b) => `${b.period}: ${b.what} ${b.effect}`.trim()), ...(entry.notes ? [entry.notes] : [])],
      gaps: entry.known_gaps, warnings, look,
    },
  };
}
