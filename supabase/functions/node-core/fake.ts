// An in-memory stand-in for WORKER's r9_node_draft.sql (never applied), with the same rules, so the HTTP face can be proven end to end without a database.
// The SQL is the authority and has its own tests (supabase/tests/test_r9_node.py); the places where this goes beyond that draft are marked REQUESTED
// (deviceState, account, signout) and are also listed in docs/node-function-contract.md for WORKER.
import type { DeviceState, NodeAccount, NodeDb, NodeJob } from "./types.ts";

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

interface Device { userCode: string; name: string; owner?: string; approved: boolean; denied: boolean; used: boolean; expires: number }
interface Token { owner: string; name: string; expires: number; revoked: boolean }

export class FakeNodeWorld implements NodeDb {
  now = () => Date.now();
  users = new Map<string, { email: string; local_compute: boolean; worker: boolean }>();
  devices = new Map<string, Device>();
  tokens = new Map<string, Token>();
  jobs = new Map<string, NodeJob & { run_on: string; worker_user_id: string | null }>();
  artifacts: { job: string; kind: string; path: string; bytes: number }[] = [];
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
    const k = bucket + "|" + caller, t = this.now(), arr = (this.hitLog.get(k) ?? []).filter((x) => t - x < windowSeconds * 1000);
    if (arr.length >= max) { this.hitLog.set(k, arr); return false; }
    arr.push(t); this.hitLog.set(k, arr); return true;
  }
  async deviceBegin(deviceHash: string, userCode: string, deviceName: string): Promise<string> {
    this.calls.push("node_device_begin");
    if (this.devices.has(deviceHash)) throw err("23505", "dup");
    const expires = this.now() + 600_000;
    this.devices.set(deviceHash, { userCode, name: deviceName, approved: false, denied: false, used: false, expires });
    return new Date(expires).toISOString();
  }
  async deviceState(deviceHash: string): Promise<DeviceState> {
    this.calls.push("node_device_state");
    const d = this.devices.get(deviceHash);
    if (!d) return "unknown";
    if (d.used) return "used";
    if (this.now() >= d.expires) return "expired";
    return d.denied ? "denied" : d.approved ? "approved" : "pending";
  }
  async deviceExchange(deviceHash: string, accessHash: string): Promise<string> {
    this.calls.push("node_device_exchange");
    const d = this.devices.get(deviceHash);
    if (!d || !d.approved || d.used || this.now() >= d.expires) throw err("PT401", "Not approved yet, or the code expired.");
    d.used = true;
    const expires = this.now() + 30 * 86400_000;
    this.tokens.set(accessHash, { owner: d.owner!, name: d.name, expires, revoked: false });
    return new Date(expires).toISOString();
  }
  /** node_actor: the person comes ONLY from the live token. A worker account is not a person. */
  private actor(accessHash: string): { owner: string; token: Token } {
    if (!/^[0-9a-f]{64}$/.test(accessHash ?? "")) throw err("PT401", "Sign this computer in to Ryagram first.");
    const t = this.tokens.get(accessHash);
    if (!t || t.revoked || this.now() >= t.expires) throw err("PT401", "Sign this computer in to Ryagram first.");
    if (this.users.get(t.owner)?.worker) throw err("42501", "A worker account is not a person.");
    return { owner: t.owner, token: t };
  }
  async account(accessHash: string): Promise<NodeAccount> {
    this.calls.push("node_account");
    const { owner, token } = this.actor(accessHash);
    const u = this.users.get(owner)!;
    return { email: u.email, device_name: token.name, local_compute: u.local_compute, expires_at: new Date(token.expires).toISOString() };
  }
  async signout(accessHash: string): Promise<boolean> {
    this.calls.push("node_signout");
    this.actor(accessHash).token.revoked = true;
    return true;
  }
  private held(owner: string, jobId: string) {
    const j = this.jobs.get(jobId);
    if (!j || j.owner_id !== owner || j.run_on !== "owner_local" || j.worker_user_id !== owner) throw err("42501", "This computer does not hold that job.");
    return j;
  }
  async claim(accessHash: string): Promise<NodeJob | null> {
    this.calls.push("node_claim");
    const { owner } = this.actor(accessHash);
    if (!this.users.get(owner)!.local_compute) throw err("42501", "This account is not set to render on its own computer.");
    if (!this.claimsEnabled) return null;
    const busy = [...this.jobs.values()].some((j) => j.worker_user_id === owner && ["claimed", "running", "validating", "uploading"].includes(String(j.state)));
    if (busy) return null;
    const j = [...this.jobs.values()].find((x) => x.state === "queued" && x.owner_id === owner && x.run_on === "owner_local");       // never a house job, never another person's
    if (!j) return null;
    j.state = "claimed"; j.worker_user_id = owner; j.worker_id = "node";
    return { ...j };
  }
  async heartbeat(accessHash: string, jobId: string, _p: number | null, _n: string | null, _d: unknown): Promise<boolean> {
    this.calls.push("node_heartbeat");
    this.held(this.actor(accessHash).owner, jobId);
    return true;
  }
  async reportState(accessHash: string, jobId: string, state: string): Promise<NodeJob> {
    this.calls.push("node_report_state");
    const j = this.held(this.actor(accessHash).owner, jobId);
    j.state = state;
    return { ...j };
  }
  async retry(accessHash: string, jobId: string): Promise<string> {
    this.calls.push("node_retry");
    const j = this.held(this.actor(accessHash).owner, jobId);
    j.state = "queued"; j.worker_user_id = null;
    return "requeued";
  }
  async registerArtifact(accessHash: string, jobId: string, kind: string, bytes: number): Promise<string> {
    this.calls.push("node_register_artifact");
    const j = this.held(this.actor(accessHash).owner, jobId);
    if (j.state !== "uploading") throw err("42501", "This worker does not hold the job in the uploading state.");
    if (!(ALLOWED[String(j.job_type)] ?? []).includes(kind)) throw err("22023", "not allowed");
    const f = FILES[kind];
    if (bytes > f.max) throw err("22023", "too big");
    const path = `${j.owner_id}/${j.project_id}/${j.version_id}/${j.id}/${f.name}`;           // derived from the JOB; nothing the request said
    this.artifacts.push({ job: jobId, kind, path, bytes });
    return path;
  }
}
