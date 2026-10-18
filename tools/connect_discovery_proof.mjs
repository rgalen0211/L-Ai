// E1 proof: the real MCP TypeScript SDK's own discovery functions, run against the DEPLOYED connect function on the NON-LIVE project, with every
// request they make logged (address + status only). It shows which of the spec's discovery addresses the platform can reach and that the SDK ends
// at a complete authorization-server document anyway.
//   node tools/connect_discovery_proof.mjs            (reads SUPABASE_URL from D:\Ryagram-scratch\oauth-proof\.env; refuses the live project)
import fs from 'node:fs';
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, extractWWWAuthenticateParams }
  from '@modelcontextprotocol/sdk/client/auth.js';

const ENVFILE = process.env.CONNECT_E2E_ENVFILE ?? 'D:/Ryagram-scratch/oauth-proof/.env';
let base = '';
for (const line of fs.readFileSync(ENVFILE, 'utf8').split(/\r?\n/)) {
  const m = /^\s*SUPABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
  if (m) base = m[1].replace(/^["']|["']$/g, '').replace(/\/+$/, '');
}
if (/jxtkfishqfxuptwjzczz/.test(base) || !base) { console.error('REFUSED: no non-live project'); process.exit(2); }
const server = new URL(`${base}/functions/v1/connect/mcp`);

let bad = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) bad++; };
const seen = [];
const logged = async (url, init) => {
  const res = await fetch(url, init);
  seen.push([String(url).replace(base, '<project>'), res.status]);
  return res;
};

// 1. an unauthenticated call is answered 401 with a resource_metadata pointer (how Claude and the SDK start)
const first = await logged(server, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const params = extractWWWAuthenticateParams(first);
check(first.status === 401 && !!params.resourceMetadataUrl, 'POST /mcp without a token: 401 with WWW-Authenticate resource_metadata');

// 2. the SDK follows it (and, with no pointer, tries the spec's well-known addresses itself)
const viaPointer = await discoverOAuthProtectedResourceMetadata(server, { resourceMetadataUrl: params.resourceMetadataUrl }, logged);
check(viaPointer.resource === server.href && viaPointer.authorization_servers?.length === 1, 'protected-resource metadata via the pointer names this resource and one authorization server');
// Without the pointer the SDK tries only HOST-ROOT addresses (/.well-known/oauth-protected-resource[/<path>]). Supabase's gateway answers every
// host-root path itself (401 "No API key"), so a client that ignores WWW-Authenticate cannot find us there. That is a platform limit (the fix is a
// custom domain on a paid plan); Claude and the SDK follow the pointer, which is why step 1 matters. Reported, not failed.
seen.length = 0;
let rootFound = false;
try { rootFound = !!(await discoverOAuthProtectedResourceMetadata(server, undefined, logged)).resource; } catch { rootFound = false; }
for (const [u, s] of seen) console.log(`         without the pointer the SDK tried ${u} -> ${s}`);
console.log(`  info Without the pointer: ${rootFound ? 'found' : 'NOT found (host-root addresses are not routable to a function on Supabase; the pointer in step 1 is the supported path)'}`);

// 3. the SDK finds the authorization-server document at the issuer, which has a path (the case RFC 8414 puts at the host root)
const issuer = new URL(viaPointer.authorization_servers[0]);
seen.length = 0;
const meta = await discoverAuthorizationServerMetadata(issuer, { fetchFn: logged });
for (const [u, s] of seen) console.log(`         tried ${u} -> ${s}`);
check(meta?.issuer === issuer.href.replace(/\/$/, ''), 'authorization-server metadata found; its issuer equals the address it was fetched for');
check(meta?.code_challenge_methods_supported?.join() === 'S256', 'S256 is the only PKCE method');
check(!!meta?.registration_endpoint && !!meta?.authorization_endpoint && !!meta?.token_endpoint, 'registration, authorization and token endpoints are all present');
check(meta?.authorization_endpoint?.startsWith(issuer.href.replace(/\/$/, '') + '/') && meta?.token_endpoint?.startsWith(issuer.href.replace(/\/$/, '') + '/'), 'every endpoint is under the function (reachable on this platform)');
// the SDK's schema drops fields it does not model, so RFC 9207 is checked on the raw document the SDK fetched
const raw = await (await fetch(`${issuer.href.replace(/\/$/, '')}/.well-known/openid-configuration`)).json();
check(raw.authorization_response_iss_parameter_supported === true, 'RFC 9207: iss on redirects is advertised (raw document)');
check(meta?.grant_types_supported?.includes('authorization_code') && meta?.grant_types_supported?.includes('refresh_token'), 'authorization_code and refresh_token grants');
// ---- the whole candidate list the MCP authorization spec tells a client to try, one GET each (read-only), with what each answers.
// "reachable" = the platform lets the request reach the function at all; "served" = our function answers it with the right document.
const origin = new URL(base).origin;
const issuerStr = issuer.href.replace(/\/$/, '');
const path = issuer.pathname.replace(/\/$/, '');                    // /functions/v1/connect
const resPath = server.pathname;                                    // /functions/v1/connect/mcp
const matrix = [
  ['protected resource', 'WWW-Authenticate pointer', params.resourceMetadataUrl, 'resource', server.href],
  ['protected resource', 'RFC 9728 path form at the host root', `${origin}/.well-known/oauth-protected-resource${resPath}`, 'resource', server.href],
  ['protected resource', 'RFC 9728 root form at the host root', `${origin}/.well-known/oauth-protected-resource`, 'resource', server.href],
  ['authorization server', 'RFC 8414 path form at the host root', `${origin}/.well-known/oauth-authorization-server${path}`, 'issuer', issuerStr],
  ['authorization server', 'OpenID path form at the host root', `${origin}/.well-known/openid-configuration${path}`, 'issuer', issuerStr],
  ['authorization server', 'OpenID appended to the issuer', `${issuerStr}/.well-known/openid-configuration`, 'issuer', issuerStr],
  ['authorization server', 'RFC 8414 appended to the issuer', `${issuerStr}/.well-known/oauth-authorization-server`, 'issuer', issuerStr],
];
console.log('\n  candidate addresses (one GET each):');
const served = {};
for (const [kind, label, url, key, want] of matrix) {
  const res = await fetch(url);
  let ok = false;
  try { const j = await res.json(); ok = res.status === 200 && j[key] === want; } catch { /* not JSON: the platform answered, not us */ }
  served[label] = ok;
  console.log(`  ${ok ? 'served ' : 'NOT served'}  ${String(res.status).padEnd(3)}  ${kind.padEnd(20)} ${label}`);
}
check(served['WWW-Authenticate pointer'], 'the pointer in WWW-Authenticate leads to our protected-resource document');
check(served['OpenID appended to the issuer'] && served['RFC 8414 appended to the issuer'], 'both documents the platform CAN route (appended to the issuer, under the function) are served, with the issuer equal to the address');
check(!served['RFC 8414 path form at the host root'] && !served['OpenID path form at the host root'] && !served['RFC 9728 path form at the host root'],
  'the host-root path forms are NOT ours to serve (Supabase answers every host-root path itself); this is the documented platform limit, not a missing route');
console.log(bad ? `\n${bad} CHECK(S) FAILED` : '\nDISCOVERY OK');
process.exit(bad ? 1 : 0);
