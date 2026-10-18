"""WEB's HOSTED consent page and Account > Connected AIs, run for real against the PROOF project (CC1 ask 1: live step 12 must not be its first run).

    D:/Ryagram-scratch/WEB/pgvenv2/Scripts/python.exe tools/connect_hosted_page_check.py [app_dir] [outdir]

What is real: WEB's page code (read-only from their worktree, default D:/Ryagram-scratch/WEB/consent-wt), real Chrome, the proof project's Supabase
(sign-in, connect_consent_check / connect_consent_decide / my_connected_ais / disconnect_ai over REST) and the deployed `connect` function
(register, authorize, token, MCP). What is local: a small server for the page files that swaps in the PROOF project's address and publishable key in the
config file and in the page's Content-Security-Policy, in the response only (WEB's files are not touched), and turns the connectAi flag on.
The test account is signed in by calling the sign-in API from this script and handing the session to the page's storage: no password is typed anywhere.
Nothing is printed that is a key, token, code or password. Refuses the live project. Needs D:/Ryagram-scratch/oauth-proof/.env and connect-test-account.json.
"""
import base64
import hashlib
import http.client
import http.server
import json
import os
import re
import secrets
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("D:/Ryagram-scratch/WEB/consent-wt")
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("D:/Ryagram-scratch/CONNECT/hosted-page-shots")
ENV = Path("D:/Ryagram-scratch/oauth-proof/.env")
ACCT = Path("D:/Ryagram-scratch/oauth-proof/connect-test-account.json")
ENGINE_PY = "D:/Ryagram-scratch/ENGINE/pgvenv/Scripts/python.exe"
PORT = 8190
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
LIVE_REF = "jxtkfishqfxuptwjzczz"


def read_env():
    e = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
        if m:
            e[m.group(1)] = m.group(2).strip("\"'")
    return e


env = read_env()
URL = env["SUPABASE_URL"].rstrip("/")
KEY = env["SUPABASE_PUBLISHABLE_KEY"]
if LIVE_REF in URL:
    sys.exit("REFUSED: live project")
REF = re.match(r"https://([a-z0-9]+)\.supabase\.co", URL).group(1)
FN = f"{URL}/functions/v1/connect"
acct = json.loads(ACCT.read_text())


def http_json(method, url, body=None, headers=None, form=False):
    data = None
    h = dict(headers or {})
    if body is not None:
        data = urllib.parse.urlencode(body).encode() if form else json.dumps(body).encode()
        h.setdefault("Content-Type", "application/x-www-form-urlencoded" if form else "application/json")
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw)
        except Exception:
            return err.code, None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def authorize_location(url):
    opener = urllib.request.build_opener(NoRedirect)
    try:
        opener.open(url, timeout=30)
    except urllib.error.HTTPError as err:
        return err.headers.get("Location", "")
    return ""


_REGISTERED = {}


def new_request(client_name, callback=CALLBACK, scope="read write render_free"):
    """Register a client, start an authorization, return everything the page and the exchange need."""
    key = (client_name, callback)       # /register is limited to 10 an hour per caller: register each distinct client once per run
    if key not in _REGISTERED:
        st, reg = http_json("POST", f"{FN}/register", {"client_name": client_name, "redirect_uris": [callback], "token_endpoint_auth_method": "none"})
        assert st == 201, f"register {st} (the limiter allows 10 an hour; wait and rerun)"
        _REGISTERED[key] = reg
    reg = _REGISTERED[key]
    verifier = secrets.token_urlsafe(48)[:64]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = "st-" + secrets.token_hex(6)
    q = urllib.parse.urlencode({"response_type": "code", "client_id": reg["client_id"], "redirect_uri": callback, "state": state, "code_challenge": challenge,
                                "code_challenge_method": "S256", "scope": scope, "resource": f"{FN}/mcp"})
    loc = authorize_location(f"{FN}/authorize?{q}")
    rid = urllib.parse.parse_qs(urllib.parse.urlsplit(loc).query).get("request", [None])[0]
    assert rid, f"no request id in {loc[:60]}"
    return {"client_id": reg["client_id"], "request": rid, "verifier": verifier, "state": state}


def exchange(req, code, callback=CALLBACK):
    return http_json("POST", f"{FN}/token", {"grant_type": "authorization_code", "code": code, "client_id": req["client_id"], "redirect_uri": callback,
                                             "code_verifier": req["verifier"]}, form=True)


def mcp(token, method, params=None):
    return http_json("POST", f"{FN}/mcp", {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}, headers={"Authorization": f"Bearer {token}"})


def expire_request(request_id):
    code = ("import psycopg,sys\nfor l in open(r'D:/Ryagram-scratch/oauth-proof/.env',encoding='utf8'):\n s=l.strip()\n if s.startswith('SUPABASE_DB_URL'): d=s.partition('=')[2].strip().strip('\"\\'')\n"
            "with psycopg.connect(d,autocommit=True) as c: c.execute(\"update public.connect_requests set expires_at = now() - interval '1 second' where id = %s\", (sys.argv[1],))")
    subprocess.run([ENGINE_PY, "-c", code, request_id], check=True, capture_output=True)


# the person's session, from the sign-in API (no password in any field)
st, sess = http_json("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": acct["email"], "password": acct["password"]}, headers={"apikey": KEY})
assert st == 200, f"sign-in {st}"
SESSION = json.dumps({k: sess[k] for k in ("access_token", "refresh_token", "expires_in", "expires_at", "token_type", "user")})


def serve():
    config = (APP / "assets" / "ryagram-config.js").read_text(encoding="utf-8")
    config = re.sub(r"supabaseUrl: '[^']*'", f"supabaseUrl: '{URL}'", config)
    config = re.sub(r"supabaseKey: '[^']*'", f"supabaseKey: '{KEY}'", config)
    config = re.sub(r"connectAi: (true|false)", "connectAi: true", config)
    html = (APP / "app" / "index.html").read_text(encoding="utf-8").replace(f"https://{LIVE_REF}.supabase.co", URL).replace(f"wss://{LIVE_REF}.supabase.co", f"wss://{REF}.supabase.co")

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(APP), **k)

        def log_message(self, *a):
            pass

        def do_GET(self):
            path = urllib.parse.urlsplit(self.path).path
            if path == "/assets/ryagram-config.js":
                body, ctype = config.encode(), "text/javascript"
            elif path in ("/app/", "/app/index.html"):
                body, ctype = html.encode(), "text/html; charset=utf-8"
            else:
                return super().do_GET()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True
    base = f"http://127.0.0.1:{PORT}"

    def check(cond, what):
        nonlocal ok
        print(("  ok   " if cond else "  FAIL ") + what)
        ok = ok and bool(cond)

    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel="chrome")

            def page_for(opts, callbacks):
                ctx = b.new_context(**opts)
                ctx.add_init_script(f"try {{ localStorage.setItem('sb-{REF}-auth-token', {json.dumps(SESSION)}); }} catch (e) {{}}")
                p = ctx.new_page()
                errors = []
                p.on("pageerror", lambda e: errors.append(str(e)))
                p.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text and "status of 404" not in m.text else None)
                p.on("dialog", lambda d: d.accept())
                p.route("https://claude.ai/**", lambda route: (callbacks.append(route.request.url), route.fulfill(status=200, content_type="text/html", body="<p>the AI's callback</p>")))
                return ctx, p, errors

            for name, opts in (("desktop", dict(viewport={"width": 1280, "height": 900})),
                               ("phone", dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                # ---- A. approve, with a client that lies about its name
                req = new_request("Totally Official Ryagram Staff")
                went = []
                ctx, p, errors = page_for(opts, went)
                p.goto(f"{base}/app/#/connect/consent?request={req['request']}", wait_until="load")
                p.wait_for_selector('button:has-text("Approve")', timeout=30000)
                text = p.inner_text("main")
                low = text.lower()
                check("Claude" in text and "claude.ai" in text, "it names who is asking (the label Ryan controls) and the host")
                check(text.index("Claude") < text.index("Totally Official Ryagram Staff"), "Ryan's label comes BEFORE the name the assistant gave itself")
                check("It calls itself: Totally Official Ryagram Staff" in text, "the assistant's own name is shown only as 'It calls itself'")
                check(CALLBACK in text, "it shows the exact address you go back to")
                check(p.locator(".consent-scopes input[type=checkbox]").count() == 3 and p.locator(".consent-scopes input:checked").count() == 3, "three things it can do, all ticked")
                check("It cannot spend your credits." in text and "acts as your Ryagram account" in text, "the always-true lines are there")
                check(bool(re.search(r"(expire|ends|until|minute)", low)), f"the page says when the request ends ({[l for l in text.splitlines() if re.search(r'expire|ends|minute', l, re.I)][:1]})")
                check(went == [], "nothing has left the page before a button is pressed")
                p.screenshot(path=str(OUT / f"consent-real-{name}.png"), full_page=True)
                p.get_by_role("button", name="Approve").click()
                p.wait_for_url("https://claude.ai/**", timeout=20000)
                loc = urllib.parse.urlsplit(went[0])
                q = urllib.parse.parse_qs(loc.query)
                check(went[0].startswith(CALLBACK + "?code="), "the browser went to the shown address with a code")
                check(q.get("state") == [req["state"]], "with the assistant's own state")
                check(q.get("iss") == [FN], "and the issuer (RFC 9207)")
                st, tok = exchange(req, q["code"][0])
                check(st == 200 and tok and tok.get("scope") == "read write render_free", "the assistant can exchange that code")
                access = tok["access_token"]
                st, r = mcp(access, "tools/call", {"name": "whoami_and_credits", "arguments": {}})
                check(st == 200 and r["result"]["isError"] is False and acct["email"] in r["result"]["content"][0]["text"], "and then act as the signed-in person through the MCP tools")
                st, again = exchange(req, q["code"][0])
                check(st == 400, "a code cannot be used twice")
                # ---- B. the account page lists it, and Disconnect cuts it off at once
                p.goto(f"{base}/app/#/account", wait_until="load")
                p.wait_for_selector(".connected-list li", timeout=30000)
                lst = p.inner_text(".connected-list")
                check("Totally Official Ryagram Staff" in lst and "See your projects" in lst, f"Account > Connected AIs lists the connection and what it may do ({lst[:50]!r})")
                p.screenshot(path=str(OUT / f"connected-real-{name}.png"), full_page=True)
                p.get_by_role("button", name="Disconnect").first.click()
                p.wait_for_selector("text=is disconnected", timeout=15000)
                st, r = mcp(access, "tools/call", {"name": "whoami_and_credits", "arguments": {}})
                check(st == 401, "after Disconnect the assistant's next call is refused")
                check(not errors, f"no page errors {errors[:2]}")
                ctx.close()
                # ---- C. deny
                req = new_request("Claude")
                went = []
                ctx, p, errors = page_for(opts, went)
                p.goto(f"{base}/app/#/connect/consent?request={req['request']}", wait_until="load")
                p.wait_for_selector('button:has-text("Deny")', timeout=30000)
                p.get_by_role("button", name="Deny").click()
                p.wait_for_url("https://claude.ai/**", timeout=20000)
                check("error=access_denied" in went[0] and f"state={req['state']}" in went[0], "Deny goes back with access_denied and the state")
                ctx.close()
                # ---- D. a request that has ended
                req = new_request("Claude")
                expire_request(req["request"])
                went = []
                ctx, p, errors = page_for(opts, went)
                p.goto(f"{base}/app/#/connect/consent?request={req['request']}", wait_until="load")
                p.wait_for_selector("#library p.app-error", timeout=30000)
                check("expired" in p.inner_text("main") and p.get_by_role("button", name="Approve").count() == 0 and went == [], "an ended request shows its reason, no Approve, and goes nowhere")
                p.screenshot(path=str(OUT / f"expired-real-{name}.png"), full_page=True)
                ctx.close()
                # ---- E. an unknown request, and a malformed one
                ctx, p, errors = page_for(opts, [])
                p.goto(f"{base}/app/#/connect/consent?request=00000000-0000-4000-8000-0000000000ee", wait_until="load")
                p.wait_for_selector("#library p.app-error", timeout=30000)
                check("not found" in p.inner_text("main") and p.get_by_role("button", name="Approve").count() == 0, "an unknown request shows 'not found' and no Approve")
                p.goto(f"{base}/app/#/connect/consent?request=nope", wait_until="load")
                p.wait_for_selector("#np-title", timeout=30000)
                check(p.get_by_role("button", name="Approve").count() == 0, "a malformed request id is not the consent page")
                ctx.close()
                # ---- F. a hostile name is text, never markup; control and bidi characters are refused when the assistant registers
                evil = '<img src=x onerror="window.__pwned=1"><b>Ryagram Staff</b>'
                req = new_request(evil)
                went = []
                ctx, p, errors = page_for(opts, went)
                p.goto(f"{base}/app/#/connect/consent?request={req['request']}", wait_until="load")
                p.wait_for_selector('button:has-text("Approve")', timeout=30000)
                check(p.evaluate("window.__pwned") is None and p.locator("main img, main b").count() == 0, "markup in the assistant's name is shown as text and runs nothing")
                check(evil in p.inner_text(".consent-calls-itself"), "the name appears only in the small 'It calls itself' line")
                check(p.locator(".consent-who").inner_text().startswith("Connect Claude to Ryagram"), "the big heading is the label Ryan controls, not the assistant's name")
                ctx.close()
                for bad in () if name != "desktop" else ("Cl" + chr(0x202e) + "aude", "Claude" + chr(7), "Cla" + chr(0x200b) + "ude"):
                    st, _r = http_json("POST", f"{FN}/register", {"client_name": bad, "redirect_uris": [CALLBACK], "token_endpoint_auth_method": "none"})
                    check(st == 400, f"registering a name with a control, bidi or zero-width character is refused ({st})")
                # ---- G. a program on this computer: the label says so, whatever it calls itself; only the shown loopback address is followed
                LOOP = "http://127.0.0.1:53124/callback"
                req = new_request("Claude", callback=LOOP, scope="read")
                went = []
                ctx, p, errors = page_for(opts, went)
                p.route("http://127.0.0.1:53124/**", lambda route: (went.append(route.request.url), route.fulfill(status=200, content_type="text/html", body="<p>local</p>")))
                p.goto(f"{base}/app/#/connect/consent?request={req['request']}", wait_until="load")
                p.wait_for_selector('button:has-text("Approve")', timeout=30000)
                check(p.locator(".consent-who").inner_text().startswith("Connect A program on this computer to Ryagram"), "a loopback address is introduced as 'A program on this computer', not as 'Claude'")
                check("It calls itself: Claude" in p.inner_text("main") and LOOP in p.inner_text("main"), "its own name 'Claude' is small and second, and the exact loopback address is shown")
                shown = p.locator(".consent-scopes input[type=checkbox]").count()
                check(shown == 1, f"it asked for read only and the page offers exactly that one thing ({shown} boxes)")
                p.get_by_role("button", name="Approve").click()
                p.wait_for_url("http://127.0.0.1:53124/**", timeout=20000)
                check(went and went[0].startswith(LOOP + "?code=") and "iss=" in went[0], "Approve goes to exactly the loopback address shown, with a code and iss")
                http_json("POST", f"{URL}/rest/v1/rpc/disconnect_ai", {"p_client_id": req["client_id"]}, headers={"apikey": KEY, "Authorization": "Bearer " + json.loads(SESSION)["access_token"]})     # leave no grant behind named like a real assistant
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
