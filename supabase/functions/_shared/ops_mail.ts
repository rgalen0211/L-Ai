// The ops mail sender, shared by ops-tick and ops-digest. Pluggable on purpose: until Ryan sets up email, every message
// goes to the ops_outbox table in DRY-RUN mode and nothing leaves the project.
//
//   OPS_MAIL_MODE  unset or "dry_run"  -> write to ops_outbox only (the default; safe)
//                  "resend"            -> also hand to Resend (needs RESEND_API_KEY and OPS_MAIL_FROM)
// Ryan's click steps for "resend" are in proposals/WEB-OPS-READINESS.md section 5. Secrets live in Supabase Edge Functions
// Secrets, never in this repository and never in chat.

export const OPS_TO = "ryagram@uselai.com";

export interface Message { kind: "alert" | "digest" | "ack"; to: string; subject: string; body: string }
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

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
