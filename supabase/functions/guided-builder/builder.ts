// guided-builder (WEB's front end for ENGINE's compileFilm): the guided "Make a film step by step" page asks this function three things, as a signed-in person:
//   { action: "catalog" }                       the datasets a person may be shown (listable AND usable on the installed worker), each with its source and licence
//   { action: "describe", dataset }             one dataset in full: measures, coverage, film types, known gaps, method changes, source and licence
//   { action: "compile", request }              the story for a film request (ENGINE's compileFilm), or EVERY reason it refused
// The rules are the engine's: catalog_rules.ts decides who may be listed (RULINGS 2026-10-17), film.ts compiles and checks the story against the worker's own schema.
// Nothing here chooses, hides or rounds anything. Tested in tests/guided-builder.test.mjs. App sessions only: index.ts verifies with the shared verifyAppUser guard, which refuses a connected AI's (OAuth) token before Supabase is even asked; a connected AI uses CONNECT's
// connect_* functions, which sit on the same film.ts.
import { CATALOG } from "../_shared/catalog_data.ts";
import { listableEntries } from "../_shared/catalog_rules.ts";
import { compileFilm, FILM_TYPES, FilmError } from "../_shared/film.ts";

type Json = any;

export interface Deps {
  allowedOrigins: string[];
  verifyUser(jwt: string): Promise<{ id: string } | null>;
}

const MAX_BODY = 40_000;     // a request carries at most a look (16 KB) and a few short fields

/** What a person is shown about a dataset: everything the page needs to choose, and the source and licence to read BEFORE committing. */
export function forPerson(e: Json): Json {
  return {
    id: e.id, title: e.title, topic: e.topic, publisher: e.publisher, url: e.url, source_line: e.source_line,
    licence: e.licence, licence_short: e.licence_short,
    geography: { label: e.geography.label, noun: e.geography.noun, kind: e.geography.kind },
    period: e.period, window: e.window,
    measures: e.measures.map((m: Json) => ({ id: m.id, label: m.label, unit: m.unit, selectable: m.story_measure !== null })),
    film_types: e.film_types, known_gaps: e.known_gaps, methodology_breaks: e.methodology_breaks, missing_is_ambiguous: e.missing_is_ambiguous === true,
    continuous_colour: e.style?.choropleth?.continuous === true,
  };
}

const listed = (catalog: Json[]) => listableEntries({ usableOnly: true }, catalog);

export function catalogFor(catalog: Json[] = CATALOG): Json[] {
  return listed(catalog).map((e) => ({
    id: e.id, title: e.title, topic: e.topic, publisher: e.publisher, url: e.url, licence_short: e.licence_short,
    geography: e.geography.label, period: e.period, film_types: e.film_types,
  })).sort((a, b) => a.topic.localeCompare(b.topic) || a.title.localeCompare(b.title));
}

export async function handle(req: Request, deps: Deps, catalog: Json[] = CATALOG): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = !!origin && deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
    : { "Vary": "Origin" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!allowed) return reply(403, { error: "Not allowed from this page." });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.verifyUser(jwt).catch(() => null) : null;
  if (!user) return reply(401, { error: "Sign in first." });

  let raw: string;
  try { raw = await req.text(); } catch { return reply(400, { error: "Bad request." }); }
  if (raw.length > MAX_BODY) return reply(413, { error: "That request is too large." });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "Bad request." }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Bad request." });

  if (body.action === "catalog") return reply(200, { datasets: catalogFor(catalog), film_types: FILM_TYPES });
  if (body.action === "describe") {
    const e = typeof body.dataset === "string" ? listed(catalog).find((x: Json) => x.id === body.dataset) : undefined;
    return e ? reply(200, { dataset: forPerson(e) }) : reply(404, { error: "That dataset is not available." });         // unlisted and unknown look the same
  }
  if (body.action === "compile") {
    try {
      const { story, report } = compileFilm(body.request, { catalog });                    // audience defaults to "person": only listable entries exist
      return reply(200, { story, report });
    } catch (err) {
      if (err instanceof FilmError) return reply(422, { errors: err.errors });
      console.error(`guided-builder compile: ${(err as Error).message}`);
      return reply(500, { error: "That film couldn't be checked just now. Try again in a minute." });
    }
  }
  return reply(400, { error: "Unknown action." });
}
