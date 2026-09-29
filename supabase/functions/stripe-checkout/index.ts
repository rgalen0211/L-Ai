// Stripe checkout and billing portal for signed-in people (JWT is verified inside):
//   npx supabase functions deploy stripe-checkout --project-ref <ref> --no-verify-jwt
// Needs the secret STRIPE_SECRET_KEY (a TEST key, sk_test_... or a restricted rk_test_...) in
// Dashboard -> Edge Functions -> Secrets. A live key is refused until stripe_settings.live_ok.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { formEncode } from "../_shared/stripe.ts";
import { handle } from "./checkout.ts";

const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
                             { auth: { persistSession: false } });

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  siteUrl: "https://uselai.com",
  keyIsTest: /^(sk|rk)_test_/.test(key),
  async verifyUser(jwt) {
    const { data, error } = await service.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  context: (owner, code) => rpc("stripe_checkout_context", { p_owner: owner, p_price_code: code }),
  setCustomer: (owner, customer) => rpc("stripe_set_customer", { p_owner: owner, p_customer: customer }),
  async stripe(path, params, idempotencyKey) {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded",
                 "Idempotency-Key": idempotencyKey },
      body: formEncode(params),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `Stripe ${res.status}`);
    return json;
  },
}));
