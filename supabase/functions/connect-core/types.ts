// Connect your own AI: the shared types. Nothing in connect-core names an assistant; the MCP and REST faces
// call the same registry (tools.ts) through the same gate (dispatch.ts).
//
// Trust model: the AI client is UNTRUSTED. Its arguments are data. Every check runs here or in SQL, and no tool
// has an argument that skips, waives or overrides one.
import type { Job, UserData } from "../ai-editor/tools.ts";

export type Scope = "read" | "write" | "render_free" | "render_final";

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

export interface ProjectRow { id: string; title: string; created_at: string; updated_at: string }
export interface Quote { credits: number; free: boolean; available: number }
export interface Link { kind: string; url: string; expires_in_s: number }

/** For a job that runs on the person's own computer: when any of their signed-in computers last called the site, and what that computer calls itself (untrusted text). */
export interface LocalNode { last_seen_at: string | null; computer_name: string | null }

/** What the tools need from the database, ALWAYS as the signed-in person (RLS / connect_* functions). */
export interface Data extends Omit<UserData, "submitJob"> {
  /** A final render also names the contact sheet and preview it stands on (the database re-checks the ladder). */
  submitJob(versionId: string, jobType: string, params: Record<string, unknown>, sheetId?: string, previewId?: string): Promise<{ id: string; state: string; run_on?: string }>;
  whoami(): Promise<{ label: string; available: number; held: number }>;
  listProjects(): Promise<ProjectRow[]>;
  createProject(title: string): Promise<{ id: string; title: string; version_id: string; number: number }>;
  /** The version a project's tools work on (newest). null when the project is not the person's. */
  currentVersionId(projectId: string): Promise<string | null>;
  quote(versionId: string, jobType: "contact_sheet" | "preview" | "final_render"): Promise<Quote>;
  jobById(jobId: string): Promise<(Job & { version_id: string; progress?: number | null; note?: string | null; queue_position?: number | null;
    /** r9: where the job runs. 'owner_local' = on the person's own computer, made by their Ryagram desktop app. Absent = the house. */
    run_on?: string; node?: LocalNode | null }) | null>;
  links(versionId: string, jobId: string | null): Promise<Link[]>;
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
  maxBodyBytes: 300 * 1024,             // 256 KB story + envelope
  maxStoryBytes: 256 * 1024,
});
