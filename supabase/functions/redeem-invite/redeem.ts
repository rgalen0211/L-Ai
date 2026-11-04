// Beta sign-up by invite code. A visitor sends {code, email}; a good code makes Supabase Auth send
// an invite email, and the account exists only once they follow its link and choose a password.
// Tested in tests/redeem-invite.test.mjs; index.ts wires Supabase.
//
// The answer is the same whether or not the address already has an account (no way to test which
// emails are signed up), and a code that was reserved but not used goes back (invite_release).

export interface Deps {
  allowedOrigins: string[];
  siteUrl: string;
  reserve(code: string, email: string, ipHash: string): Promise<{ ok: boolean; reason?: string; redemption?: number }>;
  sent(redemption: number, userId: string | null): Promise<void>;
  release(redemption: number): Promise<void>;
  // Supabase Auth's admin invite. Throws with .code "email_exists" when the address has an account.
  invite(email: string, redirectTo: string): Promise<{ userId: string | null }>;
  /** Which header names the caller, for the guess limit (docs/REDEEM-INVITE-HEADER-CHECK.md). Unset or unknown = the default rule. Set only if the header check
   *  on the real project says so, as the function secret REDEEM_CALLER_HEADER. */
  callerHeader?: string;
}

/** The caller's address for the guess limit, by mode. NEVER a value the client can write; which header that is depends on the platform, so it is checked once on the
 *  real project (docs/REDEEM-INVITE-HEADER-CHECK.md):
 *    default (unset):   cf-connecting-ip, else the LAST X-Forwarded-For hop (the one the platform's proxy appended)
 *    cf-connecting-ip:  only cf-connecting-ip (if the gateway does not append to X-Forwarded-For)
 *    x-real-ip:         only x-real-ip (if the gateway sets it and neither of the others can be trusted)
 *    xff-last:          only the LAST X-Forwarded-For hop (if a client-sent cf-connecting-ip reaches the function unchanged)
 *  An unknown mode is the default. No usable value gives "unknown" (every such caller shares one count, and the site-wide cap still applies). */
export const CALLER_MODES = ["cf-connecting-ip", "x-real-ip", "xff-last"] as const;
export function callerIp(headers: Headers, mode?: string): string {
  const one = (name: string) => (headers.get(name) ?? "").split(",")[0].trim();
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const last = hops[hops.length - 1] ?? "";
  const m = String(mode ?? "").trim().toLowerCase();
  const ip = m === "cf-connecting-ip" ? one("cf-connecting-ip") : m === "x-real-ip" ? one("x-real-ip") : m === "xff-last" ? last : (one("cf-connecting-ip") || last);
  return ip || "unknown";
}

export const SENT = "If that email can join, a link to finish joining is on its way. It works once. " +
  "Already have an account? Sign in instead.";

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

  let body: { code?: unknown; email?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const code = typeof body.code === "string" ? body.code.slice(0, 40) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
  if (!code || !email) return reply(400, { error: "Enter your invite code and your email." });

  // The caller's address, hashed: only used to slow down guessing, kept a day. NEVER a value the client can write: the platform's own cf-connecting-ip, else the LAST hop
  // of X-Forwarded-For (the one the platform's proxy appended); the first entries are whatever the client sent (CLOUD-SITE 11-02; the same rule as creator-beta and node).
  const ip = callerIp(req.headers, deps.callerHeader);
  let r;
  try { r = await deps.reserve(code, email, await sha256Hex(`ryagram-invite:${ip}`)); }
  catch (e) { console.error(`redeem-invite reserve: ${(e as Error).message}`); return reply(500, { error: "Something went wrong. Try again in a minute." }); }
  if (!r.ok) {
    if (r.reason === "throttled") return reply(429, { error: "Too many tries. Wait an hour, then try again." });
    if (r.reason === "email") return reply(400, { error: "Enter a valid email address." });
    return reply(400, { error: "That code isn’t valid, has expired or has been used up." });
  }

  const redemption = r.redemption!;
  try {
    const { userId } = await deps.invite(email, `${deps.siteUrl}/app/`);
    await deps.sent(redemption, userId);
    return reply(200, { message: SENT });
  } catch (e) {
    await deps.release(redemption).catch(() => {});
    if ((e as { code?: string }).code === "email_exists") return reply(200, { message: SENT });   // same answer
    console.error(`redeem-invite invite: ${(e as Error).message}`);
    return reply(503, { error: "We couldn’t send the email just now. Your code still works; try again later." });
  }
}
