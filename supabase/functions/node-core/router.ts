// The `node` function's one router (NEXT-CONNECT 100, r9 M4): the desktop app's sign-in by device code, and the five calls a signed-in computer makes
// on its OWN owner_local jobs. It is the connector's twin: an opaque narrow token (rgn_...), hashed here, resolved to a person inside the database,
// no Supabase session in the app, no Supabase key in the request path. Kept out of index.ts so tests can run it in Node without Deno.
//
//   POST /device/code      {computer_name, app}   -> {device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval}
//   POST /device/token     {device_code}          -> {node_token, expires_in, account} | 400 {error: authorization_pending|slow_down|access_denied|expired_token}
//   GET  /account          Bearer                 -> {account:{email, computer_name, local_compute, approved_until}}
//   POST /signout          Bearer                 -> {ok:true}
//   POST /node/claim       Bearer                 -> {job: {...} | null}
//   POST /node/heartbeat   Bearer {job_id, progress?, note?, detail?}                        -> {ok}
//   POST /node/state       Bearer {job_id, state, error_code?, error_detail?, engine_commit?, engine_dirty?} -> {job}
//   POST /node/retry       Bearer {job_id, error_code, error_detail?}                         -> {result}
//   POST /node/artifact    Bearer {job_id, kind, bytes, sha256, duration_s?, width?, height?}  -> {path, upload_url}
//   POST /node/compilation-requests  Bearer      -> {requests: [{project_id, title, request, sha256, updated_at}]}   READ ONLY: what the person's AI asked for (data only; starts nothing); always on
//   POST /node/download-plans Bearer {}                                -> {plans: [{id, request, state}]}   READ ONLY: the download plans the person's AI wrote (NEXT-CONNECT 152); the app shows them for the person to approve
//   POST /node/download-update Bearer {id, state, receipt?}            -> {state}   the app tells the state of one plan (a receipt of host, size and SHA-256 only with 'done')
//   POST /node/edit-pending  Bearer {}                                  -> {changes: [{id, project_id, revision, client, op}]}   READ ONLY: the live editor's waiting changes for this person's open compilation (NEXT-CONNECT 142); always on
//   POST /node/edit-summary  Bearer {project_id, mirror, ai_visible?, summary?, applied?} -> {revision, mirrored, ai_visible}   the app mirrors its track summary (names and times) and says which waiting changes it applied
//   PRIVATE LINKS for a film made on the person's own computer (NEXT-CONNECT 120; the routes EXIST only when the function is switched on, else 404):
//   POST /node/compilation/status  Bearer {}                                              -> {status: {switch_on, plan, active, allowed, max_film_bytes, ...}}   (the app's launch check)
//   POST /node/compilation/start   Bearer {title, bytes, sha256, rights:true, duration_s?, width?, height?} -> {id, path, upload_url}
//   POST /node/compilation/finish  Bearer {id}                                            -> {id, expires_at}
//   POST /node/compilation/cancel  Bearer {id}                                            -> {cancelled}
//
// Rules (CC1 13:20, 13:34, 13:48, 13:51; each has a test that fails without it): the token is never logged and never read from a URL; a bearer that is not
// an rgn_ token is refused before any database call; errors are fixed sentences by code, never the database's text; the upload path comes from the database
// (derived from the job), never from the request; a per-file cap is enforced here as well as in SQL; polling faster than the interval is slow_down.
import { JOB_FIELDS, TOKEN_PREFIX, USER_CODE_ALPHABET, type NodeDeps, type NodeJob } from "./types.ts";

const MAX_BODY = 64_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_CODE = /^[A-Za-z0-9_-]{32,512}$/;
const TOKEN = new RegExp("^" + TOKEN_PREFIX + "[A-Za-z0-9_-]{43}$");
const SHA256 = /^[0-9a-f]{64}$/;
const NODE_STATES = ["running", "validating", "uploading", "complete", "failed"];       // a node never sets queued, claimed, cancelled or editorial_action_required
const EDIT_ROUTES = ["/node/edit-pending", "/node/edit-summary"];
const DOWNLOAD_ROUTES = ["/node/download-plans", "/node/download-update"];
const DL_STATES = ["declined", "downloading", "unpacking", "done", "refused", "cancelled"];
const COMPILATION_ROUTES = ["/node/compilation/status", "/node/compilation/start", "/node/compilation/finish", "/node/compilation/cancel"];
/** The database's own plain sentences, matched to FIXED sentences (the database's text is still never sent). The first match wins. */
const COMPILATION_REFUSALS: [RegExp, number, string, string][] = [
  [/not switched on/i, 403, "not_available", "Private links for films made on your computer are not switched on yet."],
  [/part of a ryagram plan/i, 403, "plan_required", "Private links are part of a Ryagram plan. Choose a plan on the website, then try again."],
  [/does not include/i, 403, "plan_excludes", "Your plan does not include private links for films made on your computer."],
  [/right to share/i, 400, "rights_required", "Tick that you have the right to share what is in this film."],
  [/at most \d+ MB on your plan/i, 400, "too_large", "That film is larger than your plan allows for a private link. Make it shorter or smaller."],
  [/keeps \d+ MB of private links/i, 403, "quota_full", "Your plan's space for private links is full. Delete one you no longer need, then try again."],
  [/already in progress/i, 409, "in_progress", "One upload is already in progress. Wait for it to finish."],
  [/not the size/i, 409, "size_mismatch", "The upload did not arrive whole. Cancel it and start again."],
  [/Too many tries/i, 429, "slow_down", "Too many tries. Wait a few minutes and try again."],
  [/upload is over|upload not found/i, 404, "not_found", "That upload is not there any more. Start again."],
];
function compilationRefusal(e: unknown): Response | null {
  const m = String((e as Error)?.message ?? "");
  for (const [re, status, error, text] of COMPILATION_REFUSALS) if (re.test(m)) return fail(status, error, text);
  return null;
}
const COMPILATION_PATH = new RegExp(`^(${"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"})/compilations/(${"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"})\\.mp4$`, "i");
/** The shape the database's node_compilation_begin gives: <person>/compilations/<film id>.mp4, with the film id the one it returned. Anything else is never signed. */
function compilationPathOk(path: unknown, id: string): path is string {
  if (typeof path !== "string" || path.length > 200 || path.includes("..") || path.includes("\\")) return false;
  const m = COMPILATION_PATH.exec(path);
  return !!m && m[2].toLowerCase() === id.toLowerCase();
}
const KINDS = ["contact_sheet", "preview", "final_video", "thumbnail", "receipt", "receipt_text", "metering"];
const CODE_SECONDS = 600;
export const POLL_INTERVAL = 5;

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status: number, error: string, message: string) => reply(status, { error, message });

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function userCode(): string {
  const out: string[] = [];
  while (out.length < 8) {                      // rejection sampling: no modulo bias
    for (const x of crypto.getRandomValues(new Uint8Array(16))) {
      if (x < 248 && out.length < 8) out.push(USER_CODE_ALPHABET[x % USER_CODE_ALPHABET.length]);        // 248 = 8 * 31
    }
  }
  return out.slice(0, 4).join("") + "-" + out.slice(4).join("");
}

/** The database's error codes (WORKER's draft) to fixed sentences. The database's own text is never sent. */
function dbError(e: unknown): Response {
  const code = (e as { code?: string })?.code;
  if (code === "PT401") return fail(401, "invalid_token", "Sign this computer in to Ryagram first.");
  if (code === "42501") return fail(403, "forbidden", "This account or this computer is not allowed to do that.");
  if (code === "PT404") return fail(404, "not_found", "That code is not valid any more.");
  if (code === "22023") return fail(400, "invalid_request", "That request was not valid.");
  if (code === "PT429") return fail(429, "slow_down", "Too many sign-in codes are waiting right now. Try again in a few minutes.");
  return fail(500, "server_error", "Something went wrong. Try again in a moment.");           // no console output of the error: it could hold a value
}

async function body(req: Request): Promise<Record<string, unknown> | Response> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return fail(415, "invalid_request", "Send JSON.");
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) return fail(413, "invalid_request", "That request is too large.");
  const text = await req.text();
  if (text.length > MAX_BODY) return fail(413, "invalid_request", "That request is too large.");
  try {
    const o = text ? JSON.parse(text) : {};
    return o && typeof o === "object" && !Array.isArray(o) ? o as Record<string, unknown> : fail(400, "invalid_request", "That request was not valid.");
  } catch { return fail(400, "invalid_request", "That request was not valid."); }
}

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max: number): string | null => (v == null ? null : typeof v === "string" && v.length <= max ? v : null);
const optNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function publicJob(j: NodeJob): NodeJob {
  const o: NodeJob = {};
  for (const k of JOB_FIELDS) if (k in j) o[k] = j[k];
  return o;
}

/** Who is calling, for the rate limits. NEVER a value the client can write: the platform's own cf-connecting-ip, else the LAST hop of X-Forwarded-For (the one the
 *  platform's proxy appended); the first entries are whatever the client sent. (CC1 15:25 MED-1.) */
async function caller(req: Request, salt: string): Promise<string> {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  const xff = req.headers.get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  const ip = cf || xff[xff.length - 1] || "unknown";
  return await sha256hex(salt + "|" + ip);                  // the FULL 64 hex characters: the database's node_hit refuses anything else (found by the local end-to-end harness)
}

/** The shape the database's register_artifact gives: owner/project/version/job/filename. Anything else is never signed (the signing key bypasses every RLS). (CC1 15:25 MED-3.) */
const SEG = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";            // any UUID-shaped hex: the shape is the guard, not the version bits (the local harness has ids that are not version 4)
function pathOk(path: unknown, jobId: string): path is string {
  if (typeof path !== "string" || path.length > 300 || path.includes("..") || path.startsWith("/") || path.includes("//") || path.includes("\\")) return false;
  const m = new RegExp(`^(${SEG})/(${SEG})/(${SEG})/(${SEG})/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$`, "i").exec(path);
  return !!m && m[4].toLowerCase() === jobId.toLowerCase();
}

export async function handleNode(req: Request, route: string, d: NodeDeps): Promise<Response> {
  const method = req.method;
  try {
    // ---------------------------------------------------------------- open: the sign-in
    if (route === "/device/code" && method === "POST") {
      const b = await body(req); if (b instanceof Response) return b;
      const who = await caller(req, d.salt);
      if (!(await d.db.hit(who, "device_code", 6, 60))) return fail(429, "slow_down", "Too many sign-in tries. Wait a minute and try again.");
      const name = typeof b.computer_name === "string" ? b.computer_name.replace(/[^\w .\-]/g, "").trim().slice(0, 60) : "";
      const deviceCode = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const code = userCode();
      const begun = await d.db.deviceBegin(await sha256hex(deviceCode), code, name || "This computer");
      const secs = Math.max(30, Math.min(CODE_SECONDS, Number(begun.expires_in) || CODE_SECONDS));
      const base = d.approvalBase.replace(/\/+$/, "");
      return reply(200, { device_code: deviceCode, user_code: code, verification_uri: `${base}/#/device`, verification_uri_complete: `${base}/#/device?code=${code}`, expires_in: secs, interval: Math.max(1, Math.min(60, Number(begun.interval) || POLL_INTERVAL)) });
    }
    if (route === "/device/token" && method === "POST") {
      const b = await body(req); if (b instanceof Response) return b;
      const dc = b.device_code;
      if (typeof dc !== "string" || !DEVICE_CODE.test(dc)) return fail(400, "expired_token", "The code ended. Start again on your computer.");
      const deviceHash = await sha256hex(dc);
      const who = await caller(req, d.salt);
      if (!(await d.db.hit(who, "device_poll_ip", 120, 60))) return fail(429, "slow_down", "Too many tries.");
      // The database owns the states and the poll interval; the token is minted HERE only so that the database can store its hash, and is handed out only if the database says ok.
      const token = TOKEN_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
      const r = await d.db.deviceExchange(deviceHash, await sha256hex(token));
      if (r.state === "ok" && r.account) {
        return reply(200, { node_token: token, expires_in: Math.max(60, Number(r.expires_in) || 30 * 86400),
                            account: { email: r.account.email ?? "", computer_name: r.account.computer_name, local_compute: !!r.account.local_compute } });
      }
      if (r.state === "slow_down") return reply(400, { error: "slow_down", interval: Math.max(POLL_INTERVAL, Math.min(60, Number(r.interval) || POLL_INTERVAL + 5)) });
      if (r.state === "authorization_pending" || r.state === "access_denied") return reply(400, { error: r.state });
      return reply(400, { error: "expired_token" });
    }

    // ---------------------------------------------------------------- signed in: a rgn_ bearer in the Authorization header, nowhere else
    const isCompilation = COMPILATION_ROUTES.includes(route);
    if (isCompilation && !d.compilationLinksOn) return fail(404, "not_found", "Not found.");              // the routes do not exist unless the function is switched on
    const isCall = isCompilation || ["/account", "/signout", "/node/claim", "/node/heartbeat", "/node/state", "/node/retry", "/node/artifact", "/node/compilation-requests", ...EDIT_ROUTES, ...DOWNLOAD_ROUTES].includes(route);
    if (!isCall) return fail(404, "not_found", "Not found.");
    const wantGet = route === "/account";
    if ((wantGet && method !== "GET") || (!wantGet && method !== "POST")) return fail(405, "method_not_allowed", "That is not allowed here.");
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!TOKEN.test(token)) return fail(401, "invalid_token", "Sign this computer in to Ryagram first.");       // a Supabase JWT, a connector token or junk never reaches the database
    const h = await sha256hex(token);

    if (route === "/account") {
      const a = (await d.db.account(h)).account;
      return reply(200, { account: { email: a.email ?? "", computer_name: a.computer_name, local_compute: !!a.local_compute, approved_until: String(a.approved_until ?? "").slice(0, 10) } });
    }
    if (route === "/signout") { await d.db.signout(h); return reply(200, { ok: true }); }
    if (route === "/node/claim") {
      const j = await d.db.claim(h);
      return reply(200, { job: j ? publicJob(j) : null });
    }

    if (route === "/node/compilation-requests") {                                          // READ ONLY (NEXT-CONNECT 131b): the requests the person's AI wrote; always on, it starts nothing
      const who = await caller(req, d.salt);
      if (!(await d.db.hit(who, "compilation_requests_ip", 60, 60))) return fail(429, "slow_down", "Too many tries. Wait a minute and try again.");
      const rows = await d.db.compilationRequests(h);
      return reply(200, { requests: (Array.isArray(rows) ? rows : []).slice(0, 20).map((r) => ({ project_id: r.project_id, title: r.title, request: r.request, sha256: r.sha256, updated_at: r.updated_at })) });
    }

    if (route === "/node/download-plans") {                                                // READ ONLY (NEXT-CONNECT 152): the download plans the person's AI wrote; the app shows them and the person decides
      const who = await caller(req, d.salt);
      if (!(await d.db.hit(who, "download_plans_ip", 60, 60))) return fail(429, "slow_down", "Too many tries. Wait a minute and try again.");
      const rows = await d.db.downloadPlans(h);
      return reply(200, { plans: (Array.isArray(rows) ? rows : []).slice(0, 5).map((r) => ({ id: r.id, request: r.request, state: r.state })) });
    }

    if (route === "/node/edit-pending") {                                                  // READ ONLY (NEXT-CONNECT 142): what the person's AI or web editor queued for their open compilation
      const who = await caller(req, d.salt);
      if (!(await d.db.hit(who, "edit_pending_ip", 120, 60))) return fail(429, "slow_down", "Too many tries. Wait a minute and try again.");
      const rows = await d.db.editPending(h);
      return reply(200, { changes: (Array.isArray(rows) ? rows : []).slice(0, 100).map((r) => ({ id: r.id, project_id: r.project_id, revision: r.revision, client: r.client, op: r.op })) });
    }

    const b = await body(req); if (b instanceof Response) return b;
    if (route === "/node/download-update") {                                               // the app tells the STATE of one plan; a receipt only with 'done'
      const who = await caller(req, d.salt);
      if (!(await d.db.hit(who, "download_update_ip", 120, 60))) return fail(429, "slow_down", "Too many tries. Wait a minute and try again.");
      const bad = () => fail(400, "invalid_request", "That request was not valid.");
      if (typeof b.id !== "string" || !UUID.test(b.id) || typeof b.state !== "string" || !DL_STATES.includes(b.state)) return bad();
      const receipt = b.receipt === undefined || b.receipt === null ? null : b.receipt;
      if (receipt !== null && (typeof receipt !== "object" || Array.isArray(receipt) || b.state !== "done")) return bad();
      const r = await d.db.downloadUpdate(h, b.id, b.state, receipt as Record<string, unknown> | null);
      if (r === null || r === undefined) return fail(404, "not_found", "That download request was not found.");
      return reply(200, { state: String(r) });
    }
    if (route === "/node/edit-summary") {
      const who = await caller(req, d.salt);
      if (!(await d.db.hit(who, "edit_summary_ip", 60, 60))) return fail(429, "slow_down", "Too many tries. Wait a minute and try again.");
      const bad = () => fail(400, "invalid_request", "That request was not valid.");
      if (typeof b.project_id !== "string" || !UUID.test(b.project_id) || typeof b.mirror !== "boolean") return bad();
      if (b.ai_visible !== undefined && typeof b.ai_visible !== "boolean") return bad();
      const summary = b.summary === undefined || b.summary === null ? null : b.summary;
      if (summary !== null && (typeof summary !== "object" || Array.isArray(summary))) return bad();
      if (b.mirror && summary === null) return bad();                                                // mirroring needs the summary; stopping needs none
      const applied = b.applied === undefined ? [] : b.applied;
      if (!Array.isArray(applied) || applied.length > 100 || applied.some((a) => !a || typeof a !== "object" || !Number.isInteger((a as { op_id?: unknown }).op_id) || (a as { op_id: number }).op_id < 1
          || typeof (a as { ok?: unknown }).ok !== "boolean" || Object.keys(a as object).some((k) => k !== "op_id" && k !== "ok"))) return bad();
      const r = await d.db.editPostSummary(h, b.project_id, b.mirror, b.ai_visible === true, summary as Record<string, unknown> | null, applied as { op_id: number; ok: boolean }[]);
      return reply(200, { revision: r.revision, mirrored: r.mirrored, ai_visible: r.ai_visible });
    }
    if (isCompilation) {
      const who = await caller(req, d.salt);
      if (!(await d.db.hit(who, "compilation_ip", 60, 60))) return fail(429, "slow_down", "Too many tries. Wait a minute and try again.");
      if (route === "/node/compilation/status") return reply(200, { status: await d.db.compilationStatus(h) });
      if (route === "/node/compilation/start") {
        if (!isStr(b.title, 200) || !b.title.trim()) return fail(400, "invalid_request", "Give the film a title of 1 to 200 letters.");
        const bytes = b.bytes;
        if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1) return fail(400, "invalid_request", "That request was not valid.");
        const cap = d.maxCompilationBytes ?? 1_000_000_000;
        if (bytes > cap) return fail(413, "too_large", `That film is larger than this computer may upload (${Math.round(cap / 1_000_000)} MB).`);
        if (typeof b.sha256 !== "string" || !SHA256.test(b.sha256)) return fail(400, "invalid_request", "That request was not valid.");
        if (b.rights !== true) return fail(400, "rights_required", "Tick that you have the right to share what is in this film.");          // explicit true, never implied
        const r = await d.db.compilationBegin(h, b.title.trim(), bytes, b.sha256, true, optNum(b.duration_s), optNum(b.width), optNum(b.height));
        if (!r || typeof r.id !== "string" || !UUID.test(r.id) || !compilationPathOk(r.path, r.id)) return fail(500, "server_error", "Something went wrong. Try again in a moment.");     // nothing is signed for an odd path
        return reply(200, { id: r.id, path: r.path, upload_url: await d.storage.signUpload(r.path) });
      }
      if (typeof b.id !== "string" || !UUID.test(b.id)) return fail(400, "invalid_request", "That request was not valid.");
      if (route === "/node/compilation/finish") { const r = await d.db.compilationFinish(h, b.id); return reply(200, { id: r.id, expires_at: String(r.expires_at ?? "") }); }
      return reply(200, { cancelled: !!(await d.db.compilationCancel(h, b.id)) });
    }
    if (typeof b.job_id !== "string" || !UUID.test(b.job_id)) return fail(400, "invalid_request", "That request was not valid.");
    const jobId = b.job_id;
    if (route === "/node/heartbeat") {
      const ok = await d.db.heartbeat(h, jobId, optNum(b.progress), optStr(b.note, 500), b.detail && typeof b.detail === "object" ? b.detail : null);
      return reply(200, { ok: !!ok });
    }
    if (route === "/node/state") {
      if (typeof b.state !== "string" || !NODE_STATES.includes(b.state)) return fail(400, "invalid_request", "That request was not valid.");
      // At "complete" the DATABASE (rev4 report_state) compares every registered file with what Storage actually holds and refuses a missing or wrong-sized one (42501, so 403 here).
      const j = await d.db.reportState(h, jobId, b.state, optStr(b.error_code, 80), optStr(b.error_detail, 2000), optStr(b.engine_commit, 80), typeof b.engine_dirty === "boolean" ? b.engine_dirty : null);
      return reply(200, { job: publicJob(j) });
    }
    if (route === "/node/retry") {
      if (!isStr(b.error_code, 80)) return fail(400, "invalid_request", "That request was not valid.");
      return reply(200, { result: await d.db.retry(h, jobId, b.error_code, optStr(b.error_detail, 2000)) });
    }
    // /node/artifact: the database validates the job state and kind and DERIVES the path; this function then signs that one path. The request never names a path.
    if (typeof b.kind !== "string" || !KINDS.includes(b.kind)) return fail(400, "invalid_request", "That request was not valid.");
    const bytes = b.bytes;
    if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) return fail(400, "invalid_request", "That request was not valid.");
    const cap = d.maxFileBytes ?? 200_000_000;
    if (bytes > cap) return fail(413, "too_large", `That file is larger than this computer may upload (${Math.round(cap / 1_000_000)} MB).`);
    if (typeof b.sha256 !== "string" || !SHA256.test(b.sha256)) return fail(400, "invalid_request", "That request was not valid.");
    const path = await d.db.registerArtifact(h, jobId, b.kind, bytes, b.sha256, optNum(b.duration_s), optNum(b.width), optNum(b.height));
    if (!pathOk(path, jobId)) return fail(500, "server_error", "Something went wrong. Try again in a moment.");          // nothing is signed for a path of an unexpected shape
    return reply(200, { path, upload_url: await d.storage.signUpload(path) });
  } catch (e) {
    if (COMPILATION_ROUTES.includes(route)) { const r = compilationRefusal(e); if (r) return r; }
    if (DOWNLOAD_ROUTES.includes(route)) {
      if ((e as { code?: string })?.code === "22023") return fail(400, "invalid_request", "That download update was not accepted.");
    }
    if (EDIT_ROUTES.includes(route)) {
      const code = (e as { code?: string })?.code;
      if (code === "PT404") return fail(404, "not_found", "That film was not found among your projects.");
      if (code === "22023") return fail(400, "invalid_request", "The track summary was not accepted.");
    }
    return dbError(e);
  }
}
