// The website address(es) the edge functions trust and build links from (CONNECT 2026-11-27, step 0 of proposals/DOMAIN-MOVE-PLAN-1127.md).
// TODAY nothing changes: with no setting, resolveSiteOrigins() is exactly ["https://uselai.com", "https://www.uselai.com"] and resolveSiteUrl() is "https://uselai.com", the values every function had written in its own index.ts.
// A later domain move needs NO code change and no redeploy of a different version, only two secrets and a redeploy of the same code:
//   SITE_URL            the address that builds links in emails and Checkout return pages (one https origin, no path); allowed as a page origin too, with its www twin
//   EXTRA_SITE_ORIGINS  more page origins to allow, comma separated (use it to allow the NEW domain BEFORE SITE_URL is switched: the both-domains-allowed rule)
// The two old origins are NEVER dropped here: removing the old domain is a code change on purpose (the plan's last step), so a bad secret can only ADD an origin, never lock the site out.
// An entry is used only if it is exactly https://<host> (letters, digits, dots, hyphens; no path, no port, no wildcard, no spaces); anything else is ignored and never echoed.
export const OLD_SITE_URL = "https://uselai.com";
const OLD_ORIGINS = ["https://uselai.com", "https://www.uselai.com"];
const ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export type Env = (key: string) => string | undefined;
export type Log = (line: string) => void;
const denoEnv: Env = (k) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k);

const clean = (v: string | undefined): string | null => {
  const s = (v ?? "").trim().toLowerCase().replace(/\/$/, "");
  return ORIGIN.test(s) ? s : null;
};

export function resolveSiteUrl(env: Env = denoEnv, log: Log = console.warn): string {
  const raw = env("SITE_URL");
  const ok = clean(raw);
  if (!ok && (raw ?? "").trim() !== "") log("SITE_URL ignored: not a bare https origin (https://host, no path, no port); the old address is used");
  return ok ?? OLD_SITE_URL;
}

export function resolveSiteOrigins(env: Env = denoEnv, log: Log = console.warn): string[] {
  const out = [...OLD_ORIGINS];
  const add = (o: string | null) => { if (o && !out.includes(o)) out.push(o); };
  const raw = env("SITE_URL");
  const site = clean(raw);
  if (!site && (raw ?? "").trim() !== "") log("SITE_URL ignored: not a bare https origin (https://host, no path, no port); the old address is used");
  if (site) { add(site); add(site.startsWith("https://www.") ? site.replace("https://www.", "https://") : site.replace("https://", "https://www.")); }
  let refused = false;
  for (const piece of (env("EXTRA_SITE_ORIGINS") ?? "").split(",")) {
    if (piece.trim() === "") continue;
    const o = clean(piece);
    if (o) add(o); else refused = true;
  }
  if (refused) log("EXTRA_SITE_ORIGINS: an entry was ignored (not a bare https origin: https://host, no path, no port)");
  return out;
}
