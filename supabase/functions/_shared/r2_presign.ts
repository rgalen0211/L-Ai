// A SigV4 PRESIGNED GET URL (NEXT-CONNECT 133, re-aimed at Cloudflare R2). Standard Web APIs only (crypto.subtle), no library. Cloudflare R2 speaks the S3 API: region "auto", service "s3", endpoint
// https://<account id>.r2.cloudflarestorage.com/<bucket>/<key> (path style). The same function signs AWS's own documented example (host/path/region are parameters), which is how it is checked:
// tests/r2-presign.test.mjs reproduces AWS's published presigned-URL test vector byte for byte.
//
// What it does NOT do: it holds no secret between calls, logs nothing, and never returns the secret access key; the caller passes the three values in (from function secrets) and gets one URL.

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** RFC 3986 percent-encoding as SigV4 wants it (everything except A-Z a-z 0-9 - _ . ~). */
export function uriEncode(s: string, keepSlash = false): string {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (keepSlash && ch === "/")) out += ch;
    else for (const b of enc.encode(ch)) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export interface PresignInput {
  host: string;                      // e.g. "<account>.r2.cloudflarestorage.com"
  path: string;                      // the URI path, e.g. "/<bucket>/<key>"  (already the real path; it is encoded here)
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;                   // "auto" for R2
  service?: string;                  // "s3"
  expiresSeconds: number;            // 1 .. 604800
  now: Date;
  query?: Record<string, string>;    // extra signed query parameters, e.g. response-content-disposition
}

export async function presignGet(i: PresignInput): Promise<string> {
  const region = i.region ?? "auto", service = i.service ?? "s3";
  if (!Number.isInteger(i.expiresSeconds) || i.expiresSeconds < 1 || i.expiresSeconds > 604800) throw new Error("expiry out of range");
  if (!/^[A-Za-z0-9.-]+$/.test(i.host) || !i.path.startsWith("/") || i.path.includes("..")) throw new Error("bad host or path");
  const amzDate = i.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");       // 20130524T000000Z
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${i.accessKeyId}/${scope}`, "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(i.expiresSeconds), "X-Amz-SignedHeaders": "host", ...(i.query ?? {}),
  };
  const canonicalQuery = Object.keys(q).sort().map((k) => `${uriEncode(k)}=${uriEncode(q[k])}`).join("&");
  const canonicalPath = uriEncode(i.path, true);
  const canonicalRequest = ["GET", canonicalPath, canonicalQuery, `host:${i.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const hashed = hex(await crypto.subtle.digest("SHA-256", enc.encode(canonicalRequest)));
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hashed].join("\n");
  let k: ArrayBuffer = await hmac(enc.encode("AWS4" + i.secretAccessKey), day);
  k = await hmac(k, region); k = await hmac(k, service); k = await hmac(k, "aws4_request");
  const signature = hex(await hmac(k, stringToSign));
  return `https://${i.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
