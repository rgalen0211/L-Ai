// The r9 local end-to-end harness: runs the REAL `node` function code (router.ts, db.ts, storage.ts from the maker-r9-node worktree) under Deno, exactly as node/index.ts wires it,
// except for the one thing the Free-plan environment gives index.ts and a laptop does not: the npm 'postgres' driver (a download that needs a yes). In its place the SQL goes over a
// loopback bridge to a connection that is logged in AS the role node_runner, so the REAL r9 SQL runs with the REAL role's reach. LOCAL ONLY. Nothing here is deployed.
//   env: PORT, BRIDGE_URL, SUPABASE_URL (the local gateway that stands in for the project host), NODE_UPLOAD_KEY, NODE_APPROVAL_URL, NODE_SALT, FN_ROOT (the worktree's supabase/functions as a file URL)
const root = Deno.env.get("FN_ROOT")!;
const { handleNode } = await import(`${root}/node-core/router.ts`);
const { NodeSql } = await import(`${root}/node/db.ts`);
const { makeStorage } = await import(`${root}/node/storage.ts`);

const bridge = Deno.env.get("BRIDGE_URL")!;
const db = new NodeSql(async (text: string, params: unknown[]) => {
  const r = await fetch(bridge, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: text, params }) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error("db"), { code: j.code });
  return j as Record<string, unknown>[];
});
const storage = makeStorage(Deno.env.get("SUPABASE_URL")!, Deno.env.get("NODE_UPLOAD_KEY")!, "ryagram-artifacts");
const approvalBase = Deno.env.get("NODE_APPROVAL_URL")!, salt = Deno.env.get("NODE_SALT")!;

Deno.serve({ port: Number(Deno.env.get("PORT")), hostname: "127.0.0.1", onListen: () => console.log("LISTENING") }, async (req: Request) => {
  try {
    const m = /^.*?\/node(\/.*)?$/.exec(new URL(req.url).pathname);
    return await handleNode(req, m ? (m[1] ?? "/") : "/", { db, storage, approvalBase, salt, maxFileBytes: 200_000_000 });
  } catch {
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
