// A local server for the connect tools on the in-memory stand-in (no database, no network, no real account).
// For the MCP Inspector and curl:   node tools/connect_dev_server.mjs   then   http://127.0.0.1:8787/mcp
// The bearer token is the fixed test string "dev-token". It is NOT a Ryagram credential and opens nothing real.
import http from 'node:http';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp, protectedResourceMetadata } from '../supabase/functions/connect-core/mcp.ts';
import { handleRest } from '../supabase/functions/connect-core/rest.ts';

const PORT = Number(process.env.PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const w = new FakeWorld();
const P = { userId: 'u-dev', clientId: 'dev-client' };
w.addUser(P.userId, 'dev@example.test', 100);
w.invite(P.userId, P.clientId, ['read', 'write', 'render_free', 'render_final']);
w.issue('dev-token', P);
w.finals = process.env.FINALS === '1';
const deps = {
  data: null, policy: w.policy(), deps: { compile: makeCompile(Ajv2020) },
  verifyToken: w.verifyToken, dataFor: (_t, p) => w.data(p.userId),
  resourceMetadataUrl: `${BASE}/.well-known/oauth-protected-resource`,
};

http.createServer(async (req, res) => {
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  const request = new Request(BASE + req.url, { method: req.method, headers: req.headers, body });
  const path = new URL(request.url).pathname;
  let r;
  if (path === '/mcp') r = await handleMcp(request, deps);
  else if (path === '/.well-known/oauth-protected-resource') r = Response.json(protectedResourceMetadata(`${BASE}/mcp`, 'https://example.invalid/auth/v1'));
  else r = await handleRest(request, path, deps, BASE, 'https://example.invalid/auth/v1');
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log(`connect dev server on ${BASE}/mcp (token: dev-token)`));
