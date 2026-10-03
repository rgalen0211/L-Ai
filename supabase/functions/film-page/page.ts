// Public film pages. Two callers:
//   GET  ?s=<slug>                       anyone: the page's data, with short-lived signed links
//   POST { version_id, title? } + JWT    the owner: publish (or refresh) the page, get its slug
// Unpublishing is the film_unpublish RPC, straight from the app. Tested in tests/film-page.test.mjs.
import { summarize } from "./summary.ts";

export interface Deps {
  allowedOrigins: string[];
  siteUrl: string;
  verifyUser(jwt: string): Promise<{ id: string } | null>;
  publishContext(owner: string, versionId: string): Promise<{ project_title: string; story: unknown; uploaded_data: boolean;
                                                              receipt_path: string; slug: string | null }>;
  readFile(path: string): Promise<string>;
  publish(owner: string, versionId: string, title: string, summary: unknown): Promise<string>;
  publicFilm(slug: string): Promise<{ title: string; summary: unknown; published_at: string;
                                      video_path: string | null; thumb_path: string | null } | null>;
  signedUrl(path: string, seconds: number): Promise<string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[A-Za-z0-9_-]{22}$/;
const LINK_SECONDS = 3600;

const statusOf = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? "";
  return /^PT\d{3}$/.test(code) ? Number(code.slice(2)) : code === "42501" ? 403 : null;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", ...extra } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (req.method === "GET") {
    const slug = new URL(req.url).searchParams.get("s") ?? "";
    if (!SLUG.test(slug)) return reply(404, { error: "No film here." });
    const film = await deps.publicFilm(slug).catch(() => null);
    if (!film) return reply(404, { error: "No film here. It may have been unpublished." }, { "Cache-Control": "no-store" });
    const [video, poster] = await Promise.all([
      film.video_path ? deps.signedUrl(film.video_path, LINK_SECONDS).catch(() => null) : null,
      film.thumb_path ? deps.signedUrl(film.thumb_path, LINK_SECONDS).catch(() => null) : null]);
    // Cached briefly, well inside the links' hour, so an unpublish takes effect within minutes.
    return reply(200, { title: film.title, summary: film.summary, published_at: film.published_at,
                        video_url: video, poster_url: poster }, { "Cache-Control": "public, max-age=300" });
  }

  if (req.method !== "POST") return reply(405, { error: "Use GET or POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.verifyUser(jwt).catch(() => null) : null;
  if (!user) return reply(401, { error: "Sign in first." });

  let body: { version_id?: unknown; title?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  const versionId = String(body.version_id ?? "");
  if (!UUID.test(versionId)) return reply(400, { error: "Bad version." });
  const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";

  try {
    const ctx = await deps.publishContext(user.id, versionId);
    let receipt: unknown;
    try { receipt = JSON.parse(await deps.readFile(ctx.receipt_path)); }
    catch { return reply(409, { error: "This film's receipt couldn't be read, so its sources can't be shown." }); }
    const summary = summarize(receipt, ctx.story, { uploaded: ctx.uploaded_data });
    const slug = await deps.publish(user.id, versionId, title || summary.headline || ctx.project_title, summary);
    return reply(200, { slug, url: `${deps.siteUrl}/film/?s=${slug}` });
  } catch (e) {
    const status = statusOf(e);
    if (status) return reply(status, { error: (e as Error).message });
    console.error(`film-page: ${(e as Error).message}`);
    return reply(500, { error: "Couldn't publish just now. Try again in a minute." });
  }
}
