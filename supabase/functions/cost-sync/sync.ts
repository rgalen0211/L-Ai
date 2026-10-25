// cost-sync: pulls Stripe's own balance transactions (the fee Stripe really took on each one) into the cost ledger, then runs the ledger's
// periodic pass (plan accruals, render cost, storage and email readings, Ryan's alarms). Run it hourly; both halves are idempotent.
// Stripe's answer shape is from its API reference (List balance transactions). Read-only: it only GETs.
import { json, reply, whoCalls } from "../_shared/ops_mail.ts";

export interface CostEvent {
  occurred_at: string; vendor: string; kind: string; amount_usd: number | null; quantity: number | null; unit: string;
  livemode?: boolean; ref: string; detail: Record<string, unknown>;      // livemode missing = the database records it as UNKNOWN mode (never live money)
}
type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export interface Deps {
  serviceKey: string;
  jobSecret?: string;                // COST_SYNC_SECRET: this job's own secret, what the scheduler sends instead of the service-role key
  stripeKey: string | undefined;
  fetch: Fetch;
  getCursor(key: string): Promise<string | null>;
  setCursor(key: string, value: string): Promise<void>;
  record(events: CostEvent[]): Promise<number>;
  tick(): Promise<unknown>;
  now(): number;                       // unix seconds
}

interface Txn {
  id: string; amount: number; created: number; currency: string; fee: number; type: string; reporting_category?: string; source?: string | null;
  fee_details?: { type?: string; description?: string; amount?: number; currency?: string }[];
}

const PAGE = 100;
const MAX_PAGES = 50;
const BACK_DAYS = 35;
const OVERLAP_S = 86400;

// Only a RESTRICTED key (rk_...) is accepted: this function reads balance transactions and nothing else, so it must never hold a full secret key (sk_...).
// Supabase secrets are project-wide: it has its OWN secret, STRIPE_READ_KEY (Balance: Read), separate from the checkout function's key.
export function stripeMode(key: string | undefined): boolean | null {
  if (/^rk_test_/.test(key ?? "")) return false;
  if (/^rk_live_/.test(key ?? "")) return true;
  return null;                          // unset, a full secret key, or not a Stripe key: never guess the mode
}

// A balance transaction becomes a cost event only when Stripe took a fee on it. A refund carries no fee (the original fee is not returned),
// so it adds nothing here. A fee in a currency other than USD is recorded with an UNKNOWN amount rather than a converted guess.
export function feeEvent(t: Txn, livemode?: boolean): CostEvent | null {
  if (!t || typeof t.id !== "string" || !Number.isFinite(t.fee) || t.fee <= 0) return null;
  const usd = (t.currency ?? "").toLowerCase() === "usd";
  return {
    occurred_at: new Date(t.created * 1000).toISOString(), vendor: "stripe", kind: "stripe_fee",
    amount_usd: usd ? t.fee / 100 : null, quantity: Math.abs(t.amount) / 100, unit: "gross_" + (t.currency ?? "").toLowerCase().slice(0, 3),
    ...(livemode === undefined ? {} : { livemode }), ref: t.id,
    detail: { type: t.type, reporting_category: t.reporting_category ?? null, source: t.source ?? null, gross_cents: t.amount, fee_cents: t.fee, currency: t.currency,
              fee_details: (t.fee_details ?? []).slice(0, 6).map((d) => ({ type: d.type ?? null, description: (d.description ?? "").slice(0, 80), amount: d.amount ?? null })) },
  };
}

async function pullStripe(deps: Deps, livemode: boolean) {
  const key = livemode ? "stripe_created_live" : "stripe_created_test";          // a test-mode bookmark must never hide live transactions
  const stored = await deps.getCursor(key);
  const start = stored && /^\d{9,11}$/.test(stored) ? Number(stored) : deps.now() - BACK_DAYS * 86400;
  const events: CostEvent[] = [];
  let fetched = 0; let newest = 0; let after = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.stripe.com/v1/balance_transactions?limit=${PAGE}&created[gte]=${start}` + (after ? `&starting_after=${after}` : "");
    const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${deps.stripeKey}` } });
    if (!res.ok) throw new Error(`Stripe answered ${res.status}`);
    const body = await res.json() as { data?: Txn[]; has_more?: boolean };
    const rows = Array.isArray(body.data) ? body.data : [];
    for (const t of rows) {
      fetched++;
      if (Number.isFinite(t.created) && t.created > newest) newest = t.created;
      const e = feeEvent(t, livemode);
      if (e) events.push(e);
    }
    if (!body.has_more || !rows.length) {
      let recorded = 0;
      for (let i = 0; i < events.length; i += 400) recorded += await deps.record(events.slice(i, i + 400));
      if (newest) await deps.setCursor(key, String(newest - OVERLAP_S));        // a day of overlap: a late transaction is still caught; repeats add nothing
      return { mode: livemode ? "live" : "test", fetched, fee_events: events.length, recorded };
    }
    after = rows[rows.length - 1].id;
  }
  throw new Error("More than 5,000 transactions since the last run; the bookmark was not moved. Run it again.");
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const caller = whoCalls(req, deps.serviceKey, deps.jobSecret);
  if (!caller) return json(403, { error: "Not allowed." });
  let stripe: Record<string, unknown>;
  const mode = stripeMode(deps.stripeKey);
  if (!deps.stripeKey) stripe = { skipped: "STRIPE_READ_KEY is not set" };
  else if (mode === null) stripe = { error: /^sk_/.test(deps.stripeKey) ? "STRIPE_READ_KEY must be a restricted key (rk_...), not a full secret key" : "STRIPE_READ_KEY is not a restricted Stripe key (rk_test_... or rk_live_...)" };
  else {
    try { stripe = await pullStripe(deps, mode); }
    catch (e) { console.error("cost-sync stripe", (e as Error).message); stripe = { error: (e as Error).message.slice(0, 200) }; }   // the ledger pass below still runs
  }
  let tick: unknown;
  try { tick = await deps.tick(); } catch (e) { console.error("cost_tick failed", (e as Error).message); return reply(caller, 500, { error: "cost_tick failed", stripe }); }
  return reply(caller, 200, { stripe, tick });
}
