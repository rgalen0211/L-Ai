// The rules of fetching a file for a person (find-data S2, NEXT-CONNECT 137): pure functions with no network and no database, so every refusal can be tried on its own.
// source-fetch/core.ts uses them; tests/fetch-rules.test.mjs and tests/source-fetch.test.mjs prove each one with a case that FAILS if the rule is removed.
// Design: Ryagram-logs/proposals/CONNECT-FIND-DATA-DESIGN.md section 3.

export const MAX_BYTES = 10 * 1024 * 1024;          // the upload cap
export const MAX_REDIRECTS = 3;
export const TIMEOUT_MS = 20_000;                    // the whole fetch, redirects and body together
export const ROBOTS_MAX_BYTES = 64 * 1024;
export const USER_AGENT = "Ryagram-DataFetch/1 (+https://uselai.com; ryagram@uselai.com)";

/** The closed list of reasons (the same words as fetch_attempts.reason in the database). */
export type Reason = "off_list" | "not_https" | "redirect" | "too_big" | "too_slow" | "not_a_table" | "is_html" | "login" | "robots" | "http_error" | "unreadable" | "storage" | "quota";

export const SENTENCES: Record<Reason, string> = {
  off_list: "That address is not on the list of official sources Ryagram can fetch from yet.",
  not_https: "Only https addresses on the standard port, with no user name or password in them, are fetched.",
  redirect: "That address sent Ryagram somewhere it does not fetch from, or sent it on too many times.",
  too_big: "That file is over the 10 MB limit.",
  too_slow: "The site took too long to answer.",
  not_a_table: "That is not a CSV, TSV, Excel (.xlsx) or OpenDocument (.ods) file.",
  is_html: "That address is a web page, not a data file. Ryagram does not read web pages.",
  login: "That file is behind a sign-in or a paywall. Ryagram does not sign in to other sites.",
  robots: "That site asks programs not to fetch that address.",
  http_error: "The site did not give the file (it answered with an error).",
  unreadable: "Ryagram could not read what the site sent.",
  storage: "The file could not be stored just now. Try again in a minute.",
  quota: "That would take you over your limit for uploaded data. Delete something to make room.",
};

export type Target = { ok: true; url: URL; host: string } | { ok: false; reason: Reason };

/** An address the function is willing to ask for: https, the standard port, no user name or password, a plain lower-case ASCII host name with a dot (so no IP number, no 'localhost'). The LIST is checked by the database. */
export function parseTarget(raw: unknown, base?: string): Target {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000 || /[\u0000-\u0020\u007f-\u009f\\]/.test(raw.trim())) return { ok: false, reason: "not_https" };      // no control character, space or backslash anywhere in it
  let u: URL;
  try { u = new URL(raw.trim(), base); } catch { return { ok: false, reason: "not_https" }; }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.port !== "") return { ok: false, reason: "not_https" };
  const host = u.hostname;                              // the URL parser has lower-cased it, removed a trailing dot's meaning and punycoded any non-ASCII
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || host.length > 253 || /^[0-9.]+$/.test(host) || host.includes("xn--")) return { ok: false, reason: "not_https" };
  u.hash = "";
  return { ok: true, url: u, host };
}

/** Is this a path the robots.txt rules apply to? A machine interface (an api. host, or a path under /api/) is a place programs are meant to ask. */
export function isApiPath(u: URL): boolean {
  return u.hostname.startsWith("api.") || /^\/api(\/|$)/i.test(u.pathname);
}

/** robots.txt (RFC 9309, the parts that matter): the group for our name, else '*'; the longest matching rule wins and Allow wins a tie; '*' and a closing '$' work in a path. */
export function robotsAllows(robotsText: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let cur: { agents: string[]; rules: { allow: boolean; pattern: string }[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robotsText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (cur) cur.rules.push({ allow: key === "allow", pattern: val });
    } else {
      lastWasAgent = false;
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== "*" && a.length > 0 && "ryagram-datafetch".startsWith(a)));
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (r.pattern === "") continue;                    // 'Disallow:' with nothing allows everything
      const anchored = r.pattern.endsWith("$"), pat = anchored ? r.pattern.slice(0, -1) : r.pattern;
      const re = new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (anchored ? "$" : ""));
      if (!re.test(path)) continue;
      const len = r.pattern.length;
      if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

const HTML_MARKERS = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|<meta\s/i;

export type Sniffed = { ok: true; ext: "csv" | "tsv" | "xlsx" | "ods" } | { ok: false; reason: Reason };

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 16777216)) >>> 0; }

/** The names inside a zip, from its central directory (nothing is unpacked). null when it is not a readable zip. */
export function zipNames(b: Uint8Array): string[] | null {
  let e = b.length - 22;
  const stop = Math.max(0, b.length - 22 - 65535);
  while (e >= stop && u32(b, e) !== 0x06054b50) e--;
  if (e < stop) return null;
  let n = u16(b, e + 10), p = u32(b, e + 16);
  const names: string[] = [];
  const dec = new TextDecoder();
  while (n-- > 0) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return null;
    const len = u16(b, p + 28), extra = u16(b, p + 30), com = u16(b, p + 32);
    if (p + 46 + len > b.length) return null;
    names.push(dec.decode(b.subarray(p + 46, p + 46 + len)));
    p += 46 + len + extra + com;
  }
  return names;
}

/** What the bytes REALLY are, decided from the bytes (never from the address or the header alone). */
export function sniff(b: Uint8Array, contentType: string): Sniffed {
  const ct = contentType.toLowerCase();
  if (/^(text\/html|application\/xhtml)/.test(ct)) return { ok: false, reason: "is_html" };
  if (b.length === 0) return { ok: false, reason: "not_a_table" };
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    const names = zipNames(b);
    if (!names) return { ok: false, reason: "not_a_table" };
    if (names.includes("xl/workbook.xml")) return { ok: true, ext: "xlsx" };
    if (names.includes("content.xml") && names.includes("mimetype") && new TextDecoder().decode(b.subarray(30, 200)).includes("application/vnd.oasis.opendocument.spreadsheet")) return { ok: true, ext: "ods" };
    return { ok: false, reason: "not_a_table" };
  }
  const head = b.subarray(0, 8192);
  const magic = (...s: number[]) => s.every((v, i) => head[i] === v);
  if (magic(0x25, 0x50, 0x44, 0x46) || magic(0x4d, 0x5a) || magic(0x7f, 0x45, 0x4c, 0x46) || magic(0x1f, 0x8b) || magic(0x89, 0x50, 0x4e, 0x47) || magic(0xff, 0xd8, 0xff) || magic(0x47, 0x49, 0x46, 0x38) ||
      magic(0xd0, 0xcf, 0x11, 0xe0) || magic(0x42, 0x5a, 0x68) || magic(0x37, 0x7a, 0xbc, 0xaf)) return { ok: false, reason: "not_a_table" };
  if (head.includes(0)) return { ok: false, reason: "not_a_table" };
  const text = new TextDecoder("latin1").decode(head);
  const lead = text.replace(/^\xEF\xBB\xBF/, "").trimStart();
  if (lead.startsWith("<") || HTML_MARKERS.test(text.slice(0, 1024))) return { ok: false, reason: /^<\?xml/i.test(lead) ? "not_a_table" : "is_html" };
  if (lead.startsWith("{") || (lead.startsWith("[") && !/^\[[^\]\n]*\]\s*[,\n]/.test(lead))) return { ok: false, reason: "not_a_table" };
  let control = 0;
  for (const c of head) if (c < 9 || (c > 13 && c < 32)) control++;
  if (head.length > 0 && control / head.length > 0.01) return { ok: false, reason: "not_a_table" };
  const first = lead.split(/\r?\n/)[0] ?? "";
  const tabs = (first.match(/\t/g) ?? []).length, commas = (first.match(/,/g) ?? []).length;
  return { ok: true, ext: tabs > 0 && tabs >= commas ? "tsv" : "csv" };
}

export const MIME: Record<string, string> = {
  csv: "text/csv", tsv: "text/tab-separated-values",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ods: "application/vnd.oasis.opendocument.spreadsheet",
};

/** A short name for the dataset from the address's last path part (letters, digits, dot, dash, underscore and space only). */
export function nameFor(u: URL, ext: string): string {
  let last = "";
  try { last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? ""); } catch { last = ""; }
  last = last.replace(/[^A-Za-z0-9._ -]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return last || `${u.hostname} data.${ext}`;
}
