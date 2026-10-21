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
EXPECT_SIGNER = "Pyrsys B.V."                         # READ from the real Inno Setup 6.7.3 (ISCC.exe and the installer both: Windows says Valid, signer CN=Pyrsys B.V., O=Pyrsys B.V., NL; Pyrsys is the maintainer's company); a compiler signed by anyone else is refused
# CC1 00:18 LOW-A: the compiler is pinned by the exact file and its certificate, not by a name. Read from the real Inno Setup 6.7.3 on 2026-10-21 (CC1 read the same values).
COMPILER_PINS = {
    "0a8757031b33777e4c9cbffee40f11a5062b36d25cbe144c1db73b6102b80ad7": {"thumbprint": "E0AB19C8D38CBF9C44709925122A7A02F8C70CB7", "what": "Inno Setup 6.7.3 ISCC.exe"},
}
FOLDER_LIST = HERE / "inno-6.7.3-files.sha256"          # SHA-256 of every file of the verified Inno Setup 6.7.3 folder (not the uninstall record unins000.*, which differs per install)
UNINS_RECORD = re.compile(r"^unins\d{3}\.(dat|exe|msg)$")       # only the real uninstall record may differ; 'uninst.dll' or 'unins_evil.dll' are NOT it (CC1 00:25)
SAFE_PATH = re.compile(r"^[A-Za-z0-9 _.()\\/:-]+$")
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
Source: "__OUT_DIR__\RYAGRAM-FOLDER.txt"; DestDir: "{app}\films"; Flags: uninsneveruninstall
Source: "__OUT_DIR__\RYAGRAM-FOLDER.txt"; DestDir: "{app}\work"; Flags: uninsneveruninstall
Source: "__OUT_DIR__\RYAGRAM-FOLDER.txt"; DestDir: "{app}\models"; Flags: uninsneveruninstall

[UninstallDelete]
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\ffmpeg"
Type: filesandordirs; Name: "{app}\ryagram"
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\recipes"
Type: filesandordirs; Name: "{app}\docs"

[Icons]
Name: "{autoprograms}\Ryagram"; Filename: "{app}\Open Ryagram.bat"; WorkingDir: "{app}"; Comment: "Open Ryagram"

[Code]
function GetDriveType(RootPath: String): Cardinal;
  external 'GetDriveTypeW@kernel32.dll stdcall';

function DefaultFolder(Param: String): String;
var
  Free, Total: Int64;
begin
  { D: only when it is a FIXED disk (a USB stick or a card is not), with room }
  if (GetDriveType('D:\') = 3) and GetSpaceOnDisk64('D:\', Free, Total) and (Free > 3000000000) then
    Result := 'D:\Ryagram'
  else
    Result := ExpandConstant('{localappdata}\Ryagram');
end;

function IsKeptFolder(Dir, Name: String): Boolean;
begin
  Result := (SameText(Name, 'films') or SameText(Name, 'work') or SameText(Name, 'models')) and FileExists(Dir + '\' + Name + '\RYAGRAM-FOLDER.txt');
end;

function FolderHasFiles(Dir: String): Boolean;
var
  FindRec: TFindRec;
begin
  Result := False;
  if FindFirst(Dir + '\*', FindRec) then
  begin
    try
      repeat
        { films, work and models are common names: one counts as Ryagram's own only when it carries Ryagram's marker file (written by an earlier setup, kept by an uninstall that kept the files) }
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') and (not IsKeptFolder(Dir, FindRec.Name)) then
          Result := True;
      until Result or (not FindNext(FindRec));
    finally
      FindClose(FindRec);
    end;
  end;
end;

{ HIGH-1 (a): a folder that already holds someone's files is refused, unless it is an earlier Ryagram folder (an upgrade). One test, used by the folder page AND by the install step, so a folder given on the command line (/DIR=) is checked too }
function FolderProblem(Dir: String): String;
begin
  Result := '';
  if DirExists(Dir) and (not FileExists(Dir + '\BUNDLE-MANIFEST.json')) and FolderHasFiles(Dir) then
    Result := 'That folder already has files in it and is not a Ryagram folder. Choose a new or empty folder, so none of your files are touched.';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Problem: String;
begin
  Result := True;
  if (CurPageID = wpSelectDir) and (not WizardSilent) then          { an unattended install is checked in PrepareToInstall; an error message box would wait for a person }
  begin
    Problem := FolderProblem(RemoveBackslashUnlessRoot(WizardDirValue));
    if Problem <> '' then
    begin
      MsgBox(Problem, mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := FolderProblem(RemoveBackslashUnlessRoot(WizardDirValue));
  if (Result <> '') and WizardSilent then
  begin
    Log(Result);                      { an unattended install has nobody to read a message box: it writes the reason to the log and stops, touching nothing }
    Abort;
  end;
end;

{ a folder is deleted only when Ryagram's own marker is inside it, never just because of its name }
procedure DeleteIfOurs(App, Name: String);
begin
  if FileExists(App + '\' + Name + '\RYAGRAM-FOLDER.txt') then
    DelTree(App + '\' + Name, True, True, True);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  App: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    App := ExpandConstant('{app}');
    { an unattended uninstall may say /DELETEFILES=yes or /DELETEFILES=no; otherwise the person is asked, and the default answer is No }
    if (ExpandConstant('{param:DELETEFILES|ask}') = 'yes') or ((ExpandConstant('{param:DELETEFILES|ask}') <> 'no') and
       (MsgBox('Also delete your films, the work folder and the downloaded listening model? Choose No to keep them.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES)) then
    begin
      DeleteIfOurs(App, 'films');
      DeleteIfOurs(App, 'work');
      DeleteIfOurs(App, 'models');
    end;
    RemoveDir(App);                                                  { removes the folder only if nothing is left in it }
  end;
end;
'''


MARKER_TEXT = ("This folder belongs to Ryagram: it holds your films, your work files or the listening model. The Ryagram setup put this note here, and the uninstaller deletes the folder\r\n"
               "only if this note is inside it and you answered Yes. Do not copy this note into a folder of your own.\r\n")


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
    quoted = str(path).replace("'", "''")
    ps = (f"$s = Get-AuthenticodeSignature -LiteralPath '{quoted}'; Write-Output ($s.Status.ToString() + '|' + $(if ($s.SignerCertificate) {{ $s.SignerCertificate.Subject }} else {{ '' }})"
          f" + '|' + $(if ($s.SignerCertificate) {{ $s.SignerCertificate.Thumbprint }} else {{ '' }}))")
    r = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True, timeout=60)
    return (r.stdout or "").strip()


def check_signature(path: Path, runner=run_signature_check, pins: dict = None) -> None:
    """The compiler must be EXACTLY a file we verified (its SHA-256 is pinned), Windows must call its signature Valid, the certificate's common name must be exactly EXPECT_SIGNER
    and its thumbprint must be the pinned one. A name alone is never enough (a subject such as 'O=NotPyrsys B.V. Ltd' would contain it)."""
    pins = COMPILER_PINS if pins is None else pins
    h = verify_bundle.sha256_file(Path(path))
    pin = pins.get(h)
    if pin is None:
        raise Refused(f"{Path(path).name} is not the compiler that was verified (its SHA-256 is {h[:16]}...). Only the pinned Inno Setup file is used.")
    parts = (runner(path).split("|") + ["", ""])[:3]
    status, subject, thumb = parts[0], parts[1], parts[2]
    m = re.search(r"(?:^|, )CN=([^,]+)", subject)
    if status != "Valid" or not m or m.group(1) != EXPECT_SIGNER or thumb.upper() != pin["thumbprint"].upper():
        raise Refused(f"{Path(path).name} is not signed by {EXPECT_SIGNER} with the pinned certificate (Windows says: {status or 'nothing'}). The compiler is not used.")


def load_folder_list() -> dict:
    out = {}
    for line in FOLDER_LIST.read_text(encoding="ascii").splitlines():
        if len(line) > 66 and line[64:66] == "  ":
            out[line[66:]] = line[:64]
    return out


def check_compiler_folder(iscc: Path, listing: dict = None) -> None:
    """ISCC.exe loads ISCmplr.dll, ISPP.dll and the compression DLLs from its own folder: every file in that folder must be exactly one we verified (CC1 00:21). An extra,
    missing or changed file refuses the compiler. The uninstall record (unins000.*) is the one thing allowed to differ."""
    listing = load_folder_list() if listing is None else listing
    root = Path(iscc).resolve().parent
    seen = {}
    for p in root.rglob("*"):
        if p.is_file() and not UNINS_RECORD.match(p.name.lower()):
            seen[p.relative_to(root).as_posix()] = verify_bundle.sha256_file(p)
    bad = sorted([f"{k} was added" for k in seen if k not in listing] + [f"{k} is missing" for k in listing if k not in seen] + [f"{k} has been changed" for k in seen if k in listing and seen[k] != listing[k]])
    if bad:
        raise Refused("The compiler's folder is not exactly the verified Inno Setup 6.7.3: " + "; ".join(bad[:4]) + (f" ... and {len(bad) - 4} more" if len(bad) > 4 else "") + ". The compiler is not used.")


def need_free(bundle: Path) -> int:
    return int(sum(p.stat().st_size for p in bundle.rglob("*") if p.is_file()) * 1.2) + (200 << 20)


def build(bundle: Path, iscc: Path, out: Path, version: str, *, allow_any_drive: bool = False, signature_runner=run_signature_check, compiler_pins: dict = None,
          check_name: bool = True, check_folder: bool = True, folder_pins: dict = None) -> dict:
    if not VERSION_OK.match(version or ""):
        raise Refused("The version label may only hold letters, digits, dot, dash and underscore (up to 20).")
    bundle, out = Path(bundle).resolve(), Path(out).resolve()
    for what, p in (("bundle", bundle), ("installer", out), ("compiler", Path(iscc))):
        if not SAFE_PATH.match(str(p)):
            raise Refused(f"The {what} path may only hold plain letters, digits, spaces and . _ - ( ) : \\ / (no braces, quotes or accented letters): {p}")
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
    check_signature(iscc, signature_runner, compiler_pins)
    if check_folder:
        check_compiler_folder(iscc, folder_pins)
    out.mkdir(parents=True, exist_ok=True)
    try:
        if shutil.disk_usage(out).free < need_free(bundle):
            raise Refused(f"Not enough free space in {out} (about {need_free(bundle) >> 20} MB needed).")
        (out / "RYAGRAM-FOLDER.txt").write_bytes(MARKER_TEXT.encode("ascii"))
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
