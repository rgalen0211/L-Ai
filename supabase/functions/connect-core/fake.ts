// A stand-in for the database and the render worker, behind the same interfaces (Data, Policy), so the tools,
// the gate and both faces can be tested and driven from the MCP Inspector before WORKER's job contract is live.
// It mirrors the real rules that matter (editable states, one job in progress per type, ladder, holds) but is
// NOT the authority: the SQL functions are. It lives in the repo only for tests and local development.
import type { Job } from "../ai-editor/tools.ts";
import type { CallLog, Data, Grant, Link, Policy, Principal, ProjectRow, Quote, Scope } from "./types.ts";

type FJob = Job & { version_id: string; project_id: string; params: Record<string, unknown>; steps: number; credits: number; progress: number | null };
interface FVersion { id: string; project_id: string; number: number; state: string; story_spec: Record<string, unknown>; story_sha256: string }
interface FUser { label: string; credits: number; held: number; projects: ProjectRow[]; versions: FVersion[]; jobs: FJob[]; previewsUsed: Map<string, number> }

let n = 0;
const id = () => { n++; return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`; };
const sha = (s: unknown) => {                       // a stable stand-in digest; the real one is SHA-256 in SQL
  const t = JSON.stringify(s ?? {}); let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
};
const err = (message: string, code: string) => Object.assign(new Error(message), { code });
const ALL: Scope[] = ["read", "write", "render_free", "render_final"];

export class FakeWorld {
  users = new Map<string, FUser>();
  grants = new Map<string, Grant>();                // key userId|clientId
  counters = new Map<string, number>();             // bucket counts (fixed windows are not modelled: tests set max)
  logs: CallLog[] = [];
  finals = false;
  engine = "fake0001";
  tokens = new Map<string, Principal>();            // bearer token -> principal (the stand-in for JWKS verification)

  addUser(userId: string, label: string, credits = 100): FUser {
    const u: FUser = { label, credits, held: 0, projects: [], versions: [], jobs: [], previewsUsed: new Map() };
    this.users.set(userId, u);
    return u;
  }
  invite(userId: string, clientId: string, scopes: Scope[] = ["read", "write", "render_free"]) { this.grants.set(`${userId}|${clientId}`, { scopes }); }
  revoke(userId: string, clientId: string) { this.grants.delete(`${userId}|${clientId}`); }
  issue(token: string, p: Principal) { this.tokens.set(token, p); }

  policy(): Policy {
    return {
      grantFor: async (p) => this.grants.get(`${p.userId}|${p.clientId}`) ?? null,
      hit: async (p, bucket, max) => {
        const k = `${p.userId}|${bucket}`; const c = (this.counters.get(k) ?? 0) + 1; this.counters.set(k, c); return c <= max;
      },
      finalRendersEnabled: async () => this.finals,
      log: async (e) => { this.logs.push(e); },
    };
  }
  verifyToken = async (t: string) => this.tokens.get(t) ?? null;

  data(userId: string): Data {
    const u = () => { const x = this.users.get(userId); if (!x) throw err("Sign in first.", "PT401"); return x; };
    const advance = (j: FJob) => {                  // each look at a job moves it one step: queued, running, complete
      if (j.state === "complete" || j.state === "failed" || j.state === "cancelled") return;
      j.steps++;
      if (j.steps === 1) { j.state = "running"; j.progress = 0.4; }
      else if (j.steps >= 2) {
        j.state = "complete"; j.progress = 1; j.engine_commit = this.engine;
        const user = u(); user.held -= j.credits; user.credits -= j.credits;     // captured
      }
    };
    const fv = (versionId: string) => { const v = u().versions.find((x) => x.id === versionId); if (!v) throw err("Version not found.", "P0002"); return v; };
    const quote = (versionId: string, t: string): Quote => {
      const v = fv(versionId); const user = u();
      let credits = 0, free = false;
      if (t === "preview") { free = (user.previewsUsed.get(v.project_id) ?? 0) < 3; credits = free ? 0 : 5; }
      if (t === "final_render") credits = 40;
      return { credits, free, available: user.credits - user.held };
    };
    return {
      whoami: async () => ({ label: u().label, available: u().credits - u().held, held: u().held }),
      listProjects: async () => [...u().projects].reverse(),
      createProject: async (title) => {
        const user = u(); const p: ProjectRow = { id: id(), title, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        user.projects.push(p);
        const v: FVersion = { id: id(), project_id: p.id, number: 1, state: "draft", story_spec: {}, story_sha256: sha({}) };
        user.versions.push(v);
        return { id: p.id, title, version_id: v.id, number: 1 };
      },
      currentVersionId: async (pid) => {
        const vs = u().versions.filter((v) => v.project_id === pid);
        return vs.length ? vs.reduce((a, b) => (b.number > a.number ? b : a)).id : null;
      },
      getVersion: async (vid) => {
        const user = u(); const v = fv(vid); user.jobs.filter((j) => j.version_id === vid).forEach(advance);
        return { version: v, project: { id: v.project_id, title: user.projects.find((p) => p.id === v.project_id)!.title },
                 jobs: user.jobs.filter((j) => j.version_id === vid).slice().reverse() } as never;
      },
      listVersions: async (pid) => u().versions.filter((v) => v.project_id === pid).map((v) => ({ id: v.id, number: v.number, state: v.state, created_at: "2026-01-01" })),
      saveStory: async (vid, story) => {
        const v = fv(vid);
        if (!["draft", "sampling", "previewing", "editorial_action_required", "ready_to_render"].includes(v.state)) throw err(`This version is locked (${v.state}). Make a new version to change it.`, "42501");
        v.story_spec = story as Record<string, unknown>; v.story_sha256 = sha(story); v.state = "draft";
        return { story_sha256: v.story_sha256 };
      },
      createVersion: async (pid, from) => {
        const user = u(); const src = fv(from);
        const v: FVersion = { id: id(), project_id: pid, number: Math.max(...user.versions.filter((x) => x.project_id === pid).map((x) => x.number)) + 1,
          state: "draft", story_spec: src.story_spec, story_sha256: src.story_sha256 };
        user.versions.push(v); return { id: v.id, number: v.number };
      },
      submitJob: async (vid, type, params, sheetId, previewId) => {
        const user = u(); const v = fv(vid);
        if (user.jobs.some((j) => j.version_id === vid && j.job_type === type && ["queued", "running"].includes(j.state))) throw err(`A ${type} job for this version is already in progress.`, "42501");
        if (type === "final_render" && (!sheetId || !previewId)) throw err("A final render needs its contact sheet and preview.", "22023");
        const q = quote(vid, type);
        if (q.credits > q.available) throw err("Not enough credits.", "42501");
        if (type === "preview" && q.free) user.previewsUsed.set(v.project_id, (user.previewsUsed.get(v.project_id) ?? 0) + 1);
        user.held += q.credits;
        const j: FJob = { id: id(), job_type: type, state: "queued", attempt: 1, created_at: new Date().toISOString(), story_sha256: v.story_sha256,
          engine_commit: null, error_class: null, error_code: null, error_detail: null, version_id: vid, project_id: v.project_id,
          params, steps: 0, credits: q.credits, progress: null };
        user.jobs.push(j); return { id: j.id, state: j.state };
      },
      currentEngine: async () => this.engine,
      readReceipt: async () => null,
      quote: async (vid, t) => quote(vid, t),
      jobById: async (jid) => {
        const j = u().jobs.find((x) => x.id === jid); if (!j) return null; advance(j);
        return { ...j, queue_position: j.state === "queued" ? 1 : null };
      },
      links: async (vid, jid): Promise<Link[]> => u().jobs.filter((j) => j.version_id === vid && j.state === "complete" && (!jid || j.id === jid))
        .map((j) => ({ kind: j.job_type, url: `https://fake.ryagram.invalid/${j.id}?sig=test`, expires_in_s: 900 })),
    };
  }
}
export { ALL as ALL_SCOPES };
