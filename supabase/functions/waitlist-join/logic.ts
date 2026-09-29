// The waitlist Edge Function's rules, with no imports so the Node tests can run them.
// index.ts supplies the real Cloudflare check and the database call.

export interface Deps {
  allowedOrigins: string[];     // browsers may call only from these pages
  allowedHostnames: string[];   // Turnstile must have been solved on these hosts
  verify: (token: string, remoteIp: string | null) => Promise<{ success: boolean; hostname?: string; action?: string }>;
  join: (email: string, useCase: string | null) => Promise<void>;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cors(origin: string | null, allowed: string[]): Record<string, string> {
  return origin && allowed.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin",
        "Access-Control-Allow-Headers": "content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const headers = cors(origin, deps.allowedOrigins);
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "method" });
  if (!origin || !deps.allowedOrigins.includes(origin)) return reply(403, { error: "origin" });

  let body: { email?: unknown; use_case?: unknown; token?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "json" }); }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const useCase = typeof body.use_case === "string" && body.use_case.trim() ? body.use_case.trim() : null;
  const token = typeof body.token === "string" ? body.token : "";
  if (!EMAIL.test(email) || email.length > 254) return reply(400, { error: "email" });
  if (useCase && useCase.length > 2000) return reply(400, { error: "use_case" });
  if (!token || token.length > 2048) return reply(400, { error: "check" });

  // Cloudflare decides whether a person solved the check, on our page, for this form.
  const remoteIp = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  let result;
  try { result = await deps.verify(token, remoteIp); } catch { return reply(502, { error: "verify" }); }
  if (!result.success || !result.hostname || !deps.allowedHostnames.includes(result.hostname)
      || result.action !== "waitlist") {
    return reply(400, { error: "check" });
  }

  try { await deps.join(email, useCase); } catch { return reply(500, { error: "save" }); }
  // Same answer for a new address and one already listed, so the form can't reveal who signed up.
  return reply(200, { ok: true });
}
