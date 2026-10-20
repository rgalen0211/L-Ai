// A STANDALONE draw-and-return probe server for hosts to be tested against WITHOUT touching the live connector or any database.
// In memory only. Listens on 127.0.0.1. It is reachable by a host only if a person deliberately opens a tunnel to it (see
// proposals\CONNECT-DRAW-RETURN-TEST.md); this program never opens one and never makes an outbound call.
//
//   deno run -A tools/draw-return-server.ts --port 8799 --results D:\path\results.jsonl
//
// The address a host connects to is  http://127.0.0.1:<port>/p/<secret>/mcp  where <secret> is made fresh at every start and printed
// to the console only (never written to a file). Nothing but the secret path answers; anything else is 404.
// Each finished test and each host handshake is appended to --results as one JSON line WITHOUT the picture bytes.
import { FakeWorld } from "../supabase/functions/connect-core/fake.ts";
import { handleMcp } from "../supabase/functions/connect-core/mcp.ts";
import { makeCompile } from "../supabase/functions/connect-core/ajv_adapter.ts";
import { enableDrawTest } from "../supabase/functions/connect-core/drawtest.ts";
import Ajv2020 from "npm:ajv@8.17.1/dist/2020.js";

const arg = (k: string, d: string) => { const i = Deno.args.indexOf(k); return i >= 0 && Deno.args[i + 1] ? Deno.args[i + 1] : d; };
const port = Number(arg("--port", "8799"));
const resultsFile = arg("--results", "draw-return-results.jsonl");
const b = new Uint8Array(16); crypto.getRandomValues(b);
const secret = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

enableDrawTest();
const world = new FakeWorld();
const P = { tokenHash: "h-probe", userId: "u-probe", clientId: "probe-client" };
world.addUser(P.userId, "probe@example.test", 0);
world.invite(P.userId, P.clientId, ["read", "write"]);          // no render scopes: this server cannot start anything else
world.issue("probe", P);
const compile = makeCompile(Ajv2020);
const deps = { data: world.data(P.userId), policy: world.policy(), deps: { compile }, verifyToken: world.verifyToken,
  dataFor: (_t: string, p: { userId?: string }) => world.data(p.userId!), resourceMetadataUrl: "http://127.0.0.1/none" };

let nResults = 0, nShake = 0;
async function flush() {
  while (nShake < world.handshakes.length) {
    const h = world.handshakes[nShake++];
    await Deno.writeTextFile(resultsFile, JSON.stringify({ kind: "handshake", ...h, userId: undefined }) + "\n", { append: true });
    console.log(`HANDSHAKE ${h.clientName} ${h.clientVersion}: sampling=${h.sampling} elicitation=${h.elicitation} roots=${h.roots} capabilities=[${h.capabilityKeys.join(",")}]`);
  }
  while (nResults < world.drawResults.length) {
    const { image: _i, userId: _u, ...r } = world.drawResults[nResults++];
    await Deno.writeTextFile(resultsFile, JSON.stringify({ kind: "result", ...r, at_iso: new Date(r.at).toISOString() }) + "\n", { append: true });
    console.log(`${r.outcome.toUpperCase()} ${r.mode}${r.tier ? " " + r.tier : ""} ${r.kind} ${r.bytes}B host="${r.claimedHost}" model="${r.claimedModel}" made=${r.howMade} :: ${r.reason}`);
  }
}

Deno.serve({ hostname: "127.0.0.1", port, onListen: () => {
  console.log(`Draw-and-return probe listening. Connector address (keep it private):\n  http://127.0.0.1:${port}/p/${secret}/mcp\nResults file: ${resultsFile}`);
} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname !== `/p/${secret}/mcp`) return new Response("Not found", { status: 404 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  const headers = new Headers(req.headers); headers.set("authorization", "Bearer probe");     // the secret path IS the authentication
  const res = await handleMcp(new Request(req.url, { method: req.method, headers, body: req.method === "POST" ? await req.arrayBuffer() : undefined }), deps);
  await flush();
  return res;
});
