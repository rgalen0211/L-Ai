// The live preview editor, AI half (NEXT-CONNECT 141): the closed vocabulary of editor ops and the draft rules, as plain TypeScript.
// The AUTHORITY is the SQL (migrations/20261027000400_live_editor.sql: edit_op_problem, apply_edit_ops, undo_edit_ops); this file is its twin for the in-memory stand-in (fake.ts) and for the tools'
// input schemas, and tests/edit-op-cases.json is run through BOTH so they cannot drift. Design: Ryagram-logs/proposals/CONNECT-LIVE-EDITOR-TOOLS.md.

export type Mode = "data" | "compilation";
export type Op = Record<string, unknown>;

/** The five look keys the worker's schema accepts TODAY (WORKER W1; WEB's editor offers the same), a copy of the rows the migration inserts into edit_look_keys; ENGINE 35's keys are added to both by a reviewed change (a test fails if the lists disagree). */
export interface LookKey { key: string; kind: "colour" | "enum" | "number" | "bool"; choices?: string[]; min?: number; max?: number }
export const LOOK_KEYS: LookKey[] = [
  { key: "network.color", kind: "colour" },
  { key: "network.base_color", kind: "colour" },
  { key: "network.context_color", kind: "colour" },
  { key: "state.fill", kind: "colour" },
  { key: "page.background", kind: "colour" },
];

export const LIMITS_EDIT = Object.freeze({ opsPerCall: 20, opsPerMinute: 60, opsPerDay: 600, undoneWindowMs: 10 * 60 * 1000, maxDraftBytes: 256 * 1024 });

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const CTRL = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/;
const PLACE = /([A-Za-z]:[\\/]|\\\\|(^|\s)\/[A-Za-z]|\.\.[\\/]|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/;
const PICTURE = /^[^\\/:*?"<>|\u0000-\u001f\u007f-\u009f]{1,100}\.(png|jpg|jpeg|webp)$/i;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Plain text an op may carry: 1..max characters, no control character, no bidirectional override, no place on a computer or web address. */
export function textOk(t: unknown, max: number): boolean {
  return typeof t === "string" && t.length >= 1 && t.length <= max && !CTRL.test(t) && !BIDI.test(t) && !PLACE.test(t) && !/[<>]/.test(t);
}

/** null = fine, otherwise the plain sentence (the same words as the SQL where a test compares them). */
export function opProblem(mode: Mode, op: unknown): string | null {
  if (op === null || typeof op !== "object" || Array.isArray(op)) return "A change must be an object.";
  const o = op as Op;
  if (typeof o.op !== "string") return 'A change needs an "op" naming what it does.';
  const kind = o.op;
  const keys = Object.keys(o);
  const known = (allowed: string[]) => !keys.some((k) => !allowed.includes(k));
  if (mode === "data") {
    let allowed: string[];
    if (kind === "set_look") allowed = ["op", "key", "value"];
    else if (kind === "unset_look") allowed = ["op", "key"];
    else return `"${kind.slice(0, 40)}" is not a change this editor knows for a data film.`;
    if (!known(allowed)) return "That change has a field the editor does not know.";
    if (typeof o.key !== "string") return 'A look change needs a "key".';
    const k = LOOK_KEYS.find((x) => x.key === o.key);
    if (!k) return `"${o.key.slice(0, 60)}" is not a look setting the editor has.`;
    if (kind === "unset_look") return null;
    if (!("value" in o)) return 'A set_look change needs a "value".';
    const v = o.value;
    if (k.kind === "colour" && !(typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v))) return `"${k.key}" needs a colour like #1a73e8.`;
    if (k.kind === "enum" && !(typeof v === "string" && k.choices!.includes(v))) return `"${k.key}" can only be: ${k.choices!.join(", ")}.`;
    if (k.kind === "number") {
      if (!isNum(v)) return `"${k.key}" needs a number.`;
      if (v < k.min! || v > k.max!) return `"${k.key}" must be between ${k.min} and ${k.max}.`;
    }
    if (k.kind === "bool" && typeof v !== "boolean") return `"${k.key}" must be true or false.`;
    return null;
  }
  const ALLOWED: Record<string, string[]> = {
    move_clip: ["op", "id", "start"], trim_clip: ["op", "id", "edge", "to"], reorder_clip: ["op", "id", "index"], set_clip_text: ["op", "id", "text"], delete_clip: ["op", "id"],
    add_clip: ["op", "track", "start", "len", "text", "picture"],
  };
  if (!ALLOWED[kind]) return `"${kind.slice(0, 40)}" is not a change this editor knows for a compilation.`;
  if (!known(ALLOWED[kind])) return "That change has a field the editor does not know.";
  if (kind !== "add_clip" && !(typeof o.id === "string" && ID.test(o.id))) return 'This change needs a clip "id" from get_edit_state.';
  for (const name of ["start", "to", "len"]) {
    if (name in o && !isNum(o[name])) return `"${name}" must be a number.`;
  }
  if (kind === "move_clip") {
    if (!("start" in o)) return 'move_clip needs "start".';
    if ((o.start as number) < 0 || (o.start as number) > 86400) return '"start" must be between 0 and 86400 seconds.';
  } else if (kind === "trim_clip") {
    if (!(o.edge === "start" || o.edge === "end")) return 'Trim the "start" or the "end".';
    if (!("to" in o)) return 'trim_clip needs "to".';
    if ((o.to as number) < 0 || (o.to as number) > 86400) return '"to" must be between 0 and 86400 seconds.';
  } else if (kind === "reorder_clip") {
    if (!(isNum(o.index) && Number.isInteger(o.index) && o.index >= 0 && o.index <= 199)) return '"index" must be a whole number from 0 to 199.';
  } else if (kind === "set_clip_text") {
    if (!textOk(o.text, 120)) return "The text must be 1 to 120 characters of plain words (no places on a computer, no web addresses, no markup).";
  } else if (kind === "add_clip") {
    if (!(o.track === "text" || o.track === "pictures")) return 'The AI can add a "text" or a "pictures" clip.';
    if (!("start" in o) || !("len" in o)) return 'A new clip needs "start" and "len".';
    if ((o.start as number) < 0 || (o.start as number) > 3600) return '"start" must be between 0 and 3600 seconds.';
    if ((o.len as number) < 0.3 || (o.len as number) > 30) return '"len" must be between 0.3 and 30 seconds.';
    if (o.track === "text") {
      if ("picture" in o || !("text" in o)) return 'A text clip needs "text" and no "picture".';
      if (!textOk(o.text, 120)) return "The text must be 1 to 120 characters of plain words (no places on a computer, no web addresses, no markup).";
    } else {
      if ("text" in o || !("picture" in o)) return 'A picture clip needs a "picture" name and no "text".';
      if (!(typeof o.picture === "string" && PICTURE.test(o.picture))) return "A picture is the NAME of one the person added in the app (png, jpg or webp), never a place.";
    }
  }
  return null;
}

// ----------------------------------------------------------------------------------------------------- the draft, as the in-memory stand-in keeps it (the SQL keeps the same facts in edit_drafts / edit_ops)
export interface OpRow { id: number; revision: number; actor: "person" | "ai"; client: string | null; op: Op; inverse: Op | null; status: "applied" | "pending" | "undone" | "rejected"; at: number; undone_at: number | null }
export interface Draft { mode: Mode; revision: number; look: Record<string, unknown>; tracks: Record<string, unknown>; mirrored: boolean; ai_visible: boolean; editor_seen_at: number | null; ops: OpRow[] }
export const newDraft = (mode: Mode): Draft => ({ mode, revision: 0, look: {}, tracks: {}, mirrored: false, ai_visible: false, editor_seen_at: null, ops: [] });

const e = (message: string, code: string) => Object.assign(new Error(message), { code });

export function applyOps(d: Draft, actor: "person" | "ai", client: string | null, base: number, ops: unknown, nextId: () => number, now = Date.now()): { revision: number; changes: number; state: unknown; pending: boolean } {
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > LIMITS_EDIT.opsPerCall) throw e("Send between 1 and 20 changes at a time.", "22023");
  if (base !== d.revision) throw e(`The editor has changed since you looked (it is now at revision ${d.revision}). Read it again with get_edit_state and send your changes on top of that.`, "PT409");
  if (d.mode === "compilation" && actor === "ai" && !d.ai_visible) throw e('The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app.', "PT403");
  if (d.mode === "compilation" && actor === "person" && !d.mirrored) throw e("The Ryagram app on your computer has not shared the track list with this page yet. Open it, then try again.", "PT403");
  if (actor === "ai") {
    const recent = (ms: number) => d.ops.filter((x) => x.actor === "ai" && now - x.at < ms).length;
    if (recent(60_000) + ops.length > LIMITS_EDIT.opsPerMinute) throw e("That is more than 60 changes in a minute. Wait a minute and continue.", "PT429");
    if (recent(86_400_000) + ops.length > LIMITS_EDIT.opsPerDay) throw e("That is more than 600 changes in a day, the limit for now. Try tomorrow.", "PT429");
  }
  ops.forEach((o, i) => {
    const p = opProblem(d.mode, o);
    if (p) throw e(`Change ${i + 1} was not accepted, and nothing was changed: ${p}`, "22023");
    if (actor === "ai" && d.ops.some((x) => x.status === "undone" && JSON.stringify(x.op) === JSON.stringify(o) && x.undone_at !== null && now - x.undone_at < LIMITS_EDIT.undoneWindowMs)) {
      throw e(`Change ${i + 1} was not accepted: the person undid exactly this a moment ago. Ask them before doing it again.`, "PT409");
    }
  });
  const revision = d.revision + 1;
  const look = { ...d.look };
  for (const o of ops as Op[]) {
    if (d.mode === "data") {
      const key = o.key as string; const prev = look[key];
      let inverse: Op | null;
      if (o.op === "set_look") { inverse = prev === undefined ? { op: "unset_look", key } : { op: "set_look", key, value: prev }; look[key] = o.value; }
      else { inverse = prev === undefined ? null : { op: "set_look", key, value: prev }; delete look[key]; }
      d.ops.push({ id: nextId(), revision, actor, client, op: o, inverse, status: "applied", at: now, undone_at: null });
    } else {
      d.ops.push({ id: nextId(), revision, actor, client, op: o, inverse: null, status: "pending", at: now, undone_at: null });
    }
  }
  if (d.mode === "data") d.look = look;
  d.revision = revision;
  return { revision, changes: ops.length, state: d.mode === "data" ? { look: d.look } : null, pending: d.mode === "compilation" };
}

/** Undo some ops, newest first. A newer applied change to the same setting stands (skipped); pending compilation ops are simply rejected. */
export function undoOps(d: Draft, ids: number[], now = Date.now()): { undone: number; skipped: number; revision: number; state: unknown } {
  let undone = 0, skipped = 0;
  for (const row of d.ops.filter((x) => ids.includes(x.id)).sort((a, b) => b.id - a.id)) {
    if (row.status === "pending") { row.status = "rejected"; row.undone_at = now; undone++; }
    else if (row.status === "applied" && row.inverse && d.mode === "data") {
      if (d.ops.some((l) => l.id > row.id && l.status === "applied" && l.op.key === row.op.key)) { skipped++; continue; }
      const inv = row.inverse;
      if (inv.op === "set_look") d.look[inv.key as string] = inv.value; else delete d.look[inv.key as string];
      row.status = "undone"; row.undone_at = now; undone++;
    } else skipped++;
  }
  if (undone > 0) d.revision++;
  return { undone, skipped, revision: d.revision, state: d.mode === "data" ? { look: d.look } : null };
}
