// guided-builder: the guided "Make a film step by step" page's server side (builder.ts). Deploy WITH a JWT check inside (the person must be signed in):
//   npx supabase functions deploy guided-builder --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
// No secrets of its own: the service role Supabase gives every function is used only to ask Auth who the bearer token belongs to.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { verifyAppUser } from "../_shared/oauth_guard.ts";
import { handle } from "./builder.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  // The shared guard first (CONNECT's rule): a connection (OAuth) token is refused before Supabase is even asked (the only line of defence needed: there is no token left for a second check to see).
  async verifyUser(jwt) {
    const u = await verifyAppUser(service.auth, jwt);
    return u ? { id: u.id } : null;
  },
}));
