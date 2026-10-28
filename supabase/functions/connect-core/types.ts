// Connect your own AI: the shared types. Nothing in connect-core names an assistant; the MCP and REST faces
// call the same registry (tools.ts) through the same gate (dispatch.ts).
//
// Trust model: the AI client is UNTRUSTED. Its arguments are data. Every check runs here or in SQL, and no tool
// has an argument that skips, waives or overrides one.
import type { Job, UserData } from "../ai-editor/tools.ts";

export type Scope = "read" | "write" | "render_free" | "render_final" | "edit" | "fetch_data";

/** Who is calling. The real server knows only the token's hash: the database resolves the person and client from it on every call, and no
 *  function takes an owner id. userId and clientId exist only in the in-memory stand-in used by tests. */
export interface Principal { tokenHash: string; userId?: string; clientId?: string }

/** An invited account's consent for one client. Scopes live in OUR table, not in the token. */
export interface Grant { scopes: Scope[] }

/** The server side: invitation/consent, limits, switches and logs. Backed by SQL functions (connect_* RPCs). */
export interface Policy {
  /** null = not invited, not consented, or revoked. Checked on EVERY call; nothing is cached across calls. */
  grantFor(p: Principal): Promise<Grant | null>;
  /** One fixed-window counter in SQL. true = allowed (and counted). */
  hit(p: Principal, bucket: string, max: number, windowSeconds: number): Promise<boolean>;
  /** The final-render switch (control row). Off unless Ryan turns it on. */
  finalRendersEnabled(): Promise<boolean>;
  log(p: Principal, e: CallLog): Promise<void>;
}

/** One row per tool call. No arguments, no story text, no tokens. */
export interface CallLog {
  tool: string;
  credits: number;                      // credits the call held or would have held (0 for free)
  result: "ok" | "refused" | "error";
  code: string;                         // short machine reason: ok | no_grant | scope | rate | payload | args | checks_failed | needs_confirm | ...
  failedChecks: number;                 // how many checks failed (set_story), else 0
}

/** What an AI may ask for: a compilation made on the person's OWN computer from videos that never leave it. DATA only: a phrase, the NAMES of folders the person has chosen in their
 *  maker, switches, and overlay rules by picture NAME. Never a path, a video, a picture or an account detail. The maker reads it when the person opens it; nothing is built from here. */
export interface CompilationRequest {
  schema: "ryagram.compilation-request/0";
  phrase: string;
  search: "every" | "words";
  folders: string[];
  song: boolean;
  clean_cuts: boolean;
  rules: { phrase: string; picture: string; seconds: number; mode: "full" | "centre" | "corner" | "lower_third" }[];
  texts: { text: string; start_s: number; length_s: number; position: "top" | "centre" | "bottom" | "lower_third"; size: "small" | "medium" | "large" }[];
  note: string;
}

export interface ProjectRow { id: string; title: string; created_at: string; updated_at: string }
export interface Quote { credits: number; free: boolean; available: number }
export interface Link { kind: string; url: string; expires_in_s: number }

/** For a job that runs on the person's own computer: when any of their signed-in computers last called the site, and what that computer calls itself (untrusted text). */
export interface LocalNode { last_seen_at: string | null; computer_name: string | null }

/** The person's open editor, as their AI may see it (NEXT-CONNECT 141). Names and numbers only: never a path, a video, a picture or an account detail. */
export interface EditState {
  saved_story_sha256: string | null;
  look_keys: { key: string; kind: string; choices: string[] | null; min: number | null; max: number | null }[] | null;
  data: { revision: number; look: Record<string, unknown>; editor_open: boolean };
  compilation: { revision: number; shared: boolean; tracks: { duration?: number; clips?: Record<string, unknown>[] } | null; pending: number; editor_open: boolean };
  recently_undone: { mode: string; op: Record<string, unknown>; at: string }[];
}
export interface EditResult { revision: number; changes: number; state: unknown; pending: boolean }
export interface EditUndoResult { undone: number; skipped: number; revision: number; state: unknown }

/** What the tools need from the database, ALWAYS as the signed-in person (RLS / connect_* functions). */
/** A download plan as the AI sees it: the website, the state and, when finished, a small receipt (never a file name or a path). */
export interface DownloadRow {
  id: string; host: string; state: string; created_at: string;
  receipt: { bytes: number; sha256: string; members: number; trust_label: string; retrieved: string } | null;
}

export interface Data extends Omit<UserData, "submitJob"> {
  /** The render machine as the public status page shows it: ok, delayed (not checking in right now) or unknown (never seen). */
  renderingState(): Promise<"ok" | "delayed" | "unknown">;
  /** Writes down a download plan for the person's desktop app to show. Throws the database's sentences (PT429 too many waiting, 22023 not valid). */
  requestDownload(url: string, why: string, folder: string): Promise<{ id: string; host: string; state: string }>;
  listDownloads(): Promise<(DownloadRow & { url?: string; why?: string; folder?: string })[]>;
  /** A final render also names the contact sheet and preview it stands on (the database re-checks the ladder). */
  submitJob(versionId: string, jobType: string, params: Record<string, unknown>, sheetId?: string, previewId?: string): Promise<{ id: string; state: string; run_on?: string }>;
  whoami(): Promise<{ label: string; available: number; held: number }>;
  listProjects(): Promise<ProjectRow[]>;
  createProject(title: string): Promise<{ id: string; title: string; version_id: string; number: number }>;
  /** The version a project's tools work on (newest). null when the project is not the person's. */
  currentVersionId(projectId: string): Promise<string | null>;
  /** Saves (replaces) the compilation request on one of the person's projects. null = the project is not theirs. */
  saveCompilationRequest(projectId: string, request: CompilationRequest): Promise<{ sha256: string } | null>;
  quote(versionId: string, jobType: "contact_sheet" | "preview" | "final_render"): Promise<Quote>;
  jobById(jobId: string): Promise<(Job & { version_id: string; progress?: number | null; note?: string | null; queue_position?: number | null;
    /** r9: where the job runs. 'owner_local' = on the person's own computer, made by their Ryagram desktop app. Absent = the house. */
    run_on?: string; node?: LocalNode | null }) | null>;
  links(versionId: string, jobId: string | null): Promise<Link[]>;
  /** The live editor (scope read for the state, scope edit for the rest). null = the project is not the person's. Changes are DRAFTS the person sees and saves; the AI never saves, renders or spends from here. */
  editState(projectId: string): Promise<EditState | null>;
  editOps(projectId: string, mode: "data" | "compilation", baseRevision: number, ops: Record<string, unknown>[]): Promise<EditResult>;
  /** Takes back the AI's own most recent batch (never the person's changes). */
  editUndoAi(projectId: string, mode: "data" | "compilation"): Promise<EditUndoResult>;
}

export interface Deps {
  /** Compiles a JSON Schema into a checker that returns plain-words problems ([] = fine). */
  compile(schema: object): (value: unknown) => string[];
  now?: () => number;
}

export interface ToolCtx {
  principal: Principal;
  data: Data;
  policy: Policy;
  deps: Deps;
}

export interface ToolResult {
  text: string;
  /** Machine-readable twin of the text (MCP structuredContent; REST body). */
  data?: Record<string, unknown>;
  isError?: boolean;
  code?: string;                        // for the log
  credits?: number;                     // for the log
  failedChecks?: number;
}

export interface ToolDef {
  name: string;                         // a-z, 0-9, underscore only (the strictest assistant's rule)
  title: string;
  description: string;
  scope: Scope;
  readOnly: boolean;                    // MCP readOnlyHint; honest, because assistants gate write tools on it
  /** MCP destructiveHint: true only for a tool that REPLACES or deletes what the person already has. Default false. */
  destructive?: boolean;
  /** MCP idempotentHint: asking again with the same arguments changes nothing more. Default = readOnly. */
  idempotent?: boolean;
  /** false = kept out of tools/list (a directory reviewer sees only tools that can work); the server still answers a call with its refusal. Default true. */
  listed?: boolean;
  /** Per-user hourly bucket shared by the render tools, if any. */
  ladder?: boolean;
  inputSchema: Record<string, unknown>; // JSON Schema; additionalProperties:false always
  run(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
}

export const LIMITS = Object.freeze({
  callsPerMinutePerClient: 60,
  ladderPerHourPerUser: 30,             // the editor's number
  linksPerDayPerUser: 50,
  projectsPerDayPerUser: 20,
  compilationRequestsPerDayPerUser: 50,
  maxBodyBytes: 300 * 1024,             // 256 KB story + envelope
  maxStoryBytes: 256 * 1024,
});
