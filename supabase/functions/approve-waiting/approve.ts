// Ryan approves a WAITING account (Option B, Ryan 2026-11-04): the account becomes active with the normal welcome credits, once, and the person is emailed that their access is open.
// Admin only: the caller's own login is checked (an AI's token is refused, a WAITING person is refused) and the DATABASE decides everything else (admin_approve_waiting checks is_app_admin,
// writes the audit row, flips once, pays once). The email goes through the ops mail sender (OPS_MAIL_MODE): until live mail is switched on it is only SAVED and the answer says so.
// Tested in tests/waiting-gate.test.mjs. THE EMAIL'S WORDS BELOW ARE A DRAFT FOR RYAN TO APPROVE (CONNECT, 2026-11-04); nothing is sent until he does and the function is deployed.

export interface Approved { flipped: boolean; email: string; credits: number }
export interface Deps {
  allowedOrigins: string[];
  siteUrl: string;
  verifyUser(jwt: string): Promise<{ id: string; email: string } | null>;
  approve(jwt: string, userId: string, reason: string): Promise<Approved>;           // runs as the caller (the database checks is_app_admin)
  send(m: { kind: "invite"; to: string; subject: string; body: string }): Promise<{ mode: "dry_run" | "live" }>;
}

export function compose(a: Approved, siteUrl: string): { subject: string; body: string } {
  const site = siteUrl.replace(/\/$/, "");
  const body = [
    "You're in. Your Ryagram access is open.", "",
    `Sign in with the email and password you chose: ${site}/app/`,
    ...(a.credits > 0 ? ["", `${a.credits} welcome credit${a.credits === 1 ? " is" : "s are"} waiting for you.`] : []), "",
    "Beta credits are free, in exchange for your feedback. If you talk about or promote Ryagram, or a film you made with it, please say your credits were free.", "",
    "The Ryagram Team",
  ].join("\n");
  return { subject: "Your Ryagram access is open", body };
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

  let body: { user_id?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return reply(400, { error: "Choose a person from the waiting list." });
  if (reason.length < 3 || reason.length > 300) return reply(400, { error: "Say why, in a few words." });

  let done: Approved;
  try { done = await deps.approve(jwt, userId, reason); }
  catch (err) {
    const msg = (err as Error).message ?? "";
    if (/Only an admin/i.test(msg)) return reply(403, { error: "Only an admin can approve." });
    if (/No such account/i.test(msg)) return reply(404, { error: "No such account." });
    return reply(409, { error: msg.replace(/[\u0000-\u001f<>]/g, " ").slice(0, 200) || "That account cannot be approved." });
  }
  if (!done.flipped) return reply(200, { status: "already_open", message: "That account was already open. Nothing was changed and no email was sent." });
  // The account is open and its credits are paid whether or not the email goes: a failed email must never undo an approval (the page says so and Ryan can write to them).
  const { subject, body: text } = compose(done, deps.siteUrl);
  try {
    const { mode } = await deps.send({ kind: "invite", to: done.email, subject, body: text });
    return reply(200, { status: mode === "live" ? "sent" : "saved", to: done.email,
      message: mode === "live" ? `Approved. ${done.email} was emailed.` : "Approved. Mail is not switched on, so nothing was sent; the message is saved under Recent messages." });
  } catch (err) {
    console.error(`approve-waiting send: ${(err as Error).message}`);
    return reply(200, { status: "approved_not_emailed", to: done.email, message: "Approved, but the mail service did not accept the message. Write to them yourself." });
  }
}
