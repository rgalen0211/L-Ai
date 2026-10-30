// app-link: the invite email's link to the desktop app, good ONCE, from a PRIVATE Cloudflare R2 bucket (NEXT-CONNECT 162). NOT DEPLOYED. Deploy after review and after the migration
// 20261030000100_invite_app_links.sql is applied (a Ryan row; there is no login to check: the link IS the credential, and the database decides):
//   npx.cmd supabase functions deploy app-link --project-ref <ref> --no-verify-jwt
// Secrets: the same four as app-download (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) and APP_LINK_ON=1 to switch it on. Until APP_LINK_ON=1 it answers 404.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
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
  enabled: () => secret("APP_LINK_ON") === "1",
  configured: () => !!(account && akid && secret("R2_SECRET_ACCESS_KEY") && bucket),
  async sha256Hex(text) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  },
  async peek(tokenHash) {
    const { data, error } = await service.rpc("peek_invite_app_link", { p_token_hash: tokenHash });
    if (error) throw new Error(error.code ?? "error");
    return data as { ok: boolean; file_name?: string; size_bytes?: number };
  },
  async redeem(tokenHash) {
    const { data, error } = await service.rpc("redeem_invite_app_link", { p_token_hash: tokenHash });
    if (error) throw Object.assign(new Error(error.code ?? "error"), { code: error.code });
    return data as Release;
  },
  presign: (key, seconds, fileName) => presignGet({
    host: `${account}.r2.cloudflarestorage.com`, path: `/${bucket}/${key}`, accessKeyId: akid, secretAccessKey: secret("R2_SECRET_ACCESS_KEY"),
    expiresSeconds: seconds, now: new Date(), query: { "response-content-disposition": `attachment; filename="${fileName}"` },
  }),
}));
