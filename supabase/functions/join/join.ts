// "Create an account" with no invite code (Option B, Ryan 2026-11-04; path A of RYAN-QUEUE Q378). A visitor sends {email}; if they may join now, Supabase Auth sends the invite email and
// the account exists once they follow its link and choose a password. The account starts on the WAITING list (the database trigger), so the link opens nothing but the waiting page.
// Tested in tests/waiting-gate.test.mjs; index.ts wires Supabase.
//
// The answer is the SAME whether or not the address already has an account (no way to test which emails are signed up), and also when Supabase Auth cannot send the email just now
// (its own hourly allowance can run out): an error that only unknown addresses would hit must not tell a stranger which addresses are signed up. The failure is logged, not shown.

export interface Deps {
  allowedOrigins: string[];
  siteUrl: string;
  reserve(email: string, ipHash: string): Promise<{ ok: boolean; reason?: string }>;
  // Supabase Auth's admin invite. Throws with .code "email_exists" when the address already has an account.
  invite(email: string, redirectTo: string): Promise<void>;
}

export const SENT = "If that email can join, a link to finish making your account is on its way. It works once. If it has not come in a few minutes, try again later. Already have an account? Sign in instead.";

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

  let body: { email?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
  if (!email) return reply(400, { error: "Enter your email address." });

  // The caller's address, hashed: only used to slow down abuse, kept two days. NEVER a value the client can write: the platform's own cf-connecting-ip, else the LAST hop of
  // X-Forwarded-For (the one the platform's proxy appended). The same rule as redeem-invite, creator-beta and node.
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim() || hops[hops.length - 1] || "unknown";
  let r;
  try { r = await deps.reserve(email, await sha256Hex(`ryagram-join:${ip}`)); }
  catch (e) { console.error(`join reserve: ${(e as Error).message}`); return reply(500, { error: "Something went wrong. Try again in a minute." }); }
  if (!r.ok) {
    if (r.reason === "throttled") return reply(429, { error: "Too many tries. Wait a while, then try again." });
    if (r.reason === "email") return reply(400, { error: "Enter a valid email address." });
    if (r.reason === "off") return reply(409, { error: "Making an account is not open yet. Join the waitlist instead." });
    return reply(500, { error: "Something went wrong. Try again in a minute." });
  }
  try {
    await deps.invite(email, `${deps.siteUrl}/app/`);
    return reply(200, { message: SENT });
  } catch (e) {
    if ((e as { code?: string }).code !== "email_exists") console.error(`join invite: ${(e as Error).message}`);       // logged, never shown
    return reply(200, { message: SENT });                                                                          // the same answer in every case
  }
}
