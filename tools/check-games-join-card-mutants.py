"""Must-fail proof for tools/check-games-join-card.py: each mutant breaks ONE rule of the join card page in a copy and the real-Chrome check must then FAIL (exit 1). The unbroken page passes first.

    py -I tools/check-games-join-card-mutants.py [--check-targets]   (needs node and Chrome; run with TEMP/TMP on D:)
Each mutant's text must occur exactly once in the built page, or it is BROKEN, never 'caught'."""
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / "tools" / "check-games-join-card.py"


def page():
    js = "import('./tools/games-host/join-card.mjs').then(m=>process.stdout.write(m.joinCardHtml()))"
    return subprocess.run(["node", "--no-warnings", "-e", js], cwd=ROOT, capture_output=True, text=True, encoding="utf8", check=True).stdout


MUTANTS = [
    ("a name is put in with innerHTML", "u.appendChild(el('li','',names[k]))", "var li=el('li','');li.innerHTML=names[k];u.appendChild(li)"),
    ("hidden characters are not removed from a name", ".replace(BAD,' ')", ""),
    ("a name is not cut", ".slice(0,n||24)", ".slice(0,n||2400)"),
    ("a lowercase code is shown", "/^[A-Z]{4}$/.test(sc.code)", "/^[A-Za-z]{4}$/.test(sc.code)"),
    ("a code of any length is shown", "/^[A-Z]{4}$/.test(sc.code)", "/^[A-Z]+$/.test(sc.code)"),
    ("the phone address in the result is shown", "kids.push(el('p','hint','Open the game on your phone and enter this code.'));", "kids.push(el('p','hint','Open the game on your phone and enter this code.'));if(sc.phone_url)kids.push(el('p','hint',String(sc.phone_url)));"),
    ("an address in the result is shown", "kids.push(el('p','hint','Open the game on your phone and enter this code.'));", "kids.push(el('p','hint','Open the game on your phone and enter this code.'));if(sc.address)kids.push(el('p','hint',String(sc.address)));"),
    ("more than twenty names are drawn", "names.length<20", "names.length<200"),
    ("how many more is not said", "if(total>names.length)kids.push(el('p','hint','and '+(total-names.length)+' more'));", ""),
    ("the page has a button", "kids.push(el('p','sub'", "kids.push(el('button','','Go'));kids.push(el('p','sub'"),
    ("the page reaches out", "paint(null);\nif(typeof ResizeObserver", "paint(null);\nvar x=new Image();x.src='https://example.test/p';\nif(typeof ResizeObserver"),
    ("the code is not read out", "c.setAttribute('aria-label','Join code '+code.split('').join(' '));", ""),
    ("the height is never reported", "function size(){var h=", "function size(){return;var h="),
    ("the page never says it is ready", "function(){note('ui/notifications/initialized',{});size();}", "function(){size();}"),
    ("only the first result is drawn", "if(m.method==='ui/notifications/tool-result'){paint(m.params&&m.params.structuredContent);return;}", "if(m.method==='ui/notifications/tool-result'){if(window.__done)return;window.__done=1;paint(m.params&&m.params.structuredContent);return;}"),
    ("a hint has too little contrast", ".hint{margin:8px 0 0;color:#b6b5ae", ".hint{margin:8px 0 0;color:#55555c"),
    ("the card sends an unexpected message", "note('ui/notifications/initialized',{});", "note('ui/notifications/initialized',{});note('ui/open-link',{url:'https://example.test/'});"),
    ("a player given as text is not read", "(typeof p==='string'?clean(p):'')", "''"),
]


def run(html):
    with tempfile.TemporaryDirectory(prefix="joincard-mut-") as d:
        f = Path(d) / "page.html"
        f.write_text(html, encoding="utf-8")
        return subprocess.run([sys.executable, "-B", str(CHECK), str(f)], capture_output=True, text=True, encoding="utf8").returncode


def main():
    html = page()
    bad = [n for n, a, b in MUTANTS if html.count(a) != 1]
    if "--check-targets" in sys.argv:
        print("targets ok" if not bad else "BAD TARGETS: %s" % bad)
        sys.exit(1 if bad else 0)
    if bad:
        print("BROKEN MUTANTS (text not found exactly once):", bad)
        sys.exit(2)
    if run(html) != 0:
        print("BASELINE FAILS (nothing proved)")
        sys.exit(2)
    print("baseline passes")
    missed = 0
    for n, a, b in MUTANTS:
        rc = run(html.replace(a, b, 1))
        print(("caught  " if rc == 1 else "MISSED  ") + n)
        missed += rc != 1
    print("%d mutant(s) not caught" % missed if missed else "all %d mutants caught" % len(MUTANTS))
    sys.exit(1 if missed else 0)


main()
