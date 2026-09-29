// Delete my account (the person's own, confirmed by typing their email). JWT is checked inside:
//   npx supabase functions deploy delete-account --project-ref <ref> --no-verify-jwt
// No secrets of its own: the service role Supabase gives every function is used only for the
// account_* functions, removing the person's files, and deleting their login.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./remove.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
                             { auth: { persistSession: false } });

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  async verifyUser(jwt) {
    const { data, error } = await service.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? "" };
  },
  check: (owner) => rpc("account_deletion_check", { p_owner: owner }),
  async removeFiles(paths) {
    const { error } = await service.storage.from("ryagram-artifacts").remove(paths);
    if (error) throw new Error(error.message);
  },
  requestDeletion: async (owner, email, reason) => {
    await rpc("account_request_deletion", { p_owner: owner, p_email: email, p_reason: reason });
  },
  async deleteUser(owner) {
    const { error } = await service.auth.admin.deleteUser(owner);
    if (error) throw new Error(error.message);
  },
}));
