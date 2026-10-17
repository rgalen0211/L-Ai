// get-delivery-url (PIPE-1, JOB-CONTRACT-v1 3b): a person's delivered film as a 1-hour signed link. JWT is checked inside:
//   npx supabase functions deploy get-delivery-url --project-ref <ref> --no-verify-jwt
// No secrets of its own: the service role Supabase gives every function is used only for delivery_object_for (which
// enforces owner, expiry and deletion) and for signing that one object.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { claimsOf, handle } from "./deliver.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
                             { auth: { persistSession: false } });

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  async verifyUser(jwt) {
    const { data, error } = await service.auth.getUser(jwt);
    if (error || !data.user) return null;
    const cid = claimsOf(jwt).client_id;
    return { id: data.user.id, clientId: typeof cid === "string" && cid ? cid : null };
  },
  async objectFor(owner, delivery) {
    const { data, error } = await service.rpc("delivery_object_for", { p_owner: owner, p_delivery: delivery });
    if (error) throw new Error(error.message);
    return data as string;
  },
  async sign(path, seconds) {
    const { data, error } = await service.storage.from("ryagram-artifacts").createSignedUrl(path, seconds);
    if (error || !data) throw new Error(error?.message ?? "no url");
    return data.signedUrl;
  },
}));
