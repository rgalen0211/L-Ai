// The two Storage calls the node function makes, with the one key it holds (NODE_UPLOAD_KEY). Kept out of index.ts so the same code can be run against a local stand-in for Storage.
import type { NodeStorage } from "../node-core/types.ts";

// Supabase's new keys (sb_secret_..., sb_publishable_...) are not JWTs and go on the apikey header ONLY; a legacy key (a JWT, starts "eyJ") is also sent as the Bearer token.
// Sending an sb_ key as a Bearer token is the documented thing not to do, and this call has never been run against real Storage (NEXT-CONNECT 128).
export function storageHeaders(uploadKey: string): Record<string, string> {
  const h: Record<string, string> = { apikey: uploadKey, "Content-Type": "application/json" };
  if (uploadKey.startsWith("eyJ")) h.Authorization = `Bearer ${uploadKey}`;
  return h;
}

export function makeStorage(projectUrl: string, uploadKey: string, BUCKET: string): NodeStorage {
  return {
    // Supabase Storage "create signed upload URL" for exactly this path. The key stays in this function.
    async signUpload(path: string): Promise<string> {
      const r = await fetch(`${projectUrl}/storage/v1/object/upload/sign/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST", headers: storageHeaders(uploadKey), body: "{}" });
      if (!r.ok) throw Object.assign(new Error("sign"), { code: "SIGN" });
      const j = await r.json() as { url?: string };
      if (!j.url) throw Object.assign(new Error("sign"), { code: "SIGN" });
      return `${projectUrl}/storage/v1${j.url}`;
    },
  };
}
