"""ONE heavy GPU job at a time on this PC (Ryan, 2026-10-17). Every session runs its GPU work through this:

    python C:/Users/Ryan/Ryagram-logs/tools/gpu_lock.py run --who FACES --priority a -- python lipsync_line.py ...
    python C:/Users/Ryan/Ryagram-logs/tools/gpu_lock.py status

PRIORITY (Ryan's order; the session says which it is):
    a  something Ryan is actively waiting on (today: FACES lip-sync)
    b  (no longer used for films: see e) WORKER GPU work that is not a film render
    c  (no longer used for films: see e) measured runs and GPU diagnosis (BUILDER / ENGINE / WORKER)
    d  test suites and merge lanes -- and test suites should run CPU-only unless they truly need the GPU
    e  FILM RENDERS, by Codex only (Ryan 2026-10-20 16:18: 'Render only through codex and only when there is
       literally nothing else to do that needs GPU'): films, previews, contact sheets, Shorts, drafts. LAST of all.

HOW IT WORKS: a waiter writes a ticket in the queue folder; the lock (held.json, created exclusively) goes to the
highest-priority live ticket, oldest first. Nobody is pre-empted: a running job finishes, then the best waiter starts.
The lock is released when the command exits (also on error or Ctrl-C). A lock or ticket whose wrapper AND command are
both gone is stale and is cleared by the next waiter. State lives on D: (RULINGS 2026-10-14):
    D:\\Ryagram-scratch\\gpu-lock\\  held.json, queue\\*.json, log.txt (one line per start and end)
Exit code: the command's own; 2 bad usage.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(os.environ.get("RYAGRAM_GPU_LOCK_DIR", r"D:\Ryagram-scratch\gpu-lock"))
HELD = ROOT / "held.json"
QUEUE = ROOT / "queue"
LOG = ROOT / "log.txt"
PRIORITIES = "abcde"
POLL = float(os.environ.get("RYAGRAM_GPU_LOCK_POLL", "2"))


def pid_alive(pid) -> bool:
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k.OpenProcess.restype = wintypes.HANDLE
        k.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        h = k.OpenProcess(0x1000, False, pid)            # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ctypes.get_last_error() == 5           # access denied: it exists
        try:
            code = wintypes.DWORD()
            return bool(k.GetExitCodeProcess(h, ctypes.byref(code))) and code.value == 259    # STILL_ACTIVE
        finally:
            k.CloseHandle(h)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _read(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _alive(rec) -> bool:
    return bool(rec) and (pid_alive(rec.get("pid")) or pid_alive(rec.get("child")))


def _log(line: str):
    ROOT.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {line}\n")


def _tickets():
    out = []
    for p in sorted(QUEUE.glob("*.json")):
        rec = _read(p)
        if rec is None:
            if time.time() - p.stat().st_mtime > 10:          # half-written and abandoned
                p.unlink(missing_ok=True)
            continue
        if not _alive(rec):
            p.unlink(missing_ok=True)                           # its waiter is gone
            continue
        out.append((p, rec))
    return out                                                  # file names sort by priority, then time


def _clear_stale_held():
    rec = _read(HELD)
    if HELD.exists() and rec is not None and not _alive(rec):
        HELD.unlink(missing_ok=True)
        _log(f"STALE cleared: {rec.get('who')} pid {rec.get('pid')}")


def run(who: str, priority: str, cmd: list) -> int:
    ROOT.mkdir(parents=True, exist_ok=True)
    QUEUE.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    me = {"who": who, "priority": priority, "pid": os.getpid(), "child": None, "token": token,
          "cmd": " ".join(cmd)[:300], "since": datetime.now().isoformat(timespec="seconds")}
    ticket = QUEUE / f"{priority}-{time.time_ns():020d}-{os.getpid()}.json"
    ticket.write_text(json.dumps(me), encoding="utf-8")
    said = False
    try:
        while True:
            _clear_stale_held()
            first = _tickets()
            if not HELD.exists() and first and first[0][0] == ticket:
                try:
                    fd = os.open(HELD, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                except (FileExistsError, PermissionError):
                    time.sleep(POLL)
                    continue
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump(me, fh)
                break
            if not said:
                h = _read(HELD) or {}
                ahead = [r["who"] for p, r in first if p != ticket][:5]
                print(f"gpu_lock: waiting (GPU held by {h.get('who', 'nobody')}; queue ahead/around: {ahead})", file=sys.stderr, flush=True)
                said = True
            time.sleep(POLL)
    finally:
        ticket.unlink(missing_ok=True)
    _log(f"START {who} [{priority}] pid {os.getpid()}: {me['cmd']}")
    t0 = time.time()
    rc = 1
    try:
        proc = subprocess.Popen(cmd)
        me["child"] = proc.pid
        HELD.write_text(json.dumps(me), encoding="utf-8")       # record the command's pid too
        rc = proc.wait()
    except KeyboardInterrupt:
        rc = 130
    finally:
        rec = _read(HELD)
        if rec and rec.get("token") == token:
            HELD.unlink(missing_ok=True)
        _log(f"END   {who} [{priority}] rc {rc} after {time.time() - t0:.0f} s")
    return rc


def status() -> int:
    _clear_stale_held()
    h = _read(HELD)
    print(f"held by: {h['who']} [{h['priority']}] since {h['since']}: {h['cmd']}" if h else "held by: nobody")
    for _p, r in _tickets():
        print(f"  waiting: {r['who']} [{r['priority']}] since {r['since']}: {r['cmd']}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="gpu_lock.py", description="one heavy GPU job at a time")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--who", required=True)
    r.add_argument("--priority", required=True, choices=list(PRIORITIES))
    r.add_argument("command", nargs=argparse.REMAINDER)
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "status":
        return status()
    cmd = a.command[1:] if a.command[:1] == ["--"] else a.command
    if not cmd:
        print("gpu_lock: nothing to run (put the command after --)", file=sys.stderr)
        return 2
    return run(a.who, a.priority, cmd)


if __name__ == "__main__":
    sys.exit(main())
