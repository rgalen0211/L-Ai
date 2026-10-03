// Starts a Stripe Checkout for a pack or a plan, or opens the billing portal to manage a plan.
// The browser gets back a Stripe URL and goes there; no card details ever touch Ryagram.
// Credits are granted only by stripe-webhook, never here. Tested in tests/stripe.test.mjs.

export interface Context {
  stripe_price_id: string | null; mode: "payment" | "subscription" | null; customer_id: string | null;
  email: string | null; has_plan: boolean; live_ok: boolean;
}
export interface Deps {
  allowedOrigins: string[];
  siteUrl: string;                          // https://uselai.com
  keyIsTest: boolean;                       // STRIPE_SECRET_KEY starts sk_test_ / rk_test_
  verifyUser(jwt: string): Promise<{ id: string } | null>;
  context(owner: string, priceCode: string): Promise<Context>;
  setCustomer(owner: string, customerId: string): Promise<void>;
  stripe(path: string, params: Record<string, unknown>, idempotencyKey: string): Promise<any>;
}

const CODE = /^(pack|sub)_[a-z]+$/;

function cors(origin: string | null, allowed: string[]): Record<string, string> {
  return origin && allowed.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const headers = cors(origin, deps.allowedOrigins);
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!origin || !deps.allowedOrigins.includes(origin)) return reply(403, { error: "Not allowed from this page." });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.verifyUser(jwt).catch(() => null) : null;
  if (!user) return reply(401, { error: "Sign in first." });

  let body: { action?: unknown; price_code?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const action = body.action === "portal" ? "portal" : "checkout";
  const code = typeof body.price_code === "string" ? body.price_code : "";
  if (action === "checkout" && !CODE.test(code)) return reply(400, { error: "Choose a pack or a plan." });

  try {
    const ctx = await deps.context(user.id, action === "checkout" ? code : "");
    // Test mode until Ryan says otherwise: a live key is refused unless stripe_settings.live_ok.
    if (!deps.keyIsTest && !ctx.live_ok) return reply(503, { error: "Payments aren't open yet." });
    const back = `${deps.siteUrl}/app/#/credits`;

    if (action === "portal") {
      if (!ctx.customer_id) return reply(404, { error: "There's no plan or purchase to manage yet." });
      const portal = await deps.stripe("/v1/billing_portal/sessions", { customer: ctx.customer_id, return_url: back },
                                       `portal-${user.id}-${Date.now()}`);
      return reply(200, { url: portal.url });
    }

    if (!ctx.stripe_price_id || !ctx.mode) return reply(404, { error: "That isn't on sale." });
    if (ctx.mode === "subscription" && ctx.has_plan) {
      return reply(409, { error: "You already have a plan. Use Manage plan to change or cancel it." });
    }
    let customer = ctx.customer_id;
    if (!customer) {
      // One customer per person: the idempotency key makes a double click create one, not two.
      const created = await deps.stripe("/v1/customers",
        { email: ctx.email ?? undefined, metadata: { owner_id: user.id } }, `customer-${user.id}`);
      customer = created.id as string;
      await deps.setCustomer(user.id, customer);
    }
    const metadata = { owner_id: user.id, price_code: code };
    const session = await deps.stripe("/v1/checkout/sessions", {
      mode: ctx.mode,
      customer,
      client_reference_id: user.id,
      line_items: [{ price: ctx.stripe_price_id, quantity: 1 }],
      metadata,
      ...(ctx.mode === "payment" ? { payment_intent_data: { metadata } } : { subscription_data: { metadata } }),
      success_url: `${back}?paid=${code}`,
      cancel_url: back,
    }, `checkout-${user.id}-${code}-${Math.floor(Date.now() / 60000)}`);   // one session per minute per choice
    return reply(200, { url: session.url });
  } catch (err) {
    console.error(`stripe-checkout: ${(err as Error).message}`);      // Stripe's message can name the key; logs only
    return reply(502, { error: "Stripe didn't answer. Try again in a minute." });
  }
}
