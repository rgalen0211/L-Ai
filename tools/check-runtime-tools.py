"""Every tools/ module the packaged app imports must travel in the app folder (NEXT-CONNECT 171; found when app-1030b would not start: desktop_maker imports maker_checklist, which RUNTIME_TOOLS did not list).

    py -I tools/check-runtime-tools.py

Reads the source only. Starting from every file in make_app_bundle.RUNTIME_TOOLS it follows each `import X` / `from X import ...` (at the top of a file or inside a function) that names a file tools/X.py of this repository,
and reports any such module that is NOT in RUNTIME_TOOLS (or RUNTIME_PAGE_DIRS' python helpers). Exit 1 and the import chain when one is missing; the packaged app would stop at that import with 'A part of Python that
the maker needs is missing'. No file is run."""
import ast
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_app_bundle as mab                 # noqa: E402

SELF_ONLY = {"make_app_bundle", "make_app_installer", "make_forge_addon"}          # build-time tools that never travel
OPTIONAL = {"ryagram_node_render"}          # imported inside a try/except in desktop_maker: without it the app says "cannot make site films yet" and still starts; it travels with the site-film packaging


def imports_of(path: Path) -> set:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            out.add(node.module.split(".")[0])
    return out


def missing(tools: Path, runtime) -> list:
    have = {Path(t).stem for t in runtime}
    problems, seen, todo = [], set(), [Path(t).stem for t in runtime]
    while todo:
        mod = todo.pop()
        if mod in seen:
            continue
        seen.add(mod)
        f = tools / f"{mod}.py"
        if not f.is_file():
            continue
        for imp in sorted(imports_of(f)):
            if imp == mod or imp in SELF_ONLY or (imp in OPTIONAL and imp not in have):
                continue
            if (tools / f"{imp}.py").is_file():
                if imp not in have:
                    problems.append(f"{mod}.py imports {imp}, which is in tools/ but not in RUNTIME_TOOLS (the packaged app would not start)")
                else:
                    todo.append(imp)
    return sorted(set(problems))


if __name__ == "__main__":
    probs = missing(HERE, mab.RUNTIME_TOOLS)
    # MUST-FAIL proof: take maker_checklist.py out of the list and this check must name it
    proof = missing(HERE, [t for t in mab.RUNTIME_TOOLS if t != "maker_checklist.py"])
    if not any("maker_checklist" in x for x in proof):
        print("  FAIL the check itself does not notice a missing maker_checklist.py")
        sys.exit(1)
    print("  ok   MUST-FAIL: without maker_checklist.py in the list the check names it")
    for p in probs:
        print("  FAIL " + p)
    print(("FAILED: %d" % len(probs)) if probs else "all passed: every tools/ module the packaged app imports travels with it")
    sys.exit(1 if probs else 0)
