// What the `node` function needs from the database and from storage. The real ones call the node_* SQL functions as the role node_runner
// (node/db.ts) and sign an upload URL (node/index.ts); the tests use the in-memory stand-in in fake.ts, which keeps the same rules as WORKER's
// r9_node_draft.sql (never applied). Nothing here takes an owner id: the person is resolved INSIDE the database from the token's hash, on every call.

export interface ExchangeResult { state: string; interval?: number; expires_in?: number; account?: NodeAccount }

/** The job columns a node may see. The database row has more (lease, worker ids); those never leave the function. */
export const JOB_FIELDS = ["id", "owner_id", "project_id", "version_id", "job_type", "state", "attempt", "story", "params", "dataset_id",
  "sheet_job_id", "preview_job_id", "approved_by", "approved_at", "ladder_engine_commit"] as const;
export type NodeJob = Record<string, unknown>;

/** The email is MASKED by the database (s***@example.com): enough to notice the wrong account, not to read the address. */
export interface NodeAccount { email?: string; computer_name: string; local_compute: boolean; approved_until?: string }

export interface NodeDb {
  /** REQUESTED from WORKER (rev3 has no per-caller limit): node_hit, a copy of connect_anon_hit for the node role. The caller is a salted hash, never an address. true = allowed. */
  hit(caller: string, bucket: string, max: number, windowSeconds: number): Promise<boolean>;
  /** node_device_begin: stores only the hash of the device secret; the database owns the interval and the 10 minutes. */
  deviceBegin(deviceHash: string, userCode: string, computerName: string): Promise<{ user_code: string; expires_in: number; interval: number }>;
  /** node_device_exchange: the poll. The database owns the states (authorization_pending, slow_down with a longer interval, access_denied, expired_token, ok) and mints the token ONCE from the hash we give it. */
  deviceExchange(deviceHash: string, tokenHash: string): Promise<ExchangeResult>;
  /** node_account(access_hash) */
  account(accessHash: string): Promise<{ account: NodeAccount }>;
  /** node_signout(access_hash): revokes THIS token. */
  signout(accessHash: string): Promise<{ ok: boolean }>;
  claim(accessHash: string): Promise<NodeJob | null>;
  heartbeat(accessHash: string, jobId: string, progress: number | null, note: string | null, detail: unknown | null): Promise<boolean>;
  reportState(accessHash: string, jobId: string, state: string, errorCode: string | null, errorDetail: string | null, engineCommit: string | null, engineDirty: boolean | null): Promise<NodeJob>;
  retry(accessHash: string, jobId: string, errorCode: string, errorDetail: string | null): Promise<string>;
  /** register_artifact through node_register_artifact: validates the job state, kind and size; RETURNS the storage path, which the database derives from the job. */
  registerArtifact(accessHash: string, jobId: string, kind: string, bytes: number, sha256: string, durationS: number | null, width: number | null, height: number | null): Promise<string>;
  /** node_compilation_status: the launch check for private links (plan, limits, switch). Creates nothing. */
  compilationStatus(accessHash: string): Promise<CompilationStatus>;
  /** node_compilation_begin: the person asked for a private link and ticked the rights box. The database re-checks switch, plan and limits and CHOOSES the path. */
  compilationBegin(accessHash: string, title: string, bytes: number, sha256: string, rights: boolean, durationS: number | null, width: number | null, height: number | null): Promise<{ id: string; path: string }>;
  /** node_compilation_finish: the plan is checked again and the stored size must equal the size said. */
  compilationFinish(accessHash: string, id: string): Promise<{ id: string; expires_at: string }>;
  /** node_compilation_requests: the requests the person's AI wrote (NEXT-CONNECT 131b). READ ONLY: the computer's token resolves the person, only that person's rows come back (at most 20, newest first),
   *  each is data (a phrase, folder names, switches, a note), and reading starts nothing and touches no credit. */
  compilationRequests(accessHash: string): Promise<CompilationRequestRow[]>;
  /** node_compilation_cancel: an upload that failed or was given up. */
  compilationCancel(accessHash: string, id: string): Promise<boolean>;
  /** node_download_plans (NEXT-CONNECT 152): the download plans the person's AI wrote that still wait or run, for THIS computer's person (at most 5, newest first). Data only: reading starts nothing. */
  downloadPlans(accessHash: string): Promise<DownloadPlanRow[]>;
  /** node_download_update: the app tells the STATE of one plan (and, with 'done', a small receipt: host, size, SHA-256, never a file name or a path). null = not this person's plan. */
  downloadUpdate(accessHash: string, id: string, state: string, receipt: Record<string, unknown> | null): Promise<string | null>;
  /** node_edit_pending (NEXT-CONNECT 142): the changes the person's AI (or their web editor) has queued for their open compilation, which this computer applies locally. Data only, at most 100, oldest first. */
  editPending(accessHash: string): Promise<EditPendingRow[]>;
  /** node_edit_post_summary: mirror (or stop mirroring) the track summary of one of the person's projects, with the person's own tick for their AI, and say which waiting changes were applied. Names and times only. */
  editPostSummary(accessHash: string, projectId: string, mirror: boolean, aiVisible: boolean, summary: Record<string, unknown> | null, applied: { op_id: number; ok: boolean }[]): Promise<EditSummaryResult>;
}

/** One saved request, as the database returns it. The router passes on only these five fields. */
export interface CompilationRequestRow { project_id: string; title: string; request: Record<string, unknown>; sha256: string; updated_at: string }

/** One download plan, as the database returns it: no owner, no account detail. */
export interface DownloadPlanRow { id: string; request: Record<string, unknown>; state: string }

/** One waiting change, as the database returns it: no owner, no account detail. */
export interface EditPendingRow { id: number; project_id: string; revision: number; client: string | null; op: Record<string, unknown> }
export interface EditSummaryResult { revision: number; mirrored: boolean; ai_visible: boolean }

/** What the app's launch check gets (node_compilation_status): the facts about the person's plan, never a price or an account detail. */
export interface CompilationStatus {
  switch_on: boolean; plan: string | null; active: boolean; allowed: boolean;
  max_film_bytes?: number | null; max_kept_bytes?: number | null; starts_per_hour?: number | null; kept_bytes?: number;
}

export interface NodeStorage {
  /** A signed upload URL for exactly this one path. The path comes from the database, never from the request. */
  signUpload(path: string): Promise<string>;
}

export interface NodeDeps {
  db: NodeDb;
  storage: NodeStorage;
  /** Where the person approves a code, e.g. https://uselai.com/app (no trailing slash). */
  approvalBase: string;
  /** A secret salt for the rate-limit caller hash. */
  salt: string;
  /** The largest file a node may upload, whatever the database's own per-kind limit is. */
  maxFileBytes?: number;
  /** PRIVATE LINKS FOR FILMS MADE ON THE PERSON'S OWN COMPUTER (NEXT-CONNECT 120): the four /node/compilation/* routes exist only when this is true. OFF unless the function is given the setting. */
  compilationLinksOn?: boolean;
  /** The largest compilation film this function will sign an upload for, whatever the person's plan says (the database's plan limit is the real one). */
  maxCompilationBytes?: number;
}

export const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no 0 O 1 I L
export const TOKEN_PREFIX = "rgn_";                                  // a node token; the connector's are rga_/rgr_, so the two can never be mistaken
