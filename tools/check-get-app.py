"""The page behind the app link in an invite email, in REAL Chrome (NEXT-CONNECT 162).

    py -I tools/check-get-app.py <scratch base folder on D:>

Serves this repository's pages on 127.0.0.1 (no other network), opens /get-app/ the way an email link would (the token in the address FRAGMENT), and answers the app-link function and the storage host with stand-ins
inside the browser (Playwright routes), so nothing real is asked. Checks what a person and a mail program's link checker see: opening the page asks only 'peek' (it changes nothing) and never 'redeem'; the
button is the only thing that redeems; the token leaves the address bar at once and is never sent anywhere but the function's POST body; a bad link, a used link and a foreign download address are refused in words;
and nothing is requested from anywhere else. The browser and the server are closed at the end."""
import functools
import http.server
import json
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FAILED = []
TOKEN = "ab" * 32
FN = "https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/app-link"
R2 = "https://acct.r2.cloudflarestorage.com/ryagram-app/releases/app-1.zip?X-Amz-Signature=x"


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{httpd.server_address[1]}"


def run(pw, hash_, mode="good"):
    """One visit. mode: good | used | bad_url. Returns (page state, calls to the function, other requests)."""
    b = pw.chromium.launch(channel="chrome")
    ctx = b.new_context(accept_downloads=True)
    pg = ctx.new_page()
    calls, others, errors = [], [], []
    state = {"redeemed": False}

    def fn(route):
        req = route.request
        if req.method == "OPTIONS":
            route.fulfill(status=204, headers={"access-control-allow-origin": BASE, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS"})
            return
        body = json.loads(req.post_data or "{}")
        calls.append(body)
        h = {"access-control-allow-origin": BASE, "content-type": "application/json"}
        if mode == "used" or body.get("t") != TOKEN or (state["redeemed"] and body.get("action") == "peek"):
            route.fulfill(status=404, headers=h, body=json.dumps({"error": "That link has been used, has expired, or is no longer good. If you have a Ryagram account, sign in at uselai.com and use the Download card."}))
        elif body["action"] == "peek":
            route.fulfill(status=200, headers=h, body=json.dumps({"ok": True, "file_name": "app-1.zip", "size_bytes": 274327789}))
        else:
            state["redeemed"] = True
            url = "https://evil.example/app.zip" if mode == "bad_url" else R2
            route.fulfill(status=200, headers=h, body=json.dumps({"url": url, "expires_in": 900, "file_name": "app-1.zip", "size_bytes": 274327789, "sha256": "c" * 64}))

    def r2(route):
        others.append(route.request.url)
        route.fulfill(status=200, headers={"content-type": "application/zip", "content-disposition": 'attachment; filename="app-1.zip"'}, body=b"PK-not-a-real-zip")

    pg.route(FN, fn)
    pg.route(re.compile(r"^https://acct\.r2\.cloudflarestorage\.com/.*"), r2)
    pg.route(re.compile(r"^https://fonts\.(googleapis|gstatic)\.com/.*"), lambda route: route.abort())
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("request", lambda r: others.append(r.url) if not re.match(rf"^({re.escape(BASE)}/|data:|blob:|{re.escape(FN)}|https://acct\.r2\.cloudflarestorage\.com/|https://fonts\.)", r.url) else None)
    return b, ctx, pg, calls, others, errors


with sync_playwright() as pw:
    print("A. a link with no token, or a broken one: said in words, nothing asked")
    for h in ("", "#t=nope", "#t=" + "AB" * 32, "#x=" + TOKEN):
        b, ctx, pg, calls, others, errors = run(pw, h)
        pg.goto(f"{BASE}/get-app/{h}", wait_until="load")
        pg.wait_for_function("() => document.getElementById('ga-msg').textContent.length > 20")
        check("not complete" in pg.inner_text("#ga-msg") and calls == [] and pg.locator("#ga-go").is_hidden(), f"{h or '(no fragment)'}: 'not complete', no call to the function, no button")
        b.close()

    b, ctx, pg, calls, others, errors = run(pw, "")
    pg.goto(f"{BASE}/get-app/?t={TOKEN}", wait_until="load")
    pg.wait_for_function("() => document.getElementById('ga-msg').textContent.length > 20")
    check("not complete" in pg.inner_text("#ga-msg") and calls == [], "MUST-FAIL guard: a token in the query string is not taken (only the fragment is)")
    b.close()

    print("B. a good link: opening the page only PEEKS (a mail program's link checker cannot use it up); the button is what redeems")
    b, ctx, pg, calls, others, errors = run(pw, "")
    pg.goto(f"{BASE}/get-app/#t={TOKEN}", wait_until="load")
    pg.wait_for_selector("#ga-go:not([hidden])", timeout=15000)
    pg.wait_for_timeout(800)
    check(calls == [{"t": TOKEN, "action": "peek"}], f"only one call, a peek, with the token in the body ({calls})")
    check("Your link is good." in pg.inner_text("#ga-msg") and "app-1.zip (274 MB)" in pg.inner_text("#ga-detail") and "works once" in pg.inner_text("#ga-detail"), "the page says what it would download and that the link works once")
    check(pg.url == f"{BASE}/get-app/" and TOKEN not in pg.url, "the token is out of the address bar")
    check(pg.locator("#ga-after a").count() == 0, "no download link is on the page before the button")
    csp = pg.get_attribute("meta[http-equiv='Content-Security-Policy']", "content") or ""
    check("connect-src https://jxtkfishqfxuptwjzczz.supabase.co;" in csp and "*" not in csp and "script-src 'self'" in csp, "the page may talk only to the Ryagram project and run only its own script")
    check(pg.get_attribute("meta[name=referrer]", "content") == "no-referrer", "the page sends no referrer anywhere")
    with pg.expect_download(timeout=15000) as dl:
        pg.click("#ga-go")
    d = dl.value
    check(d.suggested_filename == "app-1.zip", "the button starts the download of app-1.zip")
    check([c["action"] for c in calls] == ["peek", "redeem"] and calls[1]["t"] == TOKEN, "the button made exactly one redeem call")
    pg.wait_for_selector("#ga-after a", timeout=10000)
    after = pg.inner_text("#ga-after")
    check("Download app-1.zip" in after and "c" * 64 in after and "unzip" in after, "afterwards: a fallback button, the file's SHA-256 and what to do next")
    a_href = pg.get_attribute("#ga-after a", "href")
    check(a_href.startswith("https://acct.r2.cloudflarestorage.com/"), "the only address on the page is the signed storage address")
    check(not errors, f"no page errors ({errors[:1]})")
    check(not [o for o in others if o.startswith("http") and "cloudflarestorage" not in o and "fonts." not in o], f"nothing was requested from anywhere else ({[o for o in others][:3]})")
    b.close()

    print("C. a used or expired link is said in words, with no button")
    b, ctx, pg, calls, others, errors = run(pw, "", mode="used")
    pg.goto(f"{BASE}/get-app/#t={TOKEN}", wait_until="load")
    pg.wait_for_function("() => /used, has expired/.test(document.getElementById('ga-msg').textContent)", timeout=15000)
    check(pg.locator("#ga-go").is_hidden() and "Download card" in pg.inner_text("#ga-msg"), "the plain sentence, a way forward (the Download card), and no button")
    b.close()

    print("D. a download address that is not the storage host is never followed")
    b, ctx, pg, calls, others, errors = run(pw, "", mode="bad_url")
    pg.goto(f"{BASE}/get-app/#t={TOKEN}", wait_until="load")
    pg.wait_for_selector("#ga-go:not([hidden])", timeout=15000)
    pg.click("#ga-go")
    pg.wait_for_function("() => document.getElementById('ga-go').hidden", timeout=10000)
    pg.wait_for_timeout(500)
    check(pg.url.startswith(BASE) and not any("evil.example" in o for o in others) and pg.locator("#ga-after a").count() == 0, "MUST-FAIL guard: a foreign address from the function is not followed or shown as a link")
    b.close()

    print("E. the helper functions")
    b, ctx, pg, calls, others, errors = run(pw, "")
    pg.goto(f"{BASE}/get-app/", wait_until="load")
    r = pg.evaluate("""() => { const g = window.ryagramGetApp; return [g.tokenFrom('#t=' + 'ab'.repeat(32)), g.tokenFrom('#t=AB'), g.tokenFrom(''), g.sizeWords(274327789), g.sizeWords(2.5e9), g.sizeWords(0),
      g.safeDownloadUrl('https://acct.r2.cloudflarestorage.com/x?y=1'), g.safeDownloadUrl('http://acct.r2.cloudflarestorage.com/x'), g.safeDownloadUrl('https://evil.example/x'),
      g.safeDownloadUrl('https://user@acct.r2.cloudflarestorage.com/x'), g.safeDownloadUrl('https://acct.r2.cloudflarestorage.com.evil.example/x'), g.safeDownloadUrl('javascript:alert(1)')]; }""")
    check(r[0] == "ab" * 32 and r[1] is None and r[2] is None and r[3] == "274 MB" and r[4] == "2.50 GB" and r[5] == "", "token and size helpers")
    check(r[6] and r[6].startswith("https://acct.r2.cloudflarestorage.com/") and r[7:] == [None] * 5, "only an https address on the storage host is followed")
    b.close()
httpd.shutdown()
print()
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
