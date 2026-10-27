"""Must-fail proof for tools/check-maker-live-draft.py and tools/check-maker-live-sync.py (NEXT-CONNECT 142). Each mutant breaks ONE rule in a scratch copy of tools/maker_live.py or
tools/maker_live_sync.py, and the checks must then FAIL. The unbroken copy must pass first (a non-zero exit of a broken copy proves nothing otherwise).

    py -I tools/check-maker-live-mutants.py [scratch folder on D:]      exit 0 only when every mutant is caught"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="maker-live-mut-"))
DRAFT, SYNC = "maker_live.py", "maker_live_sync.py"
M = [
    (DRAFT, "a stale revision is accepted", 'if base_revision != m["revision"]:', "if False:"),
    (DRAFT, "the AI may change tracks the person did not share", 'if mode == "compilation" and actor == "ai" and not m["ai_visible"]:', "if False:"),
    (DRAFT, "the AI has no minute limit", "if recent(60) + len(ops) > OPS_PER_MINUTE:", "if False:"),
    (DRAFT, "the AI has no day limit", "if recent(86400) + len(ops) > OPS_PER_DAY:", "if False:"),
    (DRAFT, "the AI may repeat what the person undid", 'r.get("ended_by") == "person" and r["op"] == op', 'r.get("ended_by") == "nobody" and r["op"] == op'),
    (DRAFT, "the app's refusal counts as the person saying no", 'r.get("ended_by") == "person" and r["op"] == op', 'r["op"] == op'),
    (DRAFT, "the vocabulary is not checked", "why = op_problem(mode, op, self._look_defs()) or check(running, op, self.look_keys)", "why = check(running, op, self.look_keys)"),
    (DRAFT, "the page's rules are not applied", "why = op_problem(mode, op, self._look_defs()) or check(running, op, self.look_keys)", "why = op_problem(mode, op, self._look_defs())"),
    (DRAFT, "a batch is applied op by op into the draft", "m[\"state\"], m[\"revision\"] = running, revision", "m[\"state\"], m[\"revision\"] = running, revision + 1"),
    (DRAFT, "undo clobbers a newer change", 'if mode == "data" and any(r["id"] > row["id"]', 'if False and any(r["id"] > row["id"]'),
    (DRAFT, "undo does not replay the film", 'm["state"] = self._replay(m)', "pass"),
    (DRAFT, "speaker and voice fields enter the draft", "        for k in LOCAL_ONLY:\n            c.pop(k, None)\n", ""),
    (DRAFT, "the summary carries every field", 'out = {"schema": "ryagram.edit-tracks/0", "duration": s.get("duration", 0), "clips": [{k: c[k] for k in keep if k in c} for c in s["clips"]]}',
     'out = {"schema": "ryagram.edit-tracks/0", "duration": s.get("duration", 0), "clips": [dict(c) for c in s["clips"]]}'),
    (DRAFT, "text is not cut at 200 characters", "return _CLEAN.sub(\"\", str(s))[:MAX_TEXT]", "return _CLEAN.sub(\"\", str(s))"),
    (DRAFT, "a video clip can be moved by hand", 'if c["track"] == "video":\n            return "Video clips follow each other. Reorder this one instead."', 'if False:\n            return "x"'),
    (DRAFT, "a trim may pass the end of the file", "if new_len > room + 1e-9:", "if False:"),
    (DRAFT, "a lane the maker cannot build may be added to", 'if lanes is not None and op["track"] not in lanes:', "if False:"),
    (DRAFT, "a damaged file crashes the maker", "        except (OSError, ValueError):\n            pass\n", "        except OSError:\n            pass\n"),
    (SYNC, "nothing is acknowledged", 'self.acks.append({"op_id": c["id"], "ok": ok})', "pass"),
    (SYNC, "every change is acknowledged as applied", 'self.acks.append({"op_id": c["id"], "ok": ok})', 'self.acks.append({"op_id": c["id"], "ok": True})'),
    (SYNC, "another film's changes are applied", 'c.get("project_id") == self.project_id and', "True and"),
    (SYNC, "an applied change is applied again after a failed post", 'and c["id"] not in waiting_ack', "and True"),
    (SYNC, "the tick is ignored", "self.ai_visible = bool(mirror and ai_visible)", "self.ai_visible = bool(ai_visible)"),
    (SYNC, "a signed-out computer is asked", 'if self.project_id is None or not self._signed_in():', "if self.project_id is None:"),
    (SYNC, "the summary is posted every cycle", "if self.posted_revision != self.draft.ops_since(\"compilation\", 0)[\"revision\"] or self.posted_flags != flags or self.acks:", "if True:"),
    (SYNC, "switching off says nothing", "if self.posted_flags is not None and self.posted_flags[0]:", "if False:"),
    (SYNC, "a failing call has no slower retry", "self.backoff = min(MAX_BACKOFF_S, max(GAP_CLOSED_S, self.backoff * 2 or GAP_CLOSED_S))", "self.backoff = 0"),
    (SYNC, "the editor-open rhythm is ignored", "(GAP_OPEN_S if self.draft.editor_open() else GAP_CLOSED_S)", "GAP_CLOSED_S"),
    (SYNC, "a batch is split into single changes", "key = (changes[i].get(\"revision\"), changes[i].get(\"client\"))", "key = (changes[i].get(\"id\"), changes[i].get(\"client\"))"),
    (SYNC, "a person's change is applied as the AI's", 'actor = "ai" if key[1] else "person"', 'actor = "ai"'),
]


def run(folder):
    res = []
    for script in ("check-maker-live-draft.py", "check-maker-live-sync.py"):
        r = subprocess.run([sys.executable, "-I", str(folder / "tools" / script)], capture_output=True, text=True, cwd=folder, timeout=900)
        res.append(r.returncode)
    return res


def fresh(name):
    f = BASE / name
    shutil.rmtree(f, ignore_errors=True)
    (f / "tools").mkdir(parents=True)
    for n in (DRAFT, SYNC, "check-maker-live-draft.py", "check-maker-live-sync.py"):
        shutil.copy(HERE / n, f / "tools" / n)
    shutil.copytree(ROOT / "tests", f / "tests", ignore=shutil.ignore_patterns("node_modules"), dirs_exist_ok=True)
    return f


f = fresh("base")
base = run(f)
if base != [0, 0]:
    print("BASELINE FAILS (nothing proved):", base)
    sys.exit(2)
print("baseline passes")
missed = 0
for i, (file, name, a, b) in enumerate(M):
    f = fresh("m")
    p = f / "tools" / file
    src = p.read_text(encoding="utf-8").replace("\r\n", "\n")
    if src.count(a) != 1:
        print(f"BROKEN MUTANT ({src.count(a)} matches): {name}")
        missed += 1
        continue
    p.write_text(src.replace(a, b), encoding="utf-8")
    caught = run(f) != [0, 0]
    print(("caught  " if caught else "MISSED  ") + name)
    missed += 0 if caught else 1
shutil.rmtree(BASE, ignore_errors=True)
print(f"{missed} not caught" if missed else f"all {len(M)} mutants caught")
sys.exit(1 if missed else 0)
