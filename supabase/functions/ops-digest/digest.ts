// ops-digest: once a day (08:00 New York). SILENT when nothing needs Ryan; otherwise one short email of what needs action.
import { isService, json, OPS_TO, type Sender } from "../_shared/ops_mail.ts";

export interface DigestData {
  actionable: boolean; items: string[]; recovered: string[]; support_open: number; abuse_waiting: number; rendering: string;
  digest_sent_today: boolean; ai_day_spent: number; ai_day_cap: number; ai_month_spent: number; ai_month_cap: number;
}
export interface Deps { serviceKey: string; data(): Promise<DigestData>; sender: Sender }

export function compose(d: DigestData): { subject: string; body: string } {
  const lines: string[] = [];
  if (d.items.length) lines.push("NEEDS ACTION:", ...d.items.map((i) => `- ${i}`), "");
  if (d.support_open) lines.push(`- ${d.support_open} support request(s) waiting for a reply.`);
  if (d.abuse_waiting) lines.push(`- ${d.abuse_waiting} abuse report(s) waiting for your review.`);
  if (d.recovered.length) lines.push("", "Back to normal:", ...d.recovered.map((i) => `- ${i}`));
  lines.push("", `Rendering: ${d.rendering}. AI editor spend: $${Number(d.ai_day_spent).toFixed(2)} of $${d.ai_day_cap} today, $${Number(d.ai_month_spent).toFixed(2)} of $${d.ai_month_cap} this month.`,
    "Everything else is fine. Open #/admin/ops in the app for the buttons.");
  const n = d.items.length + (d.support_open ? 1 : 0) + (d.abuse_waiting ? 1 : 0);
  return { subject: `Ryagram daily: ${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`, body: lines.join("\n") };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  if (!isService(req, deps.serviceKey)) return json(403, { error: "Not allowed." });
  let d: DigestData;
  try { d = await deps.data(); } catch (e) { console.error("digest data failed", (e as Error).message); return json(500, { error: "digest failed" }); }
  if (!d.actionable) return json(200, { sent: false, reason: "nothing needs action" });       // silent when everything is fine
  if (d.digest_sent_today) return json(200, { sent: false, reason: "already sent today" });
  const m = compose(d);
  try {
    await deps.sender.send({ kind: "digest", to: OPS_TO, ...m });
  } catch (e) {
    console.error("digest not sent", (e as Error).message);
    return json(502, { sent: false, error: "send failed; will retry on the next run" });
  }
  return json(200, { sent: true, mode: deps.sender.mode });
}
