// ops-tick: every 5 minutes. Runs the database's health pass (ops_tick: reap lost leases, expire stale queue, raise alerts) and
// emails every NEW alert exactly once. A failed send leaves the alert un-notified, so the next tick tries again.
import { isService, json, OPS_TO, type Sender } from "../_shared/ops_mail.ts";

export interface Deps {
  serviceKey: string;
  tick(): Promise<{ rendering: string; reaped: number; expired: number; new_alerts: { key: string; detail: string }[] }>;
  markNotified(keys: string[]): Promise<number>;
  sender: Sender;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  if (!isService(req, deps.serviceKey)) return json(403, { error: "Not allowed." });
  let r;
  try { r = await deps.tick(); } catch (e) { console.error("ops_tick failed", (e as Error).message); return json(500, { error: "tick failed" }); }
  let notified = 0;
  if (r.new_alerts.length) {
    const body = r.new_alerts.map((a) => `- ${a.detail}`).join("\n") + "\n\nDetails: #/admin/ops in the app. You will not be emailed about these again unless they clear and come back.";
    try {
      await deps.sender.send({ kind: "alert", to: OPS_TO,
        subject: r.new_alerts.length === 1 ? `Ryagram: ${r.new_alerts[0].detail}`.slice(0, 120) : `Ryagram: ${r.new_alerts.length} things need a look`, body });
      notified = await deps.markNotified(r.new_alerts.map((a) => a.key));
    } catch (e) {
      console.error("alert not sent; will retry next tick", (e as Error).message);
    }
  }
  return json(200, { rendering: r.rendering, reaped: r.reaped, expired: r.expired, alerts: r.new_alerts.length, notified, mode: deps.sender.mode });
}
