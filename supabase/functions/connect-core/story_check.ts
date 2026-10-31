// set_story's server-side check: the worker's own JSON Schema (vendored, generated from ryagram/worker/schema.py)
// plus the rules the schema cannot carry that this side can verify, each failure in plain words.
// The worker re-validates every job and its verdict is authoritative; the message says so.
import { DATASETS } from "../_shared/templates.ts";
import { titleProblems } from "../_shared/title_limits.ts";
import { LIMITS } from "./types.ts";

export interface AjvError { instancePath: string; keyword: string; params: Record<string, unknown>; message?: string; schemaPath?: string }

const MAX_REPORTED = 30;

/** "/sequence/clips/0/headline" -> "clip 1, headline" in the words a person would use. */
export function whereWords(path: string, subject = "story"): string {
  if (!path) return subject === "story" ? "The story" : "The call";
  const parts = path.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "clips" && /^\d+$/.test(parts[i + 1] ?? "")) { out.push(`clip ${Number(parts[i + 1]) + 1}`); i++; }
    else if (/^\d+$/.test(parts[i])) out.push(`item ${Number(parts[i]) + 1}`);
    else out.push(`"${parts[i]}"`);
  }
  return `In the ${subject}, ${out.join(", ")}`;
}

export function plainError(e: AjvError, subject = "story"): string {
  const where = whereWords(e.instancePath, subject);
  const p = e.params ?? {};
  switch (e.keyword) {
    case "required": return `${where}: the field "${p.missingProperty}" is missing.`;
    case "additionalProperties": return `${where}: "${p.additionalProperty}" is not a field Ryagram accepts here.`;
    case "enum": return `${where} must be one of: ${(p.allowedValues as unknown[]).map(String).join(", ")}.`;
    case "type": return `${where} must be ${/^[aeiou]/.test(String(p.type)) ? "an" : "a"} ${p.type}.`;
    case "const": return `${where} must be ${JSON.stringify(p.allowedValue)}.`;
    case "minimum": return `${where} must be at least ${p.limit}.`;
    case "maximum": return `${where} must be at most ${p.limit}.`;
    case "exclusiveMinimum": return `${where} must be more than ${p.limit}.`;
    case "exclusiveMaximum": return `${where} must be less than ${p.limit}.`;
    case "minLength": return `${where} is too short (at least ${p.limit} characters).`;
    case "maxLength": return `${where} is too long (at most ${p.limit} characters).`;
    case "minItems": return `${where} needs at least ${p.limit} items.`;
    case "maxItems": return `${where} can hold at most ${p.limit} items.`;
    case "pattern": return `${where} is not in the allowed format.`;
    default: return `${where} ${e.message ?? "is not valid"}.`;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The rules the schema cannot carry (worker schema.py NOT_IN_SCHEMA) that can be checked without the data. */
export function extraProblems(story: unknown): string[] {
  const out: string[] = [];
  if (!isObj(story)) return out;
  const clips = isObj(story.sequence) && Array.isArray(story.sequence.clips) ? story.sequence.clips : [];
  const ids = new Map<string, number>();
  clips.forEach((c, i) => {
    if (!isObj(c)) return;
    const n = i + 1;
    if (typeof c.id === "string") {
      if (ids.has(c.id)) out.push(`Clips ${ids.get(c.id)} and ${n} share the id "${c.id.slice(0, 40)}"; each clip needs its own.`);
      else ids.set(c.id, n);
    }
    if (c.kind === "render") {
      if (typeof c.dataset === "string" && !DATASETS[c.dataset]) {
        out.push(`Clip ${n} uses the dataset "${c.dataset.slice(0, 64)}", which is not in the Ryagram catalog. Allowed: ${Object.keys(DATASETS).join(", ")}.`);
      }
      if (typeof c.start === "string" && typeof c.end === "string" && c.start > c.end) {
        out.push(`Clip ${n} starts (${c.start}) after it ends (${c.end}).`);
      }
    }
    if (c.kind === "title") {
      const empty = (v: unknown) => typeof v !== "string" || v.trim() === "";
      if ("headline" in c && "subhead" in c && empty(c.headline) && empty(c.subhead)) {
        out.push(`Title card ${n} has an empty headline and an empty subhead.`);
      } else if ("headline" in c && !("subhead" in c) && empty(c.headline)) {
        out.push(`Title card ${n} has an empty headline.`);
      }
    }
  });
  return out;
}

/** Every failed check, in plain words, or [] when the story passes everything this side can check. */
export function checkStory(story: unknown, schemaCheck: (v: unknown) => string[]): string[] {
  if (!isObj(story)) return ["The story must be a JSON object."];
  let size = 0;
  try { size = new TextEncoder().encode(JSON.stringify(story)).length; } catch { return ["The story could not be read as JSON."]; }
  if (size > LIMITS.maxStoryBytes) return [`The story is ${Math.round(size / 1024)} KB; the limit is 256 KB.`];
  const problems = [...schemaCheck(story), ...extraProblems(story), ...titleProblems(story)];
  const seen = new Set<string>();
  const unique = problems.filter((m) => (seen.has(m) ? false : (seen.add(m), true)));
  if (unique.length > MAX_REPORTED) {
    return [...unique.slice(0, MAX_REPORTED), `...and ${unique.length - MAX_REPORTED} more. Fix these first and send the story again.`];
  }
  return unique;
}

// ---------------------------------------------------------------------------------------------- structured problems (NEXT-CONNECT 157, PUNCH P2)
// The same checks, but each failure is DATA the AI can act on: the field path, a short code, the plain sentence and a suggested fix. Follow-on noise is left out: the schema describes a clip as
// "a title card OR a data view", so a bad title card also makes the data-view branch fail ("missing dataset", "missing view", "kind must be render"), and a headline-or-subhead rule fails twice.
// Those are consequences of the primary error, not extra mistakes; they are counted in `suppressed` and never listed.

export interface StructuredProblem { path: string; where: string; code: string; message: string; fix: string }
export interface StructuredCheck { ok: boolean; errors: StructuredProblem[]; plain: string[]; suppressed: number; more: number }

const CLIP_PATH = /^\/sequence\/clips\/(\d+)(\/.*)?$/;

/** "/sequence/clips/0/headline" -> "clip 1, headline" (the short place name used in the list). */
export function fieldWords(path: string): string {
  if (!path) return "the story";
  const parts = path.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "sequence") continue;
    if (parts[i] === "clips" && /^\d+$/.test(parts[i + 1] ?? "")) { out.push(`clip ${Number(parts[i + 1]) + 1}`); i++; }
    else if (/^\d+$/.test(parts[i])) out.push(`item ${Number(parts[i]) + 1}`);
    else out.push(parts[i]);
  }
  return out.join(", ") || "the story";
}

const CODES: Record<string, string> = {
  required: "missing_field", additionalProperties: "unknown_field", enum: "not_allowed_value", const: "not_allowed_value", type: "wrong_type",
  minimum: "out_of_range", maximum: "out_of_range", exclusiveMinimum: "out_of_range", exclusiveMaximum: "out_of_range",
  minLength: "length", maxLength: "length", minItems: "count", maxItems: "count", pattern: "bad_format",
};

function fixFor(e: AjvError): string {
  const p = e.params ?? {};
  switch (e.keyword) {
    case "required": return `Add "${p.missingProperty}".`;
    case "additionalProperties": return `Remove "${p.additionalProperty}"; Ryagram does not accept it here.`;
    case "enum": return `Use one of: ${(p.allowedValues as unknown[]).map(String).join(", ")}.`;
    case "const": return `Use ${JSON.stringify(p.allowedValue)}.`;
    case "type": return `Make it ${/^[aeiou]/.test(String(p.type)) ? "an" : "a"} ${p.type}.`;
    case "minimum": return `Use ${p.limit} or more.`;
    case "maximum": return `Use ${p.limit} or less.`;
    case "exclusiveMinimum": return `Use more than ${p.limit}.`;
    case "exclusiveMaximum": return `Use less than ${p.limit}.`;
    case "minLength": return `Make it at least ${p.limit} characters.`;
    case "maxLength": return `Shorten it to at most ${p.limit} characters.`;
    case "minItems": return `Give it at least ${p.limit} items.`;
    case "maxItems": return `Give it at most ${p.limit} items.`;
    case "pattern": return "Use the allowed format.";
    default: return "Change it and save the whole story again.";
  }
}

/** Primary problems first and only: the raw schema errors of a story, minus the follow-on noise, as data. */
export function structureSchemaErrors(story: unknown, raw: AjvError[], extra: string[]): { errors: StructuredProblem[]; suppressed: number } {
  const clips = isObj(story) && isObj(story.sequence) && Array.isArray(story.sequence.clips) ? story.sequence.clips : [];
  const titleHasExtra = new Set<number>();
  for (const m of extra) { const mm = /^Title card (\d+)/.exec(m); if (mm) titleHasExtra.add(Number(mm[1]) - 1); }
  let suppressed = 0;
  const keep: AjvError[] = [];
  const badKind = new Set<number>();
  for (const e of raw) {
    const m = CLIP_PATH.exec(e.instancePath);
    if (!m) { keep.push(e); continue; }
    const n = Number(m[1]);
    const clip = clips[n];
    const kind = isObj(clip) ? clip.kind : undefined;
    const branch = kind === "title" ? 0 : kind === "render" ? 1 : null;
    if (branch === null) {                                              // no usable kind: ONE problem for the clip, whatever else the two branches say
      if (!badKind.has(n)) { badKind.add(n); keep.push({ instancePath: `/sequence/clips/${n}/kind`, keyword: "enum", params: { allowedValues: ["title", "render"] }, message: "must be title or render" }); }
      else suppressed++;
      continue;
    }
    const sp = e.schemaPath ?? "";
    const inOther = sp.includes("/items/oneOf/") && !sp.includes(`/items/oneOf/${branch}/`);
    if (inOther || e.keyword === "oneOf") { suppressed++; continue; }                // the other kind's rules, and "must match exactly one": consequences
    if (branch === 0 && titleHasExtra.has(n) && ["maxLength", "minimum", "maximum", "anyOf", "required", "type"].includes(e.keyword)) { suppressed++; continue; }   // the title rules say it again, with the limit
    keep.push(e);
  }
  // "a headline or a subhead is required" arrives as two required errors and an anyOf: say it once
  const anyOfAt = new Set(keep.filter((e) => e.keyword === "anyOf").map((e) => e.instancePath));
  const merged: AjvError[] = [];
  for (const e of keep) {
    if (e.keyword === "required" && anyOfAt.has(e.instancePath) && (e.schemaPath ?? "").includes("/anyOf/")) { suppressed++; continue; }
    merged.push(e);
  }
  const out: StructuredProblem[] = [];
  const seen = new Set<string>();
  for (const e of merged) {
    let message: string; let fix: string; let code: string;
    if (e.keyword === "anyOf") { message = `${whereWords(e.instancePath)} needs a headline or a subhead.`; fix = 'Add "headline" or "subhead".'; code = "missing_field"; }
    else { message = plainError(e); fix = fixFor(e); code = CODES[e.keyword] ?? "invalid"; }
    const key = `${e.instancePath}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: e.instancePath || "/", where: fieldWords(e.instancePath), code, message, fix });
  }
  return { errors: out, suppressed };
}

/** Rules that are not in the schema (extraProblems, titleProblems) as data: the clip number in the sentence gives the path, and a title card's sentence names its field. */
function structureExtra(messages: string[]): StructuredProblem[] {
  return messages.map((m) => {
    const mm = /^(?:Clips? |Title card )(\d+)/.exec(m);
    const clip = mm ? `/sequence/clips/${Number(mm[1]) - 1}` : "";
    const mk = (path: string, code: string, fix: string): StructuredProblem => ({ path: path || "/", where: fieldWords(path), code, message: m, fix });
    if (/^Title card /.test(m)) {
      const f = /: the (headline|subhead|credit line)\b/.exec(m);
      const field = f ? (f[1] === "credit line" ? "credit" : f[1]) : "";
      const lim = /characters; the limit is (\d+)/.exec(m);
      if (field && lim) return mk(`${clip}/${field}`, "length", `Shorten the ${f![1]} to at most ${lim[1]} characters.`);
      if (field && /control or invisible/.test(m)) return mk(`${clip}/${field}`, "bad_character", `Remove the control or invisible characters from the ${f![1]}.`);
      if (field && /must be text/.test(m)) return mk(`${clip}/${field}`, "wrong_type", `Make the ${f![1]} text.`);
      if (/needs a headline or a subhead/.test(m)) return mk(clip, "missing_field", 'Add "headline" or "subhead".');
      if (/needs a length in seconds|runs [\d.]+ seconds/.test(m)) return mk(`${clip}/seconds`, "out_of_range", "Use a length from 0.5 to 12 seconds.");
      if (/the fade must be/.test(m)) return mk(`${clip}/fade`, "out_of_range", "Use a fade from 0 to 2 seconds.");
    }
    return mk(clip, "rule", "Change that as the sentence says, then save the whole story again.");
  });
}

/** checkStory with the failures as data. ok is true only when nothing failed. The plain sentences (the old failed_checks) are kept for clients that read them. */
export function checkStoryStructured(story: unknown, schemaCheck: ((v: unknown) => string[]) & { detailed?: (v: unknown) => AjvError[] }): StructuredCheck {
  if (!isObj(story)) return one("The story must be a JSON object.", "story_shape");
  let size = 0;
  try { size = new TextEncoder().encode(JSON.stringify(story)).length; } catch { return one("The story could not be read as JSON.", "story_shape"); }
  if (size > LIMITS.maxStoryBytes) return one(`The story is ${Math.round(size / 1024)} KB; the limit is ${Math.round(LIMITS.maxStoryBytes / 1024)} KB. Nothing was saved.`, "story_size", "Make the story smaller than 256 KB: shorten long texts, leave out clips you do not need, or split the film into two projects, then send the whole story again.");
  const extra = [...extraProblems(story), ...titleProblems(story)];
  let structured: { errors: StructuredProblem[]; suppressed: number };
  if (schemaCheck.detailed) structured = structureSchemaErrors(story, schemaCheck.detailed(story), extra);
  else structured = { errors: schemaCheck(story).map((m) => ({ path: "/", where: "the story", code: "invalid", message: m, fix: "Change it and save the whole story again." })), suppressed: 0 };
  let errors = [...structured.errors, ...structureExtra(extra)];
  const seen = new Set<string>();
  errors = errors.filter((e) => (seen.has(e.message) ? false : (seen.add(e.message), true)));
  const clipOf = (p: string) => { const m = CLIP_PATH.exec(p); return m ? Number(m[1]) : -1; };
  errors.sort((a, b) => clipOf(a.path) - clipOf(b.path));                  // the story as a whole first, then clip by clip
  let more = 0;
  if (errors.length > MAX_REPORTED) { more = errors.length - MAX_REPORTED; errors = errors.slice(0, MAX_REPORTED); }
  const plain = errors.map((e) => e.message);
  if (more) plain.push(`...and ${more} more. Fix these first and send the story again.`);
  return { ok: errors.length === 0, errors, plain, suppressed: structured.suppressed, more };
}

function one(message: string, code: string, fix = "Send the whole story as one JSON object under 256 KB."): StructuredCheck {
  return { ok: false, errors: [{ path: "/", where: "the story", code, message, fix }], plain: [message], suppressed: 0, more: 0 };
}
