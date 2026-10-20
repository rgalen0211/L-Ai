// What the `node` function needs from the database and from storage. The real ones call the node_* SQL functions as the role node_runner
// (node/db.ts) and sign an upload URL (node/index.ts); the tests use the in-memory stand-in in fake.ts, which keeps the same rules as WORKER's
// r9_node_draft.sql (never applied). Nothing here takes an owner id: the person is resolved INSIDE the database from the token's hash, on every call.

export type DeviceState = "pending" | "approved" | "denied" | "expired" | "used" | "unknown";

/** The job columns a node may see. The database row has more (lease, worker ids); those never leave the function. */
export const JOB_FIELDS = ["id", "owner_id", "project_id", "version_id", "job_type", "state", "attempt", "story", "params", "dataset_id",
  "sheet_job_id", "preview_job_id", "approved_by", "approved_at", "ladder_engine_commit"] as const;
export type NodeJob = Record<string, unknown>;

export interface NodeAccount { email?: string; device_name: string; local_compute: boolean; expires_at: string }

export interface NodeDb {
  /** Per-caller limit; the caller is a salted hash, never an address. true = allowed. */
  hit(caller: string, bucket: string, max: number, windowSeconds: number): Promise<boolean>;
  /** node_device_begin: stores only the hash of the device secret. Returns when the code ends (ISO). */
  deviceBegin(deviceHash: string, userCode: string, deviceName: string): Promise<string>;
  /** REQUESTED from WORKER (not in the 49033a5 draft): node_device_state(hash) so the app can tell 'not yet' from 'denied' from 'ended'. */
  deviceState(deviceHash: string): Promise<DeviceState>;
  /** node_device_exchange: once only; stores only the hash of the new token. Returns when the token ends (ISO). */
  deviceExchange(deviceHash: string, accessHash: string): Promise<string>;
  /** REQUESTED from WORKER: node_account(access_hash). */
  account(accessHash: string): Promise<NodeAccount>;
  /** REQUESTED from WORKER: node_signout(access_hash), revokes THIS token. */
  signout(accessHash: string): Promise<boolean>;
  claim(accessHash: string): Promise<NodeJob | null>;
  heartbeat(accessHash: string, jobId: string, progress: number | null, note: string | null, detail: unknown | null): Promise<boolean>;
  reportState(accessHash: string, jobId: string, state: string, errorCode: string | null, errorDetail: string | null, engineCommit: string | null, engineDirty: boolean | null): Promise<NodeJob>;
  retry(accessHash: string, jobId: string, errorCode: string, errorDetail: string | null): Promise<string>;
  /** register_artifact through node_register_artifact: validates the job state, kind and size; RETURNS the storage path, which the database derives from the job. */
  registerArtifact(accessHash: string, jobId: string, kind: string, bytes: number, sha256: string, durationS: number | null, width: number | null, height: number | null): Promise<string>;
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
}

export const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no 0 O 1 I L
export const TOKEN_PREFIX = "rgn_";                                  // a node token; the connector's are rga_/rgr_, so the two can never be mistaken
