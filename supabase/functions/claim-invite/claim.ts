// A signed-in person on the WAITING list enters an invite code (NEXT-CONNECT, Option B, Ryan 2026-11-04). A good code makes their account active and pays the code's own
// welcome credits, once. Everything that matters is decided in the database (public.invite_claim: the same throttle and tables as redeem-invite); this file checks WHO is asking.
// A WAITING person is allowed here on purpose (it is how they leave the list), so index.ts verifies with verifyAppUser, not verifyActiveUser. Tested in tests/waiting-gate.test.mjs.

export interface Deps {
  allowedOrigins: string[];
  verifyUser(jwt: string): Promise<{ id: string; email: string } | null>;
  claim(userId: string, code: string, ipHash: string): Promise<{ ok: boolean; reason?: string; activated?: boolean; already?: boolean }>;
}

export const OPENED = "Your code worked. Your access is open.";
export const ALREADY = "Your access is already open.";

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.verifyUser(jwt).catch(() => null) : null;
  if (!user) return reply(401, { error: "Sign in first." });

  let body: { code?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const code = typeof body.code === "string" ? body.code.slice(0, 40) : "";
  if (!code) return reply(400, { error: "Enter your invite code." });

  // The caller's address, hashed, only to slow down guessing: the platform's own cf-connecting-ip, else the LAST hop of X-Forwarded-For (never a value the client wrote).
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim() || hops[hops.length - 1] || "unknown";
  let r;
  try { r = await deps.claim(user.id, code, await sha256Hex(`ryagram-invite:${ip}`)); }
  catch (e) { console.error(`claim-invite: ${(e as Error).message}`); return reply(500, { error: "Something went wrong. Try again in a minute." }); }
  if (!r.ok) {
    if (r.reason === "throttled") return reply(429, { error: "Too many tries. Wait an hour, then try again." });
    return reply(400, { error: "That code isn’t valid, has expired or has been used up." });
  }
  return reply(200, { message: r.already ? ALREADY : OPENED, status: "active" });
}
