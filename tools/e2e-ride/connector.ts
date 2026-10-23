// The connector step of the ride (NEXT-CONNECT 116), on the connector's OWN code with its in-memory stand-in world (the same one tools/connect_dev_server.mjs uses): an invited
// test person's AI connects (initialize), lists the tools it is given, and asks who it is. Prints ONE JSON line. No network, no database, no real account, no credential.
//   deno run --no-lock --allow-read=<repo> tools/e2e-ride/connector.ts
import { FakeWorld } from "../../supabase/functions/connect-core/fake.ts";
import { handleMcp } from "../../supabase/functions/connect-core/mcp.ts";

const BASE = "http://127.0.0.1:1";
const w = new FakeWorld();
const P = { userId: "u-ride", clientId: "ride-client" };
w.addUser(P.userId, "ride@example.test", 100);
w.invite(P.userId, P.clientId, ["read", "write", "render_free"]);
w.issue("ride-token", P);
const deps = {
  data: null, policy: w.policy(), deps: { compile: () => () => [] as string[] },
  verifyToken: w.verifyToken, dataFor: (_t: string, p: { userId: string }) => w.data(p.userId),
  resourceMetadataUrl: `${BASE}/.well-known/oauth-protected-resource`,
  // deno-lint-ignore no-explicit-any
} as any;

async function rpc(method: string, params: unknown, id: number) {
  const r = await handleMcp(new Request(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer ride-token" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }), deps);
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return { status: r.status, body: JSON.parse(line ? line.slice(5) : text) };
}

const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ride", version: "1" } }, 1);
const list = await rpc("tools/list", {}, 2);
const who = await rpc("tools/call", { name: "whoami_and_credits", arguments: {} }, 3);
const tools = (list.body.result?.tools ?? []).map((t: { name: string; description?: string }) => ({ name: t.name, description: String(t.description ?? "").slice(0, 400) }));
console.log(JSON.stringify({ init: init.status, server: init.body.result?.serverInfo?.name, tools, who: who.status, whoOk: !who.body.result?.isError && !who.body.error }));
