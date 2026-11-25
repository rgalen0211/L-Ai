// Starts a Stripe Checkout for a pack or a plan, or opens the billing portal to manage a plan.
// The browser gets back a Stripe URL and goes there; no card details ever touch Ryagram.
// Credits are granted only by stripe-webhook, never here. Tested in tests/stripe.test.mjs.

export interface Context {
  stripe_price_id: string | null; mode: "payment" | "subscription" | null; customer_id: string | null;
  email: string | null; has_plan: boolean; live_ok: boolean;
  buying_open?: boolean; is_admin?: boolean;   // GEO 11-21: the server's buying switch (stripe_settings.buying_open); an app admin may test while it is off
  // CONNECT 11-24 (CC1 09:33 / 10:23): the answer the person gave once ("business or personal use?" and where they are), stored on the account
  // by set_my_tax_profile; null = never answered. tax_rate_id is the Stripe Tax Rate the DATABASE picked for THIS profile and THIS price (a plan, business, Ohio, that ZIP's county), or null = no tax.
  // tax_unknown = the profile needs a tax rate the database does not have yet (an Ohio ZIP it cannot place, or a rate with no Stripe id): the checkout is refused, never opened untaxed.
  tax_profile?: { use: "business" | "personal"; country: string; state: string | null; zip: string | null } | null;
  tax_rate_id?: string | null; tax_county?: string | null; tax_unknown?: boolean;
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
    // GEO 11-21: buying is a server switch, not only the page's hidden buttons. While it is off no checkout opens for an ordinary
    // account (the billing portal for an existing plan stays open). A missing key reads as closed.
    if (action === "checkout" && ctx.buying_open !== true && ctx.is_admin !== true) return reply(503, { error: "Buying is not open yet." });
    // CONNECT 11-24 (CC1 safety fact): a TEST key skips live_ok above, and anyone can pay with Stripe's public test card. So while buying is open
    // for everyone, a test key opens NO checkout, for an administrator too. (Step 69 swaps the key and the price ids BEFORE it opens buying.)
    if (action === "checkout" && deps.keyIsTest && ctx.buying_open === true) return reply(503, { error: "Payments aren't open yet." });
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
    // The one question (business or personal use, and where you are) is asked ONCE and stored; a checkout without it is refused so no plan is ever
    // sold untaxed by accident. The page answers it with set_my_tax_profile and asks again on this code.
    const profile = ctx.tax_profile ?? null;
    if (!profile || (profile.use !== "business" && profile.use !== "personal")) {
      return reply(422, { error: "Tell us whether this is for business or personal use and where you are first.", code: "tax_profile_missing" });
    }
    // Only a PLAN can carry tax here (a credit pack is never taxed at checkout: prepaid credits are taxed when used, Ryan 11-24).
    // The database decides the rate; if it says a tax applies but has no rate to give, refuse rather than sell untaxed.
    const taxRate = ctx.mode === "subscription" ? (ctx.tax_rate_id ?? null) : null;
    if (ctx.mode === "subscription" && ctx.tax_unknown === true) {
      return reply(503, { error: "Tax for your area isn't set up yet. Please try again later.", code: "tax_not_ready" });
    }
    let customer = ctx.customer_id;
    if (!customer) {
      // One customer per person: the idempotency key makes a double click create one, not two.
      const created = await deps.stripe("/v1/customers",
        { email: ctx.email ?? undefined, metadata: { owner_id: user.id } }, `customer-${user.id}`);
      customer = created.id as string;
      await deps.setCustomer(user.id, customer);
    }
    // What Stripe's own record of the purchase will say about use and place (the webhook reads only owner_id and price_code; the rest is for the books).
    const metadata: Record<string, string> = { owner_id: user.id, price_code: code, tax_use: profile.use, tax_country: profile.country };
    if (profile.state) metadata.tax_state = profile.state;
    if (ctx.tax_county) metadata.tax_county = ctx.tax_county;
    const session = await deps.stripe("/v1/checkout/sessions", {
      mode: ctx.mode,
      customer,
      client_reference_id: user.id,
      line_items: [{ price: ctx.stripe_price_id, quantity: 1, ...(taxRate ? { tax_rates: [taxRate] } : {}) }],
      metadata,
      ...(ctx.mode === "payment" ? { payment_intent_data: { metadata } } : { subscription_data: { metadata } }),
      success_url: `${back}?paid=${code}`,
      cancel_url: back,
    }, `checkout-${user.id}-${code}-${taxRate ?? "none"}-${Math.floor(Date.now() / 60000)}`);   // one session per minute per choice (and per tax rate, so a corrected answer is never served an old session)
    return reply(200, { url: session.url });
  } catch (err) {
    console.error(errorLine(err));      // never the message: Stripe's can name the key, an email or a customer id (GEO 11-21 L3)
    return reply(502, { error: "Stripe didn't answer. Try again in a minute." });
  }
}

// What a failed checkout leaves in the logs: Stripe's error type and code and the HTTP status (or the database's error code),
// each held to a plain token, and nothing else. The message itself is never logged.
export function errorLine(err: unknown): string {
  const e = (err ?? {}) as { stripeType?: unknown; code?: unknown; status?: unknown };
  const token = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(v)) ? v
    : (typeof v === "number" && Number.isInteger(v)) ? String(v) : "-";
  return `stripe-checkout: failed type=${token(e.stripeType)} code=${token(e.code)} status=${token(e.status)}`;
}
