"""The setup-exe builder (NEXT-CONNECT 108), with MUST-FAILs. The compiler is a STAND-IN here (a script that writes a file where the real one would), so this proves the builder's own rules:
what it refuses, what the generated Inno script says and does not say, and what it records. The real compile-and-install test needs Inno Setup itself (a Ryan-approved download) and is a separate run.

    python tools/check-app-installer.py [<scratch base folder on D:>]
"""
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_app_installer as mai              # noqa: E402
import verify_bundle as vb                    # noqa: E402

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="app-installer-check-"))
BASE.mkdir(parents=True, exist_ok=True)
FAILS = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def fresh(name):
    d = BASE / name
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    return d


def make_bundle(root):
    """A small fake bundle in the real shape: app files under the app folders, a big file by size in the manifest, BUNDLE-MANIFEST.json and SHA256SUMS.txt."""
    b = root / "bundle"
    (b / "tools").mkdir(parents=True)
    (b / "ryagram").mkdir()
    (b / "python").mkdir()
    shutil.copy2(HERE / "verify_bundle.py", b / "tools" / "verify_bundle.py")
    (b / "tools" / "desktop_maker.py").write_text("print('app')\n")
    (b / "ryagram" / "engine.py").write_text("print('engine')\n")
    (b / "python" / "python.exe").write_bytes(b"MZ" + b"0" * 5000)
    (b / "Open Ryagram.bat").write_bytes(b"@echo off\r\n")
    (b / "START-HERE.txt").write_bytes(b"hello\r\n")
    (b / "models").mkdir()
    sums = {}
    for p in sorted(b.rglob("*")):
        rel = p.relative_to(b).as_posix()
        if p.is_file() and rel.split("/")[0] in ("ryagram", "tools", "recipes", "docs") or rel in ("Open Ryagram.bat", "START-HERE.txt"):
            sums[rel] = sha(p)
    large = {"python/python.exe": {"bytes": 5002, "sha256": sha(b / "python" / "python.exe")}}
    (b / "BUNDLE-MANIFEST.json").write_text(json.dumps({"schema": "ryagram.app-bundle/0", "app_head": "a" * 40, "large_files": large, "downloads_made": 0}, indent=1), encoding="utf-8")
    sums["BUNDLE-MANIFEST.json"] = sha(b / "BUNDLE-MANIFEST.json")
    (b / "SHA256SUMS.txt").write_text("".join(f"{h}  {rel}\n" for rel, h in sorted(sums.items())), encoding="utf-8", newline="\n")
    assert vb.check(b) == [], vb.check(b)
    return b


def make_stub(root, rc=0, write=True):
    """A stand-in for ISCC.exe: reads OutputDir and OutputBaseFilename from the script it is given and writes that file (or does not)."""
    py = root / f"stub{rc}{'w' if write else 'n'}.py"
    py.write_text(
        "import sys, re\nfrom pathlib import Path\niss = Path(sys.argv[-1]).read_text()\n"
        "out = re.search(r'^OutputDir=(.*)$', iss, re.M).group(1); name = re.search(r'^OutputBaseFilename=(.*)$', iss, re.M).group(1)\n"
        + ("Path(out, name + '.exe').write_bytes(b'MZ-setup-' + iss.encode())\n" if write else "")
        + f"print('compiled'); sys.exit({rc})\n")
    bat = root / f"iscc{rc}{'w' if write else 'n'}.bat"
    bat.write_text(f'@"{sys.executable}" "{py}" %*\r\n')
    return bat


THUMB = "AA" * 20
GOOD_SIG = lambda p: "Valid|CN=Pyrsys B.V., O=Pyrsys B.V., S=Noord-Holland, C=NL|" + THUMB          # noqa: E731
FAKE_SIG = lambda p: "Valid|CN=Somebody Else|" + THUMB                                        # noqa: E731
NO_SIG = lambda p: "NotSigned|"                                                       # noqa: E731
BAD_SIG = lambda p: "HashMismatch|CN=Pyrsys B.V.|" + THUMB
WRONG_THUMB = lambda p: "Valid|CN=Pyrsys B.V., O=Pyrsys B.V., C=NL|" + "BB" * 20
LOOKALIKE = lambda p: "Valid|CN=NotPyrsys B.V. Ltd, O=Pyrsys B.V. Impostor|" + THUMB                                  # noqa: E731


def attempt(root, name, **over):
    out = root / name
    kw = dict(bundle=over.pop("bundle"), iscc=over.pop("iscc"), out=over.pop("out", out), version=over.pop("version", "7"), allow_any_drive=True,
              signature_runner=over.pop("sig", GOOD_SIG), check_name=False)
    kw["check_folder"] = over.pop("check_folder", False)          # the stand-in compiler's folder is not Inno's; the folder rule has its own rows below
    pins = over.pop("pins", None)
    if pins is None:
        pins = {sha(kw["iscc"]): {"thumbprint": THUMB}} if Path(kw["iscc"]).is_file() else {}
    kw["compiler_pins"] = pins
    kw.update(over)
    out = kw["out"]
    try:
        return mai.build(kw.pop("bundle"), kw.pop("iscc"), kw.pop("out"), kw.pop("version"), **kw), None, out
    except mai.Refused as e:
        return None, str(e), out


def main():
    root = fresh("w")
    print("a good build (the compiler is a stand-in)")
    b = make_bundle(root)
    stub = make_stub(root)
    before = {p.relative_to(b).as_posix(): sha(p) for p in b.rglob("*") if p.is_file()}
    info, err, out = attempt(root, "o1", bundle=b, iscc=stub)
    check(info and not err and (out / "Ryagram-Setup-7.exe").is_file(), f"the setup file is made with the exact name Ryagram-Setup-<version>.exe ({err})")
    man = json.loads((out / "SETUP-MANIFEST.json").read_text())
    check(man["sha256"] == sha(out / "Ryagram-Setup-7.exe") and man["bytes"] == (out / "Ryagram-Setup-7.exe").stat().st_size and man["bundle_manifest_sha256"] == sha(b / "BUNDLE-MANIFEST.json")
          and man["app_head"] == "a" * 40 and man["signed"] is False and man["downloads_made"] == 0, "SETUP-MANIFEST.json records the setup hash and size, the bundle manifest hash, the app head, signed false, downloads 0")
    check(before == {p.relative_to(b).as_posix(): sha(p) for p in b.rglob("*") if p.is_file()}, "the bundle folder is not changed by wrapping it")
    iss = (out / "app.iss").read_text(encoding="ascii")
    check("AppId={{635FB146-7DBF-4396-BC2B-20E4C5154435}" in iss and mai.APP_ID == "635FB146-7DBF-4396-BC2B-20E4C5154435" and "PrivilegesRequired=lowest" in iss and "DefaultDirName={code:DefaultFolder}" in iss and "D:\\Ryagram" in iss and "{localappdata}\\Ryagram" in iss,
          "the script: fixed AppId (upgrades in place), no administrator prompt, folder D:\\Ryagram when D: is ready else the user's own folder")
    check(f"Source: \"{str(b)}\\*\"" in iss and f"OutputDir={out}" in iss and "OutputBaseFilename=Ryagram-Setup-7" in iss, "the script wraps exactly this bundle and writes into exactly this folder")
    check("{autoprograms}\\Ryagram" in iss and 'Filename: "{app}\\Open Ryagram.bat"' in iss, "one Start menu entry that runs Open Ryagram.bat")
    check(not re.search(r"^\[(Run|Registry|UninstallRun|Tasks|InstallDelete)\]", iss, re.M) and not re.search(r"(?i)startup|runonce|autostart|service|fileassoc|ChangesAssociations|DownloadTemporaryFile|wininet|http", iss),
          "MUST-FAIL: no [Run], no [Registry], no auto-start, no service, no file association, no download code in the script")
    check("MB_DEFBUTTON2" in iss and "films, the work folder and the downloaded listening model" in iss, "the uninstaller asks before deleting films, work and the model, and defaults to keeping them")
    check(out.joinpath("app.iss").read_bytes().isascii(), "the script is plain ASCII")
    # an unattended install (or a folder given by /DIR=) is checked too, and stops quietly instead of waiting for a person at a message box
    check("function PrepareToInstall" in iss and iss.count("FolderProblem(RemoveBackslashUnlessRoot(WizardDirValue))") == 2 and "(Result <> '') and WizardSilent" in iss and "Abort;" in iss
          and "(CurPageID = wpSelectDir) and (not WizardSilent)" in iss, "MUST-FAIL: the same folder test also runs at the install step, and an unattended refusal logs the reason and aborts (no message box to wait on)")
    # CC1 23:32 HIGH-1: the setup and the uninstaller never touch a person's own files
    check("function NextButtonClick" in iss and "wpSelectDir" in iss and "BUNDLE-MANIFEST.json" in iss and "already has files in it and is not a Ryagram folder" in iss and "FolderHasFiles" in iss,
          "MUST-FAIL (HIGH-1a): the folder page refuses a folder that already has files unless it is an earlier Ryagram folder, in one plain sentence")
    check(not re.search(r"DelTree\(\s*App\s*,", iss) and "RemoveBackslash" in iss and "RemoveDir(App)" in iss,
          "MUST-FAIL (HIGH-1b): the uninstaller never deletes the whole install folder; it removes films, work and models by name, then the folder only if it is empty")
    check("function IsKeptFolder" in iss and "RYAGRAM-FOLDER.txt" in iss and "not IsKeptFolder(Dir, FindRec.Name)" in iss and iss.count("uninsneveruninstall") == 3,
          "CC1 LOW (23:44): films, work and models are accepted for a reinstall ONLY when Ryagram's marker is inside (the setup writes it, flagged to survive an uninstall that keeps the files)")
    body_ = iss[iss.index("function IsKeptFolder"):iss.index("function FolderHasFiles")]
    check("FileExists(Dir + '" + chr(92) + "' + Name + '" + chr(92) + "RYAGRAM-FOLDER.txt')" in body_ and "SameText(Name, 'films')" in body_,
          "MUST-FAIL (CC1 23:44): a folder named films, work or models counts as Ryagram's only if the marker file is inside it (its name alone is not enough)")
    check((out / "RYAGRAM-FOLDER.txt").is_file() and "Ryagram" in (out / "RYAGRAM-FOLDER.txt").read_text(encoding="ascii"), "the builder writes the marker file next to the script")
    check("procedure DeleteIfOurs" in iss and "FileExists(App + '\\' + Name + '\\RYAGRAM-FOLDER.txt')" in iss and iss.count("DelTree(") == 1 and all(f"DeleteIfOurs(App, '{x}')" in iss for x in ("films", "work", "models")),
          "MUST-FAIL (CC1 23:44): the uninstaller deletes a folder only when the marker is inside it; the single DelTree is behind that test")
    check("GetDriveType('D:\\') = 3" in iss, "LOW-4: D: is chosen only when it is a fixed disk (not a USB stick or a card)")

    print("\nrefusals (each must leave --out absent or untouched)")
    cases = []

    def refuse(what, word, **kw):
        nm = "r%d" % len(cases)
        cases.append(nm)
        info, err, o = attempt(root, nm, **kw)
        check(info is None and err and word in err and (not o.exists() or o.name == "full" or not any(o.iterdir())), f"MUST-FAIL: {what}: refused ({(err or 'NOT REFUSED')[:80]!r}) and nothing is left in the output folder")

    b2 = make_bundle(fresh("w2"))
    (b2 / "tools" / "desktop_maker.py").write_text("print('changed')\n")
    refuse("a bundle that fails its own start-time check", "start-time check", bundle=b2, iscc=stub)
    b3 = make_bundle(fresh("w3"))
    (b3 / "SHA256SUMS.txt").unlink()
    refuse("a folder that is not a bundle", "not a bundle", bundle=b3, iscc=stub)
    b4 = make_bundle(fresh("w4"))
    tok = "rgn_" + "A" * 43
    (b4 / "tools" / "desktop_maker.py").write_text("t = '" + tok + "'\n")
    sums = (b4 / "SHA256SUMS.txt").read_text()
    lines = []
    for l in sums.splitlines():
        h, rel = l[:64], l[66:]
        lines.append(f"{sha(b4 / rel)}  {rel}" if rel != "BUNDLE-MANIFEST.json" else l)
    (b4 / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    refuse("a bundle that holds a node token (its checksums are fine, so only the leak scan can see it)", "must never travel", bundle=b4, iscc=stub)
    refuse("a version label with odd characters", "version label", bundle=b, iscc=stub, version="7 && del")
    refuse("an empty version label", "version label", bundle=b, iscc=stub, version="")
    refuse("a missing compiler", "was not found", bundle=b, iscc=root / "nope.exe")
    refuse("a compiler that is not signed", "not signed by", bundle=b, iscc=stub, sig=NO_SIG)
    refuse("a compiler signed by someone else", "not signed by", bundle=b, iscc=stub, sig=FAKE_SIG)
    refuse("MUST-FAIL (CC1 LOW-A): the RIGHT name with the WRONG certificate thumbprint", "pinned certificate", bundle=b, iscc=stub, sig=WRONG_THUMB)
    refuse("MUST-FAIL (CC1 LOW-A): a look-alike subject that merely CONTAINS the name (CN=NotPyrsys B.V. Ltd)", "pinned certificate", bundle=b, iscc=stub, sig=LOOKALIKE)
    refuse("MUST-FAIL (CC1 LOW-A): a compiler file that is not the pinned one, even with a perfect signature answer", "not the compiler that was verified", bundle=b, iscc=stub, pins={"0" * 64: {"thumbprint": THUMB}})
    check(mai.COMPILER_PINS.get("0a8757031b33777e4c9cbffee40f11a5062b36d25cbe144c1db73b6102b80ad7", {}).get("thumbprint") == "E0AB19C8D38CBF9C44709925122A7A02F8C70CB7" and len(mai.COMPILER_PINS) == 1,
          "the shipped pin is the one compiler file CC1 and I both read (SHA-256 0a875703..., thumbprint E0AB19C8...)")
    refuse("a compiler whose signature no longer matches the file", "not signed by", bundle=b, iscc=stub, sig=BAD_SIG)
    refuse("a compile that fails", "did not finish", bundle=b, iscc=make_stub(root, rc=1))
    refuse("a compile that says fine but writes no setup file", "did not finish", bundle=b, iscc=make_stub(root, rc=0, write=False))
    full = root / "full"
    full.mkdir()
    (full / "x").write_text("x")
    refuse("an output folder that already has files", "not empty", bundle=b, iscc=stub, out=full)
    ghost = next(L for L in "ZYXWVUTSRQPONMLKJIHGFE" if not os.path.exists(f"{L}:\\"))          # a drive letter this PC does not have: even a broken guard cannot create anything there
    ghost_out = Path(f"{ghost}:/Ryagram-installer-check-not-created")
    info, err, o = attempt(root, "offd", bundle=b, iscc=stub, out=ghost_out, allow_any_drive=False)
    check(info is None and err and "D:" in err and not ghost_out.exists(), f"MUST-FAIL: an output folder off D: is refused and not created (aimed at the missing drive {ghost}:, never at a real root)")
    keep = mai.need_free
    mai.need_free = lambda bundle: 1 << 60
    refuse("too little free space", "free space", bundle=b, iscc=stub)
    mai.need_free = keep
    check(sha(b / "tools" / "verify_bundle.py") == before["tools/verify_bundle.py"], "the refused runs changed nothing in the good bundle")

    print("\nthe compiler's whole folder is pinned (CC1 00:21)")
    inno = fresh("inno-folder")
    (inno / "Languages").mkdir()
    (inno / "ISCmplr.dll").write_bytes(b"dll-1")
    (inno / "ISPP.dll").write_bytes(b"dll-2")
    (inno / "Languages" / "German.isl").write_text("de")
    shutil.copy2(stub, inno / "iscc.bat")
    good = {"ISCmplr.dll": sha(inno / "ISCmplr.dll"), "ISPP.dll": sha(inno / "ISPP.dll"), "Languages/German.isl": sha(inno / "Languages" / "German.isl"), "iscc.bat": sha(inno / "iscc.bat")}
    def folder_try(name, listing):
        i, e, o = attempt(root, name, bundle=b, iscc=inno / "iscc.bat", check_folder=True, folder_pins=listing)
        return i, e
    i, e = folder_try("fo1", good)
    check(i is not None and e is None, f"a compiler folder that is exactly the verified list is accepted ({e})")
    (inno / "unins000.dat").write_bytes(b"differs per install")
    i, e = folder_try("fo2", good)
    check(i is not None, "and the uninstall record unins000.* may be there and differ")
    (inno / "ISPP.dll").write_bytes(b"dll-2-CHANGED")
    i, e = folder_try("fo3", good)
    check(i is None and e and "ISPP.dll has been changed" in e, f"MUST-FAIL: a changed DLL beside the compiler refuses it ({(e or 'NOT REFUSED')[:80]!r})")
    (inno / "ISPP.dll").write_bytes(b"dll-2")
    (inno / "Evil.dll").write_bytes(b"x")
    i, e = folder_try("fo4", good)
    check(i is None and e and "Evil.dll was added" in e, f"MUST-FAIL: an extra DLL in the compiler's folder refuses it ({(e or 'NOT REFUSED')[:80]!r})")
    (inno / "Evil.dll").unlink()
    (inno / "Languages" / "German.isl").unlink()
    i, e = folder_try("fo5", good)
    check(i is None and e and "German.isl is missing" in e, f"MUST-FAIL: a missing file refuses it ({(e or 'NOT REFUSED')[:80]!r})")
    lst = mai.load_folder_list()
    check(len(lst) > 100 and "ISCmplr.dll" in lst and all(len(h) == 64 for h in lst.values()) and not any(k.lower().startswith("unins") for k in lst), "the shipped list names every file of the verified Inno folder (ISCmplr.dll and ISPP.dll among them) and none of the uninstall record")

    print("\nthe small things CC1 listed")
    odd = fresh("odd '; echo INJECTED; '")
    f = odd / "x.bat"
    f.write_text("@echo off\r\n")
    sig = mai.run_signature_check(f)
    check("INJECTED" not in sig and sig.split("|")[0] in ("NotSigned", "UnknownError", "Valid"), f"LOW-1: a quote and a semicolon in the compiler's path do not run anything in PowerShell ({sig[:40]!r})")
    for what, name in (("braces", "w{x}"), ("an accented letter", "wé")):
        bad_root = fresh(name)
        bb = make_bundle(bad_root)
        info, err, o = attempt(bad_root, "o", bundle=bb, iscc=stub)
        check(info is None and err and "plain letters" in err, f"LOW-3: a path with {what} is refused in a sentence ({(err or 'NOT REFUSED')[:60]!r})")

    print("\nthe source")
    src = (HERE / "make_app_installer.py").read_text(encoding="utf-8")
    code = src.split('"""', 2)[2]
    check(not re.search(r"^\s*(import|from)\s+(socket|urllib|http|requests|ftplib|smtplib|ssl)\b", code, re.M), "the builder imports no networking module (it downloads nothing)")
    check("subprocess.run([str(iscc), \"/Q\", str(iss)]" in code and code.count("subprocess.run(") == 2, "it runs exactly two programs: Windows' signature check and the compiler")
    check("EXPECT_SIGNER" in code and "check_signature(iscc" in code, "the compiler's signature is checked before it is ever run")
    print()
    if FAILS:
        print("FAILED: " + "; ".join(FAILS))
        return 1
    print("all passed")
    shutil.rmtree(root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
