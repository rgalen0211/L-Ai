// An in-memory stand-in for WORKER's r9_node_draft.sql (never applied), with the same rules, so the HTTP face can be proven end to end without a database.
// The SQL is the authority and has its own tests (supabase/tests/test_r9_node.py); the places where this goes beyond that draft are marked REQUESTED
// (node_hit) and are also listed in docs/node-function-contract.md for WORKER. Aligned with r9-node-draft rev3 (3ce2c65).
import type { CompilationStatus, ExchangeResult, NodeAccount, NodeDb, NodeJob } from "./types.ts";

const mask = (e: string) => e.split("@")[0].slice(0, 1) + "***@" + e.split("@")[1];
const err = (code: string, m: string) => Object.assign(new Error(m), { code });
const FILES: Record<string, { name: string; max: number }> = {
  contact_sheet: { name: "sheet.png", max: 20_000_000 }, preview: { name: "preview.mp4", max: 60_000_000 }, final_video: { name: "film.mp4", max: 500_000_000 },
  thumbnail: { name: "thumb.jpg", max: 5_000_000 }, receipt: { name: "receipt.sequence.json", max: 5_000_000 }, receipt_text: { name: "receipt.txt", max: 5_000_000 },
  metering: { name: "metering.json", max: 5_000_000 },
};
const ALLOWED: Record<string, string[]> = {
  contact_sheet: ["contact_sheet", "receipt", "receipt_text", "metering"], preview: ["preview", "thumbnail", "receipt", "receipt_text", "metering"],
  final_render: ["final_video", "thumbnail", "receipt", "receipt_text", "metering"],
};

interface Device { userCode: string; name: string; owner?: string; approved: boolean; denied: boolean; used: boolean; expires: number; interval: number; nextPoll: number }
interface Token { id: string; owner: string; name: string; expires: number; revoked: boolean }

export class FakeNodeWorld implements NodeDb {
  now = () => Date.now();
  users = new Map<string, { email: string; local_compute: boolean; worker: boolean }>();
  devices = new Map<string, Device>();
  tokens = new Map<string, Token>();
  jobs = new Map<string, NodeJob & { run_on: string; worker_user_id: string | null }>();
  stored = new Map<string, number>();                                      // what Storage holds: path -> bytes (tests set it)
  artifacts_: { job: string; kind: string; path: string; bytes: number }[] = [];
  hitLog = new Map<string, number[]>();
  calls: string[] = [];                                     // every database function the function called, in order (the tests read it)
  claimsEnabled = true;

  addUser(id: string, email: string, local_compute = false, worker = false) { this.users.set(id, { email, local_compute, worker }); }
  addJob(j: { id: string; owner_id: string; run_on: string; job_type?: string; state?: string }) {
    this.jobs.set(j.id, { project_id: "00000000-0000-4000-8000-0000000000a1", version_id: "00000000-0000-4000-8000-0000000000b1", attempt: 1, job_type: "preview",
      state: "queued", story: { clips: [] }, params: {}, worker_user_id: null, lease_expires_at: "x", worker_id: null, ...j } as never);
  }
  approve(userCode: string, owner: string): boolean {
    for (const d of this.devices.values()) if (d.userCode === userCode && !d.approved && !d.denied && !d.used && this.now() < d.expires) { d.approved = true; d.owner = owner; return true; }
    return false;
  }
  deny(userCode: string): boolean {
    for (const d of this.devices.values()) if (d.userCode === userCode && !d.approved && !d.denied) { d.denied = true; return true; }
    return false;
  }
  removeAll() { for (const t of this.tokens.values()) t.revoked = true; }
  /** What the connector's connect_scopes would answer for a node token: nothing (audience separation). */
  connectVerify(_accessHash: string): string[] | null { return null; }

  async hit(caller: string, bucket: string, max: number, windowSeconds: number): Promise<boolean> {
    this.calls.push("hit");
    if (!/^[0-9a-f]{64}$/.test(caller ?? "") || !/^[a-z0-9_]{1,30}$/.test(bucket) || !(windowSeconds >= 1 && windowSeconds <= 86400) || !(max >= 1)) throw err("22023", "bad limit");     // WORKER rev4 node_hit refuses these
    const k = bucket + "|" + caller, t = this.now(), arr = (this.hitLog.get(k) ?? []).filter((x) => t - x < windowSeconds * 1000);
    if (arr.length >= max) { this.hitLog.set(k, arr); return false; }
    arr.push(t); this.hitLog.set(k, arr); return true;
  }
  async deviceBegin(deviceHash: string, userCode: string, computerName: string) {
    this.calls.push("node_device_begin");
    if (this.devices.has(deviceHash)) throw err("23505", "dup");
    if ([...this.devices.values()].filter((d) => !d.used && this.now() < d.expires).length >= 500) throw err("PT429", "Too many sign-in codes are waiting right now.");
    this.devices.set(deviceHash, { userCode, name: computerName, approved: false, denied: false, used: false, expires: this.now() + 600_000, interval: 5, nextPoll: 0 });
    return { user_code: userCode, expires_in: 600, interval: 5 };
  }
  /** node_device_exchange (rev3): the database owns the states and the poll interval; the token is stored only as a hash and minted once. */
  async deviceExchange(deviceHash: string, tokenHash: string): Promise<ExchangeResult> {
    this.calls.push("node_device_exchange");
    const d = this.devices.get(deviceHash);
    if (!d || d.used) return { state: "expired_token" };
    if (d.denied) return { state: "access_denied" };
    if (this.now() >= d.expires) return { state: "expired_token" };
    if (this.now() < d.nextPoll) { d.interval = Math.min(d.interval + 5, 60); d.nextPoll = this.now() + d.interval * 1000; return { state: "slow_down", interval: d.interval }; }
    d.nextPoll = this.now() + d.interval * 1000;
    if (!d.approved) return { state: "authorization_pending" };
    d.used = true;
    const expires = this.now() + 30 * 86400_000;
    this.tokens.set(tokenHash, { id: "tok-" + this.tokens.size, owner: d.owner!, name: d.name, expires, revoked: false });
    const u = this.users.get(d.owner!)!;
    return { state: "ok", expires_in: 30 * 86400, account: { email: mask(u.email), computer_name: d.name, local_compute: u.local_compute } };
  }
  /** node_actor: the person comes ONLY from the live token. A worker account is not a person. */
  private actor(accessHash: string): { owner: string; token: Token } {
    if (!/^[0-9a-f]{64}$/.test(accessHash ?? "")) throw err("PT401", "Sign this computer in to Ryagram first.");
    const t = this.tokens.get(accessHash);
    if (!t || t.revoked || this.now() >= t.expires) throw err("PT401", "Sign this computer in to Ryagram first.");
    if (this.users.get(t.owner)?.worker) throw err("42501", "A worker account is not a person.");
    return { owner: t.owner, token: t };
  }
  async account(accessHash: string): Promise<{ account: NodeAccount }> {
    this.calls.push("node_account");
    const { owner, token } = this.actor(accessHash);
    const u = this.users.get(owner)!;
    return { account: { email: mask(u.email), computer_name: token.name, local_compute: u.local_compute, approved_until: new Date(token.expires).toISOString() } };
  }
  async signout(accessHash: string) {
    this.calls.push("node_signout");
    this.actor(accessHash).token.revoked = true;
    return { ok: true };
  }
  private held(a: { owner: string; token: Token }, jobId: string) {
    const j = this.jobs.get(jobId);
    if (!j || j.owner_id !== a.owner || j.run_on !== "owner_local" || j.worker_user_id !== a.owner || (j as { node_token_id?: string }).node_token_id !== a.token.id) throw err("42501", "This computer does not hold that job.");     // rev3: pinned to THIS computer's token
    return j;
  }
  async claim(accessHash: string): Promise<NodeJob | null> {
    this.calls.push("node_claim");
    const { owner, token } = this.actor(accessHash);
    if (!this.users.get(owner)!.local_compute) throw err("42501", "This account is not set to render on its own computer.");
    if (!this.claimsEnabled) return null;
    const busy = [...this.jobs.values()].some((j) => j.worker_user_id === owner && ["claimed", "running", "validating", "uploading"].includes(String(j.state)));
    if (busy) return null;
    const j = [...this.jobs.values()].find((x) => x.state === "queued" && x.owner_id === owner && x.run_on === "owner_local");       // never a house job, never another person's
    if (!j) return null;
    j.state = "claimed"; j.worker_user_id = owner; j.worker_id = "node"; (j as { node_token_id?: string }).node_token_id = token.id;
    return { ...j };
  }
  async heartbeat(accessHash: string, jobId: string, _p: number | null, _n: string | null, _d: unknown): Promise<boolean> {
    this.calls.push("node_heartbeat");
    this.held(this.actor(accessHash), jobId);
    return true;
  }
  async reportState(accessHash: string, jobId: string, state: string): Promise<NodeJob> {
    this.calls.push("node_report_state");
    const j = this.held(this.actor(accessHash), jobId);
    if (state === "complete") {                                       // rev4: every registered file must be in Storage at exactly the registered size
      for (const a of this.artifacts_.filter((x) => x.job === jobId)) {
        if (this.stored.get(a.path) !== a.bytes) throw err("42501", "The stored file is not the size this computer registered: not completed.");
      }
    }
    j.state = state;
    return { ...j };
  }
  async retry(accessHash: string, jobId: string): Promise<string> {
    this.calls.push("node_retry");
    const j = this.held(this.actor(accessHash), jobId);
    j.state = "queued"; j.worker_user_id = null;
    return "requeued";
  }
  async registerArtifact(accessHash: string, jobId: string, kind: string, bytes: number): Promise<string> {
    this.calls.push("node_register_artifact");
    const j = this.held(this.actor(accessHash), jobId);
    if (j.state !== "uploading") throw err("42501", "This worker does not hold the job in the uploading state.");
    if (!(ALLOWED[String(j.job_type)] ?? []).includes(kind)) throw err("22023", "not allowed");
    const f = FILES[kind];
    if (bytes > f.max) throw err("22023", "too big");
    const path = `${j.owner_id}/${j.project_id}/${j.version_id}/${j.id}/${f.name}`;           // derived from the JOB; nothing the request said
    this.artifacts_.push({ job: jobId, kind, path, bytes });
    return path;
  }

  // ------------------------------------------------------------------------------------- private links for films made on the person's own computer (NEXT-CONNECT 120)
  // The same rules as supabase/connect-drafts/compilation_delivery_draft.sql (the SQL is the authority and has its own check): the switch, the ACTIVE PLAN, the plan's config row, one upload at a time,
  // the kept total, the rights tick, the stored size at finish, the plan again at finish. Nothing here knows about a tester flag.
  compilationSwitchOn = false;
  plans = new Map<string, string | null>();              // owner -> the code of their ACTIVE plan (absent or null = no active plan)
  planLimits = new Map<string, { enabled: boolean; max_film_bytes: number; max_kept_bytes: number; starts_per_hour: number }>();
  compilations = new Map<string, { id: string; owner: string; title: string; bytes: number; sha256: string; path: string; state: string; rights: boolean; expires_at?: string }>();
  private compLimits(owner: string) {
    if (!this.compilationSwitchOn) throw err("42501", "Private links for films made on your computer are not switched on yet.");
    const plan = this.plans.get(owner) ?? null;
    if (!plan) throw err("42501", "Private links are part of a Ryagram plan. Choose a plan on the website, then try again.");
    const lim = this.planLimits.get(plan);
    if (!lim || !lim.enabled) throw err("42501", "Your plan does not include private links for films made on your computer.");
    return lim;
  }
  async compilationStatus(accessHash: string): Promise<CompilationStatus> {
    this.calls.push("node_compilation_status");
    const { owner } = this.actor(accessHash);
    const plan = this.plans.get(owner) ?? null, lim = plan ? this.planLimits.get(plan) : undefined;
    const kept = [...this.compilations.values()].filter((c) => c.owner === owner && c.state === "ready").reduce((a, c) => a + c.bytes, 0);
    return { switch_on: this.compilationSwitchOn, plan, active: !!plan, allowed: this.compilationSwitchOn && !!lim && lim.enabled,
             max_film_bytes: lim?.enabled ? lim.max_film_bytes : null, max_kept_bytes: lim?.enabled ? lim.max_kept_bytes : null, starts_per_hour: lim?.enabled ? lim.starts_per_hour : null, kept_bytes: kept };
  }
  async compilationBegin(accessHash: string, title: string, bytes: number, sha256: string, rights: boolean) {
    this.calls.push("node_compilation_begin");
    const { owner } = this.actor(accessHash);
    const lim = this.compLimits(owner);
    if (rights !== true) throw err("22023", "Tick that you have the right to share what is in this film.");
    if (!title || title.trim().length < 1 || title.trim().length > 200) throw err("22023", "Give the film a title of 1 to 200 letters.");
    if (!(bytes >= 1 && bytes <= lim.max_film_bytes)) throw err("22023", `A film can be at most ${Math.floor(lim.max_film_bytes / 1048576)} MB on your plan to get a private link. Make it shorter or smaller.`);
    if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) throw err("22023", "That file fingerprint is not valid.");
    if ([...this.compilations.values()].some((c) => c.owner === owner && c.state === "uploading")) throw err("42501", "One upload is already in progress. Wait for it to finish.");
    const kept = [...this.compilations.values()].filter((c) => c.owner === owner && c.state === "ready").reduce((a, c) => a + c.bytes, 0);
    if (kept + bytes > lim.max_kept_bytes) throw err("42501", `Your plan keeps ${Math.floor(lim.max_kept_bytes / 1048576)} MB of private links. Delete one you no longer need, then try again.`);
    const id = crypto.randomUUID(), path = `${owner}/compilations/${id}.mp4`;
    this.compilations.set(id, { id, owner, title: title.trim(), bytes, sha256, path, state: "uploading", rights: true });
    return { id, path };
  }
  async compilationFinish(accessHash: string, id: string) {
    this.calls.push("node_compilation_finish");
    const { owner } = this.actor(accessHash);
    const c = this.compilations.get(id);
    if (!c || c.owner !== owner) throw err("PT404", "Upload not found.");
    if (c.state === "ready") return { id, expires_at: c.expires_at! };
    if (c.state !== "uploading") throw err("42501", "This upload is over. Start again.");
    this.compLimits(owner);
    if (this.stored.get(c.path) !== c.bytes) throw err("42501", "The stored file is not the size this computer said. Cancel and start again.");
    c.state = "ready"; c.expires_at = new Date(this.now() + 30 * 86400_000).toISOString();
    return { id, expires_at: c.expires_at };
  }
  async compilationCancel(accessHash: string, id: string) {
    this.calls.push("node_compilation_cancel");
    const { owner } = this.actor(accessHash);
    const c = this.compilations.get(id);
    if (!c || c.owner !== owner || c.state !== "uploading") return false;
    c.state = "failed";
    return true;
  }
}
