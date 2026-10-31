// The one gate every tool call passes, from either face. Order matters and is tested:
//   unknown tool -> invited + consented? -> scope -> rate limits -> argument check -> run -> log.
// Nothing here knows which assistant is calling.
import { friendlyError, TOOL_BY_NAME } from "./tools.ts";
import { LIMITS, type CallLog, type Data, type Deps, type Policy, type Principal, type ToolResult } from "./types.ts";

export interface Env { data: Data; policy: Policy; deps: Deps }

const NO_GRANT = "This Ryagram account is not enabled for AI connections (it is invite-only for now), or the connection was revoked. The person can ask Ryan for an invite or reconnect.";

export async function callTool(name: string, rawArgs: unknown, principal: Principal, env: Env): Promise<ToolResult> {
  const { policy, data, deps } = env;
  const tool = TOOL_BY_NAME.get(name);
  const finish = async (r: ToolResult, result: CallLog["result"], code: string): Promise<ToolResult> => {
    try {
      await policy.log(principal, { tool: tool ? name : "unknown",
        credits: r.credits ?? 0, result, code, failedChecks: r.failedChecks ?? 0 });
    } catch { /* a failed log write never changes what the person sees */ }
    return r;
  };
  const refused = (text: string, code: string) => finish({ text, isError: true, code }, "refused", code);
  // a limit says how long to wait and which limit it was, as data as well as words (NEXT-CONNECT 169)
  const limited = (text: string, which: string, limit: number, windowSeconds: number) =>
    finish({ text, isError: true, code: "rate", data: { ok: false, code: "rate", limit: which, max: limit, window_seconds: windowSeconds, retry_after_seconds: windowSeconds, started: false } }, "refused", "rate");

  if (!tool) return refused(`There is no tool called "${String(name).slice(0, 60)}".`, "unknown_tool");

  let grant;
  try { grant = await policy.grantFor(principal); } catch { return finish({ text: friendlyError(null), isError: true, code: "error" }, "error", "grant_lookup"); }
  if (!grant) return refused(NO_GRANT, "no_grant");
  if (!grant.scopes.includes(tool.scope)) {
    return refused(`This connection was not allowed to do that (${tool.scope.replace("_", " ")}). The person can change what this connection may do in Ryagram.`, "scope");
  }

  try {
    if (!(await policy.hit(principal, "calls", LIMITS.callsPerMinutePerClient, 60))) {
      return limited(`Too many calls from this connection in the last minute (the limit is ${LIMITS.callsPerMinutePerClient}). Wait a minute and continue.`, "connection_calls", LIMITS.callsPerMinutePerClient, 60);
    }
    if (!(await policy.hit(principal, "calls_acct", LIMITS.callsPerMinutePerAccount, 60))) {
      return limited(`Too many calls on this Ryagram account in the last minute, counting every connected AI together (the limit is ${LIMITS.callsPerMinutePerAccount}). Wait a minute and continue.`, "account_calls", LIMITS.callsPerMinutePerAccount, 60);
    }
    if (tool.ladder && !(await policy.hit(principal, "ladder", LIMITS.ladderPerHourPerUser, 3600))) {
      return limited(`The hourly limit for starting sheets and previews from a connection is reached (${LIMITS.ladderPerHourPerUser} an hour). The person can still start them in the Ryagram app.`, "hourly_jobs", LIMITS.ladderPerHourPerUser, 3600);
    }
  } catch { return finish({ text: friendlyError(null), isError: true, code: "error" }, "error", "limit_lookup"); }

  const args = rawArgs == null ? {} : rawArgs;
  if (typeof args !== "object" || Array.isArray(args)) return refused("The arguments must be a JSON object.", "args");
  const problems = deps.compile(tool.inputSchema)(args);
  if (problems.length) return refused(`The call was not understood: ${problems.slice(0, 8).join(" ")}`, "args");

  try {
    const r = await tool.run(args as Record<string, unknown>, { principal, data, policy, deps });
    return finish(r, r.isError || r.refused ? "refused" : "ok", r.code ?? "ok");
  } catch (e) {
    return finish({ text: friendlyError(e), isError: true, code: "error" }, "error", "tool_error");
  }
}
