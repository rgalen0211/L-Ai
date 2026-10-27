// get_delivery_url (JOB-CONTRACT-v1 3b, PIPE-1): a person's own delivered film as a 1-hour signed link, for the
// /app/#/delivery/<id> page. Tested in tests/get-delivery-url.test.mjs.
//
// SQL cannot sign a storage URL, so the contract's get_delivery_url is this function: the database decides WHAT may be
// handed out (delivery_object_for: the owner only, not expired, not deleted -- the rule lives there, not here), and this
// function only signs it. An app session only: a connected AI's OAuth token (it carries client_id) is refused; CONNECT
// reaches deliveries through its own connect_* function.

export interface Deps {
  allowedOrigins: string[];
  verifyUser(jwt: string): Promise<{ id: string; clientId: string | null } | null>;
  objectFor(owner: string, delivery: string): Promise<string>;        // the storage path, or throws with the database's message
  /** A film made on the person's OWN computer that they chose to keep a private link to (NEXT-CONNECT 120). Tried ONLY when objectFor finds no such delivery; absent = the feature is off here. Same rules: owner, not expired, not deleted. */
  compilationFor?(owner: string, delivery: string): Promise<string>;
  sign(path: string, seconds: number): Promise<string>;
}

export const SIGNED_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.verifyUser(jwt).catch(() => null) : null;
  if (!user) return reply(401, { error: "Sign in first." });
  if (user.clientId) return reply(403, { error: "A connected AI gets film links through its own tools." });

  let body: { delivery_id?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const id = typeof body.delivery_id === "string" ? body.delivery_id.trim().toLowerCase() : "";
  if (!UUID.test(id)) return reply(400, { error: "Bad request." });

  let path: string;
  let label = "AI-assisted";
  try {
    path = await deps.objectFor(user.id, id);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (/kept for its (30 )?days|no longer stored/.test(msg)) return reply(410, { error: msg });
    if (!deps.compilationFor) return reply(404, { error: "Film not found." });                    // not yours, or no such delivery: the same answer
    try {
      path = await deps.compilationFor(user.id, id);                     // a film made on the person's own computer: the same owner, expiry and deletion rules, another label
      label = "Made on your computer";
    } catch (err2) {
      if (/kept for its (30 )?days|no longer stored/.test((err2 as Error).message ?? "")) return reply(410, { error: (err2 as Error).message });
      return reply(404, { error: "Film not found." });
    }
  }
  if (!path.startsWith(`${user.id}/`)) return reply(404, { error: "Film not found." });   // belt and braces: the owner's own folder
  try {
    const url = await deps.sign(path, SIGNED_SECONDS);
    return reply(200, { url, expires_in: SIGNED_SECONDS, label });
  } catch (err) {
    console.error(`get-delivery-url sign: ${(err as Error).message}`);
    return reply(500, { error: "The link couldn't be made just now. Try again in a minute." });
  }
}

// The claims of a JWT that Supabase has ALREADY verified (auth.getUser) -- read only to learn client_id; never trusted alone.
export function claimsOf(jwt: string): Record<string, unknown> {
  try {
    const part = jwt.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(b64));
  } catch {
    return {};
  }
}
