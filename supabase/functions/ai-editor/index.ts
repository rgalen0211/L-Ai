// Ryagram AI editor (2A-8/9). Deploy (JWT is verified inside, so the platform check is off):
//   npx supabase functions deploy ai-editor --project-ref <ref> --no-verify-jwt
// Needs the secret ANTHROPIC_API_KEY (Dashboard -> Edge Functions -> Secrets), and
// control.ai_enabled = true. The key exists only here; the browser never sees it.
//
// Two database clients:
//   * service: service_role, used ONLY for the ai_* functions (sessions, caps, usage).
//   * per request: the PERSON'S token, used for every tool, so RLS applies as in the app.
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { handle } from "./editor.ts";
import type { UserData } from "./tools.ts";

const url = Deno.env.get("SUPABASE_URL")!;
// The public key requests are made with (the person's JWT is what grants access). Supabase
// provides SUPABASE_ANON_KEY to functions; RYAGRAM_PUBLISHABLE_KEY is the fallback secret.
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("RYAGRAM_PUBLISHABLE_KEY") ?? "";
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

function userData(jwt: string): UserData {
  const db = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const run = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    async getVersion(id) {
      const version = await run(db.from("versions").select("id, project_id, number, state, story_spec, story_sha256").eq("id", id).single());
      const [project, jobs] = await Promise.all([
        run(db.from("projects").select("id, title").eq("id", version.project_id).single()),
        run(db.from("jobs").select("id, job_type, state, attempt, created_at, story_sha256, engine_commit, error_class, error_code, error_detail")
              .eq("version_id", id).order("created_at", { ascending: false })),
      ]);
      return { version, project, jobs } as never;
    },
    listVersions: (projectId) =>
      run(db.from("versions").select("id, number, state, created_at").eq("project_id", projectId).order("number")) as never,
    saveStory: (id, story) => run(db.from("versions").update({ story_spec: story }).eq("id", id).select("story_sha256").single()) as never,
    createVersion: (projectId, fromId) => run(db.rpc("create_version", { p_project_id: projectId, p_from_version_id: fromId })) as never,
    submitJob: (id, jobType, params) => run(db.rpc("submit_job", { p_version_id: id, p_job_type: jobType, p_params: params })) as never,
    async currentEngine() {
      const { data, error } = await db.rpc("current_engine_commit");
      return error ? null : (data as string | null);
    },
    async readReceipt(versionId, jobId) {
      let q = db.from("artifacts").select("storage_path, job_id").eq("version_id", versionId).eq("kind", "receipt")
        .order("created_at", { ascending: false }).limit(1);
      if (jobId) q = q.eq("job_id", jobId);
      const rows = await run(q) as { storage_path: string }[];
      if (!rows.length) return null;
      const { data } = await db.storage.from("ryagram-artifacts").download(rows[0].storage_path);
      return data ? (await data.text()) : null;
    },
  };
}

Deno.serve((req) => handle(req, {
  allowedOrigins: ["https://uselai.com", "https://www.uselai.com"],
  async verifyUser(jwt) {
    const { data, error } = await service.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  store: {
    sessionFor: (owner, versionId) => rpc("ai_session_for", { p_owner: owner, p_version: versionId }),
    reserveTurn: (owner, sessionId) => rpc("ai_reserve_turn", { p_owner: owner, p_session: sessionId }),
    turnContext: (turnId) => rpc("ai_turn_context", { p_turn: turnId, p_limit: 12 }),
    allowExecution: (turnId) => rpc("ai_allow_execution", { p_turn: turnId }),
    recordUsage: (turnId, usage) => rpc("ai_record_usage", { p_turn: turnId, p_usage: usage }),
    addRuling: (turnId, text) => rpc("ai_add_ruling", { p_turn: turnId, p_text: text }),
    finishTurn: (turnId, status, escalated, toolCalls, userText, replyText, summary) =>
      rpc("ai_finish_turn", { p_turn: turnId, p_status: status, p_escalated: escalated, p_tool_calls: toolCalls,
                              p_user_text: userText, p_reply_text: replyText, p_summary: summary }),
  },
  userData,
  claude: claude as never,
}));
