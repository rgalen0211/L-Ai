// What a connected AI is told about the options it can set (NEXT-CONNECT 104, connector parity). Ryan 13:49: control and direction go through the user's connected AI,
// so the AI must reach the whole range the desktop app has. The list (OPTIONS, WEB's merged shared list) is WORDING AND DISPLAY ONLY: set_story's check against the
// worker's story schema is the ONLY validator, and a value outside an advertised range is refused with a plain message by that check, never by this file.
//
// Which rows are the AI's: a row with source "story" and connector "yes" is a field of the story at its path (128 today). The profile rows (source "profile") are the SAME
// options as the app's Your look, and 23 of them say which story row they are (same_as): they add their default and their choice labels to that story row and are not listed twice.
// One profile row has no story path (ramp_continuous); it is named as "set in the app only". Rows that are planned, reserved or engine-only are named as NOT AVAILABLE so the AI
// does not try them. Nothing here invents a word: a missing default says the engine decides.
import { OPTIONS, OPTION_GROUPS, type Option } from "../_shared/options_list.ts";

/** The groups in the order a person meets them. */
const GROUP_ORDER = ["story", "size", "look", "chart", "words", "brand", "outro", "advanced"];

const isStoryRow = (o: Option) => o.source === "story";
export const availableRows = (rows: Option[] = OPTIONS) => rows.filter((o) => isStoryRow(o) && o.connector === "yes" && o.path);
export const unavailableRows = (rows: Option[] = OPTIONS) => rows.filter((o) => o.connector !== "yes" && (o.path || o.label));
/** Profile rows the connector says "yes" to that have no story row to carry them: the account look is the only place. */
export const appOnlyRows = (rows: Option[] = OPTIONS) => rows.filter((o) => o.source === "profile" && o.connector === "yes" && !o.same_as);

function groupLabel(id: string): string {
  return OPTION_GROUPS.find((g) => g.id === id)?.label ?? id;
}

/** The bound, in words an AI can relay. Taken straight from the schema's own bound in the list; nothing is invented. */
export function allowedWords(o: Option): string {
  const h = (o.hard ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(h.enum)) parts.push("one of " + (h.enum as unknown[]).map((v) => JSON.stringify(v)).join(", "));
  if (typeof h.minimum === "number" && typeof h.maximum === "number") parts.push(`a number from ${h.minimum} to ${h.maximum}`);
  else if (typeof h.minimum === "number") parts.push(`a number of at least ${h.minimum}`);
  else if (typeof h.maximum === "number") parts.push(`a number of at most ${h.maximum}`);
  if (typeof h.maxLength === "number") parts.push(`text of up to ${h.maxLength} characters`);
  if (typeof h.pattern === "string") parts.push(`a colour written like ${h.pattern}`);
  if (typeof h.minItems === "number" || typeof h.maxItems === "number") {
    parts.push(h.minItems === h.maxItems ? `a list of exactly ${h.minItems} items` : `a list of ${h.minItems ?? 0} to ${h.maxItems ?? "any number of"} items`);
  }
  if (typeof h.maxProperties === "number") parts.push(`an object of at most ${h.maxProperties} fields`);
  return parts.length ? parts.join("; ") : `any ${o.control === "number" ? "number" : o.control === "toggle" ? "true or false" : "value"} the story format accepts`;
}

/** The profile row that says it is the same option as this story row (it carries the default and the choice labels). */
function profileTwin(o: Option, rows: Option[]): Option | undefined {
  return rows.find((r) => r.source === "profile" && r.same_as === o.id);
}

export function defaultWords(o: Option, rows: Option[] = OPTIONS): string {
  const d = o.default !== undefined && o.default !== null ? o.default : profileTwin(o, rows)?.default;
  return d === null || d === undefined ? "set by the engine when you leave it out" : JSON.stringify(d);
}

/** The longer explanation (what it changes, when to use it, an example, what to be careful about): the story row's own, or else its profile twin's. */
function detailOf(o: Option, rows: Option[]): NonNullable<Option["help_detail"]> {
  return o.help_detail ?? profileTwin(o, rows)?.help_detail ?? {};
}

function choiceWords(o: Option, rows: Option[]): string {
  const ch = o.choices ?? profileTwin(o, rows)?.choices;
  return ch && ch.length ? ch.map((c) => `${JSON.stringify(c.value)} = ${c.label}`).join("; ") : "";
}

export interface OptionView {
  path: string; group: string; label: string; help: string; control: string; allowed: string; default: string; choices: string; careful: string;
  applies_to: string; also_in_the_app_as: string;
}

export function optionView(o: Option, rows: Option[] = OPTIONS): OptionView {
  const twin = profileTwin(o, rows);
  return {
    path: String(o.path), group: o.group, label: o.label, help: o.help, control: o.control, allowed: allowedWords(o), default: defaultWords(o, rows),
    choices: choiceWords(o, rows), careful: detailOf(o, rows).careful ?? "",
    applies_to: String(o.path).includes("[]") ? "each clip it fits (the [] stands for a clip's place in sequence.clips)" : "the whole story",
    also_in_the_app_as: twin ? twin.label : "",
  };
}
export const optionViews = (rows: Option[] = OPTIONS): OptionView[] => availableRows(rows).map((o) => optionView(o, rows));

function line(v: OptionView): string {
  const said = [v.label, v.help].filter(Boolean).join(". ");
  const bits = [`- ${v.path}: ${said}`];
  if (v.choices) bits.push(`Choices: ${v.choices}.`);
  bits.push(`Allowed: ${v.allowed}.`, `If left out: ${v.default}.`);
  if (v.careful) bits.push(`Careful: ${v.careful}`);
  return bits.join(" ");
}

/** The section of get_story_schema's text that lists every option. */
export function optionsText(rows: Option[] = OPTIONS): string {
  const views = availableRows(rows).map((o) => optionView(o, rows));
  const out: string[] = [
    `Options you can set (${views.length}). Each one is a field of the story at the path shown; a [] in a path means "in a clip" of sequence.clips. A bare path is for the whole story.`,
    "This list explains the fields in plain words; it does not allow anything by itself. set_story checks every value against the story format and refuses one outside its range, in words you can pass on.",
    "Ask get_story_schema with option set to a path (or an id) for the full explanation of one option: what it changes, when to use it, an example and what to be careful about.",
  ];
  for (const g of GROUP_ORDER) {
    const inGroup = views.filter((v) => v.group === g);
    if (!inGroup.length) continue;
    out.push("", `${groupLabel(g)}:`);
    for (const v of inGroup) out.push(line(v));
  }
  const na = unavailableRows(rows);
  if (na.length) {
    out.push("", "NOT AVAILABLE YET (the story check refuses these; do not write them):");
    for (const o of na) out.push(`- ${o.path ?? o.id}: ${o.label}. ${o.connector_note ?? "not built or not applied yet"} (${o.status}).`);
  }
  const app = appOnlyRows(rows);
  if (app.length) {
    out.push("", "SET IN THE APP ONLY (the account look, Your look; there is no story field for these yet):");
    for (const o of app) out.push(`- ${o.label}: ${o.help}`);
  }
  out.push("", "The account's default look (Your look in the Ryagram app) is separate and is set there for now; a story's own fields above always apply to that story.");
  return out.join("\n");
}

/** One option in full, for get_story_schema with option set. Matches a story path or an id; null when nothing matches. */
export function optionDetail(key: string, rows: Option[] = OPTIONS): string | null {
  const k = key.trim();
  const hits = rows.filter((o) => isStoryRow(o) && (o.path === k || o.id === k));
  if (!hits.length) return null;
  return hits.map((o) => {
    const v = optionView(o, rows), d = detailOf(o, rows);
    const ok = availableRows(rows).includes(o);
    return [
      `${v.path}${ok ? "" : " (NOT AVAILABLE YET: " + (o.connector_note ?? o.status) + ")"}`, `${v.label}. ${v.help}`,
      d.changes ? `What it changes: ${d.changes}` : "", d.use_when ? `Use it when: ${d.use_when}` : "", d.example ? `Example: ${d.example}` : "", d.careful ? `Be careful: ${d.careful}` : "",
      v.choices ? `Choices: ${v.choices}.` : "", `Allowed: ${v.allowed}.`, `If left out: ${v.default}.`, `Applies to: ${v.applies_to}.`,
      v.also_in_the_app_as ? `In the app this is also "${v.also_in_the_app_as}" under Your look.` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}
