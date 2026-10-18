// A LOCAL stand-in for WEB's hosted consent page, for the NON-LIVE project only (WEB builds the real one in the app).
//   node tools/connect_consent_local.mjs        then the AI's sign-in opens http://localhost:8788/consent?request=<id>
// It serves one page on 127.0.0.1 and the supabase-js bundle from node_modules. It reads D:\Ryagram-scratch\oauth-proof\.env but hands the
// page ONLY the project URL and the publishable key (public by design). The secret key never leaves this process (it is not even read).
// The page signs in with a Ryagram test account, asks connect_consent_check, shows who is asking, and calls connect_consent_decide on a button
// press. It follows redirect_to only when it begins with the redirect address it showed.
import fs from 'node:fs';
import http from 'node:http';

const env = {};
for (const line of fs.readFileSync('D:/Ryagram-scratch/oauth-proof/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) { console.error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY missing in the .env'); process.exit(2); }
const sdk = fs.readFileSync(new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect an AI to Ryagram (test)</title>
<style>
 body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;color:#1b1b1b;background:#fafafa}
 h1{font-size:1.3rem} .box{background:#fff;border:1px solid #ddd;border-radius:10px;padding:1rem 1.2rem;margin:1rem 0}
 .host{font-size:1.25rem;font-weight:700;word-break:break-all} .warn{color:#8a1c1c} .muted{color:#666;font-size:.9rem}
 button{font:inherit;padding:.6rem 1rem;border-radius:8px;border:1px solid #888;background:#fff;cursor:pointer} button.go{background:#1b1b1b;color:#fff;border-color:#1b1b1b}
 input[type=email],input[type=password]{width:100%;padding:.5rem;margin:.2rem 0 .8rem;font:inherit;box-sizing:border-box}
 @media (prefers-color-scheme:dark){body{background:#151515;color:#eee}.box{background:#1f1f1f;border-color:#333}button{background:#222;color:#eee;border-color:#666}button.go{background:#eee;color:#111}}
</style></head><body>
<h1>Connect an AI assistant to Ryagram</h1>
<p class="muted">Test page for the staging project only. Use the test account, never your real password.</p>
<div id="app" class="box">Loading...</div>
<script src="/supabase.js"></script>
<script>
const CFG = ${JSON.stringify({ url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY })};
const sb = supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false } });
const app = document.getElementById('app');
const req = new URLSearchParams(location.search).get('request') || '';
const WORDS = { read: 'See your projects, films and credit balance', write: 'Create projects and change your film stories', render_free: 'Make contact sheets and previews (free)' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function signIn(msg) {
  app.innerHTML = '<p>Sign in with the Ryagram test account.</p>' + (msg ? '<p class="warn">' + esc(msg) + '</p>' : '') +
    '<label>Email<input id="e" type="email" autocomplete="username"></label><label>Password<input id="p" type="password" autocomplete="current-password"></label><button class="go" id="go">Sign in</button>';
  document.getElementById('go').onclick = async () => {
    const r = await sb.auth.signInWithPassword({ email: document.getElementById('e').value.trim(), password: document.getElementById('p').value });
    r.error ? signIn('That did not work: ' + r.error.message) : decide();
  };
}
async function decide() {
  if (!/^[0-9a-f-]{36}$/.test(req)) { app.innerHTML = '<p class="warn">This page needs a sign-in request from your assistant.</p>'; return; }
  const c = await sb.rpc('connect_consent_check', { p_request: req });
  if (c.error) { app.innerHTML = '<p class="warn">' + esc(c.error.message) + '</p>'; return; }
  const d = c.data;
  if (!d.allowed) { app.innerHTML = '<p class="warn">' + esc(d.reason) + '</p>'; return; }
  const boxes = d.offered_scopes.filter((s) => d.requested_scopes.includes(s)).map((s) =>
    '<label><input type="checkbox" checked data-s="' + esc(s) + '"> ' + esc(WORDS[s] || s) + '</label><br>').join('');
  app.innerHTML = '<p><strong>' + esc(d.client_name) + '</strong> wants to act as your Ryagram account.</p>' +
    '<p class="muted">It will send you back to:</p><p class="host">' + esc(d.redirect_host) + '</p><p class="muted">' + esc(d.redirect_uri) + '</p>' +
    '<p>It will be able to:</p>' + boxes +
    '<p class="muted">Tools that spend credits ask you first. You can disconnect it any time.</p>' +
    '<button class="go" id="yes">Allow</button> <button id="no">Deny</button>';
  const go = async (approve) => {
    const scopes = [...document.querySelectorAll('input[data-s]')].filter((b) => b.checked).map((b) => b.dataset.s);
    const r = await sb.rpc('connect_consent_decide', { p_request: req, p_approve: approve, p_scopes: scopes });
    if (r.error) { app.innerHTML = '<p class="warn">' + esc(r.error.message) + '</p>'; return; }
    const to = r.data.redirect_to;
    if (typeof to === 'string' && to.startsWith(d.redirect_uri)) { app.textContent = approve ? 'Allowed. Returning to your assistant...' : 'Denied.'; location.href = to; }
    else app.innerHTML = '<p class="warn">The return address did not match the one shown, so nothing was followed.</p>';
  };
  document.getElementById('yes').onclick = () => go(true);
  document.getElementById('no').onclick = () => go(false);
}
sb.auth.getSession().then(({ data }) => (data.session ? decide() : signIn()));
</script></body></html>`;

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/supabase.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(sdk); }
  if (path === '/consent') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(PAGE); }
  res.writeHead(404); res.end('not found');
}).listen(8788, '127.0.0.1', () => console.log('local consent page on http://localhost:8788/consent (staging project only)'));
