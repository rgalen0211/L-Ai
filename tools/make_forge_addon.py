"""Builds the small word-builder add-on zip for the portable app (NEXT-CONNECT 132): two files that go at the ROOT of the app folder (the one that holds Open Ryagram.bat), outside
the folders the app's start-time self-check watches, so app-1026b.zip itself is not touched:

    Get word builder.bat    runs the bundle's own python on get_word_builder.py, with the bundle's models folder
    get_word_builder.py     tools/get_word_builder.py, byte for byte

    python tools/make_forge_addon.py --out D:/.../forge-addon.zip

Refuses an output that is not on D: or already exists. Prints the zip's size and SHA-256. Nothing is downloaded and nothing is sent anywhere; it only writes the zip."""
import argparse
import hashlib
import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BAT = "\r\n".join([
    "@echo off",
    "rem Fetches the word-building model once (about 378 MB), checked against written-in sizes and hashes. Nothing else is installed or changed.",
    "setlocal",
    "title Ryagram: get the word builder",
    'cd /d "%~dp0"',
    'if not exist "%~dp0python\\python.exe" (',
    "  echo This file belongs in the Ryagram app folder, next to Open Ryagram.bat. Move it there and open it again.",
    "  pause",
    "  exit /b 1",
    ")",
    'set "RYAGRAM_MODEL_DIR=%~dp0models"',
    'set "PYTHONNOUSERSITE=1"',
    'set "PYTHONDONTWRITEBYTECODE=1"',
    '"%~dp0python\\python.exe" -I "%~dp0get_word_builder.py" --models "%~dp0models"',
    "echo.",
    "pause",
    "",
])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    out = Path(a.out)
    if not re.match(r"^[dD]:", str(out.resolve())):
        print("REFUSED: the zip is written on D: only.")
        return 2
    if out.exists():
        print(f"REFUSED: {out} already exists.")
        return 2
    py = (HERE / "get_word_builder.py").read_bytes()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Get word builder.bat", BAT.encode("ascii"))
        z.writestr("get_word_builder.py", py)
    data = out.read_bytes()
    print(f"{out}  {len(data)} bytes  sha256 {hashlib.sha256(data).hexdigest()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
