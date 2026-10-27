// The real database layer: every call is `select public.connect_x(...)` as the role connect_runner, which can do NOTHING else.
// No function takes an owner id; the person is resolved inside the database from the token's SHA-256 hash, on every call.
// The query function is injected (index.ts wires npm:postgres), so this mapping is plain TypeScript and unit-testable.
import type { AuthStore } from "../connect-core/authstore.ts";
import type { Data, Grant, Policy, Principal, Scope } from "../connect-core/types.ts";

export type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/** Text-protocol parameters: arrays as Postgres array literals, objects as JSON. */
function wire(v: unknown): unknown {
  if (Array.isArray(v)) return "{" + v.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",") + "}";
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

export class ConnectDb {
  private q: Query;
  private appUrl: string;
  constructor(q: Query, appUrl: string) { this.q = q; this.appUrl = appUrl; }

  private async fn<T = unknown>(name: string, types: string[], args: unknown[]): Promise<T> {
    // jsonb and array parameters travel as TEXT and are cast in SQL. If the driver is told the parameter is jsonb it JSON-encodes a string a second time
    // (a story arrived as a JSON string, found against the real database), so the driver is never asked to know those types.
    const ph = types.map((t, i) => (t === "jsonb" || t.endsWith("[]") ? `$${i + 1}::text::${t}` : `$${i + 1}::${t}`)).join(", ");
    const rows = await this.q(`select public.${name}(${ph}) as r`, args.map(wire));
    return rows[0]?.r as T;
  }

  /** A bearer token -> a principal, or null. Only the hash goes to the database. */
  async verify(tokenHash: string): Promise<Principal | null> {
    const scopes = await this.fn<string[] | null>("connect_scopes", ["text"], [tokenHash]);
    return scopes && scopes.length ? { tokenHash } : null;
  }

  authStore(): AuthStore {
    return {
      registerClient: (name, uris) => this.fn<string>("connect_register_client", ["text", "text[]"], [name, uris]),
      beginAuthorization: (a) => this.fn<string>("connect_begin_authorization", ["text", "text", "text", "text", "text", "text", "text", "text"],
        [a.clientId, a.redirectUri, a.state, a.codeChallenge, a.method, a.scope, a.resource, a.issuer]),
      exchangeCode: (a) => this.fn("connect_exchange_code", ["text", "text", "text", "text", "text", "text"],
        [a.codeHash, a.clientId, a.redirectUri, a.verifier, a.accessHash, a.refreshHash]),
      refresh: (a) => this.fn("connect_refresh", ["text", "text", "text", "text"], [a.refreshHash, a.clientId, a.accessHash, a.newRefreshHash]),
      revoke: async (hash) => { await this.fn("connect_revoke", ["text"], [hash]); },
      hit: (caller, bucket, max, windowSeconds) => this.fn<boolean>("connect_anon_hit", ["text", "text", "int", "int"], [caller, bucket, max, windowSeconds]),
    };
  }

  policy(): Policy {
    return {
      grantFor: async (p): Promise<Grant | null> => {
        const scopes = await this.fn<string[] | null>("connect_scopes", ["text"], [p.tokenHash]);
        return scopes && scopes.length ? { scopes: scopes as Scope[] } : null;
      },
      hit: (p, bucket, max, windowSeconds) => this.fn<boolean>("connect_hit", ["text", "text", "int", "int"], [p.tokenHash, bucket, max, windowSeconds]),
      finalRendersEnabled: () => this.fn<boolean>("connect_final_enabled", [], []),
      log: async (p, e) => {
        await this.fn("connect_log", ["text", "text", "int", "text", "text", "int"], [p.tokenHash, e.tool, e.credits, e.result, e.code, e.failedChecks]);
      },
    };
  }

  data(p: Principal): Data {
    const h = p.tokenHash;
    const self = this;
    const d: Data = {
      whoami: () => self.fn("connect_whoami", ["text"], [h]),
      listProjects: () => self.fn("connect_list_projects", ["text"], [h]),
      async createProject(title) {
        const r = await self.fn<{ id: string; title: string; version_id?: string; number?: number }>("connect_create_project", ["text", "text"], [h, title]);
        const version_id = r.version_id ?? (await d.currentVersionId(r.id)) ?? "";
        return { id: r.id, title: r.title, version_id, number: r.number ?? 1 };
      },
      requestDownload: (url, why, folder) => self.fn("connect_request_download", ["text", "text", "text", "text"], [h, url, why, folder]),
      listDownloads: () => self.fn("connect_list_downloads", ["text"], [h]),
      async saveCompilationRequest(projectId, request) {
        // connect_set_compilation_request lives in migrations/20261026000300_compilation_requests.sql (NOT APPLIED until Ryan applies it): it returns the request's SHA-256, or null for a project that is not the person's.
        const sha = await self.fn<string | null>("connect_set_compilation_request", ["text", "uuid", "jsonb"], [h, projectId, request]);
        return sha ? { sha256: sha } : null;
      },
      currentVersionId: (projectId) => self.fn("connect_current_version", ["text", "uuid"], [h, projectId]),
      getVersion: (versionId) => self.fn("connect_get_version", ["text", "uuid"], [h, versionId]),
      listVersions: (projectId) => self.fn("connect_list_versions", ["text", "uuid"], [h, projectId]),
      async saveStory(versionId, story) {
        const sha = await self.fn<string>("connect_save_story", ["text", "uuid", "jsonb"], [h, versionId, story]);
        return { story_sha256: sha };
      },
      createVersion: (projectId, fromVersionId) => self.fn("connect_create_version", ["text", "uuid", "uuid"], [h, projectId, fromVersionId]),
      submitJob: (versionId, jobType, params, sheetId, previewId) =>
        self.fn("connect_submit_job", ["text", "uuid", "text", "jsonb", "uuid", "uuid"], [h, versionId, jobType, params ?? {}, sheetId ?? null, previewId ?? null]),
      currentEngine: () => self.fn("connect_current_engine", ["text"], [h]),
      readReceipt: async () => null,
      quote: (versionId, jobType) => self.fn("connect_quote", ["text", "uuid", "text"], [h, versionId, jobType]),
      jobById: (jobId) => self.fn("connect_job", ["text", "uuid"], [h, jobId]),
      // migrations/20261027000400_live_editor.sql (NOT APPLIED until Ryan applies it): the person's live editor, as drafts.
      editState: (projectId) => self.fn("connect_edit_state", ["text", "uuid"], [h, projectId]),
      editOps: (projectId, mode, base, ops) => self.fn("connect_edit_ops", ["text", "uuid", "text", "bigint", "jsonb"], [h, projectId, mode, base, ops]),
      editUndoAi: (projectId, mode) => self.fn("connect_edit_undo_ai", ["text", "uuid", "text"], [h, projectId, mode]),
      // No file links leave the database: the AI is pointed at the person's own Ryagram page, where they sign in to watch.
      async links(versionId, jobId) {
        const v = await d.getVersion(versionId);
        const done = (v.jobs as { id: string; job_type: string; state: string }[]).filter((j) => j.state === "complete" && (!jobId || j.id === jobId));
        return done.length ? [{ kind: "open_in_ryagram", url: self.appUrl, expires_in_s: 0 }] : [];
      },
    };
    return d;
  }
}
