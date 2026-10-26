"""The word-builder fetch (tools/get_word_builder.py, NEXT-CONNECT 132) against a LOCAL test server only (nothing leaves this computer, nothing real is downloaded), with the pins
compared to what the host's listing said. Standard library only.

    python tools/check-get-word-builder.py [<scratch base folder>]
"""
import glob
import hashlib
import importlib.util
import os
import re
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else None
sys.path.insert(0, str(ROOT / "tools"))
import model_download as md  # noqa: E402
import get_word_builder as wb  # noqa: E402

FAILED = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILED.append(what)


def gitsha(b):
    return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()


M = bytes(range(256)) * 3000
V = b'{"<pad>": 0, "|": 4}\n'
REV = "e" * 40
FAKE = (("onnx/model.onnx", len(M), "sha256", hashlib.sha256(M).hexdigest()), ("vocab.json", len(V), "git-sha1", gitsha(V)))
BODY = {"onnx/model.onnx": M, "vocab.json": V}
MODE = {}
HITS = []


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def do_GET(self):  # noqa: N802
        HITS.append(self.path)
        m = re.match(r"^/fake/repo/resolve/" + REV + r"/(.+)$", self.path)
        if not m or m.group(1) not in BODY:
            self.send_response(404); self.end_headers(); return
        name, body, mode = m.group(1), BODY[m.group(1)], MODE.get(m.group(1), "ok")
        if mode == "redirect":
            self.send_response(302); self.send_header("Location", "http://127.0.0.2:1/evil.bin"); self.end_headers(); return
        if mode == "flip":
            body = body[:-1] + bytes([body[-1] ^ 1])
        announce = len(body) + (7 if mode == "size" else 0)
        send = body[: len(body) // 2] if mode == "short" else (body + b"EXTRA" if mode == "long" else body)
        self.send_response(200); self.send_header("Content-Length", str(announce if mode != "long" else len(body))); self.end_headers()
        self.wfile.write(send)


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
NET = md.Net(scheme="http", host="127.0.0.1", domains=("127.0.0.1",), port=srv.server_address[1])
tmp = Path(tempfile.mkdtemp(prefix="wb-check-", dir=str(BASE) if BASE else None))


def run(root, **kw):
    return wb.download(root, net=NET, files=FAKE, repo="fake/repo", revision=REV, **kw)


def refused(root, mode_for, fragment):
    MODE.clear(); MODE.update(mode_for)
    try:
        run(root)
        return False, "no refusal"
    except md.ModelRefused as e:
        return fragment.lower() in str(e).lower(), str(e)[:200]
    finally:
        MODE.clear()


def nothing_left(root):
    return not any(Path(root).rglob("*")) or not any(p.is_file() for p in Path(root).rglob("*"))


try:
    print("A. a good download lands where the engine looks")
    r = tmp / "a"
    d = run(r)
    check((d / "onnx" / "model.onnx").read_bytes() == M and (d / "vocab.json").read_bytes() == V, "both files are there, byte for byte")
    check(glob.glob(str(r / "models--*wav2vec2-base-960h-ONNX" / "snapshots" / "*" / "onnx" / "model.onnx")) != [] if wb.FOLDER.endswith("wav2vec2-base-960h-ONNX") else False,
          "the engine's own search pattern (ryagram/library/align.py: models--*wav2vec2-base-960h-ONNX/snapshots/*/onnx/model.onnx) finds the model")
    check(glob.glob(str(r / "models--*wav2vec2-base-960h-ONNX" / "snapshots" / "*" / "vocab.json")) != [], "and the word list (vocab.json)")
    check(not (r / ".downloading-word-builder").exists(), "the staging folder is gone")
    HITS.clear()
    run(r)
    check(HITS == [], "a second run downloads nothing (already complete)")

    print("B. every fault is refused and NOTHING is kept (each has the control above)")
    for label, mode, frag in (("a file whose bytes are wrong (same size)", {"onnx/model.onnx": "flip"}, "check number is different"),
                              ("a file that ends early", {"onnx/model.onnx": "short"}, "ended early"),
                              ("a file announced with the wrong size", {"onnx/model.onnx": "size"}, "not the size"),
                              ("a redirect to a host that is not allowed", {"onnx/model.onnx": "redirect"}, "not on the allowed list"),
                              ("a vocab.json whose git id is wrong", {"vocab.json": "flip"}, "check number is different")):
        r = tmp / ("b" + str(abs(hash(label)) % 10000))
        good, why = refused(r, mode, frag)
        check(good and nothing_left(r), f"{label}: refused ({why[:70]}) and nothing is left in the models folder")

    print("C. the pins and the rules are what the host's listing said")
    names = {n: (b, k, v) for n, b, k, v in wb.FILES}
    check(names["onnx/model.onnx"] == (377911891, "sha256", "00b7cc69516c1ab63c429e63a2b543e4d42bb77441ec5b98ee935de175b00de1"), "model.onnx: 377,911,891 bytes, the host's LFS SHA-256")
    check(names["vocab.json"] == (358, "git-sha1", "7efc55a6619a53189e1ca2b5bdcca400a2d4f3e6"), "vocab.json: 358 bytes, the host's git blob id")
    check(wb.REPO == "onnx-community/wav2vec2-base-960h-ONNX" and wb.REVISION == "729c1a6730fb549c20a1c73a3d3f96f11020225e", "the repo and the revision the listing gave")
    check(wb.final_dir("X") == Path("X") / "models--onnx-community--wav2vec2-base-960h-ONNX" / "snapshots" / wb.REVISION, "the folder is the host's cache layout the engine reads")
    check(abs(wb.total_bytes() - 377912249) == 0 and 360 < wb.total_bytes() / (1 << 20) < 361, "the total said to the person is about 360 MiB (378 MB)")
    check(wb.file_url("onnx/model.onnx", md.Net()) == "https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/" + wb.REVISION + "/onnx/model.onnx", "the real URL has the fixed host, repo, revision and path")
    check(md.HOST == "huggingface.co" and md.REDIRECT_DOMAINS == ("huggingface.co", "hf.co"), "the host and the redirect list are the listening model's own")
    src = (ROOT / "tools" / "get_word_builder.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if l.lstrip().startswith(("import ", "from ")))
    check(not any(x in code for x in ("socket", "requests", "ftplib", "smtplib", "subprocess", "zipfile", "tarfile", "importlib", "pickle", "ctypes")), "it imports no networking module of its own and nothing that could run a download")
    check(not re.search(r"\b(exec|eval|__import__)\(", src), "it never runs or evaluates anything")

    print("D. MUST-FAIL: the same download with a check removed KEEPS a bad file (so the checks above are what refuse it)")
    mut = tmp / "mut.py"
    mut.write_text(src.replace("if h.hexdigest() != want:", "if False:"), encoding="utf-8")
    spec = importlib.util.spec_from_file_location("gwb_mut", mut)
    m2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(m2)
    MODE.clear(); MODE["onnx/model.onnx"] = "flip"
    r = tmp / "d1"
    try:
        m2.download(r, net=NET, files=FAKE, repo="fake/repo", revision=REV); kept = (m2.final_dir(r, REV) / "onnx" / "model.onnx").exists()
    except md.ModelRefused:
        kept = False
    MODE.clear()
    check(kept, "hash check removed: the flipped file IS kept (the real code refuses it above)")
    mut.write_text(src.replace("if announced != nbytes:", "if False:"), encoding="utf-8")
    spec = importlib.util.spec_from_file_location("gwb_mut2", mut)
    m3 = importlib.util.module_from_spec(spec); spec.loader.exec_module(m3)
    MODE.clear(); MODE["onnx/model.onnx"] = "size"
    r = tmp / "d2"
    try:
        m3.download(r, net=NET, files=FAKE, repo="fake/repo", revision=REV); passed = True
    except md.ModelRefused:
        passed = False
    MODE.clear()
    check(passed, "MUST-FAIL: size check removed: a file announced with the wrong size is then NOT refused by the size line (the hash line is the second defence)")

    print("E. the question comes first and 'stop' downloads nothing")
    r = tmp / "e"
    HITS.clear()
    import io
    old_in, old_out = sys.stdin, sys.stdout
    sys.stdin = io.StringIO("no\n"); sys.stdout = io.StringIO()
    try:
        rc = wb.main(["--models", str(r)]); out = sys.stdout.getvalue()
    finally:
        sys.stdin, sys.stdout = old_in, old_out
    check(rc == 1 and "378 MB" in out and "Stopped. Nothing was downloaded." in out and HITS == [] and not r.exists(), "it says about 378 MB, a reply that is not YES stops, and nothing was fetched or created")
finally:
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print()
if FAILED:
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print("  -", f)
    sys.exit(1)
print("all passed")
