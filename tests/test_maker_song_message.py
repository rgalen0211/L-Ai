"""The film-ready sentence of the desktop maker's song page (tools/maker_song.py film_ready_message), 2026-10-27: 'the word furthest from its beat is N ms off' covers only the words that WERE
measured, so the words that ran on from the word before (BUILDER songjoined: receipt rows with joined_to_previous and no measured offset) are counted and named next to it.

    python tests/test_maker_song_message.py          (needs nothing but Python; prints OK lines and exits 1 on a failure)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import maker_song as m  # noqa: E402

ok = True


def check(c, w):
    global ok
    print(("  ok   " if c else "  FAIL ") + w)
    ok = ok and bool(c)


def msg(rcpt):
    return m.film_ready_message("song-1.mp4", "films", rcpt)


base = {"offsets": {"max_abs_ms": 12}, "words": [{"n": 1, "measured_offset_ms": 3}, {"n": 2, "measured_offset_ms": 5}]}
check(msg(base) == "Your film is ready: song-1.mp4, in films. Measured on the finished film, the word furthest from its beat is 12 ms off.", "nothing joined: the sentence is exactly as it was")
one = {**base, "words": [{"n": 1, "measured_offset_ms": 3}, {"n": 2, "measured_offset_ms": None, "joined_to_previous": True}]}
check(msg(one) == "Your film is ready: song-1.mp4, in films. Measured on the finished film, the word furthest from its beat is 12 ms off. 1 word ran together with the word before and was not measured.", "one joined word: said next to the beat sentence, singular")
three = {**base, "words": [{"n": i, "measured_offset_ms": None, "joined_to_previous": True} for i in range(3)] + [{"n": 9, "measured_offset_ms": 1}]}
check("3 words ran together with the word before and were not measured." in msg(three), "three joined words: plural")
other = {**base, "words": [{"n": 1, "measured_offset_ms": 3}, {"n": 2, "measured_offset_ms": None}]}
check("ran together" not in msg(other), "MUST-FAIL: a word unmeasured for any other reason is never called joined")
both = {**base, "words": [{"n": 1, "measured_offset_ms": 4, "joined_to_previous": True}]}
check("ran together" not in msg(both), "a word that WAS measured is never counted as joined")
built = {**one, "built_from_sounds": [1, 2]}
t = msg(built)
check(t.index("furthest") < t.index("ran together") < t.index("built from sounds"), "the order is: furthest from its beat, then ran together, then built from sounds")
check(msg({}) == "Your film is ready: song-1.mp4, in films." and msg(None) == "Your film is ready: song-1.mp4, in films.", "an empty or missing receipt says only that the film is ready")
check("ran together" not in msg({"words": "x"}) and "ran together" not in msg({"words": [None, 5, "x"]}), "a malformed receipt never raises and never invents a count")


# ---- NEXT-WEB 181: the optional speed_cap (ENGINE 52): a closed number from 1 to 6, recipe byte for byte as before when it is not asked for ----
class _R:
    def validate_recipe(self, rec):
        return rec


import types  # noqa: E402

m._dm = types.SimpleNamespace(STATE={"R": _R()})
base_rec = m._recipe(["a b"], False)
check("speed_cap" not in base_rec["song"], "no speed_cap asked: the recipe has no such key")
check(m._recipe(["a b"], False, None) == base_rec, "speed_cap None gives exactly the old recipe")
check(m._recipe(["a b"], False, 1.5)["song"]["speed_cap"] == 1.5 and m._recipe(["a b"], True, 2.0)["song"]["guide_slot"] == "guide", "a cap is added to the song block and the guide slot is kept")
check(m._speed_cap(None) is None and m._speed_cap({}) is None and m._speed_cap({"speed_cap": None}) is None, "not asked: None")
check(m._speed_cap({"speed_cap": 1.5}) == 1.5 and m._speed_cap({"speed_cap": 1}) == 1.0 and m._speed_cap({"speed_cap": 6}) == 6.0, "1 to 6 is taken as a number")
for bad in (0.99, 6.01, -1, "1.5", True, False, [], {}, float("nan"), float("inf")):
    try:
        m._speed_cap({"speed_cap": bad})
        check(False, f"{bad!r} must be refused")
    except m.Problem as e:
        check("number from 1 to 6" in str(e), f"{bad!r} is refused in words")


class _Old:
    def validate_recipe(self, rec):
        if "speed_cap" in rec["song"]:
            raise ValueError("unknown key")
        return rec


m._dm.STATE["R"] = _Old()
try:
    m._recipe(["a b"], False, 1.5)
    check(False, "an engine that does not know the key must refuse")
except m.Problem as e:
    check("does not know the speed limit yet" in str(e), "an older engine: the words say the limit is not known, not that songs cannot be made")
check(m._recipe(["a b"], False) == base_rec, "and without a cap an older engine still works")
print("ALL OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
