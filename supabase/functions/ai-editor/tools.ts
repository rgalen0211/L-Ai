// The editor's tools (2A-8). Every tool runs through UserData, which carries the PERSON'S
// token, so it can do only what they could do by hand (RLS). Tools are pinned to the
// conversation's version: no tool takes a version or project id from the model.
// Starting a render counts against the hourly cap; the final render is never started here.
import { build, DATASETS, RENDER_VIEWS, TEMPLATES } from "../_shared/templates.ts";
import { untrusted } from "./prompt.ts";
import { LOOK_FIELDS, LOOK_THEMES, applyLook } from "../_shared/look.ts";

export interface Job {
  id: string; job_type: string; state: string; attempt: number; created_at: string;
  story_sha256: string; engine_commit: string | null;
  error_class: string | null; error_code: string | null; error_detail: string | null;
}
export interface VersionView {
  version: { id: string; project_id: string; number: number; state: string; story_spec: Record<string, unknown>; story_sha256: string };
  project: { id: string; title: string };
  jobs: Job[];
}
export interface UserData {
  getVersion(versionId: string): Promise<VersionView>;
  listVersions(projectId: string): Promise<{ id: string; number: number; state: string; created_at: string }[]>;
  saveStory(versionId: string, story: unknown): Promise<{ story_sha256: string }>;
  createVersion(projectId: string, fromVersionId: string): Promise<{ id: string; number: number }>;
  submitJob(versionId: string, jobType: string, params: Record<string, unknown>): Promise<{ id: string; state: string }>;
  currentEngine(): Promise<string | null>;
  readReceipt(versionId: string, jobId: string | null): Promise<string | null>;
}
export interface ToolContext {
  data: UserData;
  versionId: string;
  allowExecution(): Promise<boolean>;
  addRuling(text: string): Promise<number>;
  actions: Record<string, unknown>[];          // what the page should refresh or show
}
export interface ToolOutcome { text: string; isError?: boolean; escalate?: string }

const PERIOD = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const tool = (name: string, description: string, properties: Record<string, unknown> = {}) => ({
  name, description, strict: true,
  input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});

// set_look's inputs, built from the same field table the page's controls use. Every property is required
// and nullable (strict tools), so the model names what it changes and passes null for the rest.
const LOOK_SCOPE: Record<string, string> = { film: "film_", title: "title_", view: "view_", look: "" };
const LOOK_TOOL_PROPS: Record<string, unknown> = {
  title_index: nullable("integer", { minimum: 0, maximum: 39 }),
  view_index: nullable("integer", { minimum: 0, maximum: 39 }),
  theme: { type: ["string", "null"], enum: [...Object.keys(LOOK_THEMES), null] },
  clear: nullable("array", { items: { type: "string", maxLength: 40 }, maxItems: 30 }),
};
for (const [scope, fields] of Object.entries(LOOK_FIELDS as Record<string, Record<string, { kind: string; values?: string[]; max?: number }>>)) {
  for (const [name, spec] of Object.entries(fields)) {
    const key = LOOK_SCOPE[scope] + name;
    LOOK_TOOL_PROPS[key] = spec.kind === "num" || spec.kind === "steps" ? nullable(spec.kind === "steps" ? "string" : "number")
      : spec.kind === "bool" ? nullable("boolean")
      : spec.kind === "enum" ? { type: ["string", "null"], enum: [...spec.values!, null] }
      : nullable("string", { maxLength: spec.max ?? 20 });
  }
}

// The model's flat input -> a look patch (see _shared/look.ts).
export function lookPatch(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = { film: {}, title: {}, view: {}, look: {} };
  if (input.theme != null) patch.theme = input.theme;
  if (input.title_index != null) (patch.title as Record<string, unknown>).index = input.title_index;
  if (input.view_index != null) (patch.view as Record<string, unknown>).index = input.view_index;
  const clear = new Set(Array.isArray(input.clear) ? input.clear.map(String) : []);
  for (const [scope, fields] of Object.entries(LOOK_FIELDS as Record<string, Record<string, unknown>>)) {
    for (const name of Object.keys(fields)) {
      const key = LOOK_SCOPE[scope] + name;
      if (clear.has(key)) { (patch[scope] as Record<string, unknown>)[name] = null; clear.delete(key); }
      else if (input[key] != null) (patch[scope] as Record<string, unknown>)[name] = input[key];
    }
  }
  return { patch, unknown: [...clear] };
}

export const TOOLS = [
  tool("inspect_project", "The project, this version (state and story), its versions and recent jobs."),
  tool("list_versions", "All versions of this project, newest last."),
  tool("search_dataset", "Search the catalog of datasets a film can use.", { query: { type: "string", maxLength: 100 } }),
  tool("inspect_dataset", "Details of one catalog dataset: what it measures and the periods it covers.",
       { dataset_id: { type: "string", maxLength: 64 } }),
  tool("fetch_dataset", "Check that a catalog dataset is available to the render worker (it fetches and caches data itself).",
       { dataset_id: { type: "string", maxLength: 64 } }),
  tool("draft_story", "Replace this version's story with a template: a title card and one data view.", {
    template: { type: "string", enum: TEMPLATES.map((t) => t.id) },
    dataset_id: { type: "string", maxLength: 64 },
    headline: { type: "string", maxLength: 160 },
  }),
  tool("set_mapping", "Change the first data view: its dataset, view and period window.", {
    dataset_id: { type: "string", maxLength: 64 },
    view: { type: "string", enum: RENDER_VIEWS },
    start: nullable("string", { maxLength: 10 }),
    end: nullable("string", { maxLength: 10 }),
  }),
  tool("set_look", "Change wording, years, pace or colours of the story without replacing it: any of the named settings; null leaves a setting alone and a name in clear removes it.", LOOK_TOOL_PROPS),
  tool("edit_story", "Replace the whole story with this JSON text (the worker's story schema v1). Prefer set_mapping or draft_story.",
       { story_json: { type: "string", maxLength: 60000 } }),
  tool("generate_contact_sheet", "Start a contact sheet of the current story (free; runs the correctness checks).",
       { periods: nullable("array", { items: { type: "string", maxLength: 4 }, maxItems: 5 }) }),
  tool("run_preflight_gates", "Run Ryagram's correctness checks on the current story (they run with a contact sheet)."),
  tool("request_preview", "Start a preview of up to 10 seconds.", {
    start_seconds: nullable("number"), end_seconds: nullable("number"),
  }),
  tool("inspect_gate_results", "What the correctness checks and failed jobs said for this version."),
  tool("get_job_status", "The state of this version's jobs."),
  tool("request_final_render", "Say whether the final film is ready to render and what it would use. It never starts one: only the person can, on the page."),
  tool("create_version", "Make a new version copied from this one (to keep this one unchanged)."),
  tool("explain_receipt", "Read a finished job's receipt (what exactly was rendered, from which data and code).",
       { job_id: nullable("string", { maxLength: 36 }) }),
  tool("note_ruling", "Remember a lasting decision the person made for this project.", { text: { type: "string", maxLength: 300 } }),
  tool("escalate", "Hand this turn to the more capable model, for difficult editorial judgement.", { reason: { type: "string", maxLength: 200 } }),
];

export const EXECUTION_TOOLS = new Set(["generate_contact_sheet", "run_preflight_gates", "request_preview"]);

function storySummary(story: Record<string, unknown>): string {
  const seq = (story?.sequence ?? {}) as { clips?: Record<string, unknown>[] };
  if (!seq.clips?.length) return "The story is blank.";
  return seq.clips.map((c, i) => c.kind === "render"
    ? `${i + 1}. data view: ${c.view} of ${c.dataset}, ${c.start ?? "?"} to ${c.end ?? "?"}`
    : `${i + 1}. title card: ${JSON.stringify(c.headline ?? c.subhead ?? "")}`).join("\n");
}
function jobLine(j: Job): string {
  const problem = j.error_detail ? ` (${j.error_class ?? "error"}: ${j.error_detail})` : "";
  return `${j.job_type} ${j.state}${j.attempt > 1 ? `, attempt ${j.attempt}` : ""}, ${j.created_at.slice(0, 16)}${problem}`;
}
const catalogLine = (id: string) => `${id}: ${DATASETS[id].label}, ${DATASETS[id].start} to ${DATASETS[id].end}`;

// The same ladder rule as the app (assets/app-jobs.js ladder()).
export function ladder(jobs: Job[], storySha: string, engine: string | null) {
  const done = (t: string) => jobs.filter((j) => j.job_type === t && j.state === "complete" && j.story_sha256 === storySha)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const sheets = done("contact_sheet");
  const preview = done("preview")[0] ?? null;
  const sheet = preview ? sheets.find((s) => s.engine_commit && s.engine_commit === preview.engine_commit) ?? null : sheets[0] ?? null;
  let missing: string | null = null;
  if (!sheets.length && !preview) missing = "Make a contact sheet and a preview of this story first.";
  else if (!preview) missing = "Make a preview of this story first.";
  else if (!preview.engine_commit) missing = "This preview has no engine version recorded. Make a new preview.";
  else if (!sheets.length) missing = "Make a contact sheet of this story first.";
  else if (!sheet) missing = "The contact sheet and the preview were drawn by different versions of the engine. Make a new contact sheet.";
  else if (engine && engine !== preview.engine_commit) missing = "The engine has been updated since this preview. Make a new contact sheet and preview.";
  return { sheet, preview, ready: !missing, missing };
}

function checkStory(story: unknown): string | null {
  if (!story || typeof story !== "object" || Array.isArray(story)) return "The story must be a JSON object.";
  const s = story as Record<string, unknown>;
  if (s.schema !== 1 || s.engine !== "sequence") return 'The story needs "schema": 1 and "engine": "sequence".';
  const clips = (s.sequence as { clips?: unknown[] } | undefined)?.clips;
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > 40) return "The story needs 1 to 40 clips.";
  if (JSON.stringify(story).length > 256 * 1024) return "The story is too large.";
  return null;
}

async function save(ctx: ToolContext, story: unknown, what: string): Promise<ToolOutcome> {
  const problem = checkStory(story);
  if (problem) return { text: problem, isError: true };
  try {
    await ctx.data.saveStory(ctx.versionId, story);
  } catch (e) {
    return { text: `Couldn't save: ${(e as Error).message}`, isError: true };
  }
  ctx.actions.push({ type: "story_changed" });
  return { text: `${what} Saved. Earlier sheets and previews no longer match; a new contact sheet is the next step.` };
}

async function submit(ctx: ToolContext, jobType: string, params: Record<string, unknown>, label: string): Promise<ToolOutcome> {
  if (!(await ctx.allowExecution())) {
    return { text: "The hourly limit for starting sheets and previews from the editor is reached, or the editor was switched off. The person can still start one from the Render panel.", isError: true };
  }
  try {
    const job = await ctx.data.submitJob(ctx.versionId, jobType, params);
    ctx.actions.push({ type: "job_submitted", job_type: jobType, job_id: job.id });
    return { text: `${label} queued (job ${job.id}). Progress shows in the Render panel.` };
  } catch (e) {
    return { text: `Couldn't start it: ${(e as Error).message}`, isError: true };
  }
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const v = await ctx.data.getVersion(ctx.versionId);
  const story = v.version.story_spec ?? {};
  switch (name) {
    case "inspect_project": {
      const versions = await ctx.data.listVersions(v.project.id);
      return { text: [
        untrusted("project-title", v.project.title),
        `Version r${v.version.number}, state ${v.version.state}. Versions: ${versions.map((x) => `r${x.number} (${x.state})`).join(", ")}.`,
        `Story:`, untrusted("story", storySummary(story)),
        `Recent jobs:`, v.jobs.slice(0, 6).map(jobLine).join("\n") || "none",
      ].join("\n") };
    }
    case "list_versions": {
      const versions = await ctx.data.listVersions(v.project.id);
      return { text: versions.map((x) => `r${x.number}: ${x.state}, created ${x.created_at.slice(0, 10)}`).join("\n") };
    }
    case "search_dataset": {
      const q = String(input.query ?? "").toLowerCase();
      const hits = Object.keys(DATASETS).filter((id) => !q || id.includes(q) || DATASETS[id].label.toLowerCase().includes(q));
      return { text: hits.length ? hits.map(catalogLine).join("\n") : "No catalog dataset matches. The catalog is small for now: " + Object.keys(DATASETS).join(", ") };
    }
    case "inspect_dataset":
    case "fetch_dataset": {
      const id = String(input.dataset_id ?? "");
      if (!DATASETS[id]) return { text: `"${id}" is not in the catalog. Use search_dataset.`, isError: true };
      const views = TEMPLATES.filter((t) => t.datasets.includes(id)).map((t) => t.view);
      return { text: `${catalogLine(id)}. Tried and tested views: ${views.join(", ") || "none yet"}.${name === "fetch_dataset" ? " The render worker fetches and caches it; nothing to download." : ""}` };
    }
    case "draft_story": {
      try {
        return await save(ctx, build(String(input.template), String(input.dataset_id), input.headline), `Drafted a ${input.template} story on ${input.dataset_id}.`);
      } catch (e) {
        return { text: (e as Error).message, isError: true };
      }
    }
    case "set_mapping": {
      const dataset = String(input.dataset_id ?? "");
      const view = String(input.view ?? "");
      if (!DATASETS[dataset]) return { text: `"${dataset}" is not in the catalog.`, isError: true };
      if (!RENDER_VIEWS.includes(view)) return { text: `"${view}" is not a view.`, isError: true };
      for (const p of [input.start, input.end]) {
        if (p != null && !PERIOD.test(String(p))) return { text: `"${p}" is not a period like 2016 or 2016-03.`, isError: true };
      }
      const clips = ((story.sequence as { clips?: Record<string, unknown>[] })?.clips ?? []).map((c) => ({ ...c }));
      const i = clips.findIndex((c) => c.kind === "render");
      if (i < 0) return { text: "The story has no data view yet. Use draft_story first.", isError: true };
      clips[i] = { ...clips[i], dataset, view, start: input.start ?? DATASETS[dataset].start, end: input.end ?? DATASETS[dataset].end };
      if (String(clips[i].start) > String(clips[i].end)) return { text: "The start is after the end.", isError: true };
      return await save(ctx, { ...story, sequence: { ...(story.sequence as object), clips } }, `Data view set to ${view} of ${dataset}.`);
    }
    case "set_look": {
      const { patch, unknown } = lookPatch(input);
      if (unknown.length) return { text: `Not settings I can clear: ${unknown.join(", ")}.`, isError: true };
      const out = applyLook(story, patch);
      if (!out.ok) return { text: out.problems.join(" "), isError: true };
      if (!out.changed.length) return { text: "Nothing to change." };
      return await save(ctx, out.story, `Changed: ${out.changed.join("; ")}.${out.notes.length ? " " + out.notes.join(" ") : ""}`);
    }
    case "edit_story": {
      let parsed: unknown;
      try { parsed = JSON.parse(String(input.story_json ?? "")); } catch { return { text: "That isn't valid JSON.", isError: true }; }
      return await save(ctx, parsed, "Story replaced.");
    }
    case "generate_contact_sheet": {
      const periods = Array.isArray(input.periods) && input.periods.length ? input.periods : null;
      if (periods && (periods.length < 3 || periods.some((p) => !/^[0-9]{4}$/.test(String(p))))) {
        return { text: "Periods must be 3 to 5 years like 2016.", isError: true };
      }
      return await submit(ctx, "contact_sheet", periods ? { periods } : {}, "Contact sheet");
    }
    case "run_preflight_gates":
      return await submit(ctx, "contact_sheet", {}, "The correctness checks run with a contact sheet, so a contact sheet was");
    case "request_preview": {
      const a = input.start_seconds == null ? 0 : Number(input.start_seconds);
      const b = input.end_seconds == null ? a + 10 : Number(input.end_seconds);
      if (!(a >= 0 && b > a && b - a <= 10)) return { text: "A preview window is at most 10 seconds, with start before end.", isError: true };
      return await submit(ctx, "preview", { window_s: [a, b] }, "Preview");
    }
    case "inspect_gate_results": {
      const bad = v.jobs.filter((j) => ["failed", "editorial_action_required"].includes(j.state));
      return { text: bad.length ? untrusted("job-results", bad.slice(0, 6).map(jobLine).join("\n")) : "No failed checks or jobs for this version." };
    }
    case "get_job_status":
      return { text: v.jobs.length ? v.jobs.slice(0, 10).map(jobLine).join("\n") : "No jobs yet." };
    case "request_final_render": {
      const l = ladder(v.jobs, v.version.story_sha256, await ctx.data.currentEngine());
      if (!l.ready) return { text: `Not ready: ${l.missing}` };
      ctx.actions.push({ type: "needs_approval", kind: "final_render", sheet_job_id: l.sheet!.id, preview_job_id: l.preview!.id });
      return { text: "Ready. The person must press \"Render final film\" on the page; that click is their approval. Tell them so. You cannot start it." };
    }
    case "create_version": {
      const nv = await ctx.data.createVersion(v.project.id, v.version.id);
      ctx.actions.push({ type: "version_created", version_id: nv.id, number: nv.number });
      return { text: `Made r${nv.number} as a copy. This conversation stays on r${v.version.number}; the person can open r${nv.number} from the project page.` };
    }
    case "explain_receipt": {
      const text = await ctx.data.readReceipt(ctx.versionId, (input.job_id as string | null) ?? null);
      if (!text) return { text: "No receipt found for a finished job on this version.", isError: true };
      return { text: untrusted("receipt", text.slice(0, 6000)) };
    }
    case "note_ruling": {
      try {
        const n = await ctx.addRuling(String(input.text ?? ""));
        return { text: `Noted (${n} ruling${n === 1 ? "" : "s"} for this project).` };
      } catch (e) {
        return { text: (e as Error).message, isError: true };
      }
    }
    case "escalate":
      return { text: "Escalating.", escalate: String(input.reason ?? "") };
    default:
      return { text: `Unknown tool ${name}.`, isError: true };
  }
}
