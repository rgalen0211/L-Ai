"""Sign in to Ryagram from the desktop app (NEXT-CONNECT 98, r9 milestone M1). Standard library only.

WHAT IT DOES. The person presses "Sign in to Ryagram". The app asks the site for a short code, shows it, and the person approves THIS computer on the website
while signed in there (device authorization, RFC 8628 in shape). **No password is typed into the app.** On approval the site hands back a narrow, opaque node
token. The token is kept in the Windows Credential Manager (CRED_TYPE_GENERIC, persisted for this computer only, never the roaming kind), and nowhere else:
not in a file, a log, a receipt, the kit, a URL or any page text. What IS kept in a file is non-secret account state (email, computer name, dates) so the page can
say who is signed in and the 7-day offline grace can be counted.

WHAT IT DOES NOT DO (CC1 13:20 and 13:34, the plan's section 12). The cached state only ever gates the app's own LOCAL clip films and the "node paused"
message; it authorises nothing on the server. Any program running as the person can read the Credential Manager entry, as it can read a browser cookie: that
is said to the person in the page, not hidden. The token is never put in a query string. A server reply that names an approval address on a host we were not told about is refused.

THE SITE API THIS TALKS TO (the contract; tools/fake_ryagram_site.py is the executable copy used by the tests; names are proposals until WORKER's SQL and WEB's
edge function exist). `site` is the base address of the node edge function:

    POST {site}/device/code    {computer_name, app}                -> {device_code, user_code, verification_uri, verification_uri_complete?, expires_in, interval}
    POST {site}/device/token   {device_code}                       -> {node_token, expires_in, account:{email, computer_name, local_compute}}
                                                                      or 400 {error: authorization_pending | slow_down | access_denied | expired_token}
    GET  {site}/account        Authorization: Bearer <node token>   -> {account:{email, computer_name, local_compute, approved_until}}  (401: removed)
    POST {site}/signout        Authorization: Bearer <node token>   -> {ok:true}  (this computer is removed on the server)

Nothing here is live. With no site configured the maker shows no sign-in card and behaves exactly as r8.
"""
from __future__ import annotations

import ctypes
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

GRACE_SECONDS = 7 * 24 * 3600                      # CC1 13:34 point 5: gates local clip films and the "node paused" note ONLY
TARGET_PREFIX = "Ryagram/node/"                    # CC1 13:34 point 6: Ryagram/node/<site>
CACHE_NAME = "ryagram-account.json"
USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"        # no 0, O, 1, I or L (CC1 13:34 point 1)
USER_CODE_RE = re.compile(r"^[%s]{4}-[%s]{4}$" % (USER_CODE_ALPHABET, USER_CODE_ALPHABET))
DEVICE_CODE_RE = re.compile(r"^[A-Za-z0-9_\-]{32,512}$")        # the secret the app polls with: 32 or more characters from the site
TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-.]{32,1800}$")
LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")
MAX_REPLY = 100_000
MAX_CODE_SECONDS = 900                             # the site says 10 minutes; anything longer than 15 is refused as a bad reply
CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2                     # never CRED_PERSIST_ENTERPRISE (3), which roams with the account
ERROR_NOT_FOUND = 1168
MAX_BLOB = 2560                                    # the Credential Manager's own limit for a generic credential


class SignInError(Exception):
    """A plain sentence for the person. `kind` is a short word for the log's counts (never the sentence)."""
    def __init__(self, message: str, kind: str = "other"):
        super().__init__(message)
        self.kind = kind


# ------------------------------------------------------------------------------------------------------------------ the token store
class MemoryStore:
    """The FAKE store for tests: a dict, never a file."""
    def __init__(self):
        self.items: dict[str, str] = {}

    def read(self, target):
        return self.items.get(target)

    def write(self, target, secret):
        self.items[target] = secret

    def delete(self, target):
        self.items.pop(target, None)


class WindowsCredentialStore:
    """Windows Credential Manager over ctypes: no new dependency. Current user, this computer only (CRED_PERSIST_LOCAL_MACHINE)."""
    def __init__(self):
        if sys.platform != "win32":
            raise SignInError("Signing in needs the Windows Credential Manager, which this computer does not have. Nothing was stored.", "store")
        from ctypes import wintypes
        adv = ctypes.WinDLL("advapi32", use_last_error=True)

        class CREDENTIAL(ctypes.Structure):
            _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD), ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
                        ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD), ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
                        ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
                        ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]
        pcred = ctypes.POINTER(CREDENTIAL)
        adv.CredWriteW.argtypes = [pcred, wintypes.DWORD]
        adv.CredWriteW.restype = wintypes.BOOL
        adv.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(pcred)]
        adv.CredReadW.restype = wintypes.BOOL
        adv.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
        adv.CredDeleteW.restype = wintypes.BOOL
        adv.CredFree.argtypes = [ctypes.c_void_p]
        adv.CredFree.restype = None
        self._adv, self._CRED, self._pcred = adv, CREDENTIAL, pcred

    def read(self, target):
        out = self._pcred()
        if not self._adv.CredReadW(target, CRED_TYPE_GENERIC, 0, ctypes.byref(out)):
            err = ctypes.get_last_error()
            if err == ERROR_NOT_FOUND:
                return None
            raise SignInError(f"The Windows Credential Manager would not read the saved sign-in (error {err}).", "store")
        try:
            c = out.contents
            return ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize).decode("utf-8") if c.CredentialBlobSize else ""
        finally:
            self._adv.CredFree(out)

    def write(self, target, secret):
        blob = secret.encode("utf-8")
        if len(blob) > MAX_BLOB:
            raise SignInError("The sign-in token is too large to store safely, so nothing was stored.", "store")
        buf = (ctypes.c_ubyte * max(1, len(blob))).from_buffer_copy(blob or b"\0")
        c = self._CRED()
        c.Type, c.TargetName, c.CredentialBlobSize = CRED_TYPE_GENERIC, target, len(blob)
        c.CredentialBlob = ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))
        c.Persist, c.UserName = CRED_PERSIST_LOCAL_MACHINE, "Ryagram"
        if not self._adv.CredWriteW(ctypes.byref(c), 0):
            raise SignInError(f"The Windows Credential Manager would not save the sign-in (error {ctypes.get_last_error()}). Nothing was stored.", "store")

    def delete(self, target):
        if not self._adv.CredDeleteW(target, CRED_TYPE_GENERIC, 0) and ctypes.get_last_error() != ERROR_NOT_FOUND:
            raise SignInError("The Windows Credential Manager would not remove the saved sign-in. Remove it in Windows: Control Panel, Credential Manager, Windows Credentials.", "store")


def default_store():
    """The real store, or a refusal. There is NO file fallback: a token that cannot be stored safely is not stored."""
    return WindowsCredentialStore()


# ------------------------------------------------------------------------------------------------------------------ the network
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def check_site(site: str) -> tuple[str, str]:
    """(base, host). https only; plain http only for this computer itself (tests and the fake site)."""
    u = urllib.parse.urlparse((site or "").strip())
    host = (u.hostname or "").lower()
    local = host in ("127.0.0.1", "localhost", "::1")
    if u.scheme != "https" and not (u.scheme == "http" and local):
        raise SignInError("The site address must start with https:// .", "site")
    if not host or u.username or u.password or u.query or u.fragment:
        raise SignInError("That site address is not valid.", "site")
    netloc = f"[{host}]" if host == "::1" else host
    if u.port:
        netloc += f":{u.port}"
    return f"{u.scheme}://{netloc}{u.path.rstrip('/')}", netloc


class UrlTransport:
    """transport(method, path, body=None, bearer=None) -> (status, dict). No redirects. Replies are capped. Headers are never logged."""
    def __init__(self, base: str, timeout: float = 10.0):
        self.base, self.timeout = base, timeout
        local = urllib.parse.urlparse(base).hostname in ("127.0.0.1", "localhost", "::1")
        handlers = [_NoRedirect()] + ([urllib.request.ProxyHandler({})] if local else [])
        self._opener = urllib.request.build_opener(*handlers)

    def __call__(self, method, path, body=None, bearer=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "Ryagram-desktop/r9")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if bearer:
            req.add_header("Authorization", "Bearer " + bearer)
        try:
            with self._opener.open(req, timeout=self.timeout) as r:
                status, raw = r.status, r.read(MAX_REPLY + 1)
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read(MAX_REPLY + 1)
        except (urllib.error.URLError, TimeoutError, OSError):
            raise SignInError("I could not reach the Ryagram site. Check this computer's internet connection and try again.", "offline") from None
        if len(raw) > MAX_REPLY:
            raise SignInError("The site sent a reply that is too large, so I ignored it.", "bad_reply")
        try:
            obj = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            raise SignInError("The site sent a reply I could not read.", "bad_reply") from None
        return status, obj if isinstance(obj, dict) else {}


# ------------------------------------------------------------------------------------------------------------------ the client
def _iso(t: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(t))


def _int_in(v, lo, hi, default):
    return v if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi else default


class SignIn:
    def __init__(self, site: str, store, folder, *, transport=None, clock=time.time, computer_name: str = "", approval_hosts=(), log=None):
        self.base, self.host = check_site(site)
        self.store = store
        self.cache_path = Path(folder) / CACHE_NAME
        self.transport = transport or UrlTransport(self.base)
        self.clock = clock
        self.computer = re.sub(r"[^\w .\-]", "", computer_name or "")[:60].strip() or "This computer"
        self.approval_hosts = {self.host} | {h.lower() for h in approval_hosts}
        self.target = TARGET_PREFIX + self.host
        self._log = log or (lambda ev: None)
        self._wait = None                           # the code in progress; the device secret lives ONLY here, in memory
        self._lock = threading.RLock()

    # ---- account state that is not secret
    def _read_cache(self):
        try:
            c = json.loads(self.cache_path.read_text(encoding="utf-8"))
            return c if isinstance(c, dict) and c.get("site_host") == self.host else None
        except (OSError, ValueError):
            return None

    def _write_cache(self, acct: dict, last_ok: float, approved_until=None):
        c = {"schema": "ryagram.signin-cache/0", "site_host": self.host, "email": str(acct.get("email", ""))[:200], "computer_name": str(acct.get("computer_name") or self.computer)[:60],
             "local_compute": bool(acct.get("local_compute")), "approved_until": approved_until, "last_ok": last_ok}
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(c), encoding="utf-8")
        except OSError:
            pass                                    # the card then shows less; nothing secret is lost

    def _forget(self):
        self.store.delete(self.target)                  # if this fails the token is still there, so the cache stays and the error is shown
        try:
            self.cache_path.unlink(missing_ok=True)
        except OSError:
            pass

    def _token(self):
        t = self.store.read(self.target)
        return t if t else None

    # ---- what the page may see (never a token, never the device secret)
    def status(self) -> dict:
        with self._lock:
            now = self.clock()
            tok = self._token()
            out = {"enabled": True, "site": self.host, "computer_name": self.computer}
            if self._wait and now >= self._wait["expires_at"]:
                self._wait = None
            if self._wait and not tok:
                w = self._wait
                out.update(state="waiting", user_code=w["user_code"], open_url=w["open_url"], expires_at=int(w["expires_at"]), seconds_left=int(w["expires_at"] - now), interval=w["interval"])
                return out
            if not tok:
                if self.cache_path.exists():        # the Credential Manager entry was removed behind our back: the cache goes with it
                    try:
                        self.cache_path.unlink()
                    except OSError:
                        pass
                out["state"] = "signed_out"
                return out
            c = self._read_cache() or {}
            last_ok = float(c.get("last_ok") or 0)
            g = self.gate()
            out.update(state="signed_in", email=c.get("email", ""), computer_name=c.get("computer_name", self.computer), approved_until=c.get("approved_until"),
                       last_checked=_iso(last_ok) if last_ok else "", grace_days_left=max(0, int((last_ok + GRACE_SECONDS - now) // 86400)) if last_ok else 0,
                       clip_films=g["clip_films"], node_allowed=g["node"], note=g["note"])
            return out

    def gate(self) -> dict:
        """What the cached state lets the APP do on this computer. It never authorises anything on the server."""
        with self._lock:
            if not self._token():
                return {"clip_films": True, "node": False, "note": ""}           # signed out = the r8 behaviour; sign-in is optional until Ryan decides otherwise
            c = self._read_cache() or {}
            last_ok = float(c.get("last_ok") or 0)
            fresh = last_ok > 0 and self.clock() - last_ok <= GRACE_SECONDS
            if not fresh:
                return {"clip_films": False, "node": False, "note": "Your account has not been checked for 7 days. Connect to the internet once and press Check my account, then you can make films again."}
            return {"clip_films": True, "node": bool(c.get("local_compute")),
                    "note": "" if c.get("local_compute") else "This account does not render site films on this computer."}

    # ---- the steps
    def begin(self) -> dict:
        with self._lock:
            if self._token():
                raise SignInError("This computer is already signed in. Remove it first if you want to sign in again.", "state")
            status, r = self.transport("POST", "/device/code", {"computer_name": self.computer, "app": "ryagram-desktop"})
            if status == 429:
                raise SignInError("Too many sign-in tries. Wait a minute and try again.", "rate")
            if status != 200:
                raise SignInError("The site would not start a sign-in. Try again in a minute.", "refused")
            user_code, device_code = str(r.get("user_code", "")).upper(), r.get("device_code")
            if not USER_CODE_RE.match(user_code) or not isinstance(device_code, str) or not DEVICE_CODE_RE.match(device_code):
                raise SignInError("The site sent a sign-in code that does not look right, so I stopped. Nothing was stored.", "bad_reply")
            open_url = None
            for key in ("verification_uri_complete", "verification_uri"):
                u = urllib.parse.urlparse(str(r.get(key) or ""))
                local = (u.hostname or "") in ("127.0.0.1", "localhost", "::1")
                host = (u.netloc or "").lower()
                if (u.scheme == "https" or (u.scheme == "http" and local)) and host in self.approval_hosts and not u.username and not u.password:
                    open_url = str(r.get(key))
                    break
            if not open_url:
                raise SignInError("The site sent an approval address I do not recognise, so I stopped. Nothing was stored.", "bad_reply")
            now = self.clock()
            self._wait = {"device_code": device_code, "user_code": user_code, "open_url": open_url, "interval": _int_in(r.get("interval"), 1, 60, 5),
                          "expires_at": now + _int_in(r.get("expires_in"), 30, MAX_CODE_SECONDS, 600), "next_poll_at": now}
            self._log("signin_started")
            return self.status()

    def poll(self) -> dict:
        with self._lock:
            w = self._wait
            if not w:
                return self.status()
            now = self.clock()
            if now >= w["expires_at"]:
                self._wait = None
                self._log("signin_ended")
                return {**self.status(), "state": "expired", "message": "The code ended. Press Sign in for a new one."}
            if now < w["next_poll_at"]:                 # the client keeps to the interval itself: polling faster is refused by the site as well
                return self.status()
            status, r = self.transport("POST", "/device/token", {"device_code": w["device_code"]})
            err = str(r.get("error", "")) if status != 200 else ""
            if status == 200 and r.get("node_token"):
                return self._accept(r, now)
            if err == "authorization_pending":
                w["next_poll_at"] = now + w["interval"]
                return self.status()
            if err == "slow_down":
                w["interval"] = min(60, w["interval"] + 5)
                w["next_poll_at"] = now + w["interval"]
                return self.status()
            self._wait = None
            self._log("signin_ended")
            if err == "access_denied":
                return {**self.status(), "state": "denied", "message": "The website said no to this computer. If that was a mistake, press Sign in and try again."}
            if err == "expired_token":
                return {**self.status(), "state": "expired", "message": "The code ended. Press Sign in for a new one."}
            raise SignInError("The site gave an answer I did not expect, so I stopped. Nothing was stored.", "bad_reply")

    def _accept(self, r: dict, now: float) -> dict:
        tok, acct = r.get("node_token"), r.get("account")
        if not isinstance(tok, str) or not TOKEN_RE.match(tok) or not isinstance(acct, dict):
            self._wait = None
            raise SignInError("The site sent a sign-in I could not trust, so nothing was stored.", "bad_reply")
        self.store.write(self.target, tok)                          # the ONLY place the token is kept
        life = _int_in(r.get("expires_in"), 60, 400 * 24 * 3600, 30 * 24 * 3600)
        self._write_cache(acct, now, _iso(now + life))
        self._wait = None
        self._log("signin_done")
        return self.status()

    def cancel(self) -> dict:
        with self._lock:
            self._wait = None
            return self.status()

    def check(self) -> dict:
        """Ask the site who this computer is. Success renews the 7 days. A refusal means it was removed on the website."""
        with self._lock:
            tok = self._token()
            if not tok:
                return self.status()
            status, r = self.transport("GET", "/account", None, tok)
            if status in (401, 403):
                self._forget()
                self._log("signin_removed")
                return {**self.status(), "message": "This computer was removed from your account on the website, so it is signed out here."}
            acct = r.get("account") if isinstance(r.get("account"), dict) else None
            if status != 200 or acct is None:
                raise SignInError("The site would not check the account just now. Try again in a minute.", "refused")
            self._write_cache(acct, self.clock(), acct.get("approved_until") if isinstance(acct.get("approved_until"), str) else (self._read_cache() or {}).get("approved_until"))
            return self.status()

    def remove(self) -> dict:
        """Remove THIS computer: tell the site if we can, and always forget the token here."""
        with self._lock:
            tok = self._token()
            told, note = False, ""
            if tok:
                try:
                    status, _ = self.transport("POST", "/signout", {}, tok)
                    told = status == 200
                except SignInError:
                    told = False
                if not told:
                    note = "This computer is signed out here. I could not tell the website, so also press Remove next to this computer in your account on the website."
            self._forget()
            self._wait = None
            self._log("signin_removed")
            return {**self.status(), "message": note or "Removed from this computer."}
