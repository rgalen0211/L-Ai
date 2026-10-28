"""Must-fail proof for the face-finder rules (Ryan 2026-10-28): each mutant breaks ONE rule in a scratch copy of tools/ and the check that guards that rule must then FAIL (a baseline on the unbroken copy passes first).

    py -I tools/check-yunet-mutants.py <Ryagram checkout> <scratch base folder on D:>

The rules: only the pinned YuNet file is accepted by the builder (name, size, SHA-256; the recognition and landmark models are refused by name); the self-check pins the same hash and fails a missing, swapped or
unexpected face finder even when the manifest was rewritten; the notices carry the licence text and refuse a public build without it; the maker never uses a file that is not the pinned one."""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE, BASE = sys.argv[1], Path(sys.argv[2])
NL = chr(10)
BUNDLE = "check-app-bundle.py"
NOTICES = "check-third-party-notices.py"
SHARE = "check-maker-share.py"
M = [
    ("the builder takes any file with the YuNet name", "make_app_bundle.py", "    if path.stat().st_size != YUNET_BYTES or sha256_file(path) != YUNET_SHA256:", "    if False:", BUNDLE),
    ("the builder takes the recognition and landmark models", "make_app_bundle.py", "    if any(w in low for w in FORBIDDEN_MODEL_WORDS):", "    if False:", BUNDLE),
    ("the builder does not put the file in the bundle", "make_app_bundle.py", "            shutil.copy2(face_model, out / YUNET_FILE)", "            pass", BUNDLE),
    ("the builder's pin is another hash", "make_app_bundle.py", 'YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"', 'YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa5"', BUNDLE),
    ("the notices leave the model's section out", "make_app_bundle.py", "tpn.render(libs, python_licence, ff, ff_lic, ff_readme, contact, models)", "tpn.render(libs, python_licence, ff, ff_lic, ff_readme, contact)", BUNDLE),
    ("a public build goes ahead without the model's licence record", "make_app_bundle.py", "    problems = tpn.public_problems(libs, ff, ff_lic, ff_readme, contact, models)", "    problems = tpn.public_problems(libs, ff, ff_lic, ff_readme, contact)", BUNDLE),
    ("the self-check ignores a missing face finder", "verify_bundle.py", "        if not p_face.is_file():", "        if False:", BUNDLE),
    ("the self-check ignores a swapped face finder", "verify_bundle.py", "        elif sha256_file(p_face) != YUNET_SHA256:", "        elif False:", BUNDLE),
    ("the self-check ignores a face finder nobody built in", "verify_bundle.py", "    elif p_face.is_file():", "    elif False:", BUNDLE),
    ("the self-check's pin is another hash", "verify_bundle.py", 'YUNET_FILE, YUNET_SHA256 = "models/yunet.onnx", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"', 'YUNET_FILE, YUNET_SHA256 = "models/yunet.onnx", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa5"', BUNDLE),
    ("a licence text that is not the recorded one is used", "third_party_notices.py", '            if hashlib.sha256(body.encode("utf-8")).hexdigest() == m.get("licence_file_sha256"):', "            if True:", NOTICES),
    ("a model with no licence text does not stop a public build", "third_party_notices.py", '        if not mo.get("text", "").strip():', "        if False:", NOTICES),
    ("the maker uses any file with a yunet name", "maker_edit.py", "                    if p.is_file() and _sha256(p) == YUNET_SHA256:", "                    if p.is_file():", SHARE),
    ("the maker does not say a wrong file is ignored", "maker_edit.py", "    if model is None and _wrong_model_present():", "    if False:", SHARE),
    ("the face tracks are written as the finder returned them (numpy float32 cannot be saved)", "maker_edit.py", '        c["bystander_blur"] = _plain(BL.new_spec(frame, tracks))', '        c["bystander_blur"] = BL.new_spec(frame, tracks)', SHARE),
    ("the main page's Build makes an unblurred film while the switch is on", "desktop_maker.py", '    if kind == "build" and blur_refusal():', "    if False:", SHARE),
    ("the song page's film button makes an unblurred film while the switch is on", "maker_song.py", "    if _dm.blur_refusal():", "    if False:", SHARE),
    ("the refusal never fires (the switch is not asked)", "desktop_maker.py", '    return BLUR_BUILD_REFUSAL if me is not None and me.blur_wanted() else ""', '    return ""', SHARE),
    ("the maker's pin is another hash", "maker_edit.py", 'YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"', 'YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa5"', "PIN"),
]


def run(tools: Path, check: str, scratch: Path):
    if check == "PIN":
        code = ("import sys; sys.path.insert(0, %r); import make_app_bundle as a, verify_bundle as v, maker_edit as m; "
                "sys.exit(0 if a.YUNET_SHA256 == v.YUNET_SHA256 == m.YUNET_SHA256 else 1)") % str(tools)
        return subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120)
    extra = [ENGINE, str(scratch)] if check == SHARE else ([str(scratch)] if check == BUNDLE else [])
    return subprocess.run([sys.executable, "-I", str(tools / check), *extra], capture_output=True, text=True, timeout=900)


work = Path(tempfile.mkdtemp(prefix="yunet-mut-", dir=str(BASE)))
bad = 0
try:
    for i, item in enumerate([("baseline", None, None, None, None)] + M):
        name, fname, a, b, chk = item
        tools = work / f"t{i}" / "tools"
        shutil.copytree(HERE, tools, ignore=shutil.ignore_patterns("__pycache__", "maker-live", "*.zip"))
        if fname:
            f = tools / fname
            t = f.read_bytes().decode("utf-8").replace(chr(13) + NL, NL)
            if t.count(a) != 1:
                print(f"  BROKEN MUTANT (anchor found {t.count(a)}x): {name}")
                bad += 1
                continue
            f.write_bytes(t.replace(a, b).encode("utf-8"))
        scratch = work / f"s{i}"
        scratch.mkdir()
        if fname is None:
            for c in (BUNDLE, NOTICES, SHARE):
                r = run(tools, c, scratch)
                if r.returncode != 0:
                    print(f"BASELINE FAILS ({c}):" + NL + r.stdout[-900:] + r.stderr[-300:])
                    sys.exit(1)
            print("baseline passes (bundle, notices, maker)")
            continue
        try:
            r = run(tools, chk, scratch)
            rc = r.returncode
        except subprocess.TimeoutExpired:
            rc = 1
        print(("caught  " if rc != 0 else "MISSED  ") + name)
        bad += 0 if rc != 0 else 1
finally:
    shutil.rmtree(work, ignore_errors=True)
print("all mutants caught" if not bad else f"{bad} PROBLEM(S)")
sys.exit(1 if bad else 0)
