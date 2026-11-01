"""Room on the graphics card for a site film and a clip film at the same time (NEXT-WORKER 76). Standard library only.

On a tester's own PC the person's own clip films (the maker's plan/build, the song maker) and their site films (the node loop) may run
at the same time. Neither waits for the other by default (Claude, 10-31 15:32). This is the one guard: when the OTHER kind is already
running and the graphics card has too little free memory for the one starting, the one starting waits, with a plain sentence.

  * free_mb() reads the card's free memory with nvidia-smi (the most free card when there are several). Anything that cannot be read
    (no NVIDIA card, no nvidia-smi, a timeout, odd output) is None: CAN'T TELL. The guard does not block on can't-tell: on a PC with no
    readable card both already run on the processor, and refusing there would make the person wait for nothing.
  * room_problem(kind, other_running, free) is the decision; wait_for_room() is the site film's wait (the site gives the job back when
    it has waited too long); the clip film is refused at its start with the sentence instead (the person presses again).
NEED_MB are starting values to tune once measured on a tester's card: a site film is Chrome drawing frames plus the encoder; a clip film
is the listening model, the larger of the two.
"""
from __future__ import annotations

import subprocess
import time

NEED_MB = {"site_film": 2048, "clip_film": 4096}
POLL_S = 10.0
WAIT_MAX_S = 2 * 3600                         # a site film that waited this long for room is given back to the site (retried)
SMI = ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"]

SITE_WAITING = ("Waiting: your own clip film is using the graphics card, and there is not enough graphics memory free for both. "
                "Your site film starts when it finishes.")
CLIP_REFUSED = ("Your site film is being made on the graphics card right now, and there is not enough graphics memory free for both. "
                "Press again when the site film card says Done.")


def free_mb(run=subprocess.run) -> int | None:
    """Free memory on the most free NVIDIA card, in MB, or None when it cannot be read."""
    try:
        p = run(SMI, capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    if getattr(p, "returncode", 1) != 0:
        return None
    vals = []
    for line in str(getattr(p, "stdout", "") or "").splitlines():
        s = line.strip()
        if s.isdigit():
            vals.append(int(s))
        elif s:
            return None                                # anything unexpected: can't tell
    return max(vals) if vals else None


def room_problem(kind: str, other_running: bool, free: int | None) -> str | None:
    """The plain sentence when `kind` must wait, else None."""
    if kind not in NEED_MB:
        raise ValueError(kind)
    if not other_running or free is None or free >= NEED_MB[kind]:
        return None
    return SITE_WAITING if kind == "site_film" else CLIP_REFUSED


def wait_for_room(other_running, *, free=free_mb, progress=lambda note: None, sleep=time.sleep, clock=time.monotonic,
                  max_wait_s: float = WAIT_MAX_S) -> bool:
    """The site film's wait: returns True when it may start (the clip film ended, or there is room, or it cannot tell), False when it
    waited max_wait_s (the caller gives the job back to the site). `other_running` and `free` are called afresh on every turn."""
    t0 = clock()
    while True:
        try:
            busy = bool(other_running())
        except Exception:                              # noqa: BLE001  cannot tell whether a clip film runs: do not hold the site film
            busy = False
        if room_problem("site_film", busy, free() if busy else None) is None:
            return True
        progress(SITE_WAITING)
        if clock() - t0 > max_wait_s:
            return False
        sleep(POLL_S)
