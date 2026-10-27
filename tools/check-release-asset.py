"""Is the file the website points to the file that was built? (NEXT-CONNECT 133; CC1 2026-10-26 20:01.) Run it AFTER the release exists and BEFORE assets/windows-release.js goes live.

    python tools/check-release-asset.py --zip D:/.../app-NNN.zip --url "<a fresh presigned link>"           the link answers 200 with the zip's exact size (a HEAD request: no file is downloaded)
    python tools/check-release-asset.py --zip D:/.../app-NNN.zip --url "<a fresh presigned link>" --hash    and the downloaded bytes hash to the record's SHA-256 (streams the whole file once: about 270 MB)
    (the record's own url is the app-download FUNCTION, which cannot be fetched without a person's sign-in; the link it returns is what is checked: Ryan makes one with the card and passes it here)
    python tools/check-release-asset.py --selftest                          the checks of this checker against a local test server (nothing leaves this computer)

The record is assets/windows-release.js (read as text; nothing is run): its file name and SHA-256 are compared with the built zip. The link must be https on the private bucket's own address
(<account>.r2.cloudflarestorage.com) and a redirect may only stay there. Standard library only."""
import argparse
import hashlib
import http.server
import re
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = ("r2.cloudflarestorage.com",)                    # the private bucket's own address (a presigned link); a host or a subdomain of this
FAILED = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILED.append(what)


def host_ok(host, allowed=ALLOWED):
    host = (host or "").lower().rstrip(".")
    return any(host == a or host.endswith("." + a) for a in allowed)


def read_record(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    rec = {}
    for k in ("url", "fileName", "sha256", "sizeMb", "unpackedMb"):
        m = re.search(rf"\b{k}:\s*(null|'[^']*'|\"[^\"]*\"|[0-9.]+)", text)
        v = m.group(1) if m else "null"
        rec[k] = None if v == "null" else (v[1:-1] if v[0] in "'\"" else float(v))
    return rec


class _Guard(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed):
        self.allowed = allowed

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        if u.scheme != "https" and not self.allowed_local(u) or not host_ok(u.hostname, self.allowed):
            raise urllib.error.URLError(f"a redirect to {u.hostname} is not allowed")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

    def allowed_local(self, u):
        return u.hostname in ("127.0.0.1", "localhost") and "127.0.0.1" in self.allowed


def open_url(url, allowed, method="HEAD"):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}), _Guard(allowed))
    return op.open(urllib.request.Request(url, method=method, headers={"User-Agent": "ryagram-release-check"}), timeout=60)


def verify(rec, zip_path: Path, do_hash: bool, allowed=ALLOWED, url_override=None):
    url, name, sha = (url_override or rec.get("url")), rec.get("fileName"), rec.get("sha256")
    check(bool(url and name and sha), "the record has an address, a file name and a SHA-256")
    if not (url and name and sha):
        return
    u = urllib.parse.urlsplit(url)
    check((u.scheme == "https" or (u.hostname == "127.0.0.1" and "127.0.0.1" in allowed)) and host_ok(u.hostname, allowed), f"the address is https on an allowed host ({u.hostname})")
    check(url_override is None or urllib.parse.unquote(u.path).rsplit("/", 1)[-1] == name, "the link's object name is the record's file name")
    check(url_override is not None or "app-download" in u.path, "(no link was given: the record's own address is the function, which cannot be fetched without a sign-in; give --url)")
    want_bytes = zip_path.stat().st_size
    want_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    check(want_sha == sha, f"the record's SHA-256 equals the built zip's ({want_sha[:12]}...)")
    try:
        with open_url(url, allowed) as r:
            got = int(r.headers.get("Content-Length", "-1"))
            check(r.status == 200 and got == want_bytes, f"the address answers 200 with the zip's exact size ({got} bytes; the zip is {want_bytes})")
    except (urllib.error.URLError, OSError, ValueError) as e:
        check(False, f"the address answers: {e}")
        return
    if do_hash:
        h, n = hashlib.sha256(), 0
        with open_url(url, allowed, "GET") as r:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                n += len(b)
                h.update(b)
        check(n == want_bytes and h.hexdigest() == sha, f"the downloaded bytes ({n}) hash to the record's SHA-256")


def selftest():
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="relasset-"))
    body = bytes(range(256)) * 1000
    sha = hashlib.sha256(body).hexdigest()
    z = tmp / "app.zip"
    z.write_bytes(body)
    mode = {"m": "ok"}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_HEAD(self):  # noqa: N802
            self._go(False)

        def do_GET(self):  # noqa: N802
            self._go(True)

        def _go(self, send):
            if mode["m"] == "redirect":
                self.send_response(302); self.send_header("Location", "https://evil.example/x.zip"); self.end_headers(); return
            if mode["m"] == "404":
                self.send_response(404); self.end_headers(); return
            data = body if mode["m"] != "flip" else body[:-1] + b"\x00"
            n = len(data) + (5 if mode["m"] == "size" else 0)
            self.send_response(200); self.send_header("Content-Length", str(n)); self.end_headers()
            if send:
                self.wfile.write(data)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    allowed = ("127.0.0.1",)
    rec = {"url": f"http://127.0.0.1:{port}/app.zip", "fileName": "app.zip", "sha256": sha}

    def run(mutate=None, m="ok", do_hash=False):
        mode["m"] = m
        before = len(FAILED)
        import io
        out, sys.stdout = sys.stdout, io.StringIO()
        try:
            merged = {**rec, **(mutate or {})}
            verify(merged, z, do_hash, allowed, url_override=merged["url"])
        finally:
            sys.stdout = out
        return len(FAILED) - before
    n_ok = run(do_hash=True)
    print("  ok   " if n_ok == 0 else "  FAIL ", "a matching asset passes every check, hashed too")
    for label, kw in (("a record whose SHA-256 differs from the zip", dict(mutate={"sha256": "0" * 64})), ("a wrong file name", dict(mutate={"fileName": "other.zip"})),
                      ("an address that answers 404", dict(m="404")), ("an asset of another size", dict(m="size")), ("a redirect to another host", dict(m="redirect")),
                      ("bytes that differ (same size)", dict(m="flip", do_hash=True))):
        before = len(FAILED)
        bad = run(**kw)
        del FAILED[before:]                                   # these failures are the expected ones
        print("  ok   " if bad > 0 else "  FAIL ", f"MUST-FAIL: {label} is caught")
        if bad == 0:
            FAILED.append(label)
    srv.shutdown()
    print("all passed" if not FAILED else f"FAILED: {FAILED}")
    return 1 if FAILED else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip")
    ap.add_argument("--hash", action="store_true")
    ap.add_argument("--url", default="", help="a fresh presigned link made by the card (the checker never makes one)")
    ap.add_argument("--record", default=str(ROOT / "assets" / "windows-release.js"))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.zip:
        sys.exit("give --zip <the built zip>")
    verify(read_record(Path(a.record)), Path(a.zip), a.hash, url_override=a.url or None)
    print("all passed" if not FAILED else f"FAILED: {len(FAILED)}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
