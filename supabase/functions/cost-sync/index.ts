// Cost ledger sync (see sync.ts). NOT DEPLOYED. Deploy after review:
//   npx supabase functions deploy cost-sync --project-ref <ref> --no-verify-jwt
// Schedule: Dashboard > Integrations > Cron > every hour > Supabase Edge Function cost-sync, with the same Authorization header as ops-tick
// (the scheduler sends COST_SYNC_SECRET, its own per-job secret, as the bearer token; the service-role key is also accepted for Ryan running it by hand). It reads Stripe with its OWN secret, STRIPE_READ_KEY: a RESTRICTED key (rk_...) with
// "Balance: Read" only (supabase/README.md, "Cost ledger"). Never the checkout function's key: Supabase secrets are project-wide. With no key it still runs the ledger's own pass.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./sync.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";

const sk = resolveServiceKey();            // FUNCTIONS_KEY_NAME picks a key by name; unset = SUPABASE_SERVICE_ROLE_KEY as before (supabase/functions/_shared/service_key.ts)
const serve = guardedServe(sk);

const serviceKey = sk.key;
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

serve((req) => handle(req, {
  serviceKey,
  jobSecret: Deno.env.get("COST_SYNC_SECRET"),
  stripeKey: Deno.env.get("STRIPE_READ_KEY"),
  fetch: fetch as never,
  getCursor: async (key) => (await rpc("cost_sync_get", { p_key: key })) as string | null,
  setCursor: async (key, value) => { await rpc("cost_sync_set", { p_key: key, p_value: value }); },
  record: async (events) => (await rpc("cost_record_events", { p_events: events })) as number,
  tick: () => rpc("cost_tick"),
  now: () => Math.floor(Date.now() / 1000),
}));
