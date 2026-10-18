// A FILM FROM THE PERSON'S OWN UPLOADED DATA (ENGINE-BYOD-GAPS.md, S3).
//
//   describeUpload(upload)                 -> a catalog-shaped entry for ONE confirmed upload (never a catalog dataset)
//   compileUploadFilm(request, upload, o)  -> { story, report }, by the SAME compileFilm and the SAME rules as the catalog
//
// `upload` is what the server holds about one dataset of the caller's own: { dataset_id, label, status, mapping, ingest_report }.
// Nothing here reads the file or any value in it: only the person's CONFIRMED mapping and the worker's report (counts, the
// period span). The caller (an Edge Function) must fetch the upload as the person (RLS) and pass ONLY their own row; this module
// cannot tell whose it is, so it checks what it can: the id is made from the dataset id, a catalog request can never name a u_ id,
// and an upload can never be used by a request that names a catalog dataset.
//
// What carries over unchanged because it keys on the entry's GEOGRAPHY, not on the catalog: a county map is drawn as continuous
// colour (a banded county map fails the motion check), hatching is refused on counties, a look is parsed and validated first, a
// slow pacing is told it will be shortened, the worker's own schema is checked before anything is returned.
//
// What an upload does NOT get: a motion record (it cannot be measured ahead of time: the film's own preflight at render is the
// gate), a listing (it is private), a licence the person stated (S5; until then the wording the worker already uses), a unit.
import { compileFilm, FilmError } from "./film.ts";

export class UploadError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.slice(0, 5).join("; "));
    this.errors = errors;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PERIOD = /^(?:[0-9]{4}|[0-9]{4}-(?:0[1-9]|1[0-2]))$/;
const MAPPING_KEYS = ["place_index", "period_index", "value_indexes", "geography", "cadence", "state_index", "state", "measure_names", "banded_index"];
const GEOGRAPHIES: Record<string, { label: string; level: string; noun: string }> = {
  us_states: { label: "US states", level: "U.S. states", noun: "states" },
  us_counties: { label: "US county (lower 48 + DC)", level: "U.S. counties", noun: "counties" },
};
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
// The words the worker's manifest already uses (ryagram/worker/uploads.py build_manifest), so a story's notes and the film agree.
export const UPLOAD_PUBLISHER = "The person who made this film";
export const UPLOAD_LICENCE = "Supplied by the person who made this film, who confirmed they may use it.";
export const UPLOAD_SOURCE_LINE = "Source: data supplied by the film's maker";
const BAD_TEXT = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤﻿]/;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** The id the worker gives the upload in a story: u_ plus the first 24 hex digits of the dataset id. */
export function uploadRef(datasetId: string): string {
  if (typeof datasetId !== "string" || !UUID.test(datasetId)) throw new UploadError(["dataset_id: not a dataset id"]);
  return "u_" + datasetId.replace(/-/g, "").slice(0, 24);
}

/** The reasons an upload's confirmed mapping cannot be used (the SQL's mapping_ok, in the same words), or []. */
export function mappingProblems(m: any, report: any): string[] {
  const bad = (s: string) => [s];
  if (m === null || typeof m !== "object" || Array.isArray(m)) return bad("The mapping is missing.");
  if (Object.keys(m).some((k) => !MAPPING_KEYS.includes(k))) return bad("The mapping has something unexpected in it.");
  if (report?.guess?.wide === true) return bad("This file has its years across the columns. Put the years in one column, with one row per place and year, and upload it again.");
  if (!isInt(m.place_index) || !isInt(m.period_index)) return bad("Choose which column is the place and which is the period.");
  if (!Object.hasOwn(GEOGRAPHIES, String(m.geography ?? ""))) return bad("Choose whether the places are U.S. states or counties.");
  if (m.cadence !== "annual" && m.cadence !== "monthly") return bad("Choose whether the periods are yearly or monthly.");
  if (!Array.isArray(m.value_indexes) || m.value_indexes.length < 1 || m.value_indexes.length > 8 || !m.value_indexes.every(isInt)) return bad("Choose 1 to 8 columns of values.");
  const n = Array.isArray(report?.columns) ? report.columns.length : 0;
  const used = [m.place_index, m.period_index, ...m.value_indexes];
  if (m.state_index !== undefined && m.state_index !== null) {
    if (!isInt(m.state_index)) return bad("The state column isn't a column.");
    used.push(m.state_index);
  }
  if (used.some((i: number) => i < 0 || i >= n)) return bad("One of the chosen columns isn't in the file.");
  if (new Set(used).size !== used.length) return bad("Each column can only be used for one thing.");
  if (m.geography === "us_counties") {
    const noIndex = m.state_index === undefined || m.state_index === null;
    if (noIndex && (m.state === undefined || m.state === null)) return bad("County names need a state. Choose the state, or the column that has it.");
    if (m.state !== undefined && m.state !== null && !STATES.has(String(m.state))) return bad("That isn't a U.S. state.");
  }
  if (m.banded_index !== undefined && m.banded_index !== null && (!isInt(m.banded_index) || !m.value_indexes.includes(m.banded_index))) return bad("The main column has to be one of the value columns.");
  if (m.measure_names !== undefined) {
    const names = m.measure_names;
    if (names === null || typeof names !== "object" || Array.isArray(names)) return bad("Each value column's name needs 1 to 80 characters.");
    for (const [k, v] of Object.entries(names)) {
      if (!/^[0-9]{1,2}$/.test(k) || typeof v !== "string" || [...v].length < 1 || [...v].length > 80 || !m.value_indexes.includes(Number(k))) return bad("Each value column's name needs 1 to 80 characters.");
    }
  }
  return [];
}

/** A catalog-shaped entry for one CONFIRMED upload, or an UploadError saying (in the person's words) what to fix. */
export function describeUpload(upload: any): any {
  const errs: string[] = [];
  if (upload === null || typeof upload !== "object" || Array.isArray(upload)) throw new UploadError(["upload: expected the upload's record"]);
  let id = "";
  try { id = uploadRef(upload.dataset_id); } catch (e) { errs.push(...(e as UploadError).errors); }
  if (upload.status !== "approved") errs.push("Confirm what your columns mean before making a film from this data.");
  const label = typeof upload.label === "string" ? upload.label.replace(/\s+/g, " ").trim() : "";
  if (!label || [...label].length > 80 || BAD_TEXT.test(label)) errs.push("label: the name of your data needs 1 to 80 characters, with no control or invisible characters.");
  const report = upload.ingest_report;
  const problems = mappingProblems(upload.mapping, report);
  errs.push(...problems);
  const first = String(report?.periods?.first ?? ""), last = String(report?.periods?.last ?? "");
  if (!problems.length) {
    if (!PERIOD.test(first) || !PERIOD.test(last) || first > last) errs.push("The file's periods could not be read. Check the period column and upload it again.");
    else if ((upload.mapping.cadence === "annual") !== (first.length === 4 && last.length === 4)) errs.push("The periods in your file do not match the yearly or monthly choice you confirmed. Check your columns again.");
  }
  if (errs.length) throw new UploadError(errs);
  const m = upload.mapping;
  const banded = m.banded_index ?? m.value_indexes[0];
  const measureLabel = (m.measure_names && m.measure_names[String(banded)]) || "Value";
  const g = GEOGRAPHIES[m.geography];
  const unmatched = Number(report?.unmatched?.count ?? 0);
  const notes = unmatched > 0
    ? `${unmatched} place${unmatched === 1 ? "" : "s"} in your file ${unmatched === 1 ? "is" : "are"} not on this map and ${unmatched === 1 ? "is" : "are"} not drawn.` : "";
  return {
    // private data: visible to the person it belongs to, never in a catalog, never listed
    listable: true, listable_class: "own-data", listable_why: "the person's own upload, private to them", own_upload: true,
    id, title: label, short: label, group: "own", family: null, status: "usable", status_why: "usable",
    publisher: UPLOAD_PUBLISHER, source_line: UPLOAD_SOURCE_LINE, url: "",
    licence: UPLOAD_LICENCE, licence_short: "Supplied by the film's maker", topic: "Your data", notes,
    geography: { id: m.geography, label: g.label, level: g.level, noun: g.noun, kind: "geographic" },
    period: { from: first, to: last, cadence: m.cadence },
    window: [first, last],
    // the engine reads the confirmed banded column as the dataset's one measure, id "value" (worker build_manifest); its unit is not
    // asked yet (S5), so none is claimed
    measures: [{ id: "value", label: measureLabel, unit: "", role: "banded", story_measure: null }],
    film_types: ["map", "bars", "line"],
    known_gaps: {}, methodology_breaks: [], missing_is_ambiguous: true, style: null,
  };
}

/** compileFilm for the person's own upload. `request.dataset` may be omitted (it is this upload) but may not name anything else. */
export function compileUploadFilm(request: any, upload: any, opts: { storySchema?: any; today?: any } = {}): ReturnType<typeof compileFilm> {
  const entry = describeUpload(upload);                          // UploadError, in the person's words
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw new FilmError(["request: must be an object"]);
  if (request.dataset !== undefined && request.dataset !== entry.id) {
    throw new FilmError([`dataset: '${String(request.dataset).slice(0, 64)}' is not this upload; a film made from your own data uses only that data`]);
  }
  // the catalog is exactly this one entry: no catalog dataset, and no other person's u_ id, is reachable from here
  return compileFilm({ ...request, dataset: entry.id }, { catalog: [entry], audience: "person", storySchema: opts.storySchema, today: opts.today });
}
