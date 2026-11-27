// Delete my account (the person's own, confirmed by typing their email). JWT is checked inside:
//   npx supabase functions deploy delete-account --project-ref <ref> --no-verify-jwt
// No secrets of its own: the service role Supabase gives every function is used only for the
// account_* functions, removing the person's files, and deleting their login.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { verifyAppUser } from "../_shared/oauth_guard.ts";
import { handle } from "./remove.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";
import { resolveSiteOrigins } from "../_shared/site_origins.ts";

const sk = resolveServiceKey();            // FUNCTIONS_KEY_NAME picks a key by name; unset = SUPABASE_SERVICE_ROLE_KEY as before (supabase/functions/_shared/service_key.ts)
const serve = guardedServe(sk);

const service = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient,
                             { auth: { persistSession: false } });

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

serve((req) => handle(req, {
  allowedOrigins: resolveSiteOrigins(),
  verifyUser: (jwt) => verifyAppUser(service.auth, jwt),
  check: (owner) => rpc("account_deletion_check", { p_owner: owner }),
  async removeFiles(paths, bucket) {
    const { error } = await service.storage.from(bucket === "uploads" ? "ryagram-uploads" : "ryagram-artifacts").remove(paths);
    if (error) throw new Error(error.message);
  },
  eraseContent: (owner) => rpc("account_erase_paid_content", { p_owner: owner }),                 // GEO 11-21 M1
  redactContact: async (owner, email) => {                                                          // GEO 11-21 M5
    await rpc("account_redact_contact", { p_owner: owner, p_email: email });
  },
  requestDeletion: async (owner, email, reason) => {
    await rpc("account_request_deletion", { p_owner: owner, p_email: email, p_reason: reason });
  },
  async blockLogin(owner) {                                                                        // CC1 10:57 LOW 7
    const { error } = await service.auth.admin.updateUserById(owner, { ban_duration: "876000h" });   // about 100 years: until Ryan's hand close deletes it
    if (error) throw new Error(error.message);
  },
  async deleteUser(owner) {
    const { error } = await service.auth.admin.deleteUser(owner);
    if (error) throw new Error(error.message);
  },
}));
