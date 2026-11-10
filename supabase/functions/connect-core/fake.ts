// A stand-in for the database and the render worker, behind the same interfaces (Data, Policy), so the tools,
// the gate and both faces can be tested and driven from the MCP Inspector before WORKER's job contract is live.
// It mirrors the real rules that matter (editable states, one job in progress per type, ladder, holds) but is
// NOT the authority: the SQL functions are. It lives in the repo only for tests and local development.
import type { Job } from "../ai-editor/tools.ts";
import { applyOps, LOOK_KEYS, newDraft, undoOps, type Draft, type Mode, type Op } from "./edit_state.ts";
import { downloadUrlProblem } from "./tools.ts";
import type { CallLog, Data, DownloadRow, EditState, GeoRow, Grant, Link, Policy, Principal, ProjectRow, Quote, Scope } from "./types.ts";

type FJob = Job & { version_id: string; project_id: string; params: Record<string, unknown>; steps: number; credits: number; progress: number | null; run_on?: string };
interface FCounty { id: string; shape: "profile" | "compare"; counties: string[]; kind: string; rule: string | null; year: number | null; state: "asked" | "claimed" | "answered" | "failed"; answer: unknown; fail_code: string | null; fail_detail: string | null; asked: number; claimed: number | null; finished: number | null }
interface FCard { id: string; project_id: string; version_id: string; sha: string; state: "asked" | "claimed" | "answered" | "failed"; answer: unknown; fail_code: string | null; fail_detail: string | null; asked: number; claimed: number | null; finished: number | null }
interface FVersion { id: string; project_id: string; number: number; state: string; story_spec: Record<string, unknown>; story_sha256: string }
/** r9: the person's own computer. `awake` = their Ryagram app is open and switched on; while it is not, an owner_local job just waits. */
interface FLocal { lastSeenAt: string | null; computerName: string | null; awake: boolean }
interface FUser { counties: Map<string, FCounty>; cards: Map<string, FCard>; geo: Map<string, GeoRow>; plans: { id: string; host: string; url: string; why: string; folder: string; state: string; created_at: string; receipt: DownloadRow["receipt"] }[]; requests: Map<string, { sha256: string; request: unknown }>; label: string; credits: number; held: number; projects: ProjectRow[]; versions: FVersion[]; jobs: FJob[]; previewsUsed: Map<string, number>; local?: FLocal; drafts: Map<string, Draft>; tracks: Map<string, unknown> }

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
    const u: FUser = { counties: new Map(), cards: new Map(), geo: new Map(), plans: [], requests: new Map(), label, credits, held: 0, projects: [], versions: [], jobs: [], previewsUsed: new Map(), drafts: new Map(), tracks: new Map() };
    this.users.set(userId, u);
    return u;
  }
  /** Make this person's jobs run on their own computer (owner_local), with the computer's last-seen time and name. */
  /** The house worker's three calls for county questions, as the database has them (the answer must carry the schema of its shape and fit 64 KB). For tests of the connector. */
  countyWorker(userId: string) {
    const user = this.users.get(userId)!;
    return {
      claim: () => {
        const c = [...user.counties.values()].find((x) => x.state === "asked" || (x.state === "claimed" && (x.claimed ?? 0) < Date.now() - 600000));
        if (!c) return null;
        c.state = "claimed"; c.claimed = Date.now();
        return { request_id: c.id, shape: c.shape, counties: [...c.counties], kind: c.kind, rule: c.rule, year: c.year };
      },
      finish: (rid: string, answer: unknown) => {
        const c = user.counties.get(rid);
        if (!c || c.state !== "claimed") throw err("No such claimed request.", "PT404");
        const o = answer as Record<string, unknown> | null;
        if (!o || typeof o !== "object" || Array.isArray(o) || JSON.stringify(o).length > 65536 || o.schema !== (c.shape === "profile" ? "ryagram.geo-county-profile/0" : "ryagram.geo-compare-counties/1")) throw err("That is not a county answer.", "22023");
        c.state = "answered"; c.answer = JSON.parse(JSON.stringify(answer)); c.finished = Date.now(); c.fail_code = null; c.fail_detail = null;
      },
      fail: (rid: string, code: string, detail = "") => {
        if (!["request_rejected", "county_not_held", "engine_error", "answer_rejected"].includes(code)) throw err("Unknown failure code.", "22023");
        const c = user.counties.get(rid);
        if (!c || c.state !== "claimed") throw err("No such claimed request.", "PT404");
        c.state = "failed"; c.fail_code = code; c.fail_detail = detail.trim().slice(0, 300); c.finished = Date.now();
      },
    };
  }
  /** The house worker's three calls for the film card, as the database has them (claim hands out the saved story, finish stores a card drawn from THAT story, fail records a known code). For tests of the connector. */
  cardWorker(userId: string) {
    const user = this.users.get(userId)!;
    return {
      claim: () => {
        const c = [...user.cards.values()].find((x) => x.state === "asked" || (x.state === "claimed" && (x.claimed ?? 0) < Date.now() - 600000));
        if (!c) return null;
        c.state = "claimed"; c.claimed = Date.now();
        const v = user.versions.find((x) => x.id === c.version_id)!;
        return { request_id: c.id, project_id: c.project_id, version_id: c.version_id, story_sha256: c.sha, story: JSON.parse(JSON.stringify(v.story_spec)) as Record<string, unknown> };
      },
      finish: (rid: string, card: unknown) => {
        const c = user.cards.get(rid);
        const o = card as Record<string, unknown> | null;
        const bad = !o || typeof o !== "object" || Array.isArray(o) || JSON.stringify(o).length > 262144 || o.schema !== 1 || typeof o.look !== "object" || o.look === null || Array.isArray(o.look)
          || typeof (o.frame as { svg?: unknown } | undefined)?.svg !== "string";
        if (bad) throw err("That is not a film look card.", "22023");
        if (!c || c.state !== "claimed") throw err("No such claimed request.", "PT404");
        if ((o!.basis as { story_sha256?: unknown } | undefined)?.story_sha256 !== c.sha) throw err("That card was not drawn from this request's saved story.", "22023");
        c.state = "answered"; c.answer = JSON.parse(JSON.stringify(card)); c.finished = Date.now(); c.fail_code = null; c.fail_detail = null;
      },
      fail: (rid: string, code: string, detail = "") => {
        if (!["story_not_found", "view_not_supported", "engine_error", "card_rejected"].includes(code)) throw err("Unknown failure code.", "22023");
        const c = user.cards.get(rid);
        if (!c || c.state !== "claimed") throw err("No such claimed request.", "PT404");
        c.state = "failed"; c.fail_code = code; c.fail_detail = detail.trim().slice(0, 300); c.finished = Date.now();
      },
    };
  }
  setLocal(userId: string, l: FLocal) { this.users.get(userId)!.local = l; }
  /** The live editor stand-in (the SQL is the authority). The draft of one mode of one project; made on first use. */
  draft(userId: string, projectId: string, mode: Mode): Draft {
    const u = this.users.get(userId)!; const k = `${projectId}|${mode}`;
    if (!u.drafts.has(k)) u.drafts.set(k, newDraft(mode));
    return u.drafts.get(k)!;
  }
  /** The reports the person's app shared for a song film (NEXT-CONNECT 179), keyed userId/projectId; the tests set them. */
  reports = new Map<string, { why_clip: unknown; draft_messages: unknown }>();
  shareReports(userId: string, projectId: string, r: { why_clip?: unknown; draft_messages?: unknown }) { this.reports.set(userId + "/" + projectId, { why_clip: r.why_clip ?? null, draft_messages: r.draft_messages ?? null }); }
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
        const k = `${p.userId}|${bucket}${bucket === "calls" ? ":" + p.clientId : ""}`; const c = (this.counters.get(k) ?? 0) + 1; this.counters.set(k, c); return c <= max;
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
      askGeo: async (q) => {
        // mirrors connect_geo_ask: the point is rounded to 4 decimals, the same question is one request, 5 open at once, 100 a day
        const user = u();
        const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
        const cats = [...new Set(q.categories)].sort();
        const lat = r4(q.lat), lon = r4(q.lon);
        const same = [...user.geo.values()].reverse().find((g) => g.lat === lat && g.lon === lon && g.minutes === q.minutes && g.categories.join() === cats.join() && g.state !== "failed");
        if (same) return { id: same.id, state: same.state, repeat: true };
        if ([...user.geo.values()].filter((g) => g.state === "asked" || g.state === "claimed").length >= 5) throw err("There are already 5 place questions waiting for an answer. Wait for those first.", "PT429");
        if (user.geo.size >= 100) throw err("That is 100 place questions in a day. Try again tomorrow.", "PT429");
        const row: GeoRow = { id: id(), state: "asked", shape: "within_minutes", lat, lon, minutes: q.minutes, categories: cats, answer: null, fail_code: null, fail_detail: null, waited_s: 0 };
        user.geo.set(row.id, row);
        return { id: row.id, state: "asked", repeat: false };
      },
      askForecast: async (q) => {
        // mirrors connect_forecast_ask: the same request in 10 minutes is one request, the same 5-open and 100-a-day caps as the place questions
        const user = u();
        const brk = [...new Set(q.breaks ?? [])].sort((x, y) => x - y), un = (q.unit ?? "").trim() || null, series = JSON.stringify(q.series);
        const same = [...user.geo.values()].reverse().find((g) => g.shape === "forecast" && JSON.stringify((g as GeoRow & { series?: unknown }).series) === series && g.horizon === q.horizon
          && (g.method ?? null) === (q.method ?? null) && JSON.stringify((g as GeoRow & { breaks?: number[] }).breaks ?? []) === JSON.stringify(brk) && (g.unit ?? null) === un && g.state !== "failed");
        if (same) return { id: same.id, state: same.state, repeat: true };
        if ([...user.geo.values()].filter((g) => g.state === "asked" || g.state === "claimed").length >= 5) throw err("There are already 5 place questions waiting for an answer. Wait for those first.", "PT429");
        if (user.geo.size >= 100) throw err("That is 100 place questions in a day. Try again tomorrow.", "PT429");
        const row = { id: id(), state: "asked", shape: "forecast", lat: null, lon: null, lat_b: null, lon_b: null, minutes: null, categories: [], category: null, town: null, horizon: q.horizon, method: q.method ?? null, unit: un,
          series: JSON.parse(series), breaks: brk, answer: null, fail_code: null, fail_detail: null, waited_s: 0 } as GeoRow;
        user.geo.set(row.id, row);
        return { id: row.id, state: "asked", repeat: false };
      },
      askGeoShape: async (q) => {
        // mirrors connect_geo_ask_shape: points rounded to 4 decimals, the same question is one request, the same 5-open and 100-a-day caps as askGeo
        const user = u();
        const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
        const pt = (p?: { lat: number; lon: number }) => (p ? { lat: r4(p.lat), lon: r4(p.lon) } : null);
        const a = q.shape === "where_to_go" ? null : pt(q.a), b = q.shape === "compare_sites" ? pt(q.b) : null;
        const category = q.shape === "compare_sites" ? null : (q.category ?? null), town = q.shape === "where_to_go" ? ((q.town ?? "").trim() || null) : null;
        const same = [...user.geo.values()].reverse().find((g) => g.shape === q.shape && (g.lat ?? null) === (a?.lat ?? null) && (g.lon ?? null) === (a?.lon ?? null) && (g.lat_b ?? null) === (b?.lat ?? null)
          && (g.lon_b ?? null) === (b?.lon ?? null) && (g.category ?? null) === category && (g.town ?? null) === town && g.state !== "failed");
        if (same) return { id: same.id, state: same.state, repeat: true };
        if ([...user.geo.values()].filter((g) => g.state === "asked" || g.state === "claimed").length >= 5) throw err("There are already 5 place questions waiting for an answer. Wait for those first.", "PT429");
        if (user.geo.size >= 100) throw err("That is 100 place questions in a day. Try again tomorrow.", "PT429");
        const row: GeoRow = { id: id(), state: "asked", shape: q.shape, lat: a?.lat ?? null, lon: a?.lon ?? null, lat_b: b?.lat ?? null, lon_b: b?.lon ?? null, minutes: null, categories: [], category, town,
          answer: null, fail_code: null, fail_detail: null, waited_s: 0 };
        user.geo.set(row.id, row);
        return { id: row.id, state: "asked", repeat: false };
      },
      getGeo: async (gid) => { const g = u().geo.get(gid); return g ? JSON.parse(JSON.stringify(g)) : null; },
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
        const mine = d.ops.filter((o) => o.actor === "ai" && o.client !== "Ryagram panel" && (o.status === "applied" || o.status === "pending"));        // never a click made in the panel
        const last = mine.length ? Math.max(...mine.map((o) => o.revision)) : -1;
        return undoOps(d, mine.filter((o) => o.revision === last).map((o) => o.id), Date.now(), "ai");
      },
      editorCall: async (name, a) => {
        const pid = String(a.p_project), mode = a.p_mode as Mode;
        if (mode !== "data" && mode !== "compilation") throw err("That is not an editor mode.", "22023");
        if (!u().projects.some((p) => p.id === pid)) throw err("That project was not found among your projects.", "PT404");
        const d = this.draft(userId, pid, mode);
        if (mode === "compilation" && !d.ai_visible) throw err('The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app.', "PT403");
        if (name === "editor_apply_ops") return applyOps(d, "ai", "Ryagram panel", Number(a.p_base_revision), a.p_ops, () => ++this.opId);
        if (name === "editor_undo") return undoOps(d, d.ops.filter((o) => o.id === a.p_op_id && o.actor === "ai").map((o) => o.id), Date.now(), "ai");
        if (name === "editor_undo_all_ai") return undoOps(d, d.ops.filter((o) => o.actor === "ai" && o.client !== "Ryagram panel" && (o.status === "applied" || o.status === "pending")).map((o) => o.id), Date.now(), "ai");
        if (name === "my_edit_ops_since") {
          const since = Math.max(Number(a.p_revision) || 0, 0);
          return JSON.parse(JSON.stringify({ revision: d.revision, state: mode === "data" ? { look: d.look } : d.tracks, mirrored: d.mirrored, ai_visible: d.ai_visible,
            ops: d.ops.filter((o) => o.revision > since).slice(0, 200).map((o) => ({ id: o.id, revision: o.revision, actor: o.actor, client: o.client, op: o.op, status: o.status, at: new Date(o.at).toISOString() })) }));
        }
        if (name === "editor_heartbeat") { d.editor_seen_at = Date.now(); return null; }
        throw err("There is no such editor call.", "22023");
      },
      askCounty: async (q) => {
        // mirrors connect_county_ask: the same question within 10 minutes is one request, 5 open at once, 100 a day (the shape rules are checked before this, by county.ts, in GEO's words)
        const user = u();
        const same = [...user.counties.values()].reverse().find((c) => c.shape === q.shape && c.counties.join() === q.counties.join() && c.kind === q.kind && c.rule === q.rule && c.year === q.year && c.state !== "failed" && c.asked > Date.now() - 600000);
        if (same) return { id: same.id, state: same.state, repeat: true };
        if ([...user.counties.values()].filter((c) => c.state === "asked" || c.state === "claimed").length >= 5) throw err("There are already 5 county questions waiting for an answer. Wait for those first.", "PT429");
        if (user.counties.size >= 100) throw err("That is 100 county questions in a day. Try again tomorrow.", "PT429");
        const row: FCounty = { id: id(), shape: q.shape, counties: [...q.counties], kind: q.kind, rule: q.rule, year: q.year, state: "asked", answer: null, fail_code: null, fail_detail: null, asked: Date.now(), claimed: null, finished: null };
        user.counties.set(row.id, row);
        return { id: row.id, state: "asked", repeat: false };
      },
      getCounty: async (cid) => {
        const c = u().counties.get(cid);
        if (!c) return null;
        return JSON.parse(JSON.stringify({ id: c.id, state: c.state, shape: c.shape, counties: c.counties, kind: c.kind, rule: c.rule, year: c.year, answer: c.answer, fail_code: c.fail_code, fail_detail: c.fail_detail, waited_s: Math.floor(((c.finished ?? Date.now()) - c.asked) / 1000) }));
      },
      askFilmCard: async (pid) => {
        // mirrors connect_film_card_ask: the project's newest version's saved story is what is asked for (the caller never names a story); asking again for the same saved story is one request;
        // an engine_error may be tried again after 10 minutes; 5 open at once, 100 a day
        const user = u();
        const vs = user.versions.filter((v) => v.project_id === pid).sort((a, b) => b.number - a.number);
        if (!user.projects.some((p) => p.id === pid) || !vs.length) throw err("That film was not found among your projects.", "22023");
        const v = vs[0];
        const same = [...user.cards.values()].find((c) => c.project_id === pid && c.sha === v.story_sha256);
        if (same) {
          if (same.state === "failed" && same.fail_code === "engine_error" && (same.finished ?? 0) < Date.now() - 600000) user.cards.delete(same.id);
          else return { id: same.id, state: same.state, repeat: true };
        }
        if ([...user.cards.values()].filter((c) => c.state === "asked" || c.state === "claimed").length >= 5) throw err("There are already 5 film pictures waiting to be drawn. Wait for those first.", "PT429");
        if (user.cards.size >= 100) throw err("That is 100 film pictures in a day. Try again tomorrow.", "PT429");
        const row: FCard = { id: id(), project_id: pid, version_id: v.id, sha: v.story_sha256, state: "asked", answer: null, fail_code: null, fail_detail: null, asked: Date.now(), claimed: null, finished: null };
        user.cards.set(row.id, row);
        return { id: row.id, state: "asked", repeat: false };
      },
      getFilmCard: async (pid) => {
        const retryOk = (c: FCard) => c.state === "failed" && c.fail_code === "engine_error" && (c.finished ?? 0) < Date.now() - 600000;          // the database's own rule (connect_film_card_get's `retry`)
        // mirrors connect_film_card_get: the newest answered card (this save's first), else where the request for the current save stands; null for a film that is not the person's
        const user = u();
        const vs = user.versions.filter((v) => v.project_id === pid).sort((a, b) => b.number - a.number);
        if (!user.projects.some((p) => p.id === pid) || !vs.length) return null;
        const cur = vs[0].story_sha256;
        const done = [...user.cards.values()].filter((c) => c.project_id === pid && c.state === "answered").sort((a, b) => Number(b.sha === cur) - Number(a.sha === cur) || (b.finished ?? 0) - (a.finished ?? 0))[0];
        const r = [...user.cards.values()].find((c) => c.project_id === pid && c.sha === cur);
        if (done) return JSON.parse(JSON.stringify({ state: "ready", id: done.id, card: done.answer, built_sha256: done.sha, current_sha256: cur, stale: done.sha !== cur,
          refresh: done.sha === cur || !r ? null : { state: r.state, fail_code: r.fail_code, retry: retryOk(r) }, waited_s: Math.floor(((done.finished ?? 0) - done.asked) / 1000) }));
        if (!r) return { state: "none", current_sha256: cur };
        return { state: r.state === "answered" ? "ready" : r.state, id: r.id, current_sha256: cur, fail_code: r.fail_code, fail_detail: r.fail_detail, retry: retryOk(r), waited_s: Math.floor(((r.finished ?? Date.now()) - r.asked) / 1000) };
      },
      clipReports: async (pid) => (u().projects.some((p) => p.id === pid) ? JSON.parse(JSON.stringify(this.reports.get(userId + "/" + pid) ?? { why_clip: null, draft_messages: null })) : null),
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
