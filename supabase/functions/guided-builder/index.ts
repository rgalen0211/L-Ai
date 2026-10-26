// guided-builder: the guided "Make a film step by step" page's server side (builder.ts). Deploy WITH a JWT check inside (the person must be signed in):
//   npx supabase functions deploy guided-builder --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
// No secrets of its own: the service role Supabase gives every function is used only to ask Auth who the bearer token belongs to.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { verifyAppUser } from "../_shared/oauth_guard.ts";
import { handle } from "./builder.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";

const sk = resolveServiceKey();            // FUNCTIONS_KEY_NAME picks a key by name; unset = SUPABASE_SERVICE_ROLE_KEY as before (supabase/functions/_shared/service_key.ts)
const serve = guardedServe(sk);

const service = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient, { auth: { persistSession: false } });

serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  // The shared guard first (CONNECT's rule): a connection (OAuth) token is refused before Supabase is even asked (the only line of defence needed: there is no token left for a second check to see).
  async verifyUser(jwt) {
    const u = await verifyAppUser(service.auth, jwt);
    return u ? { id: u.id } : null;
  },
}));
