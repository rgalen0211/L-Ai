"""A throwaway Postgres for the test suites that always cleans up after itself.

Why this exists: each suite used to start a pgserver in a tempfile.mkdtemp() folder and never delete it, and
every test made a database from a template and never dropped it, so every run left a copy of Postgres plus
dozens of databases on C: (about 46 GB by 2026-10-04).

What it guarantees:
  * the server is stopped and its whole folder deleted when the module's tests finish, pass or fail, and when
    setUpModule itself raises (unittest runs module cleanups in both cases); atexit repeats it for a Ctrl-C;
  * each test drops its own database in tearDown (drop_database), so the folder stays small during a run;
  * every start first removes OLD leftovers of ours (reap): folders from this module's prefixes, older than
    two hours, whose postgres is no longer running. A folder in use is never touched.

Use:
    server = pgtemp.start("pg")               # in setUpModule
    pgtemp.drop_database(server, name)        # in tearDown, after closing the test's connection
"""
import atexit
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import pgserver

PREFIX = "ryagram-pgtest-"
# The names the suites used before this module existed; reap clears their old leftovers too.
OLD_PREFIXES = ("ryagram-pg-", "ryagram-2b-", "ryagram-stripe-")
STALE_SECONDS = 2 * 60 * 60


def _pid_alive(pid):
    if pid <= 0:
        return False
    if sys.platform == "win32":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out.split()
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _in_use(folder):
    """True when a postgres still owns this data folder (its postmaster.pid names a live process)."""
    pidfile = Path(folder) / "postmaster.pid"
    try:
        first = pidfile.read_text(encoding="utf-8", errors="ignore").splitlines()[0].strip()
        return _pid_alive(int(first))
    except (OSError, IndexError, ValueError):
        return False


def _writable(func, path, _exc):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except OSError:
        pass


def remove_dir(path, tries=20):
    """Delete a folder, retrying: Windows keeps files locked for a moment after postgres stops."""
    for attempt in range(tries):
        shutil.rmtree(path, onerror=_writable)
        if not Path(path).exists():
            return True
        time.sleep(0.5)
    print(f"pgtemp: COULD NOT DELETE {path}; remove it by hand.", file=sys.stderr)
    return False


def _stop(server):
    try:
        server.cleanup()
    except Exception as err:  # already stopped, or never fully started
        print(f"pgtemp: stopping the test server: {err}", file=sys.stderr)


def reap(now=None):
    """Remove our own old temp folders that no postgres is using. Returns the folders removed."""
    now = time.time() if now is None else now
    removed = []
    for entry in Path(tempfile.gettempdir()).glob("ryagram-*"):
        name = entry.name
        if not (name.startswith(PREFIX) or name.startswith(OLD_PREFIXES)):
            continue
        # Only folders that are a postgres data directory (so a same-named folder of anything else is left alone).
        if not entry.is_dir() or not (entry / "PG_VERSION").exists():
            continue
        try:
            age = now - entry.stat().st_mtime
        except OSError:
            continue
        if age < STALE_SECONDS or _in_use(entry):
            continue
        if remove_dir(entry):
            removed.append(str(entry))
    return removed


def start(label):
    """Start a test Postgres; its folder is deleted when this module's tests end, however they end."""
    reap()
    path = tempfile.mkdtemp(prefix=f"{PREFIX}{label}-")
    folder_cleanup = lambda: Path(path).exists() and remove_dir(path)     # noqa: E731
    unittest.addModuleCleanup(folder_cleanup)                             # runs last (cleanups run in reverse order)
    atexit.register(folder_cleanup)
    server = pgserver.get_server(path, cleanup_mode="stop")
    unittest.addModuleCleanup(_stop, server)                              # runs first
    atexit.register(_stop, server)
    return server


def drop_database(server, name):
    """Drop a per-test database now (connections still open to it are cut)."""
    import psycopg
    try:
        with psycopg.connect(server.get_uri(), autocommit=True) as c:
            c.execute(f'drop database if exists "{name}" with (force)')
    except Exception as err:
        print(f"pgtemp: could not drop {name}: {err}", file=sys.stderr)


if __name__ == "__main__":
    # `python supabase/tests/pgtemp.py` clears old leftovers by hand and says what it removed.
    gone = reap()
    print(f"removed {len(gone)} old test folder(s)" + "".join(f"\n  {g}" for g in gone))
