// Stripe webhook: verify the signature, pull out the fields that matter, hand them to
// stripe_apply (supabase/phase-2b/stripe_test_mode.sql), which makes every decision.
// Tested with Stripe's fixtures in tests/stripe.test.mjs; index.ts wires the real database.
import { extract, verifySignature } from "../_shared/stripe.ts";

export interface Deps {
  signingSecret: string;
  apply(eventId: string, type: string, created: string, livemode: boolean, data: Record<string, unknown>): Promise<string>;
  now?: () => number;
  log?: (msg: string) => void;
}

const MAX_BYTES = 512 * 1024;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const raw = await req.text();                 // the exact bytes Stripe signed; parse only after checking
  if (raw.length > MAX_BYTES) return reply(413, { error: "Too large." });
  const now = Math.floor((deps.now ?? Date.now)() / 1000);
  if (!(await verifySignature(raw, req.headers.get("stripe-signature"), deps.signingSecret, now))) {
    return reply(400, { error: "Bad signature." });
  }
  let event: unknown;
  try { event = JSON.parse(raw); } catch { return reply(400, { error: "Bad JSON." }); }
  const e = extract(event);
  if (!e) return reply(400, { error: "Not a Stripe event." });

  try {
    const outcome = await deps.apply(e.id, e.type, e.created, e.livemode, e.data);
    deps.log?.(`${e.id} ${e.type}: ${outcome}`);
    return reply(200, { received: true, outcome });
  } catch (err) {
    // A database failure: answer 500 so Stripe delivers the event again later.
    deps.log?.(`${e.id} ${e.type}: failed: ${(err as Error).message}`);
    return reply(500, { error: "Could not record the event; Stripe will retry." });
  }
}
