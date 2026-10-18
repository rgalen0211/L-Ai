// The real MCP TypeScript SDK client, against the real router, in the situation Supabase puts us in: only /functions/v1/connect/* reaches the
// function (a request for /.well-known/* at the host root gets a 404 here, as it does there). The client does what Claude and other spec-following
// clients do: probe the MCP URL, follow the WWW-Authenticate pointer, run the metadata discovery order for an issuer WITH A PATH, register
// itself, send the person to authorize, take the code back, exchange it, and call tools. The database is the in-memory stand-in; the SQL
// has its own tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Ajv2020 from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { FakeAuthStore } from '../supabase/functions/connect-core/fake_authstore.ts';
import { handleRequest } from '../supabase/functions/connect-core/router.ts';
import { sha256hex } from '../supabase/functions/connect-core/oauth.ts';

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const A = { tokenHash: 'x', userId: 'u-alice', clientId: 'client-claude' };

async function rig() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId);
  const as = new FakeAuthStore(w, A);
  as.allowed.add(CALLBACK);
  const seen = [];
  let base = '';
  const server = http.createServer(async (req, res) => {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
    const url = new URL(req.url, base);
    let r;
    if (!url.pathname.startsWith('/functions/v1/connect')) r = new Response('not found', { status: 404 });    // the host root: Supabase does not route it to us
    else {
      r = await handleRequest(new Request(url, { method: req.method, headers: req.headers, body }), {
        store: as.store(), consentUrl: `http://127.0.0.1:${server.address().port}/consent?request=`,
        mcp: { data: null, policy: w.policy(), deps: { compile: makeCompile(Ajv2020) },
               verifyToken: async (t) => w.verifyHashed(await sha256hex(t)), dataFor: (_t, p) => w.data(p.userId) } });
    }
    seen.push(`${req.method} ${url.pathname} ${r.status}`);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  return { w, as, seen, base, mcp: `${base}/functions/v1/connect/mcp`, close: () => new Promise((ok) => server.close(ok)) };
}

function provider() {
  const mem = { tokens: undefined, info: undefined, verifier: undefined, authUrl: undefined, state: 'state-' + Math.random().toString(36).slice(2) };
  return { mem,
    get redirectUrl() { return CALLBACK; },
    get clientMetadata() { return { client_name: 'Claude', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
    state: () => mem.state,
    clientInformation: () => mem.info, saveClientInformation: (i) => { mem.info = i; },
    tokens: () => mem.tokens, saveTokens: (t) => { mem.tokens = t; },
    redirectToAuthorization: (u) => { mem.authUrl = u; },
    saveCodeVerifier: (v) => { mem.verifier = v; }, codeVerifier: () => mem.verifier };
}

test('a spec-following MCP client discovers, registers, signs in, and calls tools, with only /functions/v1/connect reachable', async () => {
  const r = await rig();
  try {
    const p = provider();
    const t1 = new StreamableHTTPClientTransport(new URL(r.mcp), { authProvider: p });
    await assert.rejects(new Client({ name: 'sdk-test', version: '1' }).connect(t1), UnauthorizedError);
    assert.ok(p.mem.authUrl, 'the client was sent to authorize');
    // the order the client walked
    const log = r.seen.join('\n');
    assert.match(log, /POST \/functions\/v1\/connect\/mcp 401/);
    assert.match(log, /GET \/functions\/v1\/connect\/\.well-known\/oauth-protected-resource 200/);
    assert.match(log, /GET \/\.well-known\/oauth-authorization-server\/functions\/v1\/connect 404/);               // the standard place: not routed to us, as on Supabase
    assert.match(log, /GET \/functions\/v1\/connect\/\.well-known\/openid-configuration 200/);                        // the one that can reach us
    assert.match(log, /POST \/functions\/v1\/connect\/register 201/);
    // the person is sent to the consent page with a request id, decides, and the code comes back with the client's own state
    const az = await fetch(p.mem.authUrl, { redirect: 'manual' });
    assert.equal(az.status, 302);
    const consent = new URL(az.headers.get('location'));
    assert.equal(consent.pathname, '/consent');
    const back = new URL(await r.as.decide(consent.searchParams.get('request'), true));
    assert.equal(back.origin + back.pathname, CALLBACK);
    assert.equal(back.searchParams.get('state'), p.mem.state);
    await t1.finishAuth(back.searchParams.get('code'));
    assert.match(p.mem.tokens.access_token, /^rga_/); assert.ok(p.mem.tokens.refresh_token);
    // a fresh connection with the saved tokens
    const client = new Client({ name: 'sdk-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(r.mcp), { authProvider: p }));
    const tools = await client.listTools();
    assert.ok(tools.tools.some((x) => x.name === 'set_story'));
    assert.ok(tools.tools.every((x) => /^[a-z0-9_]+$/.test(x.name)));
    const who = await client.callTool({ name: 'whoami_and_credits', arguments: {} });
    assert.match(who.content[0].text, /Credits available: 100/);
    const made = await client.callTool({ name: 'create_project', arguments: { title: 'From the SDK' } });
    assert.equal(made.isError, false);
    const bad = await client.callTool({ name: 'create_project', arguments: { title: 'x', owner_id: 'someone' } });
    assert.equal(bad.isError, true);                                                                                     // an argument that skips nothing is still refused
    await client.close();
  } finally { await r.close(); }
});

test('a denied sign-in comes back as access_denied with the client\'s state, and issues nothing', async () => {
  const r = await rig();
  try {
    const p = provider();
    await assert.rejects(new Client({ name: 'sdk-test', version: '1' }).connect(new StreamableHTTPClientTransport(new URL(r.mcp), { authProvider: p })), UnauthorizedError);
    const az = await fetch(p.mem.authUrl, { redirect: 'manual' });
    const id = new URL(az.headers.get('location')).searchParams.get('request');
    const back = new URL(await r.as.decide(id, false));
    assert.equal(back.searchParams.get('error'), 'access_denied'); assert.equal(back.searchParams.get('state'), p.mem.state);
    assert.equal(r.as.codes.size, 0);
  } finally { await r.close(); }
});

test('a code cannot be used twice, and a bad token gets the OAuth challenge, not a server error', async () => {
  const r = await rig();
  try {
    const p = provider();
    const t = new StreamableHTTPClientTransport(new URL(r.mcp), { authProvider: p });
    await assert.rejects(new Client({ name: 'sdk-test', version: '1' }).connect(t), UnauthorizedError);
    const az = await fetch(p.mem.authUrl, { redirect: 'manual' });
    const back = new URL(await r.as.decide(new URL(az.headers.get('location')).searchParams.get('request'), true));
    const code = back.searchParams.get('code');
    await t.finishAuth(code);
    const again = await fetch(`${r.base}/functions/v1/connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: p.mem.info.client_id, redirect_uri: CALLBACK, code_verifier: p.mem.verifier }) });
    assert.equal(again.status, 400); assert.deepEqual(await again.json(), { error: 'invalid_grant' });
    const probe = await fetch(r.mcp, { method: 'POST', headers: { authorization: 'Bearer rga_wrong', 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
    assert.equal(probe.status, 401); assert.match(probe.headers.get('www-authenticate'), /resource_metadata=".*\/\.well-known\/oauth-protected-resource"/);
  } finally { await r.close(); }
});

test('every address the metadata advertises is a route that answers', async () => {
  const r = await rig();
  try {
    const base = `${r.base}/functions/v1/connect`;
    const oauth = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    const oidc = await (await fetch(`${base}/.well-known/openid-configuration`)).json();
    const res = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    assert.equal(oauth.issuer, base); assert.equal(oidc.issuer, base); assert.deepEqual(res.authorization_servers, [base]);
    for (const doc of [oauth, oidc]) {
      for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) assert.ok(doc[k].startsWith(base + '/'), k);
      assert.deepEqual(doc.code_challenge_methods_supported, ['S256']);
    }
    for (const u of [oidc.jwks_uri, res.resource]) {
      const x = await fetch(u, { method: u.endsWith('/mcp') ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: u.endsWith('/mcp') ? '{}' : undefined });
      assert.notEqual(x.status, 404, u);
    }
    assert.deepEqual(oidc.subject_types_supported, ['public']);
    const spec = await (await fetch(`${base}/openapi.json`)).json();
    const flow = spec.components.securitySchemes.ryagramOAuth.flows.authorizationCode;
    assert.equal(flow.authorizationUrl, oauth.authorization_endpoint); assert.equal(flow.tokenUrl, oauth.token_endpoint);
    assert.deepEqual(Object.keys(flow.scopes).sort(), ['read', 'render_free', 'write']);
    assert.equal((await fetch(`${base}/.well-known/mcp`)).status, 404);                                               // the second, stale resource document is gone
  } finally { await r.close(); }
});
