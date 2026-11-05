// claim-invite: a signed-in WAITING person enters an invite code (see claim.ts). NOT DEPLOYED. Deploy after review and after the migration 20261104000100_waiting_accounts.sql:
//   npx.cmd supabase functions deploy claim-invite --project-ref <ref> --no-verify-jwt
// The JWT is checked inside with verifyAppUser (an AI's token is refused; a WAITING person is allowed: this is how they leave the list).
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { verifyAppUser } from "../_shared/oauth_guard.ts";
import { handle } from "./claim.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";

const sk = resolveServiceKey();
const serve = guardedServe(sk);
const service = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient, { auth: { persistSession: false } });

serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  verifyUser: (jwt) => verifyAppUser(service.auth, jwt),
  async claim(userId, code, ipHash) {
    const { data, error } = await service.rpc("invite_claim", { p_user: userId, p_code: code, p_ip_hash: ipHash });
    if (error) throw new Error(error.message);
    return data;
  },
}));
