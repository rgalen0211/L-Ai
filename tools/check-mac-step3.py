"""Mac-ready step 3 (NEXT-CONNECT 188): the site-film renderer's own Windows habits, behind tools/ryagram_platform.py, with MUST-FAILs. Runs on Windows.

    py -I tools/check-mac-step3.py

Four small seams: the program file name (ffmpeg.exe or ffmpeg), the child process's fixed environment, the machine-wide runs list's default folder, and where Google Chrome lives. Each has a Windows body that must answer
EXACTLY as the code did before this step, and a macOS (and Linux) body proved with stand-ins. What only a real Mac can prove is in proposals/CONNECT-MAC-READY-STEP3.md. No network, no file written."""
import ntpath
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ryagram_platform as plat                   # noqa: E402
import node_settings as ns                        # noqa: E402
import ryagram_node_job as nj                     # noqa: E402

FAILS = []
BS = chr(92)


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


print("1. the program's file name")
check(plat.exe_name("ffmpeg", "windows") == "ffmpeg.exe" and plat.exe_name("ffmpeg", "mac") == "ffmpeg" and plat.exe_name("ffmpeg", "linux") == "ffmpeg", "ffmpeg.exe on Windows, ffmpeg on macOS and Linux")
src = (HERE / "ryagram_node_render.py").read_text(encoding="utf-8")
check('plat.exe_name("ffmpeg")' in src and '"ffmpeg.exe"' not in src, "the renderer asks the platform module for the name (no hard-coded ffmpeg.exe is left)")

print("2. the child's environment")


def old_env(environ, tmp):          # the dictionary the renderer built inline before this step, copied here as the yardstick
    return {"SYSTEMROOT": environ.get("SYSTEMROOT", "C:" + BS + "Windows"), "PATH": environ.get("SYSTEMROOT", "C:" + BS + "Windows") + BS + "System32",
            "TEMP": str(tmp), "TMP": str(tmp), "TMPDIR": str(tmp), "PYTHONUTF8": "1"}


for environ in ({}, {"SYSTEMROOT": "D:" + BS + "Win"}, {"SYSTEMROOT": "C:" + BS + "Windows", "SECRET": "x"}):
    check(plat.child_env("T:" + BS + "tmp", environ, "windows") == old_env(environ, "T:" + BS + "tmp"), "Windows: exactly the old environment for %r" % sorted(environ))
e = plat.child_env("/jobs/j1/tmp-node", {"SECRET": "x", "PATH": "/home/sam/bin", "HOME": "/Users/sam"}, "mac")
check(e == {"PATH": "/usr/bin:/bin", "HOME": "/jobs/j1/tmp-node", "TEMP": "/jobs/j1/tmp-node", "TMP": "/jobs/j1/tmp-node", "TMPDIR": "/jobs/j1/tmp-node", "LANG": "en_US.UTF-8", "PYTHONUTF8": "1"}, "macOS: a plain system PATH, the job's own folder as HOME and temp, UTF-8")
check("SECRET" not in e and "/home/sam/bin" not in str(e) and "/Users/sam" not in str(e), "MUST-FAIL guard: nothing of the person's environment (a token, their PATH, their real home) is inherited")
check("SYSTEMROOT" not in e, "macOS has no Windows variables")
check("plat.child_env(tmp)" in src and "SYSTEMROOT" not in src, "the renderer uses the platform function (no private copy of the dictionary is left)")

print("3. the runs list")
check(plat.runs_dir_default({"ProgramData": "D:" + BS + "PD"}, "windows") == Path("D:" + BS + "PD") / "Ryagram" / "runs", "Windows: ProgramData as before")
check(plat.runs_dir_default({"SystemDrive": "E:"}, "windows") == Path("E:" + BS + "ProgramData") / "Ryagram" / "runs" and plat.runs_dir_default({}, "windows") == Path("C:" + BS + "ProgramData") / "Ryagram" / "runs", "Windows: the system drive when ProgramData is missing, C: when that is missing too (as before)")
check(plat.runs_dir_default({"HOME": "/Users/sam"}, "mac") == Path("/Users/sam/Library/Application Support/Ryagram/runs"), "macOS: the user's Library/Application Support")
check(plat.runs_dir_default({"HOME": "/home/sam"}, "linux") == Path("/home/sam/.local/share/Ryagram/runs") and plat.runs_dir_default({"HOME": "/home/sam", "XDG_DATA_HOME": "/data"}, "linux") == Path("/data/Ryagram/runs"), "Linux: the user's data folder")
import os                                                                    # noqa: E402
os.environ["RYAGRAM_RUNS_DIR"] = "Z:" + BS + "elsewhere"
check(nj.runs_dir() == Path("Z:" + BS + "elsewhere"), "an explicit RYAGRAM_RUNS_DIR still wins")
del os.environ["RYAGRAM_RUNS_DIR"]
check(nj.runs_dir() == plat.runs_dir_default(), "the node job's runs_dir() is the platform default")
saved = {k: os.environ.pop(k, None) for k in ("ProgramData", "SystemDrive")}
os.environ["SystemDrive"] = "E:"
try:
    check(sys.platform != "win32" or nj.runs_dir() == Path("E:"+BS+"ProgramData") / "Ryagram" / "runs", "the node job's runs_dir() follows the platform rule when ProgramData is missing (the system drive, as before)")
finally:
    os.environ.pop("SystemDrive", None)
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v

print("4. where Chrome lives")
mac_app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mac_user = "/Users/sam/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
check(ns.find_browser({"HOME": "/Users/sam"}, lambda p: p == mac_app, "mac") == mac_app, "macOS: the machine's Chrome")
check(ns.find_browser({"HOME": "/Users/sam"}, lambda p: p == mac_user, "mac") == mac_user, "macOS: the user's own Chrome")
check(ns.find_browser({"HOME": "/Users/sam"}, lambda p: p == "/Applications/Safari.app/Contents/MacOS/Safari", "mac") is None, "MUST-FAIL guard: macOS with no Chrome is None (Safari and Edge are never taken)")
check(ns.find_browser({}, lambda p: p == mac_app, "mac") == mac_app, "macOS with no HOME still finds the machine's Chrome")
win = ntpath.join("C:" + BS + "Program Files", "Google", "Chrome", "Application", "chrome.exe")
got = ns.find_browser({"PROGRAMFILES": "C:" + BS + "Program Files"}, lambda p: str(p).replace("/", BS) == win, "windows")
check(got is not None and got.endswith("Google/Chrome/Application/chrome.exe"), "Windows: chrome.exe in Program Files, as before (forward slashes)")
check(ns.find_browser({}, lambda p: True, "windows") is None, "Windows with no folders named is still None")

print()
print("ALL PASS" if not FAILS else "FAILED: " + "; ".join(FAILS))
sys.exit(1 if FAILS else 0)
