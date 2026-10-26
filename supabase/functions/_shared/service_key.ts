// WHICH SECRET KEY THE FUNCTIONS USE (Q213 follow-up, 2026-10-25; CC1 22:51).
//
// The platform hands every function the project's OLD 'default' secret key as SUPABASE_SERVICE_ROLE_KEY, and a second secret key made later is not
// handed over under that name (Ryan's hand test 22:48: the new key got 403). The platform also injects SUPABASE_SECRET_KEYS, a JSON dictionary of
// every secret key keyed by NAME. So a function that must move to another key has to pick it by name.
//
//   FUNCTIONS_KEY_NAME NOT set  -> SUPABASE_SERVICE_ROLE_KEY exactly as before: deploying this file changes nothing until Ryan sets the name.
//   FUNCTIONS_KEY_NAME set      -> the entry of that name in SUPABASE_SECRET_KEYS, and NOTHING ELSE. If the dictionary is missing, is not readable
//                                  JSON, or has no such entry, the function REFUSES with one plain 503 and never falls back to the old key (so the
//                                  hand test shows the mistake at once, before the old key is deleted).
//
// One chosen key serves everything a function does with the service key: its database client AND the bearer check (isService / whoCalls), so once
// the name points at the new key the OLD key is no longer accepted by any function. No value is ever logged; only the key's NAME.
//
// Use:  const sk = resolveServiceKey();  const serve = guardedServe(sk);  createClient(url, sk.forClient, ...)  serve((req) => ...)

export type EnvReader = (name: string) => string | undefined;

export interface ServiceKey {
  /** The real key, or "" when there is a problem. */
  key: string;
  /** The real key, or a placeholder when there is a problem (createClient refuses an empty key; a guarded function never uses the placeholder). */
  forClient: string;
  /** "" when all is well, otherwise a short reason for the log (names only, never a value). */
  problem: string;
}

const NAME_OK = /^[a-z0-9_]{1,64}$/;                  // Supabase refuses dashes in a key name: lowercase letters, digits, underscore
const PLACEHOLDER = "service-key-unavailable";
const denoEnv: EnvReader = (name) => Deno.env.get(name);

export function resolveServiceKey(env: EnvReader = denoEnv): ServiceKey {
  const bad = (problem: string): ServiceKey => ({ key: "", forClient: PLACEHOLDER, problem });
  const ok = (key: string): ServiceKey => ({ key, forClient: key, problem: "" });
  const name = (env("FUNCTIONS_KEY_NAME") ?? "").trim();
  if (!name) {
    const legacy = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    return legacy ? ok(legacy) : bad("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  if (!NAME_OK.test(name)) return bad("FUNCTIONS_KEY_NAME is not a valid key name (lowercase letters, digits and underscore only)");
  const raw = env("SUPABASE_SECRET_KEYS");
  if (!raw) return bad(`FUNCTIONS_KEY_NAME is "${name}" but SUPABASE_SECRET_KEYS is not set`);
  let dict: unknown;
  try { dict = JSON.parse(raw); } catch { return bad(`FUNCTIONS_KEY_NAME is "${name}" but SUPABASE_SECRET_KEYS is not readable JSON`); }
  if (dict === null || typeof dict !== "object" || Array.isArray(dict)) return bad(`FUNCTIONS_KEY_NAME is "${name}" but SUPABASE_SECRET_KEYS is not a dictionary`);
  const entry = Object.prototype.hasOwnProperty.call(dict, name) ? (dict as Record<string, unknown>)[name] : undefined;
  if (typeof entry !== "string" || entry.length === 0) return bad(`FUNCTIONS_KEY_NAME is "${name}" but SUPABASE_SECRET_KEYS holds no key of that name`);
  return ok(entry);
}

export const NOT_SET_UP = "This service cannot reach its database right now. Nothing was changed. Try again later.";

/** Replaces Deno.serve for a function: with a problem every request gets the same plain 503 (and the reason goes to the log, names only). */
export function guardedServe(sk: ServiceKey, serve: (handler: (req: Request) => Response | Promise<Response>) => unknown = (h) => Deno.serve(h)) {
  if (sk.problem) console.error(`service key: ${sk.problem}`);
  return (handler: (req: Request) => Response | Promise<Response>) =>
    serve(sk.problem
      ? () => new Response(JSON.stringify({ error: NOT_SET_UP }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } })
      : handler);
}
