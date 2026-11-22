"""The listening-model download and the computer's proxy (CC1 11-22; customer step: a stranger on a network that needs a proxy gets the model).
MUST-FAILs, with nothing leaving this computer:
  A  with a proxy set, a REAL download (host huggingface.co) goes to that proxy, as a CONNECT tunnel to huggingface.co:443 (so TLS stays end to
     end with the host): a fake proxy on 127.0.0.1 records the request and refuses it, and the download is refused in words, keeping nothing
  B  NO_PROXY naming the host is honoured: the fake proxy sees nothing (proved on 127.0.0.2, never on a real host: a NO_PROXY test against
     huggingface.co would go out to the internet)
  C  a LOOPBACK server is never reached through a proxy (a dead proxy set, the local test server still answers)
  D  no proxy set: nothing is routed to a proxy
No real download happens: every connection to huggingface.co ends at the fake proxy, which answers 403.

    python tools/check-model-download-proxy.py
"""
import importlib.util
import os
import socket
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILED = []


def check(ok, name):
    print(("ok   " if ok else "FAIL ") + name, flush=True)
    if not ok:
        FAILED.append(name)


REAL_CONNECT = socket.create_connection
WENT_OUT = []


def loopback_only(address, *a, **k):
    """this check never leaves the computer: a connection to anything but 127.x is refused BEFORE any name lookup (so a broken proxy rule
    fails here, it never reaches the internet)"""
    host = str(address[0])
    if not host.startswith("127.") and host != "localhost":
        WENT_OUT.append(host)
        raise OSError(f"this check refuses a direct connection to {host}")
    return REAL_CONNECT(address, *a, **k)


socket.create_connection = loopback_only
spec = importlib.util.spec_from_file_location("model_download", ROOT / "tools" / "model_download.py")
md = importlib.util.module_from_spec(spec)
spec.loader.exec_module(md)
PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy")
SAVED = {k: os.environ.pop(k) for k in PROXY_VARS if k in os.environ}


class FakeProxy(BaseHTTPRequestHandler):
    seen = []

    def do_CONNECT(self):
        FakeProxy.seen.append(f"CONNECT {self.path}")
        self.send_error(403, "refused by the test proxy")

    def do_GET(self):
        FakeProxy.seen.append(f"GET {self.path}")
        self.send_error(403, "refused by the test proxy")

    def log_message(self, *a):
        pass


class Local(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"x"
        self.send_response(404)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def serve(handler, host="127.0.0.1"):
    srv = ThreadingHTTPServer((host, 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def attempt(root, net=None):
    try:
        md.download("tiny", root, net=net) if net is not None else md.download("tiny", root)
        return None
    except md.ModelRefused as e:
        return str(e)


def kept(root):
    return [p for p in Path(root).rglob("*") if p.is_file()]


proxy = serve(FakeProxy)
local = serve(Local)
local2 = serve(Local, "127.0.0.2")
pport, lport, lport2 = proxy.server_address[1], local.server_address[1], local2.server_address[1]
try:
    with tempfile.TemporaryDirectory(prefix="mdp-") as td:
        print("A. a proxy is set: the real host is reached through it, as a tunnel")
        os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = f"http://127.0.0.1:{pport}"
        FakeProxy.seen.clear()
        msg = attempt(Path(td) / "a")
        check(any(s.startswith("CONNECT huggingface.co:443") for s in FakeProxy.seen),
              f"MUST-FAIL: the download goes through the computer's proxy as CONNECT huggingface.co:443 (seen: {FakeProxy.seen[:2]})")
        check(not any(s.startswith("GET ") for s in FakeProxy.seen), "MUST-FAIL: never a plain GET through the proxy (TLS stays end to end with the host)")
        check(WENT_OUT == [], f"MUST-FAIL: with a proxy set, no direct connection to the host is even attempted ({WENT_OUT[:2]})")
        check(msg is not None and "Nothing was kept" in msg and "Windows' proxy settings" in msg and kept(Path(td) / "a") == [],
              f"MUST-FAIL: refused by the proxy, the download says so in words and keeps nothing ({(msg or '')[:90]!r})")

        print("B. NO_PROXY naming the host is honoured (on 127.0.0.2: not in the loopback rule, and never off this computer)")
        other = md.Net(scheme="http", host="127.0.0.2", port=lport2, domains=())
        FakeProxy.seen.clear()
        msg = attempt(Path(td) / "b1", net=other)
        check(any("127.0.0.2" in s for s in FakeProxy.seen), f"CONTROL: without NO_PROXY a non-loopback-rule host goes through the proxy ({FakeProxy.seen[:2]})")
        os.environ["NO_PROXY"] = "127.0.0.2"
        FakeProxy.seen.clear()
        msg = attempt(Path(td) / "b2", net=other)
        check(FakeProxy.seen == [] and msg is not None and "answered 404" in msg,
              f"MUST-FAIL: with NO_PROXY naming the host the proxy sees nothing and the server is reached directly ({FakeProxy.seen[:2]}, {(msg or '')[:60]!r})")
        del os.environ["NO_PROXY"]

        print("C. a loopback server is never reached through a proxy")
        os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"
        net = md.Net(scheme="http", host="127.0.0.1", port=lport, domains=())
        msg = attempt(Path(td) / "c", net=net)
        check(msg is not None and "answered 404" in msg, f"MUST-FAIL: with a dead proxy set, the loopback test server is still reached directly ({(msg or '')[:90]!r})")
        check(md._proxies(net) == {}, "the loopback rule: no proxy for 127.0.0.1")

        print("D. no proxy set")
        for k in PROXY_VARS:
            os.environ.pop(k, None)
        real = md.Net()
        got = md._proxies(real)
        check(all(not v.startswith(f"http://127.0.0.1:{pport}") for v in got.values()), "with no proxy variable, the fake proxy is not used")
        check(set(got) <= {"http", "https"}, "only http/https proxies are ever taken from the computer's settings")
finally:
    proxy.shutdown()
    local.shutdown()
    local2.shutdown()
    for k in PROXY_VARS:
        os.environ.pop(k, None)
    os.environ.update(SAVED)

if FAILED:
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print("  " + f)
    sys.exit(1)
print("ALL PASS")
