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
import { applyProfile, ProfileError } from "./profile.ts";
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

const byId = (cat: Json[]) => new Map(cat.map((e) => [e.id as string, e]));

/** What a server-side caller can say about a dataset. Not a user-facing list. */
export function describeDataset(id: string, catalog: Json[] = CATALOG): Json | null {
  const e = byId(catalog).get(id);
  if (!e) return null;
  return {
    id: e.id, title: e.title, status: e.status, publisher: e.publisher, url: e.url, licence_short: e.licence_short,
    geography: e.geography, period: e.period, default_window: e.window,
    measures: e.measures.map((m: Json) => ({ id: m.id, label: m.label, unit: m.unit, selectable: m.story_measure !== null })),
    film_types: e.film_types, known_gaps: e.known_gaps, methodology_breaks: e.methodology_breaks,
    missing_is_ambiguous: e.missing_is_ambiguous,
  };
}

/** Datasets whose id, title or measure contains every word of the query. Server side only; usable ones first. */
export function searchCatalog(query: string, opts: { usableOnly?: boolean; limit?: number } = {}, catalog: Json[] = CATALOG): Json[] {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const rank = { usable: 0, next: 1, later: 2 } as Record<string, number>;
  return catalog
    .filter((e) => (!opts.usableOnly || e.status === "usable"))
    .filter((e) => {
      const hay = `${e.id} ${e.title} ${e.measures.map((m: Json) => m.label).join(" ")} ${e.topic}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.title.localeCompare(b.title))
    .slice(0, Math.min(Math.max(opts.limit ?? 10, 1), 25))
    .map((e) => ({ id: e.id, title: e.title, status: e.status, film_types: e.film_types, period: e.period }));
}

function periodOk(p: string, cadence: string): boolean {
  return cadence === "monthly" ? /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(p) : /^[0-9]{4}$/.test(p);
}

function resolveYears(entry: Json, years: Json, errs: string[]): [string, string] | null {
  const cad = entry.period.cadence;
  const lo = entry.period.from, hi = entry.period.to;
  const def = entry.window ?? [lo, hi || lo];       // an open-ended series (no end) needs a window from the catalog
  const raw = { start: years?.start ?? null, end: years?.end ?? null };
  const out: string[] = [];
  for (const [which, dflt] of [["start", def[0]], ["end", def[1]]] as const) {
    let v = raw[which];
    if (v === null || v === undefined || v === "") { out.push(dflt); continue; }
    v = String(v);
    // A year is accepted for a monthly series: it means that year's first (start) or last (end) month.
    if (cad === "monthly" && /^[0-9]{4}$/.test(v)) v = which === "start" ? `${v}-01` : `${v}-12`;
    if (!periodOk(v, cad)) {
      errs.push(`years.${which}: '${v}' is not a ${cad === "monthly" ? "month like 2019-06 (or a year like 2019)" : "year like 2019"}; this dataset is ${cad || "annual"}`);
      out.push(dflt);
      continue;
    }
    if (v < lo || (hi && v > hi)) errs.push(`years.${which}: ${v} is outside this dataset's coverage, ${lo} ${hi ? `to ${hi}` : "onward"}`);
    out.push(v);
  }
  if (out[0] > out[1]) errs.push(`years: start ${out[0]} is after end ${out[1]}`);
  return [out[0], out[1]];
}

function breaksInside(entry: Json, start: string, end: string): Json[] {
  return entry.methodology_breaks.filter((b: Json) => {
    const p = String(b.period);
    const s = start.slice(0, p.length), e = end.slice(0, p.length);
    return p > s && p <= e;
  });
}

const NOTES_MAX = 4000;

function buildNotes(entry: Json, window: [string, string], measure: Json | null, breaks: Json[]): string {
  const lines = [
    `Dataset: ${entry.title} (${entry.id}). ${window[0]} to ${window[1]}.`,
    `Source: ${entry.publisher}${entry.url ? `, ${entry.url}` : ""}.`,
    measure ? `Measure: ${measure.label}${measure.unit ? ` (${measure.unit})` : ""}.` : "",
    ...breaks.map((b) => `Method change at ${b.period}: ${b.what} ${b.effect}`.trim()),
    entry.missing_is_ambiguous ? "In this source a missing value is ambiguous: it does not say whether it is zero or withheld." : "",
    entry.notes ? `Method notes: ${entry.notes}` : "",
  ].filter(Boolean);
  const licence = `Licence: ${entry.licence}`;
  // One line: the worker's `notes` text refuses newlines.
  let text = [...lines, licence].join(" ");
  if (text.length > NOTES_MAX) text = [...lines, `Licence: ${entry.licence_short}. See the source for the full terms.`].join(" ");
  if (text.length > NOTES_MAX) text = text.slice(0, NOTES_MAX - 3).trimEnd() + "...";
  return text;
}

export type FilmReport = {
  dataset: { id: string; title: string; publisher: string; url: string; licence_short: string };
  film_type: string;
  window: { start: string; end: string };
  measure: { id: string; label: string; unit: string } | null;
  method_notes: string[];
  gaps: Json;
  warnings: string[];
  look: { applied: boolean; changed: string[]; not_applied: string[] };
};

export function compileFilm(req: Json, opts: { catalog?: Json[]; storySchema?: Json } = {}): { story: Json; report: FilmReport } {
  const catalog = opts.catalog ?? CATALOG, schema = opts.storySchema ?? STORY_SCHEMA;
  const errs: string[] = [];
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
    if (t.length > max) errs.push(`${key}: longer than ${max} characters`);
    return t.slice(0, max);
  };
  const title = text("title", 160, true);
  const subtitle = text("subtitle", 320, false);

  // ---- dataset and film type
  const entry = typeof req.dataset === "string" ? byId(catalog).get(req.dataset) : undefined;
  if (typeof req.dataset !== "string" || !req.dataset) errs.push("dataset: required (an id from the catalog)");
  else if (!entry) errs.push(`dataset: '${String(req.dataset).slice(0, 64)}' is not in the catalog; use searchCatalog`);
  else if (entry.status !== "usable") {
    errs.push(`dataset: '${entry.id}' is not usable yet: ${entry.status === "next" ? "it arrives with the next render-worker update" : "the render worker has not been set up for it"}`);
  }
  if (typeof req.film_type !== "string" || !req.film_type) errs.push(`film_type: required, one of ${FILM_TYPES.join(", ")}`);
  else if (!FILM_TYPES.includes(req.film_type)) errs.push(`film_type: '${req.film_type.slice(0, 30)}' is not one of ${FILM_TYPES.join(", ")}`);
  else if (entry && !entry.film_types.includes(req.film_type)) errs.push(`film_type: '${req.film_type}' is not offered for ${entry.id}; it offers ${entry.film_types.join(", ") || "none"}`);

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
    else window = resolveYears(entry, req.years ?? null, errs);
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
  const warnings: string[] = breaks.map((b) => `the window crosses a method change at ${b.period}: ${b.what} ${b.effect}`.trim());
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
    notes: buildNotes(entry, window, headMeasure, breaks),
    sequence: {
      canvas: [1920, 1080], fps: 30, theme: "dark",
      ...(entry.style ? { style_overrides: JSON.parse(JSON.stringify(entry.style)) } : {}),
      clips: [{ kind: "title", id: "open", seconds: 3, fade: 0.4, headline: title, subhead }, render],
    },
  };

  // ---- the look: same compiler and diff guard as profiles
  let look = { applied: false, changed: [] as string[], not_applied: [] as string[] };
  if (req.look !== undefined && req.look !== null) {
    // A dataset the engine draws as continuous colour (county areas are too small to hatch) cannot take a hatching look.
    if (entry.style?.choropleth?.continuous && req.look?.look?.ramp?.mode === "hatch") {
      throw new FilmError(["look: this dataset is drawn as continuous colour (its areas are too small to hatch); use a look whose ramp mode is 'solid'"]);
    }
    try {
      const r = applyProfile(req.look, story, "restyle");
      story = r.story;
      warnings.push(...r.report.warnings);
      look = { applied: true, changed: r.report.changed, not_applied: r.report.not_applied };
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
