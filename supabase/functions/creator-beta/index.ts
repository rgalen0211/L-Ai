// Creator beta applications from /ryagram/#creators. Visitors are not signed in, so deploy without JWT verification:
//   npx supabase functions deploy creator-beta --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
// No secrets of its own: it uses the service role Supabase gives every function, only to call creator_beta_apply.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./apply.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  async apply(a) {
    const { data, error } = await service.rpc("creator_beta_apply", {
      p_name: a.name, p_email: a.email, p_kind: a.kind, p_makes: a.makes, p_link: a.link, p_question: a.question, p_website: a.website, p_caller: a.caller });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as number;
  },
}));
