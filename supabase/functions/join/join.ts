// "Create an account" with no invite code (Option B, Ryan 2026-11-04; path A of RYAN-QUEUE Q378). A visitor sends {email}; if they may join now, Supabase Auth sends the invite email and
// the account exists once they follow its link and choose a password. The account starts on the WAITING list (the database trigger), so the link opens nothing but the waiting page.
// Tested in tests/waiting-gate.test.mjs; index.ts wires Supabase.
//
// The answer is the SAME whether or not the address already has an account (no way to test which emails are signed up): email_exists answers 200 as if sent.
// 11-23 (CC1's audit, GAMES agreeing): when Supabase Auth cannot send the email just now (SMTP down, or its hourly allowance run out on launch morning) the person is TOLD so, 503 with plain words,
// and the try they spent is given back (release), so honest retries are not locked out for the day. This leaks only that a send was attempted for an address with no account, which redeem-invite already accepts.

export interface Deps {
  allowedOrigins: string[];
  siteUrl: string;
  reserve(email: string, ipHash: string): Promise<{ ok: boolean; reason?: string }>;
  // Supabase Auth's admin invite. Throws with .code "email_exists" when the address already has an account. `data` becomes the new account's user metadata (the 18+ confirmation, which a database
  // trigger copies into public.account_adult_confirmation the moment the account is made).
  invite(email: string, redirectTo: string, data: { adult_confirmed: true }): Promise<void>;
  // Gives back the try that reserve counted, after a failed send. Best effort: a failure here is logged and never changes the answer.
  release?(email: string, ipHash: string): Promise<void>;
}

export const ADULT_WORDS = "Confirm that you are 18 or older to make an account.";
// What a person reads when sign-up is not open (the server flag join_open is OFF, or the brake is on). There is no waitlist to point to any more (11-22: the page that ships with open sign-up has none),
// so the words only say to try again later. The page shows this sentence as it comes (assets/app-auth.js, a 409 is "not open yet").
export const NOT_OPEN_WORDS = "Making an account is not open yet. Please try again later.";

// What a person reads when the email could not be sent just now (not a refusal: nothing is wrong with their address). No waitlist, no invite, no person to write to.
export const SEND_FAILED_WORDS = "We couldn\u2019t send the email just now. Please try again in a few minutes.";

// What a person reads when the day's size is reached (ops_settings.join_daily_max, default 200 in any 24 hours: join_reserve answers 'full'). Not their fault and not a refusal of them: nothing about tries, no one to write to.
// 429, not 409: the page turns EVERY 409 into "not open yet" (assets/app-data.js joinWaiting), and passes any other answer's own sentence through as it comes.
export const FULL_WORDS = "Sign-up is full for now. Please try again later.";

// An address that Auth itself refuses (a shape the reserve check lets through, such as a@b..cc): the person is told to check it, and the try is NOT given back (a refusal is not a send failure: it must stay counted).
export const BAD_ADDRESS_WORDS = "Enter a valid email address.";

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

  let body: { email?: unknown; adult_confirmed?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
  if (!email) return reply(400, { error: "Enter your email address." });
  // Ryan 11-21: Age 18+. The page's box is sent as adult_confirmed: true; only the boolean true counts (not "true", 1 or a missing field). Asked BEFORE the limits are used and before any email is sent, and it says nothing about which addresses have accounts.
  if (body.adult_confirmed !== true) return reply(400, { error: ADULT_WORDS });

  // The caller's address, hashed: only used to slow down abuse, kept two days. NEVER a value the client can write: the platform's own cf-connecting-ip, else the LAST hop of
  // X-Forwarded-For (the one the platform's proxy appended). The same rule as redeem-invite, creator-beta and node.
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim() || hops[hops.length - 1] || "unknown";
  let r;
  const ipHash = await sha256Hex(`ryagram-join:${ip}`);
  try { r = await deps.reserve(email, ipHash); }
  catch (e) { console.error(`join reserve: ${(e as Error).message}`); return reply(500, { error: "Something went wrong. Try again in a minute." }); }
  if (!r.ok) {
    if (r.reason === "throttled") return reply(429, { error: "Too many tries. Wait a while, then try again." });
    if (r.reason === "email") return reply(400, { error: "Enter a valid email address." });
    if (r.reason === "off") return reply(409, { error: NOT_OPEN_WORDS });
    if (r.reason === "full") return reply(429, { error: FULL_WORDS });
    return reply(500, { error: "Something went wrong. Try again in a minute." });
  }
  try {
    await deps.invite(email, `${deps.siteUrl}/app/`, { adult_confirmed: true });
    return reply(200, { message: SENT });
  } catch (e) {
    if ((e as { code?: string }).code === "email_exists") return reply(200, { message: SENT });                    // the same answer as a sent mail (no probing of which addresses have accounts)
    console.error(`join invite: ${(e as Error).message}`);                                                         // logged
    const code = (e as { code?: string }).code;
    if (code === "validation_failed" || code === "email_address_invalid") return reply(400, { error: BAD_ADDRESS_WORDS });   // not a send failure: nothing is given back
    try { await deps.release?.(email, ipHash); } catch (re) { console.error(`join release: ${(re as Error).message}`); }   // the try is given back; if that fails the answer is the same
    return reply(503, { error: SEND_FAILED_WORDS });                                                               // the person is told it did not go
  }
}
