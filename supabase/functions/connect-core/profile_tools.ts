// ENGINE's five profile tools, offered to the user's own AI through the same registry and the same gate as every other connect tool.
// The rules, the presets and the wording are ENGINE's (supabase/functions/_shared/profile_tools.ts); this file only gives them their
// scopes, closes their argument schemas and connects them to the database as the signed-in person. Nothing here validates a profile.
import { PROFILE_TOOLS, runProfileTool, type ProfileData } from "../_shared/profile_tools.ts";
import { LIMITS, type ToolCtx, type ToolDef } from "./types.ts";

const SCOPE: Record<string, ToolDef["scope"]> = {
  get_profile_schema: "read", list_presets: "read", get_profile: "read", set_profile: "write", preview_profile: "render_free",
};
const READ_ONLY = new Set(["get_profile_schema", "list_presets", "get_profile"]);
const TITLE: Record<string, string> = {
  get_profile_schema: "Look profile rules", list_presets: "Starter looks", get_profile: "Read a look profile",
  set_profile: "Save a look profile", preview_profile: "Preview a look profile",
};

function profileData(ctx: ToolCtx): ProfileData {
  const p = ctx.data.profiles;
  if (!p) throw Object.assign(new Error("profiles are not available"), { code: "PT503" });
  return {
    listProfiles: () => p.list(),
    getProfile: (name) => p.get(name),
    saveProfile: (spec, makeDefault) => p.save(spec, makeDefault),
    submitSamplePreview: (story, periods) => p.preview(story, periods),
    // ENGINE's tool asks before it starts a sheet; this is the same hourly allowance every other sheet or preview from a connection spends.
    allowExecution: () => ctx.policy.hit(ctx.principal, "ladder", LIMITS.ladderPerHourPerUser, 3600),
  };
}

export const PROFILE_TOOL_DEFS: ToolDef[] = PROFILE_TOOLS.map((t) => ({
  name: t.name,
  title: TITLE[t.name] ?? t.name,
  description: t.description,
  scope: SCOPE[t.name],
  readOnly: READ_ONLY.has(t.name),
  // ENGINE's schema marks every field required (for strict tool use); an assistant may leave an optional one out, and the tool reads a missing one as null/false.
  inputSchema: { type: "object", properties: t.input_schema.properties, required: [], additionalProperties: false },
  async run(args, ctx) {
    const o = await runProfileTool(t.name, args, profileData(ctx));
    return { text: o.text, isError: o.isError, code: o.isError ? "refused" : "ok" };
  },
}));
