"""The film job's library loader reads Config from the engine's small settings module when it has one (NEXT-CONNECT 164, ENGINE 44's node-job closure), and from the old place when it does not.

    py -I tools/check-node-job-lib.py <scratch base folder on D:>

Fake engine folders only (a few tiny files); each case runs in its own Python so one case's imports cannot help another. No network, nothing real is touched."""
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="node-job-lib-"))
BASE.mkdir(parents=True, exist_ok=True)
FAILS = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


def engine(name, *, config=False, worker=False, broken_config=False):
    d = BASE / name / "ryagram" / "worker"
    d.mkdir(parents=True)
    (BASE / name / "ryagram" / "__init__.py").write_text("", encoding="utf-8")
    (d / "__init__.py").write_text("", encoding="utf-8")
    for m in ("contract", "engine", "runner"):
        (d / f"{m}.py").write_text(f"NAME = {m!r}\n", encoding="utf-8")
    (d / "schema.py").write_text("class Rejected(Exception):\n    pass\n\n\ndef validate_job(x):\n    return x\n", encoding="utf-8")
    if config:
        (d / "config.py").write_text("import nothing_like_this_exists\n" if broken_config else "class Config:\n    WHERE = 'config'\n", encoding="utf-8")
    if worker:
        (d / "worker.py").write_text("class Config:\n    WHERE = 'worker'\n", encoding="utf-8")
    return BASE / name


def load(eng):
    code = ("import sys; sys.path.insert(0, %r); import ryagram_node_job as nj; from pathlib import Path; lib = nj._load_lib(Path(%r)); print('WHERE=' + lib.Config.WHERE)" % (str(HERE), str(eng)))
    r = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout.strip(), r.stderr.strip()[-300:]


rc, out, err = load(engine("new", config=True))
check(rc == 0 and out == "WHERE=config", f"an engine with the node-job closure (config.py, NO worker.py): Config comes from config.py ({out or err})")
rc, out, err = load(engine("both", config=True, worker=True))
check(rc == 0 and out == "WHERE=config", f"an engine with both files: config.py wins, so the film job never imports the house worker ({out or err})")
rc, out, err = load(engine("old", worker=True))
check(rc == 0 and out == "WHERE=worker", f"an engine cut before the split (worker.py only): the old place is used ({out or err})")
rc, out, err = load(engine("none"))
check(rc != 0 and "ModuleNotFoundError" in err, "MUST-FAIL: an engine with neither file stops with the import error (nothing is guessed)")
rc, out, err = load(engine("broken", config=True, worker=True, broken_config=True))
check(rc != 0 and "nothing_like_this_exists" in err, "MUST-FAIL: a config.py that is itself broken is NOT hidden by falling back to worker.py")

print()
print("FAILED: " + "; ".join(FAILS) if FAILS else "ALL PASS")
sys.exit(1 if FAILS else 0)
