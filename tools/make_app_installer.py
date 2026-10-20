"""Wraps the r9 portable app folder in a Windows setup exe with Inno Setup (install option C, NEXT-CONNECT 108). Standard library only. NOTHING IS DOWNLOADED by this script: Inno Setup's
compiler (ISCC.exe) must already be on this PC (a Ryan-approved download, kept on D:), and the input is a bundle folder built by tools/make_app_bundle.py.

    python tools/make_app_installer.py --bundle D:/Ryagram-bundles/app-N --iscc "D:/Ryagram-tools/InnoSetup/ISCC.exe" --out D:/Ryagram-installers/setup-N --version N

THE SETUP EXE: per-user (no administrator prompt); installs into D:\\Ryagram when D: is a ready drive with room, else %LOCALAPPDATA%\\Ryagram (the person can choose another folder); a Start menu entry
"Ryagram" that runs Open Ryagram.bat; an uninstaller in Windows' Apps list. No auto-start, no service, no file association, no registry entry beyond Inno's own uninstall record. The files are the bundle's,
unchanged, so the start-time self-check (tools/verify_bundle.py) works in the installed folder exactly as in the zip. The uninstaller asks whether to keep the films, the work folder and the
downloaded listening model; if the person keeps them, they stay and everything else goes.

IT REFUSES, and leaves nothing behind in --out, when: the bundle is missing its manifest or its own start-time self-check fails (a damaged bundle is never wrapped); the leak scan finds anything that
must never travel; --out is not on D: (the storage rule) or is not empty; ISCC.exe is missing, is not named ISCC.exe, or is not signed by the expected publisher (Windows' own check, run through
PowerShell); the version label has odd characters; there is too little free space; the compile fails. It prints the setup file's exact name, size and SHA-256 for Ryan to read to Sam, and writes
SETUP-MANIFEST.json beside it (setup hash, the bundle's manifest hash, the app head, downloads_made 0). The setup exe is NOT code-signed (a money decision, later): Windows will say Unknown publisher.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import verify_bundle  # noqa: E402
from make_app_bundle import leak_scan  # noqa: E402

APP_ID = "635FB146-7DBF-4396-BC2B-20E4C5154435"          # fixed: a newer setup upgrades the older install in place
EXPECT_SIGNER = "Jordan Russell"                         # the Inno Setup author; the certificate subject of a real ISCC.exe must contain this (checked once it is installed)
VERSION_OK = re.compile(r"^[A-Za-z0-9._-]{1,20}$")

ISS = r'''; Written by tools/make_app_installer.py. Do not edit by hand: the next build overwrites it.
[Setup]
AppId={{__APP_ID__}
AppName=Ryagram
AppVersion=__VERSION__
AppPublisher=Ryagram
DefaultDirName={code:DefaultFolder}
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=__OUT_DIR__
OutputBaseFilename=__BASENAME__
Compression=lzma2/normal
SolidCompression=no
UninstallDisplayName=Ryagram
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
RestartApplications=no
SetupLogging=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Dirs]
Name: "{app}\films"
Name: "{app}\work"
Name: "{app}\models"

[Files]
Source: "__BUNDLE__\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Ryagram"; Filename: "{app}\Open Ryagram.bat"; WorkingDir: "{app}"; Comment: "Open Ryagram"

[Code]
function DefaultFolder(Param: String): String;
var
  Free, Total: Int64;
begin
  if GetSpaceOnDisk64('D:\', Free, Total) and (Free > 3000000000) then
    Result := 'D:\Ryagram'
  else
    Result := ExpandConstant('{localappdata}\Ryagram');
end;

procedure RemoveInstalledParts(const App: String);
var
  Names: array of String;
  I: Integer;
begin
  Names := ['python', 'ffmpeg', 'ryagram', 'tools', 'recipes', 'docs'];
  for I := 0 to GetArrayLength(Names) - 1 do
    DelTree(App + '\' + Names[I], True, True, True);
  DeleteFile(App + '\Open Ryagram.bat');
  DeleteFile(App + '\START-HERE.txt');
  DeleteFile(App + '\BUNDLE-MANIFEST.json');
  DeleteFile(App + '\SHA256SUMS.txt');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  App: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    App := ExpandConstant('{app}');
    if MsgBox('Also delete your films, the work folder and the downloaded listening model? Choose No to keep them.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(App, True, True, True)
    else
    begin
      RemoveInstalledParts(App);
      RemoveDir(App);
    end;
  end;
end;
'''


class Refused(Exception):
    pass


def render_iss(bundle: Path, out: Path, version: str) -> str:
    s = (ISS.replace("{{__APP_ID__}", "{{" + APP_ID + "}")
         .replace("__VERSION__", version)
         .replace("__OUT_DIR__", str(out).replace("/", "\\"))
         .replace("__BASENAME__", f"Ryagram-Setup-{version}")
         .replace("__BUNDLE__", str(bundle).replace("/", "\\")))
    return s


def run_signature_check(path: Path) -> str:
    """Windows' own verdict on a file's signature: 'Valid|<subject>' or the status word. Replaceable in tests."""
    ps = f"$s = Get-AuthenticodeSignature -LiteralPath '{path}'; Write-Output ($s.Status.ToString() + '|' + $(if ($s.SignerCertificate) {{ $s.SignerCertificate.Subject }} else {{ '' }}))"
    r = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True, timeout=60)
    return (r.stdout or "").strip()


def check_signature(path: Path, runner=run_signature_check, expect: str = EXPECT_SIGNER) -> None:
    got = runner(path)
    status, _, subject = got.partition("|")
    if status != "Valid" or expect.lower() not in subject.lower():
        raise Refused(f"{path.name} is not signed by {expect} (Windows says: {status or 'nothing'}). The compiler is not used.")


def need_free(bundle: Path) -> int:
    return int(sum(p.stat().st_size for p in bundle.rglob("*") if p.is_file()) * 1.2) + (200 << 20)


def build(bundle: Path, iscc: Path, out: Path, version: str, *, allow_any_drive: bool = False, signature_runner=run_signature_check, expect_signer: str = EXPECT_SIGNER,
          check_name: bool = True) -> dict:
    if not VERSION_OK.match(version or ""):
        raise Refused("The version label may only hold letters, digits, dot, dash and underscore (up to 20).")
    bundle, out = Path(bundle).resolve(), Path(out).resolve()
    if not (bundle / "BUNDLE-MANIFEST.json").is_file() or not (bundle / "SHA256SUMS.txt").is_file():
        raise Refused(f"{bundle} is not a bundle built by make_app_bundle.py (no BUNDLE-MANIFEST.json or SHA256SUMS.txt).")
    problems = verify_bundle.check(bundle)
    if problems:
        raise Refused("The bundle fails its own start-time check, so it is not wrapped: " + "; ".join(problems[:5]))
    leaks = leak_scan(bundle)
    if leaks:
        raise Refused("The bundle holds something that must never travel: " + "; ".join(str(x) for x in leaks[:5]))
    if not allow_any_drive and not re.match(r"^[dD]:", str(out)):
        raise Refused("The installer folder must be on D: (the storage rule).")
    if out.exists() and any(out.iterdir()):
        raise Refused(f"{out} is not empty. Nothing is overwritten; use a new folder.")
    iscc = Path(iscc)
    if not iscc.is_file():
        raise Refused(f"ISCC.exe was not found at {iscc}. Inno Setup is a Ryan-approved download; this script does not fetch it.")
    if check_name and iscc.name.lower() != "iscc.exe":
        raise Refused("The compiler must be the file ISCC.exe.")
    check_signature(iscc, signature_runner, expect_signer)
    out.mkdir(parents=True, exist_ok=True)
    try:
        if shutil.disk_usage(out).free < need_free(bundle):
            raise Refused(f"Not enough free space in {out} (about {need_free(bundle) >> 20} MB needed).")
        iss = out / "app.iss"
        iss.write_bytes(render_iss(bundle, out, version).encode("ascii"))
        r = subprocess.run([str(iscc), "/Q", str(iss)], capture_output=True, text=True, timeout=3600)
        setup = out / f"Ryagram-Setup-{version}.exe"
        if r.returncode != 0 or not setup.is_file():
            tail = " | ".join((r.stdout + r.stderr).strip().splitlines()[-4:])
            raise Refused(f"The compile did not finish (code {r.returncode}): {tail[:400]}")
        manifest = json.loads((bundle / "BUNDLE-MANIFEST.json").read_text(encoding="utf-8"))
        info = {"setup": setup.name, "bytes": setup.stat().st_size, "sha256": verify_bundle.sha256_file(setup), "version": version,
                "bundle_manifest_sha256": verify_bundle.sha256_file(bundle / "BUNDLE-MANIFEST.json"), "app_head": manifest.get("app_head"),
                "signed": False, "downloads_made": 0}
        (out / "SETUP-MANIFEST.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
        return info
    except BaseException:
        shutil.rmtree(out, ignore_errors=True)
        raise


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--iscc", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--allow-any-drive", action="store_true", help="tests only")
    a = ap.parse_args(argv)
    try:
        info = build(Path(a.bundle), Path(a.iscc), Path(a.out), a.version, allow_any_drive=a.allow_any_drive)
    except Refused as e:
        print("Refused: " + str(e))
        return 2
    print(f"Built {info['setup']}  {info['bytes']:,} bytes\nSHA-256 (read this to Sam): {info['sha256']}\nNot code-signed: Windows will say Unknown publisher.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
