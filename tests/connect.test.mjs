// Connecting an AI (assets/app-connect.js): the hosted consent page and Account > Connected AIs. The authorization server and its SQL are CONNECT's; this is what the page
// guarantees: it shows who is asking, the EXACT place the person goes back to, what the AI can do and that credit-spending tools ask first; it follows only an answer that goes where
// it said; it never sees a token; and nothing is sent before a button is pressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['app-connect.js', 'app-data.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, URL, setTimeout, clearTimeout });
const C = win.ryagramConnect;
const plain = x => JSON.parse(JSON.stringify(x));
const GOOD = '00000000-0000-4000-8000-0000000000aa';

test('ROUTE: only a UUID request id in #/connect/consent?request= is accepted; anything else is not the consent page', () => {
  assert.equal(C.requestFromHash(`#/connect/consent?request=${GOOD}`), GOOD);
  for (const bad of ['#/connect/consent', '#/connect/consent?request=', '#/connect/consent?request=abc', `#/connect/consent?request=${GOOD}&x=1`, `#/connect/consent?request=${GOOD}0`, `#/connect/consent?request=<script>`,
                     `#/connect/other?request=${GOOD}`, '', null, undefined, `#/connect/consent?request=${GOOD.toUpperCase()}`]) assert.equal(C.requestFromHash(bad), null, String(bad));
});

test('FOLLOW ONLY WHAT WAS SHOWN: the page goes to the answer only if it starts with the exact address it showed; every look-alike and changed destination is refused', () => {
  const shown = 'https://claude.ai/api/mcp/auth_callback';
  assert.equal(C.safeRedirect(shown, `${shown}?code=abc&state=xyz`), true);
  assert.equal(C.safeRedirect(shown, `${shown}?error=access_denied&state=xyz`), true);
  assert.equal(C.safeRedirect('https://chatgpt.com/connector_platform_oauth_redirect', 'https://chatgpt.com/connector_platform_oauth_redirect?code=1'), true);
  for (const bad of ['https://claude.ai.evil.example/api/mcp/auth_callback?code=1', 'https://evil.example/api/mcp/auth_callback?code=1', 'https://claude.ai@evil.example/api/mcp/auth_callback?code=1',
                     'https://claude.ai/api/mcp/auth_callback2?code=1', 'https://claude.ai/other?code=1', 'http://claude.ai/api/mcp/auth_callback?code=1', 'javascript:alert(1)', 'data:text/html,x',
                     '//evil.example/x', '', 'not a url', 'https://claude.ai:8443/api/mcp/auth_callback?code=1']) assert.equal(C.safeRedirect(shown, bad), false, bad);
  assert.equal(C.safeRedirect('', shown), false);
  assert.equal(C.safeRedirect(shown, undefined), false);
});

test('WORDS: CONNECT\'s scope ids in plain words; an unknown id is shown as what it is, never hidden; "always true" says the three things Ryan asked for', () => {
  assert.equal(C.scopeWord('read'), 'See your projects, films and credit balance');
  assert.equal(C.scopeWord('write'), 'Create projects and change your film stories');
  assert.equal(C.scopeWord('render_free'), 'Make contact sheets and previews. These are free: a connection cannot spend credits, so if one would ever cost any, your AI is refused and you start it yourself in Ryagram.');
  assert.match(C.scopeWord('render_final'), /spends credits, and it asks you first/);
  assert.equal(C.scopeWord('mystery'), 'Use the tool called mystery');
  assert.deepEqual(plain(C.ALWAYS), ['Your AI acts as your Ryagram account.', 'It cannot spend your credits.', 'You can disconnect it any time: Account, then Connected AIs.']);
  assert.equal(C.hostOf('https://claude.ai/api/mcp/auth_callback'), 'claude.ai');
  assert.equal(C.hostOf('nope'), '');
  assert.equal(C.callsLine(1), 'used 1 time in the last 30 days');
  assert.equal(C.callsLine(0), 'used 0 times in the last 30 days');
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.deepEqual(plain(['2026-10-17T01:00:00Z', '2026-10-16T01:00:00Z', '2026-10-10T01:00:00Z', null].map(d => C.ago(d, now))), ['today', 'yesterday', '7 days ago', 'never']);
});

test('DATA: check, decide (once), list and disconnect go through CONNECT\'s four functions with exactly these arguments', async () => {
  const client = createFakeClient();
  const data = win.ryagramData(client);
  const c = await data.connectConsentCheck(GOOD);
  assert.deepEqual(plain([c.allowed, c.client_name, c.redirect_uri, c.redirect_host, c.credit_scopes]), [true, 'Claude', 'https://claude.ai/api/mcp/auth_callback', 'claude.ai', []]);
  assert.deepEqual(plain((await data.connectConsentCheck('00000000-0000-4000-8000-0000000000bb')).allowed), false);
  assert.match((await data.connectConsentCheck('00000000-0000-4000-8000-0000000000cc')).reason, /expired/);
  assert.match((await data.connectConsentCheck('00000000-0000-4000-8000-0000000000ee')).reason, /not found/);
  assert.deepEqual(plain(await data.myConnectedAis()), []);
  await assert.rejects(data.connectConsentDecide(GOOD, true, []), /at least one permission/);
  const r = await data.connectConsentDecide(GOOD, true, ['read', 'render_free']);
  assert.ok(C.safeRedirect(c.redirect_uri, r.redirect_to));
  await assert.rejects(data.connectConsentDecide(GOOD, false, []), /already decided/);                          // a request is decided once
  const list = await data.myConnectedAis();
  assert.deepEqual(plain([list.length, list[0].client_name, list[0].scopes]), [1, 'Claude', ['read', 'render_free']]);
  await data.disconnectAi('client-claude');
  assert.deepEqual(plain(await data.myConnectedAis()), []);
  const calls = client.log.filter(l => l.rpc).map(l => [l.rpc, l.args]);
  assert.deepEqual(plain(calls.find(([n]) => n === 'connect_consent_check')), ['connect_consent_check', { p_request: GOOD }]);
  assert.deepEqual(plain(calls.find(([n, a]) => n === 'connect_consent_decide' && a.p_approve && a.p_scopes.length)), ['connect_consent_decide', { p_request: GOOD, p_approve: true, p_scopes: ['read', 'render_free'] }]);
  assert.deepEqual(plain(calls.find(([n]) => n === 'disconnect_ai')), ['disconnect_ai', { p_client_id: 'client-claude' }]);
  const deny = createFakeClient();
  const d2 = await win.ryagramData(deny).connectConsentDecide(GOOD, false, ['read']);
  assert.match(d2.redirect_to, /error=access_denied/);
  assert.equal(deny.db.connected, undefined, 'a denial connects nothing');
});

test('PAGE SOURCE: names the app, shows the exact destination and its host, lists what it can do, says a connection cannot spend credits, puts the return-address label first and the AI own name small, has Approve and Deny, and sends nothing on load', () => {
  const src = read('assets/app-connect.js');
  for (const text of ["`Connect ${who} to Ryagram?`", "const who = c.redirect_label || c.client_name || 'an AI';", "'It calls itself: ', c.client_name", "'Where you will be sent'", "h('code', {}, c.redirect_uri)", 'c.redirect_host', "'What it will be able to do'", "'Always true'",
                      'It cannot spend your credits.', "'Approve'", "'Deny'", 'Untick anything you do not want to allow.', 'If that is not where you expect to go back to, press Deny.']) assert.ok(src.includes(text), text);
  const view = src.slice(src.indexOf('async function consentView'), src.indexOf('// ---- the account page'));
  assert.equal([...view.matchAll(/data\.connectConsentDecide\(/g)].length, 1);                                        // one decide call, inside the button handler
  assert.match(view, /const decide = async \(button, yes\) => \{[\s\S]*data\.connectConsentDecide[\s\S]*\};\s*approve\.addEventListener\('click'/);
  assert.match(view, /safeRedirect\(c\.redirect_uri, r\.redirect_to\)/);
  assert.match(view, /navigate\(r\.redirect_to\)/);
  assert.equal([...view.matchAll(/navigate\(/g)].length, 1);                                                          // the only way out of the page
  assert.match(view, /if \(yes && !picked\.length\)/);                                                                // Approve with nothing ticked is refused in words
});

test('NO TOKEN, NO HTML: the page never reads, stores or shows a token, code or secret, and writes nothing but text nodes', () => {
  const code = read('assets/app-connect.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|\bstyle:|setAttribute\('style'|localStorage|sessionStorage|document\.cookie|access_token|refresh_token|client_secret|code_verifier|Authorization|fetch\(/);
  assert.doesNotMatch(code, /redirect_to\.(split|match|slice)|searchParams\.get\('code'\)/);                           // the code in redirect_to is never opened
});

test('WIRING AND FLAG: the route and the account section exist only behind connectAi (off), scripts load in order, and Disconnect confirms and then re-lists', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const connectOn = \(\) => window\.ryagramConfig\?\.connectAi === true \|\| !!window\.ryagramMock;/);
  assert.match(lib, /connectOn\(\) && window\.ryagramConnect\.requestFromHash\(hash\)\) view = await connectUi\(\)\.consentView\(window\.ryagramConnect\.requestFromHash\(hash\)\)/);
  assert.match(lib, /if \(connectOn\(\)\) sections\.push\(await connectUi\(\)\.connectedSection\(\)\);/);
  assert.match(read('assets/ryagram-config.js'), /connectAi: false,/);
  const html = read('app/index.html');
  assert.ok(html.indexOf('app-connect.js') > 0 && html.indexOf('app-connect.js') < html.indexOf('app-library.js'));
  const src = read('assets/app-connect.js');
  assert.match(src, /confirm\(`Disconnect \$\{r\.client_name \|\| 'this AI'\}\? It stops working with your account straight away\.`\)/);
  assert.match(src, /await data\.disconnectAi\(r\.client_id\); await draw\(\);/);
});

test('LABEL: the return-address label is shown first and large, the AI\'s own name small after "It calls itself:" and only as text; the free-previews line says a connection cannot spend credits', async () => {
  const src = read('assets/app-connect.js');
  const view = src.slice(src.indexOf('async function consentView'), src.indexOf('// ---- the account page'));
  assert.ok(view.indexOf("'consent-who'") < view.indexOf("'It calls itself: '"), 'label heading comes before the self-chosen name');
  assert.match(view, /c\.redirect_label && c\.client_name \? h\('p', \{ class: 'form-note consent-calls-itself' \}, 'It calls itself: ', c\.client_name\) : ''/);
  assert.doesNotMatch(src, /Tools that spend credits/);
  assert.match(read('assets/app.css'), /\.consent-who\{font-size:clamp/);
  const c = await win.ryagramData(createFakeClient()).connectConsentCheck(GOOD);
  assert.equal(c.redirect_label, 'Claude');
});

test('EXPIRY: the page says when the sign-in ends, warns at 5 minutes, and says the recovery once it has ended; Approve is turned off then', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const at = m => new Date(now + m * 60000).toISOString();
  assert.equal(C.expiry(at(29), now).state, 'ok');
  assert.match(C.expiry(at(29), now).text, /^This sign-in expires at .+\.$/);
  const soon = C.expiry(at(4.2), now);
  assert.equal(soon.state, 'soon');
  assert.match(soon.text, /in 5 minutes\. Decide now, or start again from your assistant\./);
  assert.match(C.expiry(at(0.4), now).text, /in 1 minute\./);
  assert.deepEqual(plain(C.expiry(at(-1), now)), { state: 'expired', text: 'This sign-in request has expired. Start again from your assistant.' });
  assert.deepEqual(plain(C.expiry('nope', now)), { state: 'unknown', text: '' });
  const src = read('assets/app-connect.js');
  assert.ok(src.includes('approve.disabled = true; approve.title = EXPIRED;'));
  assert.ok(src.includes('expiryLine, h(\'div\', { class: \'actions-row\' }, approve, deny), error]'));
});
