// Stripe helpers shared by stripe-webhook and stripe-checkout. No SDK: Stripe's documented
// signature scheme and form-encoded REST calls are small enough to own and to test in Node.

const enc = new TextEncoder();

// Stripe-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">[,v1=...][,v0=...]
// The key is the endpoint's whole signing secret (whsec_...). Several v1 values appear while a
// secret is being rolled; any one matching is enough. Older than `toleranceSec` is refused,
// so a captured request can't be replayed later (Stripe's default tolerance is 300 s).
export async function verifySignature(payload: string, header: string | null, secret: string,
                                      nowSec: number, toleranceSec = 300): Promise<boolean> {
  if (!header || !secret) return false;
  let t = NaN;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t" && /^[0-9]+$/.test(v)) t = Number(v);
    if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  if (!Number.isFinite(t) || !v1.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return v1.some((sig) => equal(sig, expected));
}

function equal(a: string, b: string): boolean {       // constant time for equal lengths
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Stripe's form encoding: nested objects and arrays as a[b][0][c]=v.
export function formEncode(params: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(`${prefix}[${k}]`, x);
    else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join("&");
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;

export interface Extracted { id: string; type: string; created: string; livemode: boolean; data: Record<string, unknown> }

// The few fields stripe_apply needs, per event type. Reads both the current invoice layout
// (parent.subscription_details, line pricing.price_details) and the older one
// (invoice.subscription, line.price), since the shape follows the webhook endpoint's API version.
export function extract(event: any): Extracted | null {
  if (!event || event.object !== "event" || typeof event.id !== "string" || typeof event.type !== "string") return null;
  const o = event.data?.object ?? {};
  const base = { id: event.id, type: event.type, created: new Date(Number(event.created) * 1000).toISOString(),
                 livemode: event.livemode === true };
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return { ...base, data: {
        session_id: o.id ?? null, mode: o.mode ?? null, payment_status: o.payment_status ?? null,
        owner_id: o.client_reference_id ?? null, customer: idOf(o.customer), price_code: o.metadata?.price_code ?? null,
        amount_total: o.amount_total ?? null, currency: o.currency ?? null,
        payment_intent: idOf(o.payment_intent), subscription: idOf(o.subscription) } };
    case "invoice.paid": {
      const lines: any[] = o.lines?.data ?? [];
      const isSub = (l: any) => l?.parent?.subscription_item_details || l?.type === "subscription" || l?.subscription;
      const line = lines.find((l) => isSub(l) && !(l.parent?.subscription_item_details?.proration ?? l.proration))
        ?? lines.find(isSub) ?? null;
      return { ...base, data: {
        invoice_id: o.id ?? null, customer: idOf(o.customer),
        subscription: idOf(o.parent?.subscription_details?.subscription) ?? idOf(o.subscription)
          ?? idOf(line?.parent?.subscription_item_details?.subscription) ?? null,
        price_id: idOf(line?.pricing?.price_details?.price) ?? idOf(line?.price) ?? null,
        billing_reason: o.billing_reason ?? null, amount_paid: o.amount_paid ?? null, currency: o.currency ?? null,
        period_start: line?.period?.start ?? null } };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const item = o.items?.data?.[0];
      return { ...base, data: {
        subscription: o.id ?? null, customer: idOf(o.customer), status: o.status ?? null,
        price_id: idOf(item?.price) ?? null,
        current_period_end: item?.current_period_end ?? o.current_period_end ?? null,
        cancel_at_period_end: o.cancel_at_period_end === true } };
    }
    case "charge.refunded":
      return { ...base, data: {
        charge: o.id ?? null, payment_intent: idOf(o.payment_intent), amount: o.amount ?? null,
        amount_refunded: o.amount_refunded ?? null, currency: o.currency ?? null } };
    default:
      return { ...base, data: {} };
  }
}
