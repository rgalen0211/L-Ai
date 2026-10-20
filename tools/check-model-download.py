"""The listening-model download (NEXT-CONNECT 106): every rule of CC1's 17:15 post, tried against a local test server (nothing leaves this computer), plus the real Tiny files
(compared byte for byte with the pinned sizes and SHA-256) and the app's own plumbing. Standard library only; faster-whisper is used only if it is installed.

    python tools/check-model-download.py [<scratch base folder>] [<a folder holding the real Tiny files: config.json model.bin tokenizer.json vocabulary.txt>]
"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else None
sys.path.insert(0, str(ROOT / "tools"))
import model_download as md  # noqa: E402

FAILED = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILED.append(what)


def sha(b):
    return hashlib.sha256(b).hexdigest()


# ---------------------------------------------------------------- a fake model with small files, pinned like the real ones
FAKE = {"config.json": b'{"a": 1}\n' * 20, "model.bin": bytes(range(256)) * 4000, "tokenizer.json": b"{}" * 500, "vocabulary.txt": b"hello\nworld\n" * 50}
REV = "f" * 40
md.PINS["fake"] = {"repo": "Systran/faster-whisper-fake", "revision": REV, "files": tuple((n, len(b), sha(b)) for n, b in FAKE.items())}


class State:
    mode = {}          # file name -> behaviour
    hits = []          # every path asked for
    lock = threading.Lock()


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def do_GET(self):  # noqa: N802
        with State.lock:
            State.hits.append(self.path)
        if self.path.endswith("/../escape.bin"):          # a server that WOULD serve a name with .. in it (the app must never ask)
            self.send_response(200); self.send_header("Content-Length", "3"); self.end_headers(); self.wfile.write(b"abc"); return
        if self.path.startswith("/cdn/"):
            return self.serve(self.path.split("/")[-1], State.mode.get("cdn-" + self.path.split("/")[-1], "ok"))
        m = re.fullmatch(r"/Systran/faster-whisper-(fake|tiny)/resolve/([0-9a-f]{40})/([A-Za-z0-9._-]+)", self.path)
        if not m:
            self.send_response(404); self.end_headers(); return
        name = m.group(3)
        self.serve(name, State.mode.get(name, "ok"), real=(m.group(1) == "tiny"))

    def serve(self, name, mode, real=False):
        body = (REAL[name] if real else FAKE[name])
        if mode == "404":
            self.send_response(404); self.end_headers(); return
        if mode.startswith("redirect:"):
            self.send_response(302); self.send_header("Location", mode[len("redirect:"):]); self.end_headers(); return
        if mode == "cdn":
            self.send_response(302); self.send_header("Location", f"http://127.0.0.1:{PORT}/cdn/{name}"); self.end_headers(); return
        send = body
        if mode == "flip":
            send = bytes([body[0] ^ 1]) + body[1:]
        if mode == "short":
            send = body[:-5]
        if mode == "long":
            send = body + b"EXTRA"
        self.send_response(200)
        if mode not in ("nolen",):
            self.send_header("Content-Length", str(len(body) if mode in ("short", "long-announced-ok") else len(send) if mode != "lie-big" else len(body) + 7))
        self.end_headers()
        for i in range(0, len(send), 65536):
            self.wfile.write(send[i:i + 65536])
            if mode == "slow":
                import time; time.sleep(0.05)


REAL = {}
srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
NET = md.Net(scheme="http", host="127.0.0.1", port=PORT, domains=())


def fresh(tmp, name):
    d = tmp / name
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    State.mode = {}
    State.hits = []
    return d


def refused(model, root, what, **kw):
    try:
        md.download(model, root, net=kw.pop("net", NET), **kw)
    except md.ModelRefused as e:
        return str(e)
    except md.Cancelled:
        return "cancelled"
    return None


def left_over(root):
    return sorted(p.name for p in Path(root).iterdir())


def main():
    tmp = Path(tempfile.mkdtemp(prefix="model-dl-", dir=BASE if BASE else None))
    try:
        # ------------------------------------------------------------------ A. a good download
        print("a good download (a small stand-in model, pinned like the real ones)")
        root = fresh(tmp, "a")
        seen = []
        out = md.download("fake", root, progress=lambda d, t, n: seen.append((d, t, n)), net=NET)
        check(out == md.final_dir(root, "fake"), "the files land in the layout the engine reads: models--Systran--faster-whisper-<size>/snapshots/<revision>/")
        check(all((out / n).read_bytes() == b for n, b in FAKE.items()), "every file is byte for byte what the server sent")
        check((root / "models--Systran--faster-whisper-fake" / "refs" / "main").read_text() == REV, "refs/main names the pinned revision")
        check(left_over(root) == ["models--Systran--faster-whisper-fake"], f"no staging folder is left behind ({left_over(root)})")
        total = sum(len(b) for b in FAKE.values())
        check(seen and seen[-1][0] == total and seen[-1][1] == total and [x[0] for x in seen] == sorted(x[0] for x in seen), "progress counts up to the pinned total and never goes back")
        hits = len(State.hits)
        md.download("fake", root, net=NET)
        check(len(State.hits) == hits and md.is_complete(root, "fake"), "a model that is already complete downloads nothing (no request was made)")
        check(all(h.startswith("/Systran/faster-whisper-fake/resolve/" + REV + "/") for h in State.hits), "every request went to the written-in repo and revision, one per pinned file name")

        root = fresh(tmp, "a2")
        State.mode = {"model.bin": "cdn"}
        md.download("fake", root, net=md.Net(scheme="http", host="127.0.0.1", port=PORT, domains=("127.0.0.1",)))
        check(md.is_complete(root, "fake") and any(h.startswith("/cdn/") for h in State.hits), "a redirect to the host's own content domain is followed and the file is still checked")

        # ------------------------------------------------------------------ B. refusals: each leaves nothing behind
        print("\nrefusals (each must keep NOTHING)")
        cases = [
            ("MUST-FAIL: same size, one byte different (a planted wrong hash)", {"model.bin": "flip"}, "check number"),
            ("MUST-FAIL: a file shorter than announced", {"vocabulary.txt": "short"}, ("ended early", "interrupted")),
            ("MUST-FAIL: a file longer than the pinned size", {"tokenizer.json": "long"}, "not the size"),
            ("MUST-FAIL: a server that does not announce the size", {"config.json": "nolen"}, "not the size"),
            ("MUST-FAIL: a server that announces another size", {"config.json": "lie-big"}, "not the size"),
            ("MUST-FAIL: the server answers 404", {"model.bin": "404"}, "answered 404"),
            ("MUST-FAIL: a redirect to a host that is not on the list", {"model.bin": "redirect:http://127.0.0.2:%d/cdn/model.bin" % PORT}, "not on the allowed list"),
            ("MUST-FAIL: a redirect with a user name in the address", {"model.bin": "redirect:http://user:pw@127.0.0.1:%d/cdn/model.bin" % PORT}, "not on the allowed list"),
            ("MUST-FAIL: a redirect to another port of the same host", {"model.bin": "redirect:http://127.0.0.1:%d/cdn/model.bin" % (PORT + 1)}, "not allowed"),
            ("MUST-FAIL: a redirect to a different scheme (https for http)", {"model.bin": "redirect:https://127.0.0.1:%d/cdn/model.bin" % PORT}, "not allowed"),
        ]
        for what, mode, word in cases:
            root = fresh(tmp, "b")
            State.mode = mode
            State.hits = []
            msg = refused("fake", root, what)
            check(msg is not None and any(w in msg for w in ((word,) if isinstance(word, str) else word)) and left_over(root) == [], f"{what}: refused ({(msg or 'NOT REFUSED')[:70]!r}) and the models folder is empty ({left_over(root)})")
        # the last file bad, the first three good: still nothing kept
        root = fresh(tmp, "b2")
        State.mode = {"vocabulary.txt": "flip"}
        msg = refused("fake", root, "last file bad")
        check(msg is not None and left_over(root) == [], "MUST-FAIL: three good files and a bad fourth keep NOTHING (not even the good three)")

        root = fresh(tmp, "b3")
        State.mode = {"model.bin": "slow"}
        ev = threading.Event()
        res = refused("fake", root, "cancel", cancel=ev, progress=lambda d, t, n: ev.set() if d > 70000 else None)
        check(res == "cancelled" and left_over(root) == [], f"cancel in the middle of a file keeps nothing ({res}, {left_over(root)})")

        # a hop that is on the list is also checked for the scheme/port with the REAL (https) settings
        real = md.Net()
        for url, ok in (("https://huggingface.co/x", True), ("https://cdn-lfs.hf.co/x", True), ("https://cas-bridge.xethub.hf.co/x", True), ("http://huggingface.co/x", False),
                        ("https://huggingface.co.evil.com/x", False), ("https://evilhuggingface.co/x", False), ("https://hf.co.evil.net/x", False), ("https://u:p@huggingface.co/x", False),
                        ("https://huggingface.co:8443/x", False), ("ftp://huggingface.co/x", False), ("https://127.0.0.1/x", False), ("https://huggingface.co@evil.com/x", False)):
            try:
                md.check_hop(url, real); got = True
            except md.ModelRefused:
                got = False
            check(got == ok, f"{'MUST-FAIL: ' if not ok else ''}the real settings {'accept' if ok else 'refuse'} {url}")
        check(md.HOST == "huggingface.co" and md.REDIRECT_DOMAINS == ("huggingface.co", "hf.co"), "the written-in host and its content domains are exactly huggingface.co and hf.co")

        # unknown model, unsafe name, no room
        root = fresh(tmp, "c")
        check(refused("whisper-large", root, "unknown") is not None and left_over(root) == [], "MUST-FAIL: a model that has no pin is refused")
        md.PINS["evil"] = {"repo": "Systran/faster-whisper-fake", "revision": REV, "files": (("../escape.bin", 3, sha(b"abc")),)}
        check(refused("evil", root, "name") is not None and not (root / "escape.bin").exists() and not (root.parent / "escape.bin").exists() and left_over(root) == [], "MUST-FAIL: a pinned name with .. or a slash is refused and nothing is written outside")
        del md.PINS["evil"]
        keep = md.free_bytes_needed
        md.free_bytes_needed = lambda m: 1 << 60
        msg = refused("fake", root, "space")
        md.free_bytes_needed = keep
        check(msg is not None and "free space" in msg and left_over(root) == [], "MUST-FAIL: too little free space is said in plain words and nothing is started")
        check(all(re.fullmatch(r"[0-9a-f]{64}", h) and md.NAME_OK.match(n) and b > 0 for k, v in md.PINS.items() if k != "fake" for n, b, h in v["files"]), "every pin is a size and 64 hex characters, with a plain file name")
        check(all(re.fullmatch(r"[0-9a-f]{40}", v["revision"]) for v in md.PINS.values()), "every revision is a full commit id, never a branch name")

        # ------------------------------------------------------------------ C. the REAL Tiny files against the pins
        print("\nthe real Tiny model (the copy the engine downloaded earlier on this PC)")
        tdir = Path(sys.argv[2]) if len(sys.argv) > 2 else next(iter(sorted(Path.home().glob(".cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots/*"))), None)
        if not tdir or not (tdir / "model.bin").exists():
            print("  skip  no real Tiny files found (pass the folder as the second argument)")
        else:
            for n, b, h in md.PINS["tiny"]["files"]:
                REAL[n] = (tdir / n).read_bytes()
            check(all(len(REAL[n]) == b and sha(REAL[n]) == h for n, b, h in md.PINS["tiny"]["files"]), "the pinned sizes and SHA-256 of Tiny equal the real files of the earlier download (all four)")
            root = fresh(tmp, "t")
            md.download("tiny", root, net=NET)
            check(md.is_complete(root, "tiny") and md.final_dir(root, "tiny").name == md.PINS["tiny"]["revision"] == tdir.name, "the real Tiny model downloads from the test server, passes the pins, and sits where the earlier copy sits")
            if importlib.util.find_spec("faster_whisper"):
                from faster_whisper import WhisperModel
                m = WhisperModel("tiny", device="cpu", compute_type="int8", download_root=str(root), local_files_only=True)
                check(m is not None, "the real engine library loads the downloaded Tiny model from that folder (offline)")
            else:
                print("  skip  faster-whisper is not installed here: the load test is skipped")

        # ------------------------------------------------------------------ D. the source says what the rules say
        print("\nthe source")
        src = (ROOT / "tools" / "model_download.py").read_text(encoding="utf-8")
        body = src.split('"""', 2)[2]
        for bad in ("exec(", "eval(", "import subprocess", "import zipfile", "import tarfile", "import importlib", "import pickle", "import marshal", "os.system", "__import__", "ctypes", "webbrowser"):
            check(bad not in body, f"MUST-FAIL: model_download.py never uses {bad}")
        check(len(re.findall(r"\.open\(|urlopen\(", body)) == 1, "the download code opens a network connection in exactly one place")
        dm_src = (ROOT / "tools" / "desktop_maker.py").read_text(encoding="utf-8")
        check("urllib.request" not in dm_src and "urlopen" not in dm_src and "http.client" not in dm_src and "import socket" not in dm_src, "the maker app itself has no network code (it only calls model_download)")
        check(re.findall(r"md\.download\(([^)]*)\)", dm_src) == ["model, root, progress=progress, cancel=cancel"], "the app calls the download with the model, folder, progress and cancel only: no host, address or other setting can be passed in")
        check("Request(" in body and body.count("Request(") == 1 and "headers={\"User-Agent\": \"Ryagram-maker\", \"Accept-Encoding\": \"identity\"}" in body, "the only headers sent are a fixed User-Agent and Accept-Encoding: identity (no cookie, no login, nothing of the person)")
        check("ProxyHandler({})" in body and "create_default_context()" in body, "no proxy variable is read and the normal certificate checks are on")
        print()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if FAILED:
        print("FAILED:", "; ".join(FAILED))
        sys.exit(1)
    print("all passed")


main()
