// Creator beta applications from /ryagram/#creators. Visitors are not signed in, so deploy without JWT verification:
//   npx supabase functions deploy creator-beta --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
// Secret: CALLER_HASH_SECRET (any long random string; `npx supabase secrets set CALLER_HASH_SECRET=...`) keys the hash of the caller's address. If it is
// not set, the project's own service key is used instead, so there is never an unsalted hash. Otherwise it only calls creator_beta_apply.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./apply.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";

const sk = resolveServiceKey();            // FUNCTIONS_KEY_NAME picks a key by name; unset = SUPABASE_SERVICE_ROLE_KEY as before (supabase/functions/_shared/service_key.ts)
const serve = guardedServe(sk);

const service = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient, { auth: { persistSession: false } });

serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  hashSecret: Deno.env.get("CALLER_HASH_SECRET") ?? sk.key,
  async apply(a) {
    const { data, error } = await service.rpc("creator_beta_apply", {
      p_name: a.name, p_email: a.email, p_kind: a.kind, p_makes: a.makes, p_link: a.link, p_question: a.question, p_website: a.website, p_caller: a.caller });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as number;
  },
}));
