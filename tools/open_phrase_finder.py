"""Opens the phrase finder's first-run page from the app folder (BUILDER 11-22; FACES' sheet for Sam: 'installs the desktop app and the
phrase finder from the zip without help'). Started by 'Open phrase finder.bat' at the zip's root, with the app's own Python (-I), after the
self-check. Standard library only.

It puts the app folder first on the import path (the zip's Python is started with -I, which leaves the current folder out), checks that
this copy of the engine has the first-run page (ryagram/library/firstrun.py), and runs `ryagram.library start` with anything passed
on (for example --no-browser). A copy without the page says so in plain words and exits 2: nothing is started, nothing is changed.
The page itself serves on 127.0.0.1 only and is FACES' (ryagram/library/firstrun.py).
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
NO_PAGE = ("This copy of the app does not have the phrase finder's first-run page yet. Nothing was started or changed. "
           "Ask for a newer copy of the app from the person or company that gave you this one.")


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not (APP / "ryagram" / "library" / "firstrun.py").is_file():
        print(NO_PAGE)
        return 2
    if str(APP) not in sys.path:
        sys.path.insert(0, str(APP))
    sys.argv = ["ryagram.library", "start", *argv]
    runpy.run_module("ryagram.library", run_name="__main__", alter_sys=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
