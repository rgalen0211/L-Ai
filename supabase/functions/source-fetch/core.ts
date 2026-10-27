// source-fetch (find-data S2, NEXT-CONNECT 137): a signed-in person names the address of a data file on an ALLOWLISTED OFFICIAL host; Ryagram's server fetches it, checks what it really is, stores it in the person's
// private upload slot and queues it for the same sandboxed reader every upload goes through. Nothing is usable until the PERSON confirms the columns in the app. Tested in tests/source-fetch.test.mjs and tests/fetch-rules.test.mjs.
//
// THE RULES (design paper section 3). https only, standard port, no user name or password; the host must be on the database's reviewed list (fetch_host_for) at the first address AND at every redirect, BEFORE that address
// is contacted; at most 3 redirects; no cookies or credentials; the whole fetch, robots.txt included, in 20 seconds; 10 MiB counted as the bytes arrive; the file's real type decided from its bytes (CSV, TSV, xlsx, ods);
// HTML, JSON, PDF and anything else refused; a 401/402/403 or a sign-in page refused and never retried; robots.txt honoured for every path that is not an API. THE LABEL IS NEVER SENT TO THE DATABASE: it is looked up there
// from the final address. Whatever else the caller puts in the request body is ignored.
import { MAX_BYTES, MAX_REDIRECTS, MIME, ROBOTS_MAX_BYTES, SENTENCES, TIMEOUT_MS, USER_AGENT, isApiPath, nameFor, parseTarget, robotsAllows, sniff } from "../_shared/fetch_rules.ts";
import type { Reason } from "../_shared/fetch_rules.ts";

export interface Registered { dataset_id: string; storage_path: string; trust_label: string; publisher: string; licence_class: string }
export interface RegisterArgs { attempt: string; owner: string; finalUrl: string; ext: string; bytes: number; sha256: string; name: string; why: string; codeVersion: string }

export interface Deps {
  allowedOrigins: string[];
  verifyUser(jwt: string): Promise<{ id: string; clientId: string | null } | null>;
  /** fetch_host_for: is this host (or its parent domain) on the reviewed list? */
  hostListed(host: string): Promise<boolean>;
  /** fetch_reserve: the limits, the list, the attempt row. Throws an Error with the database's SQLSTATE in .code and a plain sentence in .message. */
  reserve(owner: string, host: string): Promise<string>;
  fail(attempt: string, reason: Reason): Promise<void>;
  register(a: RegisterArgs): Promise<Registered>;
  storagePut(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  finish(datasetId: string): Promise<void>;
  abort(datasetId: string): Promise<void>;
  /** The network. Called with redirect 'manual' and no credentials; must reject when the signal aborts. */
  fetch(url: string, init: { method: "GET"; redirect: "manual"; credentials: "omit"; headers: Record<string, string>; signal: AbortSignal }): Promise<Response>;
  timeoutMs?: number;
  now?(): Date;
}

type Refusal = { refused: Reason };
const refuse = (reason: Reason): Refusal => ({ refused: reason });
const isRefusal = (e: unknown): e is Refusal => typeof e === "object" && e !== null && "refused" in e;

const STATUS: Record<Reason, number> = {
  off_list: 400, not_https: 400, redirect: 422, too_big: 413, too_slow: 504, not_a_table: 415, is_html: 415, login: 422, robots: 422, http_error: 502, unreadable: 502, storage: 502, quota: 400,
};
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/csv, text/tab-separated-values, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.oasis.opendocument.spreadsheet;q=0.9, */*;q=0.1",
};
const WARN_OTHERS = (publisher: string) => `Ryagram has not checked these figures. They come from ${publisher}.`;       // PLACEHOLDER wording: Ryan's and the attorney's to set

async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) {
    const b = new Uint8Array(await res.arrayBuffer());
    if (b.length > cap) throw refuse("too_big");
    return b;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { await reader.cancel().catch(() => {}); throw refuse("too_big"); }      // counted as the bytes arrive: a lying or missing Content-Length cannot get past this
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.verifyUser(jwt).catch(() => null) : null;
  if (!user) return reply(401, { error: "Sign in first." });
  if (user.clientId) return reply(403, { error: "Data is fetched by a person in the Ryagram app, not by a connected AI." });

  let rawUrl: unknown, why = "";
  try {
    const body = JSON.parse(await req.text());                                            // ONLY url and why are read; any other key (a label, a licence, a dataset id) is ignored
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Bad request." });
    rawUrl = (body as Record<string, unknown>).url;
    const w = (body as Record<string, unknown>).why;
    if (typeof w === "string") why = w.slice(0, 300);
  } catch {
    return reply(400, { error: "Bad request." });
  }
  const target = parseTarget(rawUrl);
  if (!target.ok) return reply(STATUS[target.reason], { error: SENTENCES[target.reason], code: target.reason });

  let attempt: string;
  try {
    attempt = await deps.reserve(user.id, target.host);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "PT429") return reply(429, { error: String(e.message ?? "").slice(0, 300), code: "limit" });
    if (e.code === "22023") return reply(400, { error: String(e.message ?? "").slice(0, 300), code: /official sources/.test(String(e.message)) ? "off_list" : "quota" });
    if (e.code === "PT401") return reply(401, { error: "Sign in first." });
    console.error(`source-fetch reserve: ${e.code ?? "error"}`);
    return reply(500, { error: "The fetch couldn't start just now. Try again in a minute." });
  }

  const stop = async (reason: Reason) => {
    await deps.fail(attempt, reason).catch(() => console.error("source-fetch fail-note failed"));
    return reply(STATUS[reason], { error: SENTENCES[reason], code: reason });
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  let bytes: Uint8Array, finalUrl: URL, contentType = "";
  try {
    const robotsSeen = new Map<string, string | null>();                                    // host -> robots text (null = no rules)
    const robotsOk = async (u: URL): Promise<boolean> => {
      if (isApiPath(u)) return true;
      if (!robotsSeen.has(u.hostname)) {
        const rb = new URL("/robots.txt", u.origin);
        const res = await deps.fetch(rb.href, { method: "GET", redirect: "manual", credentials: "omit", headers: HEADERS, signal: ctl.signal });
        if (res.status >= 500 || REDIRECTS.has(res.status)) { await res.body?.cancel().catch(() => {}); throw refuse("robots"); }     // unreachable: treated as 'do not fetch' (RFC 9309)
        if (res.status !== 200) { await res.body?.cancel().catch(() => {}); robotsSeen.set(u.hostname, null); }                          // 4xx: no rules
        else robotsSeen.set(u.hostname, new TextDecoder().decode(await readCapped(res, ROBOTS_MAX_BYTES).catch(() => { throw refuse("robots"); })));
      }
      const text = robotsSeen.get(u.hostname);
      return text == null ? true : robotsAllows(text, u.pathname + u.search);
    };

    let url = target.url;
    let got: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS && got === null; hop++) {
      if (!(await deps.hostListed(url.hostname))) throw refuse(hop === 0 ? "off_list" : "redirect");        // checked BEFORE the address is contacted
      if (!(await robotsOk(url))) throw refuse("robots");
      const res = await deps.fetch(url.href, { method: "GET", redirect: "manual", credentials: "omit", headers: HEADERS, signal: ctl.signal });
      if (REDIRECTS.has(res.status)) {
        await res.body?.cancel().catch(() => {});
        const next = parseTarget(res.headers.get("location") ?? "", url.href);
        if (!next.ok) throw refuse("redirect");
        url = next.url;
        continue;
      }
      if (res.status === 401 || res.status === 402 || res.status === 403) { await res.body?.cancel().catch(() => {}); throw refuse("login"); }
      if (res.status !== 200) { await res.body?.cancel().catch(() => {}); throw refuse("http_error"); }
      got = res;
      finalUrl = url;
    }
    if (got === null) throw refuse("redirect");
    contentType = got.headers.get("content-type") ?? "";
    if (/^(text\/html|application\/xhtml)/i.test(contentType)) { await got.body?.cancel().catch(() => {}); throw refuse("is_html"); }
    const declared = Number(got.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BYTES) { await got.body?.cancel().catch(() => {}); throw refuse("too_big"); }
    bytes = await readCapped(got, MAX_BYTES);
  } catch (e) {
    clearTimeout(timer);
    if (isRefusal(e)) return stop(e.refused);
    if (ctl.signal.aborted || (e as { name?: string })?.name === "AbortError") return stop("too_slow");
    return stop("unreadable");
  }
  clearTimeout(timer);

  const sniffed = sniff(bytes, contentType);
  if (!sniffed.ok) return stop(sniffed.reason);
  const sha = await sha256Hex(bytes);
  let reg: Registered;
  try {
    reg = await deps.register({ attempt, owner: user.id, finalUrl: finalUrl!.href, ext: sniffed.ext, bytes: bytes.length, sha256: sha, name: nameFor(finalUrl!, sniffed.ext), why, codeVersion: "source-fetch/1" });
  } catch (err) {
    const e = err as { code?: string };
    console.error(`source-fetch register: ${e.code ?? "error"}`);
    return stop(e.code === "22023" ? "quota" : e.code === "PT404" ? "unreadable" : "storage");
  }
  try {
    await deps.storagePut(reg.storage_path, bytes, MIME[sniffed.ext]);
    await deps.finish(reg.dataset_id);
  } catch {
    await deps.abort(reg.dataset_id).catch(() => console.error("source-fetch abort failed"));
    return stop("storage");
  }
  return reply(200, {
    dataset_id: reg.dataset_id, state: "reading", trust_label: reg.trust_label, publisher: reg.publisher, licence_class: reg.licence_class,
    final_url: finalUrl!.href, bytes: bytes.length, sha256: sha, file_type: sniffed.ext, name: nameFor(finalUrl!, sniffed.ext), retrieved_at: (deps.now?.() ?? new Date()).toISOString(),
    warning: reg.trust_label === "official" ? "" : WARN_OTHERS(reg.publisher),
  });
}
