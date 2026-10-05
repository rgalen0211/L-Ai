"""A throwaway Postgres for the test suites that always cleans up after itself.

Why this exists: each suite used to start a pgserver in a tempfile.mkdtemp() folder and never delete it, and
every test made a database from a template and never dropped it, so every run left a copy of Postgres plus
dozens of databases on C:.

What it guarantees:
  * the server is stopped and its whole folder deleted when the module's tests finish, pass or fail, and when
    setUpModule itself raises (unittest runs module cleanups in both cases); atexit repeats it for a Ctrl-C;
  * each test drops its own database in tearDown (drop_database), so the folder stays small during a run;
  * every start first removes OLD leftovers of ours (reap): folders from this module's prefixes, older than
    two hours, that hold Postgres data and that nothing is using. After a HARD kill (nothing ran) the orphaned
    postgres is stopped first, then the folder is deleted.
  * reap fails CLOSED: anything it cannot read or check (a pid file, a process lookup) counts as "in use".
  * folders are deleted with the Postgres marker (PG_VERSION) LAST, so a folder half-deleted because a file was
    locked is still recognised and retried at the next start. Top-level links and junctions are never followed.

Use:
    server = pgtemp.start("pg")               # in setUpModule
    pgtemp.drop_database(server, name)        # in tearDown, after closing the test's connection
"""
import atexit
import json
import os
import shutil
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path

import pgserver
import psutil

PREFIX = "ryagram-pgtest-"
# The names the suites used before this module existed; reap clears their old leftovers too.
OLD_PREFIXES = ("ryagram-pg-", "ryagram-2b-", "ryagram-stripe-")
STALE_SECONDS = 2 * 60 * 60
MARKER = "PG_VERSION"
FAILURE_LOG = "ryagram-pgtest-cleanup.log"


def _note(message):
    """Say it on stderr AND leave it in a file in TEMP, so a later run (or the daily sweep) can see it."""
    print(f"pgtemp: {message}", file=sys.stderr)
    try:
        with open(Path(tempfile.gettempdir()) / FAILURE_LOG, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
    except OSError:
        pass


def _is_link(path):
    p = str(path)
    return os.path.islink(p) or (hasattr(os.path, "isjunction") and os.path.isjunction(p))


def _unlink_link(path):
    """Remove a symlink or junction itself, never what it points at."""
    p = str(path)
    try:
        os.unlink(p)
    except (IsADirectoryError, PermissionError, OSError):
        os.rmdir(p)                              # a junction is removed like an empty directory


# ---------------------------------------------------------------- is anything using this folder?

def _alive_postgres(pid):
    """True when pid is a running postgres process; an unrelated process that reused the pid number is not."""
    try:
        if not psutil.pid_exists(pid):
            return False
        return "postgres" in psutil.Process(pid).name().lower()
    except psutil.NoSuchProcess:
        return False


def _handle_pids(folder):
    """The python processes that hold a pgserver handle on this folder; None if they cannot be known."""
    try:
        text = (Path(folder) / ".handle_pids.json").read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    except OSError:
        return None
    try:
        pids = json.loads(text)
        return [int(p) for p in pids]
    except (ValueError, TypeError):
        return None


def _postmaster_pid(folder):
    """The postmaster's pid; 0 when there is no pid file; None when it exists but cannot be read."""
    try:
        first = (Path(folder) / "postmaster.pid").read_text(encoding="utf-8", errors="ignore").splitlines()[0].strip()
        return int(first)
    except FileNotFoundError:
        return 0
    except (OSError, IndexError, ValueError):
        return None


def _norm(path):
    return os.path.normcase(os.path.abspath(str(path)))


def _postmaster_state(folder, pid):
    """What the process named in this folder's postmaster.pid is, to US:
      "stale"    no such process, not a postgres, or a postgres running a DIFFERENT data folder (the pid was reused)
      "ours"     a postgres whose command line says -D <this folder> (pgserver starts it that way)
      "unknown"  it cannot be told (access denied, no command line): treated as in use, never stopped."""
    try:
        if not psutil.pid_exists(pid):
            return "stale"
        proc = psutil.Process(pid)
        if "postgres" not in proc.name().lower():
            return "stale"
        cmd = proc.cmdline()
        if not cmd:
            return "unknown"
        target, given = _norm(folder), None
        for i, arg in enumerate(cmd):
            if arg == "-D" and i + 1 < len(cmd):
                given = cmd[i + 1]
            elif arg.startswith("-D") and len(arg) > 2:
                given = arg[2:]
        if given is not None:
            return "ours" if _norm(given) == target else "stale"
        # No -D on the command line: only a process started AFTER the pid file was written can be a reused pid.
        mtime = (Path(folder) / "postmaster.pid").stat().st_mtime
        return "ours" if proc.create_time() <= mtime + 2 else "stale"
    except psutil.NoSuchProcess:
        return "stale"
    except Exception:
        return "unknown"


def _in_use(folder):
    """True unless we can PROVE nothing needs this folder. Any error counts as in use (fail closed)."""
    try:
        holders = _handle_pids(folder)              # None = unreadable; [] = absent or empty
        if holders is None or any(psutil.pid_exists(p) for p in holders):
            return True
        pid = _postmaster_pid(folder)
        if pid is None:
            return True
        if pid == 0:
            return False
        state = _postmaster_state(folder, pid)
        if state == "stale":
            return False                            # a leftover pid file, or a reused pid: no postgres of ours
        if state == "unknown":
            return True
        # A postgres of ours whose python holders are all gone is the orphan of a hard kill, but only if pgserver's own
        # handle file proves it started this one; with no handle file it is somebody else's postgres: leave it.
        return not (Path(folder) / ".handle_pids.json").exists()
    except Exception:
        return True


def _stop_orphan(folder):
    """Stop a postgres left running by a hard-killed test run: pg_ctl first, then the processes themselves. Only ever
    called for a process _postmaster_state says is OURS; never raises."""
    try:
        pid = _postmaster_pid(folder)
        if not pid or _postmaster_state(folder, pid) != "ours":
            return True
        try:
            from pgserver._commands import pg_ctl
            pg_ctl(["-w", "-m", "immediate", "stop"], pgdata=Path(folder), user=None)
        except Exception:
            pass
        if _postmaster_state(folder, pid) == "ours":
            main = psutil.Process(pid)
            for child in main.children(recursive=True):
                child.kill()
            main.kill()
            main.wait(5)
        return _postmaster_state(folder, pid) != "ours"
    except psutil.NoSuchProcess:
        return True
    except Exception as err:
        _note(f"could not stop the orphaned postgres for {folder}: {err}")
        return False


# ---------------------------------------------------------------- deleting

_RETRYABLE = (32, 33)                            # Windows sharing / lock violation: a handle is still closing


def _try_delete_file(path):
    for attempt in range(2):
        try:
            os.unlink(path)
            return None
        except FileNotFoundError:
            return None
        except PermissionError as err:
            if attempt == 0 and not (getattr(err, "winerror", None) in _RETRYABLE):
                try:
                    os.chmod(path, stat.S_IWRITE)          # a read-only file: make it writable and try once more
                    continue
                except OSError:
                    pass
            return err
        except OSError as err:
            return err
    return None


def _delete_tree_once(path):
    """Delete everything under `path` that can be deleted; return the errors for what could not (links are
    removed as links, never followed)."""
    errors = []
    try:
        entries = list(os.scandir(path))
    except FileNotFoundError:
        return errors
    except OSError as err:
        return [err]
    for entry in entries:
        p = entry.path
        if _is_link(p):
            try:
                _unlink_link(p)
            except OSError as err:
                errors.append(err)
        elif entry.is_dir(follow_symlinks=False):
            inner = _delete_tree_once(p)
            errors.extend(inner)
            try:
                os.rmdir(p)
            except FileNotFoundError:
                pass
            except OSError as err:
                if not inner:                    # a child already failed: this one's "not empty" (145) is only its echo
                    errors.append(err)
        else:
            err = _try_delete_file(p)
            if err:
                errors.append(err)
    return errors


def remove_dir(path, tries=10):
    """Delete a Postgres data folder with the marker LAST, retrying only what a closing handle can explain.
    Returns True when it is gone. A folder that cannot be fully deleted keeps its marker, so the next start
    still recognises it and tries again."""
    path = Path(path)
    if _is_link(path):
        try:
            _unlink_link(path)
            return True
        except OSError as err:
            _note(f"could not remove the link {path}: {err}")
            return False
    last = []
    for attempt in range(tries):
        if not path.exists():
            return True
        # everything except the marker (at the top level) first
        errors = []
        try:
            top = list(os.scandir(path))
        except OSError as err:
            top, errors = [], [err]
        for entry in top:
            if entry.name == MARKER:
                continue
            if _is_link(entry.path):
                try:
                    _unlink_link(entry.path)
                except OSError as err:
                    errors.append(err)
            elif entry.is_dir(follow_symlinks=False):
                inner = _delete_tree_once(entry.path)
                errors.extend(inner)
                try:
                    os.rmdir(entry.path)
                except FileNotFoundError:
                    pass
                except OSError as err:
                    if not inner:
                        errors.append(err)
            else:
                err = _try_delete_file(entry.path)
                if err:
                    errors.append(err)
        if not errors:
            try:
                (path / MARKER).unlink(missing_ok=True)
                os.rmdir(path)
                return True
            except OSError as err:
                errors = [err]
        last = errors
        if not all(getattr(e, "winerror", None) in _RETRYABLE for e in errors):
            break                                  # not a lock that will clear: stop waiting
        time.sleep(0.5)
    _note(f"COULD NOT DELETE {path} ({len(last)} error(s), e.g. {last[0] if last else '?'}); it is kept and retried at the next start.")
    return False


def _stop(server):
    try:
        server.cleanup()
    except Exception as err:  # already stopped, or never fully started
        _note(f"stopping the test server: {err}")


def _age(folder):
    """Seconds since anything that shows life in the data folder last changed: its marker, pid file and handle file.
    NOT the folder's own mtime, which every deletion refreshes (a half-deleted folder must still look old)."""
    times = []
    for name in (MARKER, "postmaster.pid", ".handle_pids.json"):
        try:
            times.append((folder / name).stat().st_mtime)
        except OSError:
            pass
    return time.time() - max(times) if times else 0


def reap():
    """Remove our own old temp folders that nothing is using. Returns the folders removed."""
    removed = []
    for entry in Path(tempfile.gettempdir()).glob("ryagram-*"):
        name = entry.name
        if not (name.startswith(PREFIX) or name.startswith(OLD_PREFIXES)):
            continue
        if _is_link(entry):
            continue                               # never follow a top-level junction or symlink
        if not entry.is_dir() or not (entry / MARKER).exists():
            continue                               # not a Postgres data folder
        if _age(entry) < STALE_SECONDS:
            continue
        if _in_use(entry):
            continue
        # Orphaned by a hard kill: its postgres may still be running with no python left to stop it.
        if not _stop_orphan(entry):
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
        _note(f"could not drop {name}: {err}")


if __name__ == "__main__":
    # `python supabase/tests/pgtemp.py` clears old leftovers by hand and says what it removed.
    gone = reap()
    print(f"removed {len(gone)} old test folder(s)" + "".join(f"\n  {g}" for g in gone))
