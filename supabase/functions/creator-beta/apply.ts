// Creator beta applications: the one writer of public.creator_applications. A visitor posts the form; this function (service role) calls the
// database function, which validates, de-duplicates, rate-limits and raises Ryan's alert. Tested in tests/creator-beta.test.mjs.
//   POST { name, email, kind, makes, link, question, website? }   from uselai.com only
export interface Deps {
  allowedOrigins: string[];
  apply(a: { name: string; email: string; kind: string; makes: string; link: string; question: string; website: string }): Promise<number>;
}

const MAX_BODY = 8000;
const FIELDS = ["name", "email", "kind", "makes", "link", "question"] as const;

const statusOf = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? "";
  return /^PT\d{3}$/.test(code) ? Number(code.slice(2)) : null;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin", "Access-Control-Allow-Headers": "content-type, apikey, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });

  let raw: string;
  try { raw = await req.text(); } catch { return reply(400, { error: "Bad request." }); }
  if (raw.length > MAX_BODY) return reply(413, { error: "That is too long." });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "Bad request." }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Bad request." });

  const a: Record<string, string> = {};
  for (const f of FIELDS) {
    if (typeof body[f] !== "string") return reply(422, { error: "Please fill in every field." });
    a[f] = (body[f] as string).trim().slice(0, 1200);
  }
  const website = typeof body.website === "string" ? body.website : "";
  try {
    await deps.apply({ name: a.name, email: a.email, kind: a.kind, makes: a.makes, link: a.link, question: a.question, website });
    return reply(200, { ok: true });
  } catch (e) {
    const status = statusOf(e);
    if (status === 422 || status === 429) return reply(status, { error: (e as Error).message });
    console.error(`creator-beta: ${(e as Error).message}`);
    return reply(500, { error: "Couldn't send that just now. Please try again in a minute." });
  }
}
