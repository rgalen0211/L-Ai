"""The macOS start file for the portable app folder, and the zip step that keeps it startable (NEXT-CONNECT 166, Mac-ready step 1; plan: proposals/CONNECT-MAC-READY-PLAN.md rows 1 and 14).

Standard library only. NOT yet wired into tools/make_app_bundle.py: the builder cannot make a Mac folder until it has a macOS Python, ffmpeg and wheels (see the plan, step 3). What exists now is the part
that can be written and proved on a Windows PC:

  command_text(maker_extra, signin)   the text of "Open Ryagram.command": the same steps, in the same order, as "Open Ryagram.bat" (own Python and ffmpeg from THIS folder, the self-check BEFORE the app,
                                      the app line ending in the tester's MAKER_EXTRA), written for bash with LF endings. Folder names with spaces are handled.
  zip_mode(arcname)                   the Unix permission bits a zip entry needs on a Mac (the start file, the Python and ffmpeg programs must be executable; a zip written on Windows has none)
  add_to_zip(z, path, arcname)        zipfile.write that sets them

Tested on Windows with a stand-in folder and the real bash that Git for Windows carries (tools/check-ryagram-platform.py). What only a real Mac can show is listed in the plan's section 6 and in
proposals/CONNECT-MAC-READY-STEP1.md."""
from __future__ import annotations

import stat
import zipfile
from pathlib import Path, PurePosixPath

COMMAND_NAME = "Open Ryagram.command"
PY = "python/bin/python3"
EXEC_FILES = {COMMAND_NAME, "Open Ryagram (fill missing words).command", "Get word builder.command", "ffmpeg/ffmpeg", "ffmpeg/ffprobe"}
EXEC_DIRS = ("python/bin/",)


def command_text(maker_extra: str = "", signin: str = "") -> str:
    """The start file. `maker_extra` and `signin` are the strings make_app_bundle already checks whole (check_maker_extra, check_signin): only plain switches and the fixed site address reach this text."""
    if any(c in maker_extra + signin for c in ("\n", "\r", "`", "$", "\\")):
        raise ValueError("a start-file switch may not hold a newline, backtick, dollar sign or backslash")
    lines = [
        "#!/bin/bash",
        "# Starts the Ryagram desktop app from THIS folder, with this folder's own Python. Nothing is installed; nothing outside this folder is changed except the sign-in kept in the Keychain.",
        'cd "$(dirname "$0")" || exit 1',
        'HERE="$(pwd)"',
        'export PATH="$HERE/python/bin:$HERE/ffmpeg:$PATH"',
        'export FFMPEG_PATH="$HERE/ffmpeg/ffmpeg"',
        'export FFPROBE_PATH="$HERE/ffmpeg/ffprobe"',
        'export RYAGRAM_MODEL_DIR="$HERE/models"',
        "export PYTHONNOUSERSITE=1",
        "export PYTHONDONTWRITEBYTECODE=1",
        'if ! "$HERE/' + PY + '" -I "$HERE/tools/verify_bundle.py" "$HERE"; then',
        "  echo",
        '  echo "Do not go on. Close this window and tell Ryan what is written above."',
        '  read -r -p "Press Return to close. " _',
        "  exit 1",
        "fi",
        *(['if [ -z "${MAKER_EXTRA+x}" ]; then MAKER_EXTRA="' + maker_extra + '"; fi'] if maker_extra else []),
        'OPEN="--open"',
        'if [ -n "${MAKER_NO_OPEN:-}" ]; then OPEN=""; fi',
        # the app line: folders first, then the sign-in text, then $OPEN and the tester's MAKER_EXTRA (unquoted on purpose: it holds several switches), as in the .bat
        '"$HERE/' + PY + '" -I "$HERE/tools/desktop_maker.py" --work-dir "$HERE/work" --out-dir "$HERE/films" ' + (signin + " " if signin else "") + "$OPEN ${MAKER_EXTRA:-}",
        "rc=$?",
        'if [ "$rc" -ne 0 ]; then read -r -p "Press Return to close. " _; fi',
        'exit "$rc"',
        "",
    ]
    return "\n".join(lines)


def zip_mode(arcname: str) -> int:
    """The value for ZipInfo.external_attr: Unix mode in the high 16 bits. 0o755 for the programs and start files, 0o644 for everything else. `arcname` is relative to the folder (any top folder is ignored)."""
    parts = PurePosixPath(arcname.replace("\\", "/")).parts
    rel = "/".join(parts[1:]) if len(parts) > 1 else "/".join(parts)
    exe = rel in EXEC_FILES or any(rel.startswith(d) for d in EXEC_DIRS)
    mode = stat.S_IFREG | (0o755 if exe else 0o644)
    return (mode & 0xFFFF) << 16


def add_to_zip(z: zipfile.ZipFile, path, arcname) -> None:
    info = zipfile.ZipInfo.from_file(str(path), str(arcname).replace("\\", "/"))
    info.external_attr = zip_mode(info.filename)
    info.compress_type = zipfile.ZIP_DEFLATED
    with open(path, "rb") as f:
        z.writestr(info, f.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)


def write_command_file(out: Path, maker_extra: str = "", signin: str = "") -> Path:
    """Write the start file with LF endings (a bash script with CRLF endings does not run)."""
    p = Path(out) / COMMAND_NAME
    p.write_bytes(command_text(maker_extra, signin).encode("ascii"))
    return p
