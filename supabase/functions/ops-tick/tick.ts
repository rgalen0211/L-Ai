// ops-tick: every 5 minutes. Runs the database's health pass (ops_tick: reap lost leases, expire stale queue, raise alerts) and
// emails every NEW alert exactly once. A failed send leaves the alert un-notified, so the next tick tries again.
import { isService, json, OPS_TO, type Sender } from "../_shared/ops_mail.ts";

export interface Deps {
  serviceKey: string;
  tick(): Promise<{ rendering: string; reaped: number; expired: number; alert_mail_budget: number; new_alerts: { key: string; detail: string; urgent?: boolean }[] }>;
  markNotified(keys: string[]): Promise<number>;
  sender: Sender;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  if (!isService(req, deps.serviceKey)) return json(403, { error: "Not allowed." });
  let r;
  try { r = await deps.tick(); } catch (e) { console.error("ops_tick failed", (e as Error).message); return json(500, { error: "tick failed" }); }
  let notified = 0;
  let held = 0;
  let urgentSent = 0;
  const urgent = r.new_alerts.filter((a) => a.urgent);
  const normal = r.new_alerts.filter((a) => !a.urgent);
  // URGENT alerts (a child-safety report) are sent AT ONCE and never wait for, or count against, the daily alert-mail allowance.
  if (urgent.length) {
    try {
      await deps.sender.send({ kind: "alert", to: OPS_TO,
        subject: urgent.length === 1 ? `URGENT: ${urgent[0].detail.replace(/^URGENT:\s*/, "")}`.slice(0, 120) : `URGENT: ${urgent.length} child-safety reports`,
        body: urgent.map((a) => `- ${a.detail}`).join("\n") + "\n\nReview now: #/admin/ops in the app (Abuse reports). Open reports stay listed in the daily email until you decide." });
      notified += await deps.markNotified(urgent.map((a) => a.key));
      urgentSent = urgent.length;
    } catch (e) {
      console.error("urgent alert not sent; will retry next tick", (e as Error).message);
    }
  }
  if (normal.length && r.alert_mail_budget <= 0) {
    // Today's alert-mail allowance is used up (a flood must not exhaust the mail service's free tier). The alerts stay open and
    // un-notified: the next day's first tick sends them, and the daily digest lists them.
    held = normal.length;
  } else if (normal.length) {
    const body = normal.map((a) => `- ${a.detail}`).join("\n") + "\n\nDetails: #/admin/ops in the app. You will not be emailed about these again unless they clear and come back.";
    try {
      await deps.sender.send({ kind: "alert", to: OPS_TO,
        subject: normal.length === 1 ? `Ryagram: ${normal[0].detail}`.slice(0, 120) : `Ryagram: ${normal.length} things need a look`, body });
      notified += await deps.markNotified(normal.map((a) => a.key));
    } catch (e) {
      console.error("alert not sent; will retry next tick", (e as Error).message);
    }
  }
  return json(200, { rendering: r.rendering, reaped: r.reaped, expired: r.expired, alerts: r.new_alerts.length, urgent: urgentSent, notified, held, mode: deps.sender.mode });
}
