// app-download: an invited person's 15-minute link to the desktop app, from a PRIVATE Cloudflare R2 bucket (NEXT-CONNECT 133). Deploy (a Ryan row; the JWT is checked inside):
//   npx.cmd supabase functions deploy app-download --project-ref <ref> --no-verify-jwt
// Secrets (Ryan sets each himself, never in chat or a file in a repo): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET. The access key is an R2 token with 'Object Read only' on that ONE bucket.
// Until all four are set the function answers 503 and writes nothing. proposals\CONNECT-R2-SETUP.md has the exact steps.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { verifyAppUser } from "../_shared/oauth_guard.ts";
import { presignGet } from "../_shared/r2_presign.ts";
import { guardedServe, resolveServiceKey } from "../_shared/service_key.ts";
import { handle, type Release } from "./core.ts";

const sk = resolveServiceKey();
const serve = guardedServe(sk);
const service = createClient(Deno.env.get("SUPABASE_URL")!, sk.forClient, { auth: { persistSession: false } });

const secret = (n: string) => Deno.env.get(n) ?? "";
const account = secret("R2_ACCOUNT_ID"), akid = secret("R2_ACCESS_KEY_ID"), bucket = secret("R2_BUCKET");

serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  configured: () => !!(account && akid && secret("R2_SECRET_ACCESS_KEY") && bucket),
  async verifyUser(jwt) {
    const u = await verifyAppUser(service.auth, jwt);
    return u ? { id: u.id, clientId: null } : null;
  },
  async request(owner) {
    const { data, error } = await service.rpc("request_app_download", { p_owner: owner });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as Release;
  },
  presign: (key, seconds, fileName) => presignGet({
    host: `${account}.r2.cloudflarestorage.com`, path: `/${bucket}/${key}`, accessKeyId: akid, secretAccessKey: secret("R2_SECRET_ACCESS_KEY"),
    expiresSeconds: seconds, now: new Date(), query: { "response-content-disposition": `attachment; filename="${fileName}"` },
  }),
}));
