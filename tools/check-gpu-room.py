"""Room on the graphics card for a site film and a clip film at once (NEXT-WORKER 76; tools/gpu_room.py and its two callers).

  A  free_mb: nvidia-smi's answer read right (one card, several cards = the most free); no card, a failure, a timeout or odd output = None
  B  room_problem: only when the OTHER kind runs AND the card is readable AND too full; each kind's own plain sentence
  C  wait_for_room: waits while a clip film runs on a full card, then goes; can't tell = goes at once; gives up after its limit
  D  the desktop maker: clip_film_running sees its own job and the song maker's run; clip_room_problem refuses a clip film only while a
     site film is RENDERING on a full card, and start_job / the song maker's _run raise that sentence before anything starts
  (the renderer half, a real NodeRenderer with a stand-in spawn, is section J of tools/check-node-render.py)

No site, no network, no GPU needed: nvidia-smi and the processes are stand-ins.

    python tools/check-gpu-room.py
"""
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gpu_room as gr                         # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def smi(stdout="", rc=0, exc=None):
    def run(cmd, **kw):
        assert cmd[0] == "nvidia-smi" and "--query-gpu=memory.free" in cmd and kw.get("timeout")
        if exc:
            raise exc
        return SimpleNamespace(returncode=rc, stdout=stdout)
    return run


class Proc:
    def __init__(self, alive):
        self.alive = alive

    def poll(self):
        return None if self.alive else 0


def main() -> int:
    print("A. reading the card")
    check(gr.free_mb(smi("8123\n")) == 8123, "one card: its free MB")
    check(gr.free_mb(smi("1200\n9000\n")) == 9000, "two cards: the most free one")
    for what, run in (("no nvidia-smi", smi(exc=FileNotFoundError())), ("a timeout", smi(exc=subprocess.TimeoutExpired("nvidia-smi", 10))),
                      ("it fails", smi("", rc=9)), ("odd output", smi("[N/A]\n")), ("nothing printed", smi(""))):
        check(gr.free_mb(run) is None, f"{what}: None (can't tell)")

    print("\nB. the decision")
    need = gr.NEED_MB["site_film"]
    check(gr.room_problem("site_film", False, 10) is None, "the other kind is not running: never a problem, however full")
    check(gr.room_problem("site_film", True, None) is None, "the card cannot be read: no problem (can't tell does not block)")
    check(gr.room_problem("site_film", True, need) is None, "exactly the need free: fine")
    check(gr.room_problem("site_film", True, need - 1) == gr.SITE_WAITING, "one MB short: the site film's sentence")
    check(gr.room_problem("clip_film", True, gr.NEED_MB["clip_film"] - 1) == gr.CLIP_REFUSED, "the clip film's own sentence")
    try:
        gr.room_problem("final", True, 0)
        check(False, "an unknown kind is refused")
    except ValueError:
        check(True, "an unknown kind is refused")

    print("\nC. the site film's wait")
    t = [0.0]
    left = [3]

    def clip():
        left[0] -= 1
        return left[0] >= 0
    notes = []
    ok = gr.wait_for_room(clip, free=lambda: 10, progress=notes.append, sleep=lambda s: t.__setitem__(0, t[0] + s), clock=lambda: t[0])
    check(ok is True and notes == [gr.SITE_WAITING] * 3, "waits three turns while the clip film runs on a full card, then goes")
    notes.clear()
    fake = dict(sleep=lambda s: t.__setitem__(0, t[0] + s), clock=lambda: t[0], max_wait_s=60)      # never a real sleep, even under a mutant
    check(gr.wait_for_room(lambda: True, free=lambda: None, progress=notes.append, **fake) is True and notes == [], "can't tell: goes at once")
    check(gr.wait_for_room(lambda: (_ for _ in ()).throw(RuntimeError("x")), free=lambda: 10, progress=notes.append, **fake) is True,
          "cannot tell whether a clip film runs: goes")
    t[0] = 0.0
    ok = gr.wait_for_room(lambda: True, free=lambda: 10, sleep=lambda s: t.__setitem__(0, t[0] + s), clock=lambda: t[0], max_wait_s=60)
    check(ok is False, "MUST-FAIL: a clip film that never ends on a full card: gives up after the limit")

    print("\nD. the desktop maker")
    import desktop_maker as dm                # noqa: E402
    import maker_song as ms                   # noqa: E402
    dm.STATE.clear()
    check(dm.clip_film_running() is False, "nothing running: False")
    dm.STATE["job"] = {"proc": Proc(True)}
    check(dm.clip_film_running() is True, "the maker's own plan or build running: True")
    dm.STATE["job"] = {"proc": Proc(False)}
    real_song = dm._song_mod
    dm._song_mod = lambda: SimpleNamespace(S=lambda: {"proc": Proc(True)})
    check(dm.clip_film_running() is True, "the song maker's run: True")
    dm._song_mod = real_song

    class Node:
        def __init__(self, phase):
            self.phase = phase

        def status(self):
            return {"phase": self.phase}
    real_free = gr.free_mb
    try:
        gr.free_mb = lambda run=None: 100
        dm.STATE["node"] = Node("rendering")
        check(dm.clip_room_problem() == gr.CLIP_REFUSED, "a site film RENDERING on a full card: the clip film is refused with the sentence")
        dm.STATE["node"] = Node("idle")
        check(dm.clip_room_problem() is None, "the node idle: no problem, however full")
        dm.STATE["node"] = Node("rendering")
        gr.free_mb = lambda run=None: None
        check(dm.clip_room_problem() is None, "rendering but the card cannot be read: no problem")
        gr.free_mb = lambda run=None: 100
        dm.STATE["job"] = None
        try:
            dm._start_job_locked("plan", {})
            check(False, "start_job raises the sentence before anything starts")
        except dm.Problem as e:
            check(str(e) == gr.CLIP_REFUSED, "start_job raises the sentence before anything starts")
        real_dm, ms._dm = ms._dm, dm                       # set by the desktop maker when it registers the song routes
        try:
            ms._run(["plan"], "plan")
            check(False, "the song maker's run raises the sentence before anything starts")
        except ms.Problem as e:
            check(str(e) == gr.CLIP_REFUSED, "the song maker's run raises the sentence before anything starts")
        finally:
            ms._dm = real_dm
    finally:
        gr.free_mb = real_free
        dm.STATE.clear()

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED:")
        for f in FAILED:
            print("  " + f)
        return 1
    print("all gpu-room checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
