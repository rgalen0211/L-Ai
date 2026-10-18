// set_story's server-side check: the worker's own JSON Schema (vendored, generated from ryagram/worker/schema.py)
// plus the rules the schema cannot carry that this side can verify, each failure in plain words.
// The worker re-validates every job and its verdict is authoritative; the message says so.
import { isKnownDataset, knownDatasetIds } from "./datasets.ts";
import { titleProblems } from "../_shared/title_limits.ts";
import { LIMITS } from "./types.ts";

export interface AjvError { instancePath: string; keyword: string; params: Record<string, unknown>; message?: string }

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
      if (typeof c.dataset === "string" && !isKnownDataset(c.dataset)) {
        const ids = knownDatasetIds();
        out.push(`Clip ${n} uses the dataset "${c.dataset.slice(0, 64)}", which is not in the Ryagram catalog. Use search_datasets to find one (${ids.length} are available, for example ${ids.slice(0, 4).join(", ")}).`);
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
