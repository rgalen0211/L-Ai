// A stand-in for the database and the render worker, behind the same interfaces (Data, Policy), so the tools,
// the gate and both faces can be tested and driven from the MCP Inspector before WORKER's job contract is live.
// It mirrors the real rules that matter (editable states, one job in progress per type, ladder, holds) but is
// NOT the authority: the SQL functions are. It lives in the repo only for tests and local development.
import type { Job } from "../ai-editor/tools.ts";
import { applyOps, LOOK_KEYS, newDraft, undoOps, type Draft, type Mode, type Op } from "./edit_state.ts";
import { downloadUrlProblem } from "./tools.ts";
import type { CallLog, Data, DownloadRow, EditState, Grant, Link, Policy, Principal, ProjectRow, Quote, Scope } from "./types.ts";

type FJob = Job & { version_id: string; project_id: string; params: Record<string, unknown>; steps: number; credits: number; progress: number | null; run_on?: string };
interface FVersion { id: string; project_id: string; number: number; state: string; story_spec: Record<string, unknown>; story_sha256: string }
/** r9: the person's own computer. `awake` = their Ryagram app is open and switched on; while it is not, an owner_local job just waits. */
interface FLocal { lastSeenAt: string | null; computerName: string | null; awake: boolean }
interface FUser { plans: { id: string; host: string; url: string; why: string; folder: string; state: string; created_at: string; receipt: DownloadRow["receipt"] }[]; requests: Map<string, { sha256: string; request: unknown }>; label: string; credits: number; held: number; projects: ProjectRow[]; versions: FVersion[]; jobs: FJob[]; previewsUsed: Map<string, number>; local?: FLocal; drafts: Map<string, Draft>; tracks: Map<string, unknown> }

let n = 0;
const id = () => { n++; return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`; };
const sha = (s: unknown) => {                       // a stable stand-in digest; the real one is SHA-256 in SQL
  const t = JSON.stringify(s ?? {}); let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
};
const err = (message: string, code: string) => Object.assign(new Error(message), { code });
const ALL: Scope[] = ["read", "write", "render_free", "render_final", "edit", "fetch_data"];

export class FakeWorld {
  users = new Map<string, FUser>();
  grants = new Map<string, Grant>();                // key userId|clientId
  counters = new Map<string, number>();             // bucket counts (fixed windows are not modelled: tests set max)
  logs: CallLog[] = [];
  finals = false;
  /** what the render machine says about itself (the tests set it) */
  rendering: "ok" | "delayed" | "unknown" = "ok";
  engine = "fake0001";
  tokens = new Map<string, Principal>();            // bearer token -> principal (the stand-in for JWKS verification)

  addUser(userId: string, label: string, credits = 100): FUser {
    const u: FUser = { plans: [], requests: new Map(), label, credits, held: 0, projects: [], versions: [], jobs: [], previewsUsed: new Map(), drafts: new Map(), tracks: new Map() };
    this.users.set(userId, u);
    return u;
  }
  /** Make this person's jobs run on their own computer (owner_local), with the computer's last-seen time and name. */
  setLocal(userId: string, l: FLocal) { this.users.get(userId)!.local = l; }
  /** The live editor stand-in (the SQL is the authority). The draft of one mode of one project; made on first use. */
  draft(userId: string, projectId: string, mode: Mode): Draft {
    const u = this.users.get(userId)!; const k = `${projectId}|${mode}`;
    if (!u.drafts.has(k)) u.drafts.set(k, newDraft(mode));
    return u.drafts.get(k)!;
  }
  private opId = 0;
  /** The person's desktop app mirrors a track summary (this is what the real node function does); aiVisible = the person ticked "Let my AI see my track list". */
  mirror(userId: string, projectId: string, summary: unknown, aiVisible: boolean) {
    const d = this.draft(userId, projectId, "compilation"); d.mirrored = true; d.ai_visible = aiVisible; d.tracks = (summary ?? {}) as Record<string, unknown>; d.revision++;
  }
  /** The person editing in their own page (the editor_apply_ops stand-in). */
  personEdit(userId: string, projectId: string, mode: Mode, base: number, ops: Op[]) { return applyOps(this.draft(userId, projectId, mode), "person", null, base, ops, () => ++this.opId); }
  openEditor(userId: string, projectId: string, mode: Mode, open = true) { this.draft(userId, projectId, mode).editor_seen_at = open ? Date.now() : null; }
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
      log: async (_p, e) => { this.logs.push(e); },
    };
  }
  verifyToken = async (t: string) => this.tokens.get(t) ?? null;
  /** Tokens issued by the fake authorization server are known by hash, as in the database. */
  hashes = new Map<string, Principal>();
  issueHash(hash: string, owner: Principal, _scopes: string[]) { this.hashes.set(hash, { ...owner, tokenHash: hash }); }
  verifyHashed = async (hash: string) => this.hashes.get(hash) ?? null;

  data(userId: string): Data {
    const u = () => { const x = this.users.get(userId); if (!x) throw err("Sign in first.", "PT401"); return x; };
    const advance = (j: FJob) => {                  // each look at a job moves it one step: queued, running, complete
      if (j.state === "complete" || j.state === "failed" || j.state === "cancelled") return;
      if (j.run_on === "owner_local" && !u().local?.awake) return;            // the computer is asleep or the app is closed: the job waits, it does not move and it does not fail
      if (j.run_on !== "owner_local" && this.rendering === "delayed") return;       // the render machine is not responding: the job waits where it is
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
      requestDownload: async (url, why, folder) => {
        const user = u();
        const bad = downloadUrlProblem(url);
        if (bad) throw err(bad, "22023");
        if (!why || why.length > 300 || /https?:|[<>]|[A-Za-z]:[\x5c/]/.test(why)) throw err("The reason must be 1 to 300 characters of plain words (no places on a computer, no web addresses, no markup).", "22023");
        if (folder && (!/^[A-Za-z0-9 ._-]{1,60}$/.test(folder) || folder === "." || folder === "..")) throw err("The folder is a NAME (letters, digits, space, dot, dash), never a path.", "22023");
        if (user.plans.filter((p) => ["waiting", "downloading", "unpacking"].includes(p.state)).length >= 5) throw err("There are already 5 download requests waiting for the person. Ask them to deal with those first.", "PT429");
        if (user.plans.length >= 20) throw err("That is 20 download requests in a day. Try again tomorrow.", "PT429");
        const host = new URL(url).hostname.toLowerCase();
        const row = { id: id(), host, url, why, folder, state: "waiting", created_at: new Date().toISOString(), receipt: null };
        user.plans.push(row);
        return { id: row.id, host, state: "waiting" };
      },
      listDownloads: async () => u().plans.slice().reverse().slice(0, 20).map((p) => ({ ...p })),
      saveCompilationRequest: async (pid, request) => {
        const user = u();
        if (!user.projects.some((p) => p.id === pid)) return null;
        const row = { sha256: sha(request), request: JSON.parse(JSON.stringify(request)) };
        user.requests.set(pid, row);
        return { sha256: row.sha256 };
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
          params, steps: 0, credits: q.credits, progress: null, ...(user.local ? { run_on: "owner_local" } : {}) };
        user.jobs.push(j); return { id: j.id, state: j.state, ...(j.run_on ? { run_on: j.run_on } : {}) };
      },
      editState: async (pid): Promise<EditState | null> => {
        if (!u().projects.some((p) => p.id === pid)) return null;
        const dd = this.draft(userId, pid, "data"), dc = this.draft(userId, pid, "compilation");
        const live = (d: Draft) => d.editor_seen_at !== null && Date.now() - d.editor_seen_at < 30_000;
        return JSON.parse(JSON.stringify({
          saved_story_sha256: u().versions.filter((v) => v.project_id === pid).reduce((a, b) => (b.number > a.number ? b : a)).story_sha256,
          look_keys: LOOK_KEYS.map((k) => ({ key: k.key, kind: k.kind, choices: k.choices ?? null, min: k.min ?? null, max: k.max ?? null })),
          data: { revision: dd.revision, look: dd.look, editor_open: live(dd) },
          compilation: { revision: dc.revision, shared: dc.ai_visible, tracks: dc.ai_visible ? dc.tracks : null,
                         pending: dc.ops.filter((o) => o.status === "pending").length, editor_open: live(dc) },
          recently_undone: [...dd.ops, ...dc.ops].filter((o) => (o.status === "undone" || o.status === "rejected") && o.ended_by === "person" && o.undone_at !== null && Date.now() - o.undone_at < 600_000)
            .sort((a, b) => (b.undone_at ?? 0) - (a.undone_at ?? 0)).slice(0, 20).map((o) => ({ mode: dd.ops.includes(o) ? "data" : "compilation", op: o.op, at: new Date(o.undone_at!).toISOString() })),
        }));
      },
      editOps: async (pid, mode, base, ops) => {
        if (!u().projects.some((p) => p.id === pid)) throw err("That project was not found among your projects.", "PT404");
        return applyOps(this.draft(userId, pid, mode), "ai", "Claude", base, ops, () => ++this.opId);
      },
      editUndoAi: async (pid, mode) => {
        if (!u().projects.some((p) => p.id === pid)) throw err("That project was not found among your projects.", "PT404");
        const d = this.draft(userId, pid, mode);
        const mine = d.ops.filter((o) => o.actor === "ai" && (o.status === "applied" || o.status === "pending"));
        const last = mine.length ? Math.max(...mine.map((o) => o.revision)) : -1;
        return undoOps(d, mine.filter((o) => o.revision === last).map((o) => o.id), Date.now(), "ai");
      },
      currentEngine: async () => this.engine,
      readReceipt: async () => null,
      quote: async (vid, t) => quote(vid, t),
      renderingState: async () => this.rendering,
      jobById: async (jid) => {
        const j = u().jobs.find((x) => x.id === jid); if (!j) return null; advance(j);
        const l = u().local;
        return { ...j, queue_position: j.state === "queued" ? 1 : null,          // the real queue_position() may well count a local job too; the TOOLS must not show it
                 ...(j.run_on === "owner_local" ? { node: { last_seen_at: l?.lastSeenAt ?? null, computer_name: l?.computerName ?? null } } : {}) };
      },
      links: async (vid, jid): Promise<Link[]> => u().jobs.filter((j) => j.version_id === vid && j.state === "complete" && (!jid || j.id === jid))
        .map((j) => ({ kind: j.job_type, url: `https://fake.ryagram.invalid/${j.id}?sig=test`, expires_in_s: 900 })),
    };
  }
}
export { ALL as ALL_SCOPES };
