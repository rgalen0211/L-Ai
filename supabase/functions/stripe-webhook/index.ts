// Stripe webhook endpoint. Stripe calls it, not a person, so the platform JWT check is off:
//   npx supabase functions deploy stripe-webhook --project-ref <ref> --no-verify-jwt
// Needs the secret STRIPE_WEBHOOK_SECRET (the endpoint's whsec_..., from Stripe) in
// Dashboard -> Edge Functions -> Secrets. The signature check is what keeps strangers out.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./webhook.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
                             { auth: { persistSession: false } });

Deno.serve((req) => handle(req, {
  signingSecret: Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
  async apply(eventId, type, created, livemode, data) {
    const { data: outcome, error } = await service.rpc("stripe_apply", {
      p_event_id: eventId, p_type: type, p_created: created, p_livemode: livemode, p_data: data });
    if (error) throw new Error(error.message);
    return outcome as string;
  },
  log: (msg) => console.log(msg),
}));
