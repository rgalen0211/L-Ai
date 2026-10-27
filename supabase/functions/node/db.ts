// The real database layer: every call is a node_* function, run as the role node_runner, which can execute NOTHING else (WORKER's r9_node_draft.sql).
// No function takes an owner id; the person is resolved inside the database from the token's SHA-256 hash, on every call. The query function is injected
// (index.ts wires npm:postgres), so this mapping is plain TypeScript and unit-testable. The function names marked REQUESTED are not in the 49033a5 draft yet.
import type { CompilationRequestRow, CompilationStatus, EditPendingRow, EditSummaryResult, ExchangeResult, NodeAccount, NodeDb, NodeJob } from "../node-core/types.ts";

export type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/** Text-protocol parameters: objects as JSON text, cast in SQL (the driver is never asked to know jsonb). */
const wire = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
const placeholders = (types: string[]) => types.map((t, i) => (t === "jsonb" ? `$${i + 1}::text::jsonb` : `$${i + 1}::${t}`)).join(", ");

export class NodeSql implements NodeDb {
  private q: Query;
  constructor(q: Query) { this.q = q; }

  private async scalar<T>(name: string, types: string[], args: unknown[]): Promise<T> {
    const rows = await this.q(`select public.${name}(${placeholders(types)}) as r`, args.map(wire));
    return rows[0]?.r as T;
  }
  private async row(name: string, types: string[], args: unknown[]): Promise<Record<string, unknown> | null> {
    const rows = await this.q(`select * from public.${name}(${placeholders(types)})`, args.map(wire));
    return rows[0] ?? null;
  }

  hit(caller: string, bucket: string, max: number, windowSeconds: number) { return this.scalar<boolean>("node_hit", ["text", "text", "int", "int"], [caller, bucket, max, windowSeconds]); }      // REQUESTED
  deviceBegin(deviceHash: string, userCode: string, computerName: string) { return this.scalar<{ user_code: string; expires_in: number; interval: number }>("node_device_begin", ["text", "text", "text"], [deviceHash, userCode, computerName]); }
  deviceExchange(deviceHash: string, tokenHash: string) { return this.scalar<ExchangeResult>("node_device_exchange", ["text", "text"], [deviceHash, tokenHash]); }
  account(accessHash: string) { return this.scalar<{ account: NodeAccount }>("node_account", ["text"], [accessHash]); }
  signout(accessHash: string) { return this.scalar<{ ok: boolean }>("node_signout", ["text"], [accessHash]); }
  claim(accessHash: string): Promise<NodeJob | null> { return this.row("node_claim", ["text"], [accessHash]) as Promise<NodeJob | null>; }
  async heartbeat(accessHash: string, jobId: string, progress: number | null, note: string | null, detail: unknown | null) {
    return !!(await this.scalar<boolean>("node_heartbeat", ["text", "uuid", "numeric", "text", "jsonb"], [accessHash, jobId, progress, note, detail]));
  }
  async reportState(accessHash: string, jobId: string, state: string, errorCode: string | null, errorDetail: string | null, engineCommit: string | null, engineDirty: boolean | null) {
    const r = await this.row("node_report_state", ["text", "uuid", "public.job_state", "text", "text", "text", "boolean"], [accessHash, jobId, state, errorCode, errorDetail, engineCommit, engineDirty]);
    return (r ?? {}) as NodeJob;
  }
  async retry(accessHash: string, jobId: string, errorCode: string, errorDetail: string | null) { return String(await this.scalar("node_retry", ["text", "uuid", "text", "text"], [accessHash, jobId, errorCode, errorDetail])); }
  compilationRequests(accessHash: string) { return this.scalar<CompilationRequestRow[]>("node_compilation_requests", ["text"], [accessHash]); }
  // migrations/20261027000400_live_editor.sql (NOT APPLIED until Ryan applies it)
  editPending(accessHash: string) { return this.scalar<EditPendingRow[]>("node_edit_pending", ["text"], [accessHash]); }
  editPostSummary(accessHash: string, projectId: string, mirror: boolean, aiVisible: boolean, summary: Record<string, unknown> | null, applied: { op_id: number; ok: boolean }[]) {
    return this.scalar<EditSummaryResult>("node_edit_post_summary", ["text", "uuid", "boolean", "boolean", "jsonb", "jsonb"], [accessHash, projectId, mirror, aiVisible, summary, applied]);
  }
  compilationStatus(accessHash: string) { return this.scalar<CompilationStatus>("node_compilation_status", ["text"], [accessHash]); }
  compilationBegin(accessHash: string, title: string, bytes: number, sha256: string, rights: boolean, durationS: number | null, width: number | null, height: number | null) {
    return this.scalar<{ id: string; path: string }>("node_compilation_begin", ["text", "text", "bigint", "text", "boolean", "numeric", "int", "int"], [accessHash, title, bytes, sha256, rights, durationS, width, height]);
  }
  compilationFinish(accessHash: string, id: string) { return this.scalar<{ id: string; expires_at: string }>("node_compilation_finish", ["text", "uuid"], [accessHash, id]); }
  async compilationCancel(accessHash: string, id: string) { return !!(await this.scalar<boolean>("node_compilation_cancel", ["text", "uuid"], [accessHash, id])); }
  async registerArtifact(accessHash: string, jobId: string, kind: string, bytes: number, sha256: string, durationS: number | null, width: number | null, height: number | null) {
    return String(await this.scalar("node_register_artifact", ["text", "uuid", "public.artifact_kind", "bigint", "text", "numeric", "int", "int"], [accessHash, jobId, kind, bytes, sha256, durationS, width, height]));
  }
}
