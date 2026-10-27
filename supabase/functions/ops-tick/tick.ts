// ops-tick: every MINUTE. Runs the database's health pass (ops_tick: reap lost leases, expire stale queue, raise alerts) and
// emails every NEW alert exactly once. A failed send leaves the alert un-notified, so the next tick tries again.
import { json, OPS_TO, reply, type Sender, whoCalls } from "../_shared/ops_mail.ts";

const URGENT_LINES = 100;          // one mail lists up to 100 reports; any more are counted in it and all of them are on #/admin/ops

export interface Deps {
  serviceKey: string;
  jobSecret?: string;               // this job's own secret (OPS_TICK_SECRET): what the scheduler sends instead of the service-role key
  tick(): Promise<{ rendering: string; reaped: number; expired: number; alert_mail_budget: number; urgent_wait_s?: number; new_alerts: { key: string; detail: string; urgent?: boolean }[] }>;
  markNotified(keys: string[]): Promise<number>;
  purge?(): Promise<unknown>;       // the retention purge (does real work once a day; a failure here never stops the tick)
  // render orders (PIPE-1): finals waiting for Ryan longer than approval_days are expired (their holds released), and
  // deliveries past their 30 days are marked deleted; their film objects are removed here (SQL can't remove stored files)
  orders?(): Promise<{ approvals_expired: number; delete_objects: string[] }>;
  removeArtifacts?(paths: string[]): Promise<void>;
  sender: Sender;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const caller = whoCalls(req, deps.serviceKey, deps.jobSecret);
  if (!caller) return json(403, { error: "Not allowed." });
  let r;
  try { r = await deps.tick(); } catch (e) { console.error("ops_tick failed", (e as Error).message); return reply(caller, 500, { error: "tick failed" }); }
  let notified = 0;
  let held = 0;
  let urgentSent = 0;
  const urgent = r.new_alerts.filter((a) => a.urgent);
  const normal = r.new_alerts.filter((a) => !a.urgent);
  // URGENT alerts (a child-safety report), Ryan 2026-10-14: the FIRST goes out at once; after that ONE grouped mail at most every 15 minutes (the
  // database says how many seconds are still to wait: urgent_wait_s), covering EVERYTHING since the last one. Nothing is dropped: an alert that has to
  // wait stays un-notified and is in the next mail (a failed send is tried again next minute). Urgent mail is its own kind: it never counts against,
  // and is never held by, the daily allowance for ordinary alerts.
  let urgentHeld = 0;
  if (urgent.length && (r.urgent_wait_s ?? 0) <= 0) {
    const lines = urgent.slice(0, URGENT_LINES).map((a) => `- ${a.detail.replace(/^URGENT:\s*/, "")}`);
    if (urgent.length > URGENT_LINES) lines.push(`- ...and ${urgent.length - URGENT_LINES} more: every one is listed in #/admin/ops (Abuse reports).`);
    try {
      await deps.sender.send({ kind: "urgent", to: OPS_TO,
        subject: urgent.length === 1 ? `URGENT: ${urgent[0].detail.replace(/^URGENT:\s*/, "")}`.slice(0, 120) : `URGENT: ${urgent.length} child-safety reports`,
        body: lines.join("\n") + "\n\nReview now: #/admin/ops in the app (Abuse reports). Open reports stay listed in the daily email until you decide. Further reports are grouped into one email every 15 minutes." });
      notified += await deps.markNotified(urgent.map((a) => a.key));
      urgentSent = urgent.length;
    } catch (e) {
      console.error("urgent alert not sent; will retry next tick", (e as Error).message);
    }
  } else {
    urgentHeld = urgent.length;
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
  let purged: unknown;
  if (deps.purge) {
    try { purged = await deps.purge(); } catch (e) { console.error("retention_purge failed", (e as Error).message); purged = { error: true }; }
  }
  let orders: unknown;
  if (deps.orders) {
    try {
      const o = await deps.orders();
      const paths = (o.delete_objects ?? []).filter((x) => typeof x === "string" && x.length > 0);
      let removed = 0;
      if (paths.length && deps.removeArtifacts) {
        for (let i = 0; i < paths.length; i += 100) { await deps.removeArtifacts(paths.slice(i, i + 100)); removed += Math.min(100, paths.length - i); }
      }
      orders = { approvals_expired: o.approvals_expired, films_removed: removed };
    } catch (e) { console.error("render_orders_tick failed", (e as Error).message); orders = { error: true }; }
  }
  return reply(caller, 200, { rendering: r.rendering, reaped: r.reaped, expired: r.expired, alerts: r.new_alerts.length, urgent: urgentSent, urgent_held: urgentHeld, notified, held, mode: deps.sender.mode,
                     ...(deps.purge ? { purged } : {}), ...(deps.orders ? { orders } : {}) });
}
