// Public film pages: visitors read without signing in, owners publish with their token.
//   npx supabase functions deploy film-page --project-ref <ref> --no-verify-jwt
// No secrets of its own: it uses the service role that Supabase gives every function, only for
// the film_* functions and to read the one receipt and sign the film's two links.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./page.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
                             { auth: { persistSession: false } });
const bucket = () => service.storage.from("ryagram-artifacts");

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  siteUrl: "https://uselai.com",
  async verifyUser(jwt) {
    const { data, error } = await service.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  publishContext: (owner, versionId) => rpc("film_publish_context", { p_owner: owner, p_version: versionId }),
  async readFile(path) {
    const { data, error } = await bucket().download(path);
    if (error || !data) throw new Error("receipt missing");
    return await data.text();
  },
  publish: (owner, versionId, title, summary) =>
    rpc("film_publish", { p_owner: owner, p_version: versionId, p_title: title, p_summary: summary }),
  publicFilm: (slug) => rpc("public_film", { p_slug: slug }),
  async signedUrl(path, seconds) {
    const { data, error } = await bucket().createSignedUrl(path, seconds);
    if (error || !data) throw new Error("could not sign");
    return data.signedUrl;
  },
}));
