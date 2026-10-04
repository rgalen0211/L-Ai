// Prompt-first sourcing, path 1 (design: Ryagram-logs/proposals/WEB-PROMPT-FIRST-SOURCING.md, section 2).
// Deploy (the person's JWT is verified inside, so the platform check is off):
//   npx supabase functions deploy source-search --project-ref <ref> --no-verify-jwt
// Needs the secret ANTHROPIC_API_KEY (Dashboard -> Edge Functions -> Secrets; it exists only here, the browser
// never sees it), SQL 20261004000400 + the regenerated catalog_sources_seed.sql, and control.ai_enabled = true.
// service_role is used ONLY for the source_search_* / log_data_gap functions.
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./search.ts";
import type { CatalogRow } from "./match.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

// The catalog changes only when the seed is rerun: keep it for 5 minutes per instance (the cached prompt block depends on it).
let cached: { at: number; rows: CatalogRow[] } | null = null;

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  async verifyUser(jwt) {
    const { data, error } = await service.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  store: {
    reserve: (owner) => rpc("source_search_reserve", { p_owner: owner }),
    finish: (search, status, outcome, suggested, recommended, usage) =>
      rpc("source_search_finish", { p_search: search, p_status: status, p_outcome: outcome, p_suggested: suggested,
                                    p_recommended: recommended, p_usage: usage }),
    async catalog() {
      if (!cached || Date.now() - cached.at > 5 * 60_000) cached = { at: Date.now(), rows: await rpc("source_search_catalog") };
      return cached.rows;
    },
    logGap: (owner, search, text, need, reason, key, nearest) =>
      rpc("log_data_gap", { p_owner: owner, p_search: search, p_text: text, p_need: need, p_reason: reason, p_key: key, p_nearest: nearest }),
  },
  claude: claude as never,
}));
