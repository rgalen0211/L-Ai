"""The few places where the desktop app must behave differently on Windows, macOS and Linux, in ONE module (NEXT-CONNECT 166, Mac-ready step 1; the plan is proposals/CONNECT-MAC-READY-PLAN.md).

Standard library only, no network. Every function takes the platform and the system calls it uses as arguments (default: the real ones), so the macOS and Linux bodies run in the Windows checks
(tools/check-ryagram-platform.py) with stand-ins, and the Windows bodies are the code the app already ran, moved here unchanged:

    kill_tree(proc)               end a child and ITS children, by pid, never by name (Windows: taskkill /T /F; elsewhere: the child's own process group, which popen_group_kwargs() puts it in)
    popen_group_kwargs()          the Popen keyword arguments that make that possible (elsewhere: start_new_session; Windows: nothing, or no console window when asked)
    reveal_argv(path) / reveal()  show a file in the computer's own file window (explorer /select, | open -R | xdg-open on the folder)
    search_folders(home)          where "find my file" looks (Videos on Windows, Movies on macOS, plus Downloads, Desktop and Documents)
    total_memory_bytes()          physical memory, or None when it cannot be read
    on_system_drive(path)         Ryan's storage rule 'nothing heavy on C:' as a function: Windows C: (or no drive at all); macOS and Linux have no drive letters, so it is never true there (Mac step 2)
    exe_name(base)                a program's file name on this system (ffmpeg.exe on Windows, ffmpeg elsewhere)
    child_env(tmp)                the short, fixed environment a site-film child runs in (Windows: SYSTEMROOT and System32 only; elsewhere: a plain PATH and the job's own folder as HOME)
    runs_dir_default()            where the machine-wide list of running renders lives by default (ProgramData on Windows; the user's Library or data folder elsewhere)

What is NOT here yet, and needs a real Mac to be written and proved: the Keychain store for the sign-in token, the macOS Python / ffmpeg / wheels of the bundle, signing and notarization.
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path, PurePosixPath

WINDOWS, MAC, LINUX = "windows", "mac", "linux"
CREATE_NO_WINDOW = 0x08000000


def current(platform_name: str | None = None) -> str:
    """'windows', 'mac' or 'linux' (anything not Windows or macOS is treated as Linux, the common POSIX case)."""
    p = (platform_name if platform_name is not None else sys.platform).lower()
    if p.startswith("win") or p == "cygwin":
        return WINDOWS
    if p == "darwin" or p.startswith("mac"):
        return MAC
    return LINUX


def popen_group_kwargs(system: str | None = None, hide_window: bool = False) -> dict:
    """Keyword arguments for subprocess.Popen so kill_tree can end the child and its children later. On Windows taskkill /T needs nothing (hide_window=True adds CREATE_NO_WINDOW, as the
    site-film renderer always did); elsewhere the child becomes the leader of its own process group, so the app never signals its own."""
    system = system or current()
    if system == WINDOWS:
        return {"creationflags": CREATE_NO_WINDOW} if hide_window else {}
    return {"start_new_session": True}


def kill_tree(proc, *, system: str | None = None, run=None, getpgid=None, killpg=None, timeout: float = 30) -> str:
    """End `proc` and every process it started, by PID. Returns what was done ('taskkill', 'group', 'single'). Never signals a group this app is in: a child that is not its own group leader is
    killed alone (that is what happens for a child started without popen_group_kwargs())."""
    system = system or current()
    if system == WINDOWS:
        (run or subprocess.run)(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=timeout, check=False)      # my own job, by its PID and its children, never by name
        return "taskkill"
    getpgid = getpgid or getattr(os, "getpgid", None)
    killpg = killpg or getattr(os, "killpg", None)
    sig = getattr(signal, "SIGKILL", 9)
    try:
        if getpgid is not None and killpg is not None and getpgid(proc.pid) == proc.pid:
            killpg(proc.pid, sig)
            return "group"
    except (ProcessLookupError, PermissionError, OSError):
        pass
    proc.kill()
    return "single"


def reveal_argv(path, system: str | None = None) -> list:
    """The command that shows `path` in the computer's own file window."""
    system = system or current()
    path = str(path)
    if system == WINDOWS:
        return ["explorer", "/select," + path]
    if system == MAC:
        return ["open", "-R", path]
    return ["xdg-open", str(PurePosixPath(path).parent)]


def reveal(path, *, system: str | None = None, popen=None):
    return (popen or subprocess.Popen)(reveal_argv(path, system))


def search_folders(home, system: str | None = None, is_dir=lambda p: p.is_dir()) -> list:
    """The person's own folders that exist, in the order "find my file" looks. Videos (Windows) and Movies (macOS) are each looked for only where the system has them."""
    system = system or current()
    home = Path(home)
    old = ("Videos", "Downloads", "Desktop", "Documents", "Movies")              # what the app always looked in (Windows and Linux keep exactly this)
    names = {WINDOWS: old, LINUX: old, MAC: ("Movies", "Downloads", "Desktop", "Documents")}[system]
    return [home / n for n in names if is_dir(home / n)]


def _windows_total_memory() -> int | None:
    try:
        import ctypes

        class MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                        ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        ms = MS()
        ms.dwLength = ctypes.sizeof(MS)
        return int(ms.ullTotalPhys) if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms)) else None
    except (AttributeError, OSError):
        return None


def total_memory_bytes(system: str | None = None, *, sysconf=None, windows_total=_windows_total_memory) -> int | None:
    """Physical memory in bytes, or None when the system will not say."""
    system = system or current()
    if system == WINDOWS:
        return windows_total()
    sysconf = sysconf or getattr(os, "sysconf", None)
    if sysconf is None:
        return None
    try:
        pages, size = int(sysconf("SC_PHYS_PAGES")), int(sysconf("SC_PAGE_SIZE"))
    except (ValueError, OSError, TypeError):
        return None
    return pages * size if pages > 0 and size > 0 else None


def on_system_drive(path, system: str | None = None, *, splitdrive=os.path.splitdrive, abspath=os.path.abspath) -> bool:
    """True when `path` is on the Windows C: drive (Ryan's rule: nothing heavy or temporary on C:), or its drive cannot be told (treated as C:, the safe answer).
    macOS and Linux have no drive letters: os.path.splitdrive answers an empty drive for every path there, which the Windows rule reads as "unknown, so C:", and would refuse EVERY
    path on a Mac. There the rule does not apply (False); the free-space floor of the callers still does."""
    if current(system) != WINDOWS:
        return False
    try:
        drive = splitdrive(abspath(str(path)))[0]
    except (OSError, ValueError):
        return True
    return drive.upper() in ("C:", "")


def exe_name(base: str, system: str | None = None) -> str:
    """A program's file name here: `ffmpeg` is ffmpeg.exe on Windows and ffmpeg on macOS and Linux."""
    return base + ".exe" if current(system) == WINDOWS else base


def child_env(tmp, environ=None, system: str | None = None) -> dict:
    """The environment a site-film child process runs in: a SHORT fixed list, nothing inherited (no tokens, no PATH of the person). Windows keeps exactly what it always had (SYSTEMROOT, System32 on PATH,
    the temp folders, UTF-8). macOS and Linux get a plain system PATH, the job's own folder as HOME (nothing is written in the person's real home), the temp folders and UTF-8."""
    environ = os.environ if environ is None else environ
    t = str(tmp)
    if current(system) == WINDOWS:
        root = environ.get("SYSTEMROOT", "C:" + chr(92) + "Windows")
        return {"SYSTEMROOT": root, "PATH": root + chr(92) + "System32", "TEMP": t, "TMP": t, "TMPDIR": t, "PYTHONUTF8": "1"}
    return {"PATH": "/usr/bin:/bin", "HOME": t, "TEMP": t, "TMP": t, "TMPDIR": t, "LANG": "en_US.UTF-8", "PYTHONUTF8": "1"}


def runs_dir_default(environ=None, system: str | None = None, home=None) -> Path:
    """Where the machine-wide list of running renders lives when nothing says otherwise: the ProgramData folder under Ryagram/runs on Windows (as before), ~/Library/Application Support/Ryagram/runs on a Mac, the user's data folder on Linux."""
    environ = os.environ if environ is None else environ
    sysname = current(system)
    if sysname == WINDOWS:
        pd = environ.get("ProgramData") or (environ.get("SystemDrive", "C:") + chr(92) + "ProgramData")
        return Path(pd) / "Ryagram" / "runs"
    h = Path(home) if home is not None else Path(environ.get("HOME") or Path.home())
    if sysname == MAC:
        return h / "Library" / "Application Support" / "Ryagram" / "runs"
    return Path(environ.get("XDG_DATA_HOME") or (h / ".local" / "share")) / "Ryagram" / "runs"


def free_bytes(path, usage=shutil.disk_usage) -> int | None:
    """Free space on the volume that holds `path` (the nearest folder that exists), or None."""
    p = Path(path)
    while not p.exists() and p != p.parent:
        p = p.parent
    try:
        return int(usage(str(p)).free)
    except OSError:
        return None
