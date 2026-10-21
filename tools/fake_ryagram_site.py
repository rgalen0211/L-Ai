"""A FAKE Ryagram site for tests only (NEXT-CONNECT 98). Not the site, not a copy of any site code, nothing here is live.

It is the executable copy of the device-sign-in contract written at the top of ryagram_signin.py, with the server-side rules CC1 asked for on 13:34 built in
so the app can be tested against them, and so WORKER (SQL) and WEB (edge function) have something concrete to match:

  * a user code is 8 characters from an alphabet without 0 O 1 I L, ends after 10 minutes, and works once
  * the device secret the app polls with is 32+ random bytes; the "server" keeps only its sha256
  * polling faster than the interval is answered slow_down and the interval grows by 5
  * making codes is rate-limited (6 a minute)
  * the node token is kept only as sha256, is valid only on the node endpoints, and is REFUSED on /connect (audience separation)
  * a removed computer's token is refused (401)

Every request is written to `.seen` as (method, path with query, had a bearer header) so a test can prove no secret ever travels in a URL.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_SECONDS = 600
INTERVAL = 5
TOKEN_DAYS = 30
MAKE_PER_MINUTE = 6


def _h(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class FakeSite:
    def __init__(self, clock=time.time, approval_host: str = ""):
        self.clock = clock
        self.approval_host = approval_host                     # "" = this server itself
        self.codes: dict[str, dict] = {}                       # user_code -> state
        self.by_device: dict[str, str] = {}                    # sha256(device secret) -> user_code
        self.tokens: dict[str, dict] = {}                      # sha256(node token) -> account
        self.made: list[float] = []
        self.seen: list[tuple] = []
        self.issued_tokens: list[str] = []                     # raw, for the test's own secret scans only (a real server keeps none)
        self.issued_device_codes: list[str] = []
        self._srv = None

    # ---- the person's side (what the website's Approve / Deny / Remove would do)
    def approve(self, user_code: str, email: str = "sam@example.test", local_compute: bool = False) -> bool:
        c = self.codes.get(user_code)
        if not c or c["state"] != "pending" or self.clock() >= c["expires_at"]:
            return False
        c["state"], c["account"] = "approved", {"email": email, "computer_name": c["computer_name"], "local_compute": local_compute}
        return True

    def deny(self, user_code: str) -> bool:
        c = self.codes.get(user_code)
        if not c or c["state"] != "pending":
            return False
        c["state"] = "denied"
        return True

    def revoke_all(self) -> None:
        for t in self.tokens.values():
            t["revoked"] = True

    # ---- the API
    def _make_code(self, body: dict):
        now = self.clock()
        self.made = [t for t in self.made if now - t < 60]
        if len(self.made) >= MAKE_PER_MINUTE:
            return 429, {"error": "slow_down"}
        self.made.append(now)
        user = "".join(secrets.choice(ALPHABET) for _ in range(8))
        user = user[:4] + "-" + user[4:]
        device = secrets.token_urlsafe(32)
        self.issued_device_codes.append(device)
        self.codes[user] = {"device_hash": _h(device), "expires_at": now + CODE_SECONDS, "state": "pending", "interval": INTERVAL, "next_poll": now,
                            "computer_name": str(body.get("computer_name", ""))[:60]}
        self.by_device[_h(device)] = user
        base = self.approval_base()
        return 200, {"device_code": device, "user_code": user, "verification_uri": f"{base}/app/#/device", "verification_uri_complete": f"{base}/app/#/device?code={user}",
                     "expires_in": CODE_SECONDS, "interval": INTERVAL}

    def _poll(self, body: dict):
        now = self.clock()
        user = self.by_device.get(_h(str(body.get("device_code", ""))))
        c = self.codes.get(user) if user else None
        if not c or c["state"] == "used":
            return 400, {"error": "expired_token"}
        if now >= c["expires_at"]:
            c["state"] = "used"
            return 400, {"error": "expired_token"}
        if now < c["next_poll"]:
            c["interval"] += 5
            c["next_poll"] = now + c["interval"]
            return 400, {"error": "slow_down"}
        c["next_poll"] = now + c["interval"]
        if c["state"] == "pending":
            return 400, {"error": "authorization_pending"}
        if c["state"] == "denied":
            c["state"] = "used"
            return 400, {"error": "access_denied"}
        c["state"] = "used"                                    # single use: the token is handed over once
        tok = secrets.token_urlsafe(32)
        self.issued_tokens.append(tok)
        acct = dict(c["account"], approved_until=time.strftime("%Y-%m-%d", time.localtime(now + TOKEN_DAYS * 86400)), revoked=False)
        self.tokens[_h(tok)] = acct
        return 200, {"node_token": tok, "expires_in": TOKEN_DAYS * 86400, "account": {k: v for k, v in acct.items() if k != "revoked"}}

    def _account_for(self, bearer: str):
        a = self.tokens.get(_h(bearer)) if bearer else None
        return a if a and not a["revoked"] else None

    def approval_base(self) -> str:
        return self.approval_host or self.root_url

    # ---- the server
    def start(self) -> str:
        site = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _reply(self, code, obj):
                b = json.dumps(obj).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def _bearer(self):
                a = self.headers.get("Authorization") or ""
                return a[7:] if a.startswith("Bearer ") else ""

            def _go(self, method):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
                bearer = self._bearer()
                site.seen.append((method, self.path, bool(bearer)))
                p = self.path.split("?")[0]
                if p == "/node/device/code" and method == "POST":
                    return self._reply(*site._make_code(body))
                if p == "/node/device/token" and method == "POST":
                    return self._reply(*site._poll(body))
                if p == "/node/account" and method == "GET":
                    a = site._account_for(bearer)
                    return self._reply(200, {"account": {k: v for k, v in a.items() if k != "revoked"}}) if a else self._reply(401, {"error": "invalid_token"})
                if p == "/node/signout" and method == "POST":
                    a = site._account_for(bearer)
                    if not a:
                        return self._reply(401, {"error": "invalid_token"})
                    a["revoked"] = True
                    return self._reply(200, {"ok": True})
                if p == "/connect/ping":                       # the connector's door: a node token is NOT accepted here (audience separation)
                    return self._reply(401, {"error": "wrong_audience"})
                return self._reply(404, {"error": "not_found"})

            def do_GET(self):  # noqa: N802
                self._go("GET")

            def do_POST(self):  # noqa: N802
                self._go("POST")

        self._srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.root_url = f"http://127.0.0.1:{self._srv.server_address[1]}"
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()
        return self.root_url + "/node"

    def stop(self) -> None:
        if self._srv:
            self._srv.shutdown()
            self._srv.server_close()
            self._srv = None
