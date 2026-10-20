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
  /** REQUESTED from WORKER: node_job_artifacts(access_hash, job_id), the files registered for a job THIS computer holds: [{path, bytes, sha256}]. Used to compare sizes before 'complete'. */
  artifacts(accessHash: string, jobId: string): Promise<{ path: string; bytes: number; sha256?: string }[]>;
  /** register_artifact through node_register_artifact: validates the job state, kind and size; RETURNS the storage path, which the database derives from the job. */
  registerArtifact(accessHash: string, jobId: string, kind: string, bytes: number, sha256: string, durationS: number | null, width: number | null, height: number | null): Promise<string>;
}

export interface NodeStorage {
  /** The size in bytes of the stored object at this path, or null if there is none. The declared size of an upload is a claim; this is the proof. */
  size(path: string): Promise<number | null>;
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
}

export const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no 0 O 1 I L
export const TOKEN_PREFIX = "rgn_";                                  // a node token; the connector's are rga_/rgr_, so the two can never be mistaken
