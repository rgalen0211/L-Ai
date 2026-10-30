// Send an invite email from Ryagram (NEXT-WEB 155). Admin only: the caller's own login is checked (an AI's token is refused), and the database decides everything else
// (admin_invite_send_begin: the address is bound to the code on the first send, 60 seconds between sends, 3 at most). The message goes through the ops mail sender
// (OPS_MAIL_MODE), is recorded in ops_outbox (kind 'invite') and says plainly whether it was SENT or only SAVED (dry-run: nothing leaves the project).
// Tested in tests/send-invite.test.mjs. The email's words are RYAN'S and are APPROVED (Ryan 2026-10-28 10:59: 'sign it "The Ryagram Team"; keep 20 beta credits as the default;
// otherwise the draft words are OK'); proposals\WEB-INVITE-EMAIL.md holds them. No reply-to was asked for: none is added.

export interface Begun { to: string; name: string; credits: number; expires_at: string; sends: number }
export interface Deps {
  allowedOrigins: string[];
  siteUrl: string;
  verifyUser(jwt: string): Promise<{ id: string; email: string } | null>;
  begin(jwt: string, code: string, email: string): Promise<Begun>;          // runs as the caller (the database checks is_app_admin)
  undo(jwt: string, code: string): Promise<void>;
  send(m: { kind: "invite"; to: string; subject: string; body: string }): Promise<{ mode: "dry_run" | "live" }>;
  now?: () => Date;
  /** The app link in the email (NEXT-CONNECT 162). Absent or enabled() false = the email is exactly what it always was and the body flag is ignored. OFF until Ryan's switch INVITE_APP_LINK=1 and his approval of the added words. */
  appLink?: { enabled(): boolean; make(jwt: string, code: string): Promise<{ token: string; expires_at: string }> };
}

/** The page on uselai.com that turns the token into the download. The token is in the FRAGMENT (after #), which a browser never sends to any server or log. */
export function appLinkUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/get-app/#t=${encodeURIComponent(token)}`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// The sign-up link carries the code and the address in the URL FRAGMENT (after #), which a browser never sends to any server or log; the page reads it, fills the
// form and removes it from the address bar.
export function joinLink(siteUrl: string, code: string, email: string): string {
  return `${siteUrl.replace(/\/$/, "")}/app/#/join?code=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;
}

export function compose(b: Begun, code: string, siteUrl: string, app?: { url: string; expires_at: string }): { subject: string; body: string } {
  const first = b.name.split(" ")[0] || "there";
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const expires = new Date(b.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const body = [
    `Hi ${first},`, "",
    `You're in. Your invite code is ${code}.`, "",
    "To sign up, open this link. It fills in your email and your code:", joinLink(siteUrl, code, b.to), "",
    `Or go to ${siteUrl.replace(/\/$/, "")}/app/, choose "Have an invite code?", and enter the code with this email address. You will get an email to set your password`
      + (b.credits > 0 ? `, and ${plural(b.credits, "beta credit")} will be waiting for you.` : "."), "",
    ...(app ? [
      "To get the Ryagram app for Windows, open this link on your Windows computer. It is just for you, it works once, and it expires on " + day(app.expires_at) + ":", app.url, "",
      "If it stops working, sign in at " + siteUrl.replace(/\/$/, "") + "/app/ and use the Download card there.", ""] : []),
    "Beta credits are free, in exchange for your feedback. If you talk about or promote Ryagram, or a film you made with it, please say your credits were free.", "",
    `The code works once and expires on ${expires}.`, "",
    "The Ryagram Team",
  ].join("\n");
  return { subject: "Your Ryagram invite", body };
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

  let body: { code?: unknown; email?: unknown; include_app_link?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[A-Za-z0-9 -]{8,24}$/.test(code) || !email || email.length > 320) return reply(400, { error: "Give the invite code and the person's email address." });

  let begun: Begun;
  try { begun = await deps.begin(jwt, code, email); }
  catch (err) {
    const msg = (err as Error).message ?? "";
    if (/Only an admin/i.test(msg)) return reply(403, { error: "Only an admin can send invites." });
    return reply(409, { error: msg.replace(/[\u0000-\u001f<>]/g, " ").slice(0, 200) || "That invite cannot be sent." });
  }
  // The app link: only when the admin asked for it for THIS invite AND the switch is on. If making it fails the invite still goes, without the link, and the answer says so.
  let app: { url: string; expires_at: string } | undefined;
  let appLink: "not_asked" | "off" | "included" | "failed" = "not_asked";
  if (body.include_app_link === true) {
    if (!deps.appLink?.enabled()) appLink = "off";
    else {
      try { const made = await deps.appLink.make(jwt, code); app = { url: appLinkUrl(deps.siteUrl, made.token), expires_at: made.expires_at }; appLink = "included"; }
      catch { console.error("send-invite app link failed"); appLink = "failed"; }
    }
  }
  const { subject, body: text } = compose(begun, code, deps.siteUrl, app);
  try {
    const { mode } = await deps.send({ kind: "invite", to: begun.to, subject, body: text });
    const note = appLink === "off" ? " The app link is not switched on, so the email has no app link."
      : appLink === "failed" ? " The app link could not be made, so the email has no app link; sign-up works as usual."
      : appLink === "included" ? " It includes a one-time app download link." : "";
    return reply(200, { status: mode === "live" ? "sent" : "saved", to: begun.to, sends: begun.sends, at: (deps.now ?? (() => new Date()))().toISOString(), app_link: appLink,
      message: (mode === "live" ? `Sent to ${begun.to}.` : "Mail is not switched on, so nothing was sent. The message is saved under Recent messages.") + note });
  } catch (err) {
    console.error(`send-invite send: ${(err as Error).message}`);
    await deps.undo(jwt, code).catch(() => {});                                // a failed send does not use up one of the three
    return reply(502, { error: "The mail service did not accept the message. Nothing was sent; try again in a minute, or copy the code." });
  }
}
