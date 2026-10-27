"""The live editor page the maker serves (tools/maker-live/) is exactly WEB's pinned file, and nothing else. NEXT-CONNECT 142.

    py -I tools/check-maker-live-page.py

Checks (all offline, nothing is run): each file's size and SHA-256 equal the PIN; the page keeps its strict policy in a <meta> (nothing remote, no inline script or style); the script makes no call
but four fetches, to /api/live/rpc and /api/live/render, and reaches no other address; the stylesheet loads nothing; LF line endings, so the hashes mean the same on every PC. MUST-FAILs: a changed byte, a remote
script address, an inline script, and a fifth fetch address are each caught."""
import hashlib
import re
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent / "maker-live"
FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def pins(text):
    return {m.group(1): (int(m.group(2)), m.group(3)) for m in re.finditer(r"^(live\.\w+) (\d+) bytes sha256 ([0-9a-f]{64})$", text, re.MULTILINE)}


def problems(files, pin):
    out = []
    for name, (size, sha) in pin.items():
        b = files.get(name)
        if b is None:
            out.append(f"{name} is missing")
            continue
        if len(b) != size or hashlib.sha256(b).hexdigest() != sha:
            out.append(f"{name} is not the pinned file")
    html = files.get("live.html", b"").decode("utf-8", "replace")
    js = files.get("live.js", b"").decode("utf-8", "replace")
    css = files.get("live.css", b"").decode("utf-8", "replace")
    if not re.search(r"Content-Security-Policy[^>]*default-src 'none'[^>]*script-src 'self'[^>]*connect-src 'self'", html):
        out.append("the page lost its content policy")
    if re.search(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", html) or re.search(r"\son\w+\s*=", html) or re.search(r"<style", html, re.I):
        out.append("the page has inline script, style or handlers")
    if re.search(r"""(src|href)\s*=\s*["']?(https?:)?//""", html):
        out.append("the page loads something from another address")
    if len(re.findall(r"\bfetch\(", js)) != 4 or any(x not in js for x in ("/api/live/rpc", "/api/live/render", "/api/live/frame", "/api/live/text-rules")):
        out.append("the script does not make exactly four fetches, to /api/live/rpc, /render, /frame and /text-rules")
    if re.search(r"""(https?:)?//[a-z0-9.-]+\.[a-z]{2,}/""", re.sub(r"https?://www\.w3\.org/[^\"']*", "", js), re.I) or "XMLHttpRequest" in js or "WebSocket" in js or "sendBeacon" in js or "importScripts" in js:
        out.append("the script reaches an address of its own")
    if "@import" in css or "url(" in css:
        out.append("the stylesheet loads something")
    if any(b"\r\n" in b for b in files.values()):
        out.append("a page file has Windows line endings")
    return out


files = {n: (DIR / n).read_bytes() for n in ("live.html", "live.js", "live.css")}
pin = pins((DIR / "PIN").read_text(encoding="utf-8"))
check(sorted(pin) == ["live.css", "live.html", "live.js"], "the PIN names the three page files")
p = problems(files, pin)
check(not p, "the three files are exactly the pinned ones, with the policy, four fetches and nothing remote" + ("" if not p else f": {p}"))

bad = dict(files)
bad["live.js"] = files["live.js"] + b" "
check(problems(bad, pin) == ["live.js is not the pinned file"], "MUST-FAIL: one added byte in live.js is caught")
bad = dict(files)
bad["live.html"] = files["live.html"].replace(b"</head>", b'<script src="https://cdn.example.test/x.js"></script></head>')
check(any("another address" in x or "not the pinned" in x for x in problems(bad, pin)), "MUST-FAIL: a remote script address is caught")
bad = dict(files)
bad["live.html"] = files["live.html"].replace(b"</head>", b"<script>alert(1)</script></head>")
check(any("inline" in x for x in problems(bad, {})), "MUST-FAIL: an inline script is caught")
bad = dict(files)
bad["live.js"] = files["live.js"] + b'\nfetch("https://example.test/a");'
check(any("exactly four fetches" in x or "address of its own" in x for x in problems(bad, {})), "MUST-FAIL: a second fetch address is caught")

print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
