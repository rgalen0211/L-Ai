// The ops mail sender, shared by ops-tick and ops-digest. Pluggable on purpose: until Ryan sets up email, every message
// goes to the ops_outbox table in DRY-RUN mode and nothing leaves the project.
//
//   OPS_MAIL_MODE  unset or "dry_run"  -> write to ops_outbox only (the default; safe)
//                  "resend"            -> also hand to Resend (needs RESEND_API_KEY and OPS_MAIL_FROM)
// Ryan's click steps for "resend" are in proposals/WEB-OPS-READINESS.md section 5. Secrets live in Supabase Edge Functions
// Secrets, never in this repository and never in chat.

export const OPS_TO = "ryagram@uselai.com";

export interface Message { kind: "alert" | "digest" | "ack" | "urgent" | "invite"; to: string; subject: string; body: string }
export interface Outbox { add(kind: Message["kind"], mode: "dry_run" | "live", to: string, subject: string, body: string): Promise<boolean> }
export interface Sender { mode: "dry_run" | "live"; send(m: Message): Promise<void> }

export function dryRunSender(outbox: Outbox): Sender {
  return { mode: "dry_run", async send(m) { await outbox.add(m.kind, "dry_run", m.to, m.subject, m.body); } };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

// Sends first, then records, so a failed send is retried by the next scheduled run and a message is never recorded as
// sent when it was not.
export function resendSender(outbox: Outbox, apiKey: string, from: string, fetchFn: Fetch): Sender {
  return {
    mode: "live",
    async send(m) {
      const res = await fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.body }),
      });
      if (!res.ok) throw new Error(`The mail service refused the message (${res.status}).`);
      await outbox.add(m.kind, "live", m.to, m.subject, m.body);
    },
  };
}

export function chooseSender(env: (k: string) => string | undefined, outbox: Outbox, fetchFn: Fetch): Sender {
  if (env("OPS_MAIL_MODE") === "resend" && env("RESEND_API_KEY") && env("OPS_MAIL_FROM")) {
    return resendSender(outbox, env("RESEND_API_KEY")!, env("OPS_MAIL_FROM")!, fetchFn);
  }
  return dryRunSender(outbox);          // anything incomplete falls back to dry-run, never to a half-configured live send
}

// Only the scheduler (or Ryan with the service key) may call the ops functions.
export function isService(req: Request, serviceKey: string): boolean {
  return serviceKey.length > 0 && (req.headers.get("authorization") ?? "") === `Bearer ${serviceKey}`;
}

// PER-JOB SECRET (Q91 follow-up, 2026-10-25). pg_net keeps each scheduled call, headers included, in net.http_request_queue, and on the live
// project every database login can read that table (PUBLIC holds the grants; the owner supabase_admin cannot be changed from here). So the
// scheduler must not carry the service-role key. Each cron job carries its OWN secret instead (a random value of 32 or more characters, kept
// in Vault for the job and in this function's own secret), which lets the caller run THIS one job and nothing else.
//   "job"     = the per-job secret: the scheduler. It is answered with ok / failed only (see reply), because net._http_response keeps the
//               reply body where the same logins can read it.
//   "service" = the service-role key: Ryan running it by hand. Full detail, as before.
// A secret shorter than 32 characters is treated as not set, so an empty or weak value can never let anyone in.
export const JOB_SECRET_MIN = 32;
export type Caller = "job" | "service" | null;

function sameText(a: string, b: string): boolean {              // no early exit on the first differing character
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function whoCalls(req: Request, serviceKey: string, jobSecret?: string): Caller {
  const got = req.headers.get("authorization") ?? "";
  if (jobSecret && jobSecret.length >= JOB_SECRET_MIN && sameText(got, `Bearer ${jobSecret}`)) return "job";
  if (isService(req, serviceKey)) return "service";
  return null;
}

/** The scheduler's reply is "ok" or "failed" and nothing else; Ryan's own call gets the full body. */
export function reply(caller: Caller, status: number, body: unknown): Response {
  return caller === "job" ? json(status, { ok: status >= 200 && status < 300 }) : json(status, body);
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
