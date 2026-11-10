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
  /** Title / end cards (BUILDER 11-04): the person's own words on the film's page colour, no picture. Optional: older requests have none. At most 4. */
  cards?: { text: string; where: "start" | "end"; seconds: number }[];
  /** Clip labels (BUILDER 11-04): label every video clip with its file's name ("file") or name and time ("file_and_time"). Optional: absent = no labels, and older requests have none. */
  clip_labels?: "file" | "file_and_time";
  /** Guided footage (NEXT-CONNECT 161): what footage to get and where to put it, written by the AI as a checklist. TEXT ONLY: Ryagram downloads nothing; the person gets the footage themselves. Optional: older requests have none. */
  checklist?: ChecklistItem[];
}
/** One thing for the person to get: what it is, where they might find it (a site's NAME, never an address), what it must contain, the NAME of the folder it goes in (one of the request's folders) and how many files to expect. */
export interface ChecklistItem { id: string; what: string; from: string; must_contain: string; folder: string; count: number }

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
export interface ClipReports { why_clip: unknown | null; draft_messages: unknown | null }
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
  /** NEXT-CONNECT 196: writes a place question for the house computer to answer. The point is rounded to 4 decimals by the database. Asking the same thing twice is one request (repeat: true). */
  askGeo(q: { lat: number; lon: number; minutes: number; categories: string[] }): Promise<{ id: string; state: string; repeat?: boolean }>;
  /** GEO question shapes (migration 20261104000400): compare two places, "will a <category> place at A succeed" (never a yes or no), "where should a <category> place go" (never a place picked). Same rules as askGeo. */
  /** Forecast requests (migration 20261104000500): the person's AI hands over pairs of [year, number]; the house computer forecasts them (ENGINE's ryagram.predict), the answer is read back with getGeo. */
  askForecast(q: { series: [number, number][]; horizon: number; method?: string; breaks?: number[]; unit?: string }): Promise<{ id: string; state: string; repeat?: boolean }>;
  askGeoShape(q: { shape: GeoShape; a?: { lat: number; lon: number }; b?: { lat: number; lon: number }; category?: string; town?: string }): Promise<{ id: string; state: string; repeat?: boolean }>;
  /** One of the person's own place questions, or null. */
  getGeo(id: string): Promise<GeoRow | null>;
  /** County questions (migration 20261109000200, NOT APPLIED): asked here, answered by the house computer with GEO's county tools, read back with county_answer. Optional: a database without the migration has none, and the tools say so. */
  askCounty?(q: { shape: "profile" | "compare"; counties: string[]; kind: string; rule: string | null; year: number | null }): Promise<{ id: string; state: string; repeat?: boolean }>;
  getCounty?(id: string): Promise<CountyRow | null>;
  quote(versionId: string, jobType: "contact_sheet" | "preview" | "final_render"): Promise<Quote>;
  jobById(jobId: string): Promise<(Job & { version_id: string; progress?: number | null; note?: string | null; queue_position?: number | null;
    /** r9: where the job runs. 'owner_local' = on the person's own computer, made by their Ryagram desktop app. Absent = the house. */
    run_on?: string; node?: LocalNode | null }) | null>;
  links(versionId: string, jobId: string | null): Promise<Link[]>;
  /** The live editor (scope read for the state, scope edit for the rest). null = the project is not the person's. Changes are DRAFTS the person sees and saves; the AI never saves, renders or spends from here. */
  editState(projectId: string): Promise<EditState | null>;
  /** The two reports the person's Ryagram app shared for a song film (NEXT-CONNECT 179): the why-clip report and the draft messages, exactly as the app wrote them (untrusted data, checked by the tools that show them). null = not the person's project. Optional: a database without the table says so. */
  clipReports?(projectId: string): Promise<ClipReports | null>;
  editOps(projectId: string, mode: "data" | "compilation", baseRevision: number, ops: Record<string, unknown>[]): Promise<EditResult>;
  /** Takes back the AI's own most recent batch (never the person's changes). */
  editUndoAi(projectId: string, mode: "data" | "compilation"): Promise<EditUndoResult>;
  /** The chat panel's five calls (migrations/20261105000100_chat_editor.sql, NOT APPLIED): `name` is one of the website editor's names (editor_apply_ops, editor_undo, editor_undo_all_ai, my_edit_ops_since,
   *  editor_heartbeat); the answer is the database's own JSON; a refusal throws its { code, message }. Optional: a database without the migration has none, and the tools say so. */
  editorCall?(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Editor Step A (migrations/20261109000100_film_cards.sql, NOT APPLIED): the film's look card. askFilmCard writes a request for the film's CURRENT saved story (asking twice is one request; throws the database's sentences, 22023 not found, PT429 too many);
   *  getFilmCard reads the newest card or where the request stands (null = not the person's film). Optional: a database without the migration has none, and the tool says so. */
  askFilmCard?(projectId: string): Promise<{ id: string; state: string; repeat?: boolean }>;
  getFilmCard?(projectId: string): Promise<FilmCardRead | null>;
}

/** What connect_film_card_get answers. `card` is whatever the engine stored: it is checked (film_card.ts) before anything shows it. */
export interface FilmCardRead {
  state: "none" | "asked" | "claimed" | "failed" | "ready";
  id?: string; card?: unknown; stale?: boolean; built_sha256?: string; current_sha256?: string;
  /** With a stale card: where the request for the CURRENT save stands (null = none asked yet). */
  refresh?: { state: string; fail_code?: string | null; retry?: boolean } | null;
  /** True when the newest request for the current save failed because the engine broke and 10 minutes have passed: asking again is then allowed (the database applies the same rule). */
  retry?: boolean;
  fail_code?: string | null; fail_detail?: string | null; waited_s?: number;
}

/** NEXT-CONNECT 168: public-domain footage plans. NOT wired in the real function: with no `footage` here the tool refuses and writes nothing (the switch is OFF). The plan table is the next piece. */
export interface FootageSwitch {
  enabled(): boolean | Promise<boolean>;
  /** Writes the plan (a source and an item id and a reason: never an address) and returns it. */
  request(plan: { source: "nasa" | "nara"; item_id: string; why: string }): Promise<{ id: string; state: string }>;
}

/** NEXT-CONNECT 193: "what is within N minutes of this place" (Geographic Intelligence). NOT wired in the real function: with no `geo` here the tool refuses and looks nothing up (the switch is OFF).
 *  `within` returns the engine's drive-estimate answer (schema ryagram.drive-estimate/0, ryagram/geo/drivetime.py) for ONE place; the tool checks its shape and that every number is labelled Estimated before it shows a word of it. */
export interface GeoSwitch {
  enabled(): boolean | Promise<boolean>;
}
/** A place question as the database holds it (NEXT-CONNECT 196): asked here, answered by the house computer, read back with geo_answer. `answer` is the engine's ryagram.drive-estimate/0 JSON, untrusted until the tool has checked it. */
export type GeoShape = "compare_sites" | "verdict" | "where_to_go";
/** A county request as the database holds it. `answer` is whatever the house computer stored: it is read by county.ts before anything of it is shown. */
export interface CountyRow {
  id: string; state: "asked" | "claimed" | "answered" | "failed"; shape: "profile" | "compare"; counties: string[]; kind: string; rule: string | null; year: number | null;
  answer: unknown; fail_code: string | null; fail_detail: string | null; waited_s: number;
}
export interface GeoRow {
  id: string; state: "asked" | "claimed" | "answered" | "failed"; lat: number | null; lon: number | null; minutes: number | null; categories: string[];
  /** absent on a database that has not had migration 20261104000400: that is the old shape */
  shape?: "within_minutes" | GeoShape | "forecast"; lat_b?: number | null; lon_b?: number | null; category?: string | null; town?: string | null; horizon?: number | null; method?: string | null; unit?: string | null;
  answer: unknown; fail_code: string | null; fail_detail: string | null; waited_s: number;
}

export interface Deps {
  /** Compiles a JSON Schema into a checker that returns plain-words problems ([] = fine). */
  compile(schema: object): ((value: unknown) => string[]) & { detailed?: (value: unknown) => { instancePath: string; keyword: string; params: Record<string, unknown>; message?: string; schemaPath?: string }[] };
  now?: () => number;
  footage?: FootageSwitch;
  geo?: GeoSwitch;
  /** The forecast tools' own switch (same shape as `geo`): the real function wires none, so they refuse and ask nothing. */
  forecast?: GeoSwitch;
  /** The county tools' own switch (same shape as `geo`): the real function wires none, so they refuse and ask nothing. */
  county?: GeoSwitch;
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
  /** An expected refusal that is a RESULT, not a fault (a story that failed its checks, a render a connection cannot start): isError stays false so the AI reads it as data; the log still counts it as refused. */
  refused?: boolean;
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
  /** The chat editor (second switch, off by default): "model" = a tool the AI sees; "app" = a tool only the chat panel calls (listed with visibility app). Absent = a normal tool. When the switch is off such a tool is "no such tool". */
  chatEditor?: "app" | "model";
  inputSchema: Record<string, unknown>; // JSON Schema; additionalProperties:false always
  run(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
}

export const LIMITS = Object.freeze({
  callsPerMinutePerClient: 60,
  callsPerMinutePerAccount: 120,        // NEXT-CONNECT 169: all of one person's connected AIs together (Claude, ChatGPT, Claude Code ...)
  failedJobsPerStory: 3,                // NEXT-CONNECT 169: after this many failed contact sheets (or previews) of the SAME story, another is refused until the story changes
  ladderPerHourPerUser: 30,             // the editor's number
  linksPerDayPerUser: 50,
  filmCardsPerHourPerUser: 20,           // Editor Step A: asks for a film's look card (reads are the panel's own bucket)
  projectsPerDayPerUser: 20,
  compilationRequestsPerDayPerUser: 50,
  footagePlansPerDayPerUser: 20,
  geoQuestionsPerHourPerUser: 30,
  geoReadsPerHourPerUser: 120,
  countyQuestionsPerHourPerUser: 30,          // BACKLOG CONNECT-4: asks for a county profile or comparison (reads use the place questions' read bucket)
  panelCallsPerMinutePerClient: 90,      // the chat panel polls (about 10 a minute) and beats; its calls have their own buckets so they cannot use up the AI's
  panelCallsPerMinutePerAccount: 150,
  maxBodyBytes: 300 * 1024,             // 256 KB story + envelope
  maxStoryBytes: 256 * 1024,
});
