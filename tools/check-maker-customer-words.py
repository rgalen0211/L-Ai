"""The words a CUSTOMER reads in the desktop maker and its start files (BUILDER 11-21; Ryan's 10:11 cutoff: sell the Ryagram that exists).
No 'INTERNAL PROTOTYPE', no 'tell Ryan': one support line, with a safe default, that a build can name (make_app_bundle --support-contact
-> the start file passes --support). The support text is plain characters only, because it is written into a .bat and shown in the page and
its script. No browser, no network, no server: the page is read from page_html(), the start files are written into a throwaway folder.

    python tools/check-maker-customer-words.py
"""
import importlib.util
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILED = []


def check(ok, name):
    print(("ok   " if ok else "FAIL ") + name, flush=True)
    if not ok:
        FAILED.append(name)


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


sys.path.insert(0, str(ROOT / "tools"))
dm = load("desktop_maker")
mb = load("make_app_bundle")
BAD = re.compile(r"\bRyan\b|INTERNAL PROTOTYPE")
DEFAULT = dm.SUPPORT_DEFAULT

print("A. the page a customer opens")
dm.STATE.pop("support", None)
for flags in ({}, {"live_on": True, "edit_on": True, "data_on": True, "song_on": True}):
    saved = {k: dm.STATE.get(k) for k in flags}
    dm.STATE.update(flags)
    page = dm.page_html() + dm.maker_js()
    check(not BAD.findall(page), f"MUST-FAIL: the page and its script ({'every card on' if flags else 'plain'}) say neither 'Ryan' nor 'INTERNAL PROTOTYPE': {sorted(set(BAD.findall(page)))}")
    check("__SUPPORT__" not in page and f"send it to {DEFAULT}." in page, "the stopped-build note names the default support line, never the placeholder")
    dm.STATE.update(saved)
dm.STATE["support"] = "help@example.test"
page = dm.page_html() + dm.maker_js()
check("send it to help@example.test." in page and DEFAULT not in page.split("send it to", 1)[1][:80], "MUST-FAIL: a build's own support line replaces the default on the page")
dm.STATE.pop("support", None)

print("B. the error help after a build")
texts = [nxt.replace("{support}", dm.support()) for _w, nxt in dm.EXIT_HELP.values()]
check(not any(BAD.search(t) for t in texts), "MUST-FAIL: no exit's help names Ryan")
check(any(DEFAULT in t for t in texts), "the unexpected-error help names the support line")
check("{support}" in dm.SRC if hasattr(dm, "SRC") else "{support}" in (ROOT / "tools" / "desktop_maker.py").read_text(encoding="utf-8"),
      "CONTROL: the help keeps a {support} slot (filled at use)")

print("C. the support line is plain characters only")
for bad in ('<script>alert(1)</script>', 'a"b', '100% sure', "x'y", "a\nb", "x" * 121, ""):
    check(not dm.SUPPORT_OK.match(bad) and not mb.SUPPORT_OK.match(bad), f"MUST-FAIL: refused as a support line: {bad[:24]!r}")
check(bool(dm.SUPPORT_OK.match("help@ryagram.example, or uselai.com/help")), "a plain address and page are allowed")
r = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "desktop_maker.py"), "--support", "<b>hi</b>"], capture_output=True, text=True, timeout=120)
check(r.returncode != 0 and "--support" in (r.stdout + r.stderr) and "Desktop maker is running" not in r.stdout,
      "MUST-FAIL: the app refuses a support line with < > before it starts anything")
try:
    mb.check_support('say "hi"')
    refused = False
except mb.Refused:
    refused = True
check(refused, "MUST-FAIL: the bundle builder refuses a support line with a quote (it would break the start file)")

print("D. the start files and the read-me a customer opens")
with tempfile.TemporaryDirectory(prefix="mcw-") as td:
    out = Path(td) / "a"
    (out / "tools").mkdir(parents=True)
    mb.write_start_files(out, has_model=False)
    bat = (out / "Open Ryagram.bat").read_text(encoding="ascii")
    others = "".join(p.read_text(encoding="utf-8", errors="replace") for p in out.iterdir() if p.is_file() and p.suffix.lower() in (".txt", ".bat"))
    check(not BAD.search(others), f"MUST-FAIL: no start file or read-me names Ryan: {sorted(set(BAD.findall(others)))}")
    check("--support" not in bat, "with no --support-contact the start file passes none (the app's default speaks)")
    out2 = Path(td) / "b"
    (out2 / "tools").mkdir(parents=True)
    mb.write_start_files(out2, has_model=False, signin=mb.check_support("help@example.test"))
    check('--support "help@example.test"' in (out2 / "Open Ryagram.bat").read_text(encoding="ascii"), "MUST-FAIL: --support-contact reaches the start file")
vb = (ROOT / "tools" / "verify_bundle.py").read_text(encoding="utf-8")
check("tell Ryan" not in vb and f"contact {DEFAULT}" in vb, "MUST-FAIL: the self-check's failure words name the support line, not Ryan")

if FAILED:
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print("  " + f)
    sys.exit(1)
print("ALL PASS")
