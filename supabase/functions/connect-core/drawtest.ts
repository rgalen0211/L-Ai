// DRAW-AND-RETURN TEST (probe, off by default). Answers one question per host, with no paid call and no key:
// can the person's connected AI hand a PICTURE back to Ryagram through a tool, and how big can it be?
//
// Two tools. draw_test_start gives the AI a nonce and a job: "echo" (copy the small test picture we hand you, byte for byte: this
// tests the TRANSPORT alone, whatever the AI can draw) or "draw" (make your own picture of the test character and send it).
// draw_test_submit takes it back, checks it as hostile input, and records what happened. Nothing here is ever shown to a
// viewer or put in a film; a stored test picture is private to the person and purged after seven days (draft SQL, not applied).
//
// Off unless enableDrawTest() is called (connect/index.ts does that only when CONNECT_DRAW_TEST=1). The client is UNTRUSTED:
// the host and model names it sends are CLAIMS, recorded as claims; the client id comes from the token, not from the call.
import type { ToolCtx, ToolDef, ToolResult } from "./types.ts";
import { TOOLS, TOOL_BY_NAME } from "./tools.ts";

export const DRAW_LIMITS = Object.freeze({
  maxImageBytes: 190 * 1024,            // decoded; base64 of this (about 253 KB) still fits the 300 KB body cap
  maxSvgBytes: 100 * 1024,
  maxPixels: 4096,                      // either side of a PNG
  startsPerDay: 20,
  submitsPerDay: 40,
  nonceMinutes: 30,
});
export const ECHO_TIERS = Object.freeze({ S: 16, M: 64, L: 128 });     // square side in pixels; raw RGB, so about 0.8 KB, 12 KB, 48 KB
export type Tier = keyof typeof ECHO_TIERS;

export interface DrawIssue { nonce: string; mode: "echo" | "draw"; tier: Tier | null; payloadSha256: string | null; payloadBytes: number; issuedAt: number }
export interface DrawResult {
  nonce: string; mode: "echo" | "draw"; tier: Tier | null; at: number;
  clientId: string | null;             // from the token (server-known)
  claimedHost: string; claimedModel: string; howMade: string;      // claims
  kind: "png" | "jpeg" | "svg" | "none"; bytes: number; width: number | null; height: number | null; sha256: string;
  outcome: "pass" | "fail"; reason: string; exactMatch: boolean | null; firstDiffByte: number | null;
  image?: Uint8Array;                  // kept only when it passed validation, private, purged after seven days
}
/** What the data layer must offer. The real one is a pair of SQL functions (draft in the proposals folder); the fake is in fake.ts. */
export interface DrawStore {
  issue(i: DrawIssue): Promise<void>;
  take(nonce: string): Promise<DrawIssue | null>;      // the person's own, unused, unexpired; marks it used
  save(r: DrawResult): Promise<void>;
  /** What the host said about itself at initialize: the one place a stateless server can learn whether it offers sampling. */
  handshake?(h: Handshake): Promise<void>;
}
export interface Handshake { at: number; clientId: string | null; clientName: string; clientVersion: string; protocol: string; capabilityKeys: string[]; sampling: boolean; elicitation: boolean; roots: boolean }

/** Called by the MCP face on initialize, only when the probe is switched on. Claims, cleaned and capped; never throws. */
export async function noteHandshake(store: DrawStore | null | undefined, clientId: string | null | undefined, params: unknown): Promise<void> {
  if (!store?.handshake) return;
  try {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, any>;
    const caps = p.capabilities && typeof p.capabilities === "object" && !Array.isArray(p.capabilities) ? p.capabilities as Record<string, unknown> : {};
    const keys = Object.keys(caps).slice(0, 20).map((k) => clean(k, 30)).filter(Boolean);
    await store.handshake({ at: Date.now(), clientId: clientId ?? null, clientName: clean(p.clientInfo?.name, 60), clientVersion: clean(p.clientInfo?.version, 30),
      protocol: clean(p.protocolVersion, 12), capabilityKeys: keys, sampling: "sampling" in caps, elicitation: "elicitation" in caps, roots: "roots" in caps });
  } catch { /* recording what a host says is never allowed to break the handshake */ }
}

// ---------------------------------------------------------------------------------------------- bytes
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export async function sha256(b: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)));
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const chunk = (type: string, data: Uint8Array) => { const t = new TextEncoder().encode(type); return cat(u32(data.length), t, data, u32(crc32(cat(t, data)))); };
function adler32(b: Uint8Array) { let a = 1, s = 0; for (const x of b) { a = (a + x) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }

/** A valid PNG of incompressible noise, made from a seed with stored (uncompressed) deflate blocks, so its size is exact and
 *  nothing about it can be guessed, summarised or "drawn from memory": the AI must copy it faithfully or fail. */
export function noisePng(side: number, seed: number): Uint8Array {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s & 255; };
  const row = side * 3 + 1;
  const raw = new Uint8Array(row * side);
  for (let y = 0; y < side; y++) { raw[y * row] = 0; for (let x = 1; x < row; x++) raw[y * row + x] = rnd(); }
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let i = 0; i < raw.length; i += 65535) {
    const part = raw.subarray(i, Math.min(i + 65535, raw.length)); const last = i + 65535 >= raw.length ? 1 : 0;
    blocks.push(new Uint8Array([last, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255]), part);
  }
  blocks.push(u32(adler32(raw)));
  const ihdr = cat(u32(side), u32(side), new Uint8Array([8, 2, 0, 0, 0]));
  return cat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", cat(...blocks)), chunk("IEND", new Uint8Array(0)));
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
export function fromBase64(s: string): Uint8Array | null {
  const t = s.replace(/\s+/g, "");
  if (!t || t.length % 4 !== 0 || !B64.test(t)) return null;
  try { const bin = atob(t); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; } catch { return null; }
}
export function toBase64(b: Uint8Array): string { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }

export interface Sniffed { kind: "png" | "jpeg" | "none"; width: number | null; height: number | null; problem: string }
/** What the bytes ARE, by their own magic and header, never by what the client says. */
export function sniffImage(b: Uint8Array): Sniffed {
  const png = b.length > 33 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10;
  if (png) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return { kind: "none", width: null, height: null, problem: "the PNG has no header chunk" };
    const w = dv.getUint32(16), h = dv.getUint32(20);
    if (!w || !h || w > DRAW_LIMITS.maxPixels || h > DRAW_LIMITS.maxPixels) return { kind: "png", width: w, height: h, problem: `the picture is ${w} x ${h}; the limit is ${DRAW_LIMITS.maxPixels} on each side` };
    return { kind: "png", width: w, height: h, problem: "" };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;                                                // walk the markers to the first frame header for the size
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = (b[i + 5] << 8) | b[i + 6], w = (b[i + 7] << 8) | b[i + 8];
        if (!w || !h || w > DRAW_LIMITS.maxPixels || h > DRAW_LIMITS.maxPixels) return { kind: "jpeg", width: w, height: h, problem: `the picture is ${w} x ${h}; the limit is ${DRAW_LIMITS.maxPixels} on each side` };
        return { kind: "jpeg", width: w, height: h, problem: "" };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return { kind: "jpeg", width: null, height: null, problem: "the JPEG has no readable frame header" };
  }
  return { kind: "none", width: null, height: null, problem: "the bytes are not a PNG or a JPEG (checked by their first bytes, not by what the call said)" };
}

/** Vector art is TEXT, so it can be passed as a plain argument. It is stored, never rendered or served by this probe; the rules
 *  still refuse anything that could run or fetch, because the same text would one day be rasterised. */
export function checkSvg(t: string): string {
  if (new TextEncoder().encode(t).length > DRAW_LIMITS.maxSvgBytes) return `the SVG is larger than ${DRAW_LIMITS.maxSvgBytes / 1024} KB`;
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(t)) return "the text does not start with an <svg> element";
  if (/<\s*script|<\s*foreignObject|<\s*iframe|<\s*object|<\s*embed|<!ENTITY|<!DOCTYPE/i.test(t)) return "the SVG contains script, foreign content or an entity declaration";
  if (/\son[a-z]+\s*=/i.test(t)) return "the SVG contains an event handler";
  if (/(?:xlink:)?href\s*=\s*["']\s*(?!#)/i.test(t) || /url\(\s*["']?\s*(?!#)/i.test(t) || /@import/i.test(t)) return "the SVG points outside itself (an external link or image)";
  return "";
}

// ---------------------------------------------------------------------------------------------- tools
const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const ok = (text: string, data?: Record<string, unknown>, extra: Partial<ToolResult> = {}): ToolResult => ({ text, data, ...extra });
const refuse = (text: string, code: string, extra: Partial<ToolResult> = {}): ToolResult => ({ text, isError: true, code, ...extra });
const store = (ctx: ToolCtx): DrawStore | null => (ctx.data as unknown as { drawTest?: DrawStore }).drawTest ?? null;
function clean(v: unknown, max: number) { return String(v ?? "").replace(/[^\p{L}\p{N} ._()\-:/]/gu, "").trim().slice(0, max); }
const newNonce = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); return hex(b); };
const seedOf = (nonce: string) => parseInt(nonce.slice(0, 8), 16) >>> 0;

const BRIEF = "TEST CHARACTER: Pip, a small paper boat with one red sail and a round blue porthole, on flat pale water. Plain background, no text, no real person, no logo.";

const start: ToolDef = {
  name: "draw_test_start", title: "Start the draw-and-return test", scope: "write", readOnly: false,
  description: "A harmless test of whether this AI can send a picture back to Ryagram. Free; it cannot spend credits and changes no project. " +
    "mode \"echo\" gives you a small test picture to send back unchanged (tests the connection alone); mode \"draw\" asks you to make your own picture of a test character and send it. " +
    "Then call draw_test_submit with the nonce. Tell the person plainly what happened, including if you cannot do it.",
  inputSchema: obj({ mode: { type: "string", enum: ["echo", "draw"] }, tier: { type: "string", enum: ["S", "M", "L"], description: "echo only: S about 1 KB, M about 12 KB, L about 48 KB" } }, ["mode"]),
  async run(a, ctx) {
    const st = store(ctx);
    if (!st) return refuse("This test is not switched on here.", "not_enabled");
    if (!(await ctx.policy.hit(ctx.principal, "drawtest_start", DRAW_LIMITS.startsPerDay, 86400))) return refuse("The daily limit for this test is reached. Try tomorrow.", "rate");
    const mode = a.mode === "echo" ? "echo" : "draw";
    const nonce = newNonce();
    if (mode === "draw") {
      await st.issue({ nonce, mode, tier: null, payloadSha256: null, payloadBytes: 0, issuedAt: Date.now() });
      return ok(`Draw one picture, then call draw_test_submit with nonce ${nonce}.\n${BRIEF}\nSend it as image_base64 (a PNG or JPEG of at most ${DRAW_LIMITS.maxImageBytes / 1024} KB) or, if you cannot produce an image file, as svg_text (SVG source of at most ${DRAW_LIMITS.maxSvgBytes / 1024} KB). ` +
        `Say in how_made how you made it. If you cannot send a picture at all, call draw_test_submit with no picture and give the reason in note. Do not call this tool again to retry more than twice.`,
        { nonce, mode });
    }
    const tier = (a.tier === "M" || a.tier === "L") ? a.tier : "S" as Tier;
    const png = noisePng(ECHO_TIERS[tier], seedOf(nonce));
    await st.issue({ nonce, mode, tier, payloadSha256: await sha256(png), payloadBytes: png.length, issuedAt: Date.now() });
    return ok(`ECHO TEST ${tier}. Send this PNG back UNCHANGED: call draw_test_submit with nonce ${nonce} and image_base64 set to exactly the text below (${png.length} bytes). Do not describe, resize or redraw it.\n${toBase64(png)}`,
      { nonce, mode, tier, bytes: png.length });
  },
};

const submit: ToolDef = {
  name: "draw_test_submit", title: "Send the test picture back", scope: "write", readOnly: false,
  description: "Sends back the picture asked for by draw_test_start. Free. Ryagram checks it and says whether it arrived intact. Never put a password or key in any field.",
  inputSchema: obj({
    nonce: { type: "string", pattern: "^[0-9a-f]{24}$" },
    image_base64: { type: "string", maxLength: 262144, description: "A PNG or JPEG, base64, no data: prefix" },
    svg_text: { type: "string", maxLength: 110000 },
    how_made: { type: "string", enum: ["image_generator", "code", "svg_by_hand", "copied_from_tool", "other"] },
    host_name: { type: "string", maxLength: 40, description: "Which assistant you are, e.g. ChatGPT" },
    model_name: { type: "string", maxLength: 60 },
    note: { type: "string", maxLength: 300, description: "If you could not send a picture, why" },
  }, ["nonce"]),
  async run(a, ctx) {
    const st = store(ctx);
    if (!st) return refuse("This test is not switched on here.", "not_enabled");
    if (!(await ctx.policy.hit(ctx.principal, "drawtest_submit", DRAW_LIMITS.submitsPerDay, 86400))) return refuse("The daily limit for this test is reached. Try tomorrow.", "rate");
    const issue = await st.take(String(a.nonce));
    if (!issue) return refuse("That test code is not one of yours, was already used, or has expired. Call draw_test_start again.", "bad_nonce");
    if (Date.now() - issue.issuedAt > DRAW_LIMITS.nonceMinutes * 60000) return refuse("That test code has expired. Call draw_test_start again.", "bad_nonce");

    const base: Omit<DrawResult, "kind" | "bytes" | "width" | "height" | "sha256" | "outcome" | "reason" | "exactMatch" | "firstDiffByte"> = {
      nonce: issue.nonce, mode: issue.mode, tier: issue.tier, at: Date.now(), clientId: ctx.principal.clientId ?? null,
      claimedHost: clean(a.host_name, 40), claimedModel: clean(a.model_name, 60), howMade: clean(a.how_made, 20) || "other",
    };
    const done = async (r: Partial<DrawResult> & { outcome: "pass" | "fail"; reason: string }): Promise<ToolResult> => {
      const full: DrawResult = { ...base, kind: "none", bytes: 0, width: null, height: null, sha256: "", exactMatch: null, firstDiffByte: null, ...r };
      await st.save(full);
      const text = (full.outcome === "pass" ? "PASS. " : "FAIL. ") + full.reason;
      return ok(text, { outcome: full.outcome, kind: full.kind, bytes: full.bytes, width: full.width, height: full.height, exact_match: full.exactMatch, first_diff_byte: full.firstDiffByte },
        full.outcome === "pass" ? {} : { isError: false, code: "test_fail" });       // a failed TEST is an answer, not an error
    };

    const hasImg = typeof a.image_base64 === "string" && a.image_base64.length > 0;
    const hasSvg = typeof a.svg_text === "string" && a.svg_text.length > 0;
    if (!hasImg && !hasSvg) return done({ outcome: "fail", reason: `No picture was sent${a.note ? ` (the AI said: ${clean(a.note, 200)})` : ""}. This host cannot hand a picture back by this route.` });
    if (hasImg && hasSvg) return done({ outcome: "fail", reason: "Both a picture and SVG text were sent; send one." });

    if (hasSvg) {
      const text = String(a.svg_text);
      const bytes = new TextEncoder().encode(text);
      const problem = issue.mode === "echo" ? "SVG text cannot answer an echo test (it asks for the exact PNG)." : checkSvg(text);
      const r = { kind: "svg" as const, bytes: bytes.length, sha256: await sha256(bytes) };
      return problem ? done({ ...r, outcome: "fail", reason: `Refused: ${problem}.` })
        : done({ ...r, outcome: "pass", reason: `Received ${bytes.length} bytes of SVG and it passed the safety rules. (Vector art by the AI itself, not a generated photograph.)`, image: bytes });
    }

    const bytes = fromBase64(String(a.image_base64));
    if (!bytes) return done({ outcome: "fail", reason: "The text sent is not valid base64 (the AI probably cut it short, added words, or changed characters). Ryagram received nothing usable." });
    const r0 = { bytes: bytes.length, sha256: await sha256(bytes) };
    if (bytes.length > DRAW_LIMITS.maxImageBytes) return done({ ...r0, outcome: "fail", reason: `The picture is ${bytes.length} bytes; the limit is ${DRAW_LIMITS.maxImageBytes}.` });
    const sn = sniffImage(bytes);
    const r = { ...r0, kind: sn.kind, width: sn.width, height: sn.height };

    if (issue.mode === "echo") {
      const exact = r0.sha256 === issue.payloadSha256;
      let diff: number | null = null;
      if (!exact) { const ref = noisePng(ECHO_TIERS[issue.tier as Tier], seedOf(issue.nonce)); const n = Math.min(ref.length, bytes.length); diff = n; for (let i = 0; i < n; i++) if (ref[i] !== bytes[i]) { diff = i; break; } }
      return exact ? done({ ...r, outcome: "pass", exactMatch: true, image: bytes, reason: `Tier ${issue.tier}: all ${bytes.length} bytes came back identical. This host can carry a picture of this size through a tool.` })
        : done({ ...r, outcome: "fail", exactMatch: false, firstDiffByte: diff, reason: `Tier ${issue.tier}: the picture came back changed. Sent ${issue.payloadBytes} bytes, received ${bytes.length}; first difference at byte ${diff}. This host cannot copy a picture of this size faithfully.` });
    }
    if (sn.kind === "none" || sn.problem) return done({ ...r, outcome: "fail", reason: `Refused: ${sn.problem}.` });
    return done({ ...r, outcome: "pass", reason: `Received a real ${sn.kind.toUpperCase()}, ${sn.width} x ${sn.height}, ${bytes.length} bytes, SHA-256 ${r0.sha256.slice(0, 16)}. Claimed: ${base.claimedHost || "(none)"} / ${base.claimedModel || "(none)"}, made by ${base.howMade}.`, image: bytes });
  },
};

export const DRAW_TEST_TOOLS: ToolDef[] = [start, submit];

/** Adds the two tools to the live registry. Idempotent. Called only when the operator sets CONNECT_DRAW_TEST=1. */
export function enableDrawTest(): void {
  for (const t of DRAW_TEST_TOOLS) if (!TOOL_BY_NAME.has(t.name)) { TOOLS.push(t); TOOL_BY_NAME.set(t.name, t); }
}
