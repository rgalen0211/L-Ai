"""The third-party notices for the portable app (tools/third_party_notices.py and make_app_bundle.py --public; NEXT-CONNECT 133, CC1 2026-10-26 20:01). Synthetic folders only; nothing is downloaded.
Every refusal has a case that FAILS if the check is removed (section F runs broken-on-purpose copies).

    python tools/check-third-party-notices.py [<a built bundle folder to read, optional>]
"""
import importlib.util
import os
import re
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import third_party_notices as tpn  # noqa: E402

spec = importlib.util.spec_from_file_location("mab", ROOT / "tools" / "make_app_bundle.py")
mab = importlib.util.module_from_spec(spec)
sys.modules["mab"] = mab
spec.loader.exec_module(mab)

FAILED = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILED.append(what)


tmp = Path(tempfile.mkdtemp(prefix="notices-", dir=os.environ.get("TEMP")))


def dist(site, name, version, meta_extra="", files=None):
    d = site / f"{name}-{version}.dist-info"
    d.mkdir(parents=True)
    (d / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n{meta_extra}\n", encoding="utf-8")
    for fn, text in (files or {}).items():
        (d / fn).parent.mkdir(parents=True, exist_ok=True)
        (d / fn).write_text(text, encoding="utf-8")


GPL_VERSION = "ffmpeg version 9.0.1-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers\nconfiguration: --enable-gpl --enable-version3 --enable-static\n"
LGPL_VERSION = "ffmpeg version 7.1 Copyright (c) 2000-2025 the FFmpeg developers\nconfiguration: --disable-gpl --enable-shared\n"
NONFREE_VERSION = "ffmpeg version 7.1 Copyright\nconfiguration: --enable-gpl --enable-nonfree\n"
README = "FFmpeg 64-bit static Windows build\nLicense: GPL v3\nSource Code: https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a\n"
GPL_TEXT = "GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007 (the full text would be here)\n"

print("A. libraries: what each package declares and ships")
site = tmp / "site"
dist(site, "alpha", "1.0", "License-Expression: MIT\nHome-page: https://alpha.example\n", {"LICENSE": "MIT License\nCopyright (c) Alpha Authors\n"})
dist(site, "Beta_Lib", "2.1", "License: Apache 2.0\n", {"licenses/LICENSE.txt": "Apache License 2.0 text\n", "licenses/NOTICE": "Beta notice\n", "RECORD": "not a licence\n"})
dist(site, "gamma", "0.3", "Classifier: License :: OSI Approved :: BSD License\n")
dist(site, "av", "18.1.0", "License: BSD-3-Clause\n", {"LICENSE.txt": "BSD text\n"})
libs = {l["name"]: l for l in tpn.libraries(site)}
check(set(libs) == {"alpha", "Beta_Lib", "gamma", "av"}, "one row for every dist-info folder")
check(libs["alpha"]["licence"] == "MIT" and libs["alpha"]["texts"][0][1].startswith("MIT License") and libs["alpha"]["home"] == "https://alpha.example", "the declared licence, the home page and the package's own text")
check([n for n, _t in libs["Beta_Lib"]["texts"]] == ["LICENSE.txt", "NOTICE"], "every licence-named file is kept (LICENSE and NOTICE), a RECORD file is not a licence")
check(libs["gamma"]["texts"] == [] and libs["gamma"]["licence"] == "BSD License", "a package with no licence text: none is invented, its classifier is the declared licence")
supp = tmp / "supp"
supp.mkdir()
(supp / "gamma.txt").write_text("source: https://example.test/gamma/LICENSE\nBSD licence of gamma, as the project publishes it\n", encoding="utf-8")
g = {l["name"]: l for l in tpn.libraries(site, supp)}["gamma"]
check(g["supplied"] and "the project's own licence text" in g["texts"][0][0] and "as the project publishes it" in g["texts"][0][1], "a supplied text (put there by a person) is used and says it was added by the build")
check(not {l["name"]: l for l in tpn.libraries(site, supp)}["alpha"]["supplied"], "a package that ships its own text never takes a supplement")

print("B. the notices file")
py = "PYTHON SOFTWARE FOUNDATION LICENSE (full text)\n"
ff = tpn.ffmpeg_facts(GPL_VERSION)
txt = tpn.render(list(libs.values()), py, ff, GPL_TEXT, README, "source@example.test")
check(ff["gpl"] and ff["version3"] and not ff["nonfree"], "ffmpeg's own version output says GPL and version 3")
check("source@example.test" in txt and "bf1b838f2a" in txt and "GNU GENERAL PUBLIC LICENSE Version 3" in txt and "PYTHON SOFTWARE FOUNDATION LICENSE" in txt, "the file carries the source contact, the build's README (the exact upstream commit), the GPL text and Python's licence")
check(all(f"* {n}" in txt or f"* {n.replace('_', '-')}" in txt for n in libs) and txt.count("-----") >= 6, "every library is listed with its text")
check("(this package ships no licence text of its own" in txt, "a package with no text is listed as such")
check("separate programs" in txt and "av.libs" in txt, "it says ffmpeg is run as a separate program and that the av package carries its own FFmpeg libraries")
check("\r" not in txt and "not a public build" not in txt, "plain text, no placeholder in a build that has a contact")
check("A copy of that source is also available on request: source@example.test" in txt and "(and of the sources of the libraries" not in txt, "the source line is Ryan's accepted wording: ffmpeg's source on request, no promise about the libraries' sources")
check(txt.rstrip().endswith("Each library is listed above with its exact version; its source code is available from that project's official website."), "Ryan's sentence about the libraries is the last line of the file, verbatim")
check("[no contact given: this is NOT a public build]" in tpn.render(list(libs.values()), py, ff, GPL_TEXT, README, ""), "without a contact the file says plainly that it is not a public build")

print("C. what stops a PUBLIC build")
full = [l for l in libs.values() if l["texts"]]
check(tpn.public_problems(full, ff, GPL_TEXT, README, "c@example.test") == [], "everything present: nothing stops it")
check(any("contact" in p for p in tpn.public_problems(full, ff, GPL_TEXT, README, "")), "a GPL build with no source contact is stopped")
check(any("licence text is missing" in p for p in tpn.public_problems(full, ff, "", README, "c")), "ffmpeg without its licence text is stopped")
check(any("README" in p for p in tpn.public_problems(full, ff, GPL_TEXT, "", "c")), "ffmpeg without its README (where the source is) is stopped")
check(any("nonfree" in p for p in tpn.public_problems(full, tpn.ffmpeg_facts(NONFREE_VERSION), GPL_TEXT, README, "c")), "a --enable-nonfree build is stopped (it cannot be redistributed)")
check(any("gamma" in p and "no licence text" in p for p in tpn.public_problems(list(libs.values()), ff, GPL_TEXT, README, "c")), "a library with no licence text is stopped (named)")
check(tpn.public_problems(full, tpn.ffmpeg_facts(LGPL_VERSION), GPL_TEXT, README, "") == [], "an LGPL-configured build needs no GPL source contact (control)")

print("D. the builder writes it into docs\\ and refuses a public build that lacks something")
ffd = tmp / "ffroot" / "bin"
ffd.mkdir(parents=True)
(ffd / "ffmpeg.exe").write_text("x")
(ffd.parent / "LICENSE").write_text(GPL_TEXT)
(ffd.parent / "README.txt").write_text(README)
out = tmp / "bundle"
(out / "python" / "Lib" / "site-packages").mkdir(parents=True)
(out / "python" / "LICENSE.txt").write_text(py)
dist(out / "python" / "Lib" / "site-packages", "alpha", "1.0", "License: MIT\n", {"LICENSE": "MIT License\n"})
mab.ffmpeg_version_text = lambda d: GPL_VERSION                                            # a stand-in for running the real ffmpeg
A = lambda **kw: SimpleNamespace(public=kw.get("public", False), notices_contact=kw.get("contact", ""), ffmpeg_license="", ffmpeg_readme="", licence_supplements="")
r = mab.write_notices(A(public=True, contact="c@example.test"), out, ffd)
check(r == {"libraries": 1, "public": True, "problems": []} and (out / "docs" / "THIRD-PARTY-NOTICES.txt").is_file(), "a public build with everything present writes docs\\THIRD-PARTY-NOTICES.txt")
try:
    mab.write_notices(A(public=True), out, ffd)
    refused = False
except mab.Refused as e:
    refused = "contact" in str(e)
check(refused, "MUST-FAIL: a public build with no source contact is REFUSED")
r2 = mab.write_notices(A(public=False), out, ffd)
check(r2["problems"] and not r2["public"], "a private build is not refused; it reports what a public one would still need")
mab.ffmpeg_version_text = lambda d: ""
try:
    mab.write_notices(A(public=True, contact="c"), out, ffd)
    refused = False
except mab.Refused as e:
    refused = "could not be read" in str(e)
check(refused, "MUST-FAIL: a public build whose ffmpeg cannot say what it is, is REFUSED")

print("E. the real bundle (read only), if one is named")
if len(sys.argv) > 1:
    B = Path(sys.argv[1])
    real = tpn.libraries(B / "python" / "Lib" / "site-packages")
    n_dist = len(list((B / "python" / "Lib" / "site-packages").glob("*.dist-info")))
    check(len(real) == n_dist and n_dist > 10, f"every one of the {n_dist} libraries in the folder is listed")
    print("       without a licence text of their own: " + ", ".join(f"{l['name']} ({l['licence']})" for l in real if not l["texts"]))

print("G. the committed licence supplements (the four packages that ship no text of their own)")
import hashlib
import json
SUPP = ROOT / "tools" / "licence-supplements"
man = json.loads((SUPP / "MANIFEST.json").read_text(encoding="utf-8"))
check({m["package"] for m in man} == {"ctranslate2", "flatbuffers", "onnxruntime", "tokenizers"}, "the manifest names exactly the four packages")
for m in man:
    f = (SUPP / m["file"]).read_text(encoding="utf-8")
    first, _, body = f.partition(chr(10))
    check(first == "source: " + m["source_url"] and m["tag"].lstrip("v") == m["version"] and m["source_url"].startswith("https://raw.githubusercontent.com/") and f"/{m['tag']}/LICENSE" in m["source_url"],
          f"{m['package']}: the first line names the source, which is the project's own LICENSE at the tag matching version {m['version']}")
    check(hashlib.sha256(body.encode("utf-8")).hexdigest() == m["licence_file_sha256"] or hashlib.sha256(body.replace(chr(10), chr(13) + chr(10)).encode("utf-8")).hexdigest() == m["licence_file_sha256"], f"{m['package']}: the text is the fetched file (SHA-256 {m['licence_file_sha256'][:12]}...)")
if len(sys.argv) > 1:
    real = tpn.libraries(Path(sys.argv[1]) / "python" / "Lib" / "site-packages", SUPP)
    check([l["name"] for l in real if not l["texts"]] == [], "with the supplements, every library of the real bundle has a licence text")
    check(tpn.public_problems(real, tpn.ffmpeg_facts(GPL_VERSION), GPL_TEXT, README, "c@example.test") == [], "so a public build is no longer stopped by a library (only the contact and ffmpeg's own files remain)")

print("H. bundled model files (the face finder)")
import json as _json
MD = ROOT / "tools" / "model-licences"
mm = tpn.model_rows(MD, ["yunet"])[0]
check(mm["text"].startswith("MIT License") and "Copyright (c) 2020 Shiqi Yu" in mm["text"] and mm["sha256"] == "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4" and mm["problem"] == "", "the YuNet record reads: MIT text, the copyright line, the pinned model hash")
check(tpn.public_problems(full, ff, GPL_TEXT, README, "c@example.test", [mm]) == [], "with its licence text a PUBLIC build is not stopped by the model")
nomanifest = tpn.model_rows(None, ["yunet"])[0]
check(any("yunet" in p.lower() and "licence" in p for p in tpn.public_problems(full, ff, GPL_TEXT, README, "c@example.test", [nomanifest])), "MUST-FAIL: a model with no licence record stops a PUBLIC build")
tampered = tmp / "ml"
tampered.mkdir(exist_ok=True)
(tampered / "MANIFEST.json").write_text((MD / "MANIFEST.json").read_text(encoding="utf-8"), encoding="utf-8")
(tampered / "yunet.txt").write_text((MD / "yunet.txt").read_text(encoding="utf-8").replace("Permission is hereby granted", "Permission is NOT granted"), encoding="utf-8")
bad = tpn.model_rows(tampered, ["yunet"])[0]
check(bad["text"] == "" and "not the recorded one" in bad["problem"] and any("yunet" in p.lower() for p in tpn.public_problems(full, ff, GPL_TEXT, README, "c@example.test", [bad])), "MUST-FAIL: a licence text that is not the one recorded (changed by one phrase) is not used and stops a PUBLIC build")
rend = tpn.render(list(libs.values()), py, ff, GPL_TEXT, README, "c@example.test", [mm])
check("Model file: YuNet" in rend and "Permission is hereby granted" in rend and rend.index("Model file") < rend.index("Libraries in python"), "the notices print the model's section with its text, before the libraries")
check("Model file" not in tpn.render(list(libs.values()), py, ff, GPL_TEXT, README, "c@example.test"), "without a bundled model there is no such section")

print("F. MUST-FAIL: the same checks against broken-on-purpose copies of the tool")
src = (ROOT / "tools" / "third_party_notices.py").read_text(encoding="utf-8")


def mutant(old, new, label, probe):
    m = tmp / "m.py"
    m.write_text(src.replace(old, new), encoding="utf-8")
    sp = importlib.util.spec_from_file_location("tpn_mut", m)
    mod = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(mod)
    check(probe(mod) is False, f"MUST-FAIL: {label} would be let through (so the check above is what stops it)")


mutant('if (ffmpeg["gpl"] or ffmpeg["version3"]) and not contact.strip():', "if False:", "a GPL build with no contact", lambda M: any("contact" in p for p in M.public_problems(full, ff, GPL_TEXT, README, "")))
mutant("if not lib[\"texts\"]:\n            out.append", "if False:\n            out.append", "a library with no licence text", lambda M: any("gamma" in p for p in M.public_problems(list(libs.values()), ff, GPL_TEXT, README, "c")))
mutant('if ffmpeg["nonfree"]:', "if False:", "a nonfree ffmpeg", lambda M: any("nonfree" in p for p in M.public_problems(full, M.ffmpeg_facts(NONFREE_VERSION), GPL_TEXT, README, "c")))

print()
if FAILED:
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print("  -", f)
    sys.exit(1)
print("all passed")
