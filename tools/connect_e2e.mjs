// Pre-flight against the DEPLOYED connect function on the NON-LIVE project, before a person tries Claude: the real MCP TypeScript SDK client does
// what Claude does (discover, register, send the person to authorize), the consent step is done the way the consent page does it (signed in as the
// fresh test account, through the project's REST API), then it exchanges the code and calls every tool.
//   node tools/connect_e2e.mjs
// Reads D:\Ryagram-scratch\oauth-proof\.env (URL + publishable key) and connect-test-account.json. Prints results only; no token, code or password.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';

const env = {};
for (const line of fs.readFileSync('D:/Ryagram-scratch/oauth-proof/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (/jxtkfishqfxuptwjzczz/.test(env.SUPABASE_URL)) { console.error('REFUSED: live project'); process.exit(3); }
const acct = JSON.parse(fs.readFileSync('D:/Ryagram-scratch/oauth-proof/connect-test-account.json', 'utf8'));
const BASE = process.env.CONNECT_BASE ?? (env.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/connect');
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `  [${extra}]`)); if (!ok) failed++; };

const mem = { tokens: undefined, info: undefined, verifier: undefined, authUrl: undefined, state: 'st-' + Math.random().toString(36).slice(2) };
const provider = {
  get redirectUrl() { return CALLBACK; },
  get clientMetadata() { return { client_name: 'MCP SDK pre-flight', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
  state: () => mem.state,
  clientInformation: () => mem.info, saveClientInformation: (i) => { mem.info = i; },
  tokens: () => mem.tokens, saveTokens: (t) => { mem.tokens = t; },
  redirectToAuthorization: (u) => { mem.authUrl = u; },
  saveCodeVerifier: (v) => { mem.verifier = v; }, codeVerifier: () => mem.verifier,
};

// 0. what an unauthenticated probe sees, and the discovery documents
const probe = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
check('an unauthenticated call gets 401 with the resource_metadata pointer', probe.status === 401 && /resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource"/.test(probe.headers.get('www-authenticate') ?? ''), `${probe.status} ${probe.headers.get('www-authenticate')}`);
const oidc = await fetch(BASE + '/.well-known/openid-configuration');
check('the OpenID-shaped metadata is served under the function (the only discovery URL that reaches it)', oidc.status === 200, String(oidc.status));
const root = await fetch(new URL('/.well-known/oauth-authorization-server/functions/v1/connect', BASE));
console.log(`INFO  the standard root discovery URL answers ${root.status} (Supabase does not route it to a function; clients fall through to the one above)`);
const meta = oidc.status === 200 ? await oidc.json() : {};
check('the issuer is the function address, S256 only, public clients only',
  meta.issuer === BASE && JSON.stringify(meta.code_challenge_methods_supported) === '["S256"]' && JSON.stringify(meta.token_endpoint_auth_methods_supported) === '["none"]', JSON.stringify(meta).slice(0, 120));

// 1. the SDK client walks discovery, registers, and is sent to authorize
const t1 = new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { authProvider: provider });
let unauthorized = false;
try { await new Client({ name: 'preflight', version: '1' }).connect(t1); } catch (e) { unauthorized = e instanceof UnauthorizedError; if (!unauthorized) console.log('INFO  connect error:', String(e.message).slice(0, 160)); }
check('the SDK client discovered the server, registered itself and was sent to authorize', unauthorized && !!mem.authUrl && !!mem.info?.client_id);
if (!mem.authUrl) process.exit(1);

// 2. authorize -> consent page address with a request id
const az = await fetch(mem.authUrl, { redirect: 'manual' });
const loc = az.headers.get('location') ?? '';
const requestId = new URL(loc, BASE).searchParams.get('request');
check('/authorize redirects to the consent page with a request id', az.status === 302 && /^[0-9a-f-]{36}$/.test(requestId ?? ''), `${az.status} ${loc.slice(0, 80)}`);

// 3. the person decides, exactly as the consent page does it
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const si = await sb.auth.signInWithPassword({ email: acct.email, password: acct.password });
check('the test account signs in', !si.error);
const chk = await sb.rpc('connect_consent_check', { p_request: requestId });
check('consent check: allowed, host and label shown, no credit scopes', chk.data?.allowed === true && chk.data.redirect_host === 'claude.ai' && chk.data.redirect_label === 'Claude' && chk.data.credit_scopes.length === 0, JSON.stringify(chk.error ?? chk.data).slice(0, 160));
const dec = await sb.rpc('connect_consent_decide', { p_request: requestId, p_approve: true, p_scopes: chk.data.offered_scopes });
const back = new URL(dec.data?.redirect_to ?? 'http://invalid/');
check('consent decide returns the code and the client\'s own state', (dec.data?.redirect_to ?? '').startsWith(CALLBACK + '?code=') && back.searchParams.get('state') === mem.state);

// 4. the SDK finishes sign-in and uses the tools
await t1.finishAuth(back.searchParams.get('code'));
check('the code was exchanged for tokens', /^rga_/.test(mem.tokens?.access_token ?? '') && !!mem.tokens?.refresh_token);
const client = new Client({ name: 'preflight', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { authProvider: provider }));
const tools = (await client.listTools()).tools;
check('ten tools are offered, all with safe names and honest read-only hints', tools.length === 10 && tools.every((t) => /^[a-z0-9_]+$/.test(t.name)) && tools.find((t) => t.name === 'list_projects').annotations.readOnlyHint === true, String(tools.length));
const text = (r) => r.content?.[0]?.text ?? '';
const call = async (name, args) => client.callTool({ name, arguments: args });
let r = await call('whoami_and_credits', {});
check('whoami_and_credits', !r.isError && text(r).includes('Credits available'), text(r).slice(0, 100));
r = await call('get_story_schema', {});
check('get_story_schema returns rules and the schema', !r.isError && text(r).includes('Engine rules') && !!r.structuredContent?.schema);
const title = 'Pre-flight ' + Math.random().toString(36).slice(2, 7);
r = await call('create_project', { title });
const pid = r.structuredContent?.project_id;
check('create_project', !r.isError && !!pid, text(r).slice(0, 120));
r = await call('list_projects', {});
check('list_projects shows it', text(r).includes(pid ?? 'x'));
const bad = await call('set_story', { project_id: pid, story: { schema: 2, engine: 'sequence', sequence: { clips: [] } } });
check('set_story lists every failed check in plain words and saves nothing', bad.isError === true && /NOT saved/.test(text(bad)) && (bad.structuredContent?.failed_checks?.length ?? 0) >= 3);
const t = TEMPLATES[0];
r = await call('set_story', { project_id: pid, story: build(t.id, t.datasets[0], 'Pre-flight film') });
check('set_story saves a valid story', !r.isError && r.structuredContent?.saved === true, text(r).slice(0, 160));
r = await call('make_contact_sheet', { project_id: pid });
const jid = r.structuredContent?.job_id;
check('make_contact_sheet queues a job (nothing renders on this project: no worker)', !r.isError && !!jid, text(r).slice(0, 160));
r = await call('make_contact_sheet', { project_id: pid });
check('asking twice does not queue a second one', r.structuredContent?.started === false && r.structuredContent?.job_id === jid);
r = await call('job_status', { job_id: jid });
check('job_status says it is waiting in the queue', !r.isError && /queue/.test(text(r)), text(r).slice(0, 120));
r = await call('request_full_render', { project_id: pid, preview_job_id: jid, confirm: true });
check('request_full_render is refused', r.isError === true);
r = await call('create_project', { title: 'x', owner_id: 'someone-else' });
check('an extra argument that would skip or override anything is refused', r.isError === true && /not understood/.test(text(r)));
await client.close();

// 5. revocation is effective at once
const rv = await fetch(BASE + '/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: mem.tokens.refresh_token, client_id: mem.info.client_id }) });
check('revoke answers 200', rv.status === 200);
const after = await fetch(BASE + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + mem.tokens.access_token, 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
check('the revoked token is refused on the very next call', after.status === 401, String(after.status));
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
