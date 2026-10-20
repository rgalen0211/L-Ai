"""r8.1, "never a dead end": when some of the typed words are not said anywhere in the videos, the maker leaves them out, says so plainly, still builds the rest, and saves a note listing what was
left out. Real Chrome at 1280 px drives the real page; the recipe and bind checks are real; Plan and Build run a stand-in `ryagram.local` that behaves like the real one about missing words
(Plan exits 3 with the words it could not find AND the clips it did find). No speech model, no network.

    python tools/check-maker-skips.py <the kit's own folder, or a current Ryagram checkout> [<scratch base folder>]
"""
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

if len(sys.argv) < 2:
    sys.exit("Give the engine folder: the kit's own folder (the one that holds ryagram/local) or a current Ryagram checkout.")
ROOT = Path(__file__).resolve().parents[1]
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)

RECIPE = {"schema": "ryagram.recipe/0", "name": "any words",
          "slots": [{"id": "source-1", "label": "Your footage", "accepts": "video", "multiple": True}],
          "find": {"op": "words", "text": "the baby", "unit": "words", "slots": ["source-1"]},
          "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
          "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
          "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}},
          "render": {"preset": "720p30", "crf": 28}}
# Said anywhere in the stand-in's videos: everything EXCEPT the words listed in MISSING.
STUB_MAIN = '''import sys, json, re
from pathlib import Path
a = sys.argv
cmd = a[1]
rec = json.loads(Path(a[2]).read_text(encoding="utf-8"))
work = Path(a[a.index("--work-dir") + 1]); out = Path(a[a.index("--out") + 1])
tokens = re.findall(r"[a-z0-9']+", rec["find"]["text"].lower())
MISSING = {"brooks", "zork"}
gaps = [t for t in tokens if t in MISSING]
have = [t for t in tokens if t not in MISSING]
clips = [{"n": i + 1, "words": w, "file_name": "show.mp4", "slot": "source-1", "start_ms": 1000 * i, "end_ms": 1000 * i + 600, "duration_ms": 600} for i, w in enumerate(have)]
if cmd == "plan":
    work.mkdir(parents=True, exist_ok=True)
    (work / "asked-for.txt").write_text(" ".join(tokens))
    print(json.dumps({"ok": not gaps and bool(clips), "gaps": gaps, "clips": clips, "seconds_estimate": 0.6 * len(clips), "would_write": out.name, "model": "base", "network_attempts": 0}))
    sys.exit(3 if (gaps or not clips) else 0)
if gaps:
    print("refused: some words are not said", file=sys.stderr); sys.exit(3)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(b"\\x00\\x00\\x00\\x18ftypmp42" + bytes(range(256)) * 20)
out.with_suffix(".receipt.json").write_text(json.dumps({"schema": "ryagram.local-receipt/0", "film": out.name, "seconds": 0.6 * len(clips), "clips": clips, "network_attempts": 0, "asked_for": " ".join(tokens)}))
print("built", out.name)
'''
# ENGINE 21's contract (never-dead-end): Plan exits 0 and says ok/skipped when SOME words are missing; Build builds from what exists and the receipt lists skipped [{word, reason}];
# only "not one clip" is a refusal (exit 3).
STUB_NEW = STUB_MAIN.replace('''    print(json.dumps({"ok": not gaps and bool(clips), "gaps": gaps, "clips": clips, "seconds_estimate": 0.6 * len(clips), "would_write": out.name, "model": "base", "network_attempts": 0}))
    sys.exit(3 if (gaps or not clips) else 0)''', '''    print(json.dumps({"ok": bool(clips), "buildable": bool(clips), "complete": not gaps, "gaps": gaps, "skipped": gaps, "forged": [], "clips": clips, "seconds_estimate": 0.6 * len(clips), "would_write": out.name, "model": "base", "network_attempts": 0}))
    sys.exit(0 if clips else 3)''').replace('''if gaps:
    print("refused: some words are not said", file=sys.stderr); sys.exit(3)''', '''if not clips:
    print("refused: nothing is said", file=sys.stderr); sys.exit(3)''').replace('''"network_attempts": 0, "asked_for"''', '''"network_attempts": 0, "complete": not gaps, "skipped": [{"word": g, "reason": "not said anywhere in the files you chose"} for g in gaps], "forged": [], "asked_for"''')
assert STUB_NEW != STUB_MAIN
FAILED = []


def check(c, what):
    print(('  ok   ' if c else '  FAIL ') + what)
    if not c:
        FAILED.append(what)


def main(stub=None, label=''):
    stub = stub or STUB_MAIN
    print(label + 'engine under test')
    tmp = Path(tempfile.mkdtemp(prefix='maker-skips-', dir=BASE if BASE else None))
    try:
        shutil.copytree(ENGINE / 'ryagram', tmp / 'engine' / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
        (tmp / 'engine' / 'ryagram' / 'local' / '__main__.py').write_text(stub, encoding='utf8')
        (tmp / 'recipes').mkdir()
        (tmp / 'recipes' / 'any-words.json').write_text(json.dumps(RECIPE), encoding='utf8')
        every = json.loads(json.dumps(RECIPE))
        every['name'], every['find']['op'] = 'Every time a word is said', 'every'
        (tmp / 'recipes' / 'every-time.json').write_text(json.dumps(every), encoding='utf8')
        clips = tmp / 'Sam Videos'
        clips.mkdir()
        (clips / 'show.mp4').write_bytes(b'not really a video')
        dm.faster_whisper_missing = lambda: False
        dm.pick_files = lambda multiple: [str(clips / 'show.mp4')]
        out_dir = tmp / 'films'
        srv = dm.make_server(tmp / 'engine', tmp / 'recipes', tmp / 'work', out_dir, port=0, token='tok', activity=True)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{dm.STATE['port']}"
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel=os.environ.get('MAKER_BROWSER', 'chrome'))
            page = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))

            def fresh_page():
                page.goto(f'{base}/?t=tok', wait_until='load')
                page.wait_for_selector('#recipe option', state='attached', timeout=10000)
                page.get_by_role('button', name='Choose a file for Your footage').click()
                page.wait_for_selector('.slot li')

            def run_plan(words):
                page.fill('#words', words)
                page.click('#plan')
                page.wait_for_selector('#job-out .ok, #job-out .problems, #plan-out .problems', timeout=40000)
                page.wait_for_timeout(1500)                               # the automatic second plan, if any

            print('one word nobody says')
            fresh_page()
            run_plan('Brooks the baby')
            txt = page.inner_text('#job-out')
            check(page.locator('#skipped-note').count() == 1 and 'brooks' in page.inner_text('#skipped-note').lower() and 'film will be made without it' in page.inner_text('#skipped-note'),
                  'the plan is made WITHOUT the missing word and the page says plainly which word was left out')
            check(page.locator('#build').is_enabled() and 'Ready to build' in txt, 'Build is on: no dead end')
            check('Exit code' not in page.inner_text('body') and 'code 3' not in page.inner_text('body'), 'MUST-FAIL: no "Exit code" anywhere on the page')
            new_engine = 'ENGINE 21' in label
            check(('the baby' in page.inner_text('#plan-out').lower()) and (new_engine or 'brooks' not in page.inner_text('#plan-out dl').lower()),
                  'the plan summary shows the words' + (' as typed (the engine itself skips and lists the missing one)' if new_engine else ' it WILL find, without the missing one'))
            check(page.input_value('#words') == 'Brooks the baby', 'the box still shows what the person typed (nothing was rewritten behind their back)')
            page.click('#build')
            page.wait_for_selector('#job-out:has-text("Your film:")', timeout=40000)
            check(page.locator('#skipped-built').count() == 1 and 'brooks' in page.inner_text('#skipped-built').lower(), 'the finished screen lists the word that was left out')
            notes = sorted(out_dir.glob('*.maker-notes.json'))
            nj = json.loads(notes[0].read_text(encoding='utf-8')) if notes else {}
            check(len(notes) == 1 and nj.get('skipped') == ['brooks'] and nj.get('typed') == 'Brooks the baby' and nj.get('built_from_words') == 'the baby', f'a note beside the film lists what was left out, what was typed and what was built ({nj})')
            rec = json.loads(sorted(out_dir.glob('*.receipt.json'))[0].read_text(encoding='utf-8'))
            check(rec['asked_for'] == ('brooks the baby' if new_engine else 'the baby') and (not new_engine or [x['word'] for x in rec['skipped']] == ['brooks']),
                  'the film was built from the words that exist' + (' and the engine receipt lists the skipped word' if new_engine else ''))

            print('\nseveral missing words, and nothing at all')
            fresh_page()
            run_plan('Brooks the zork baby')
            check('brooks, zork' in page.inner_text('#skipped-note').lower() and 'without them' in page.inner_text('#skipped-note'), 'two missing words are both named')
            fresh_page()
            run_plan('Brooks zork')
            body = page.inner_text('#job-out')
            check(page.locator('#build').is_disabled() and 'Nobody says' in body and 'Try different words' in body and 'Exit code' not in body, 'MUST-FAIL: when NOTHING is said the page says so in plain words, with a way forward, and builds nothing')
            check(page.locator('#skipped-note').count() == 0, 'and claims nothing was left out')

            print('\nno missing word: unchanged')
            fresh_page()
            run_plan('the baby')
            check(page.locator('#skipped-note').count() == 0 and page.locator('#build').is_enabled(), 'words that are all said plan exactly as before, with no note')
            print('the every-time recipe explains itself')
            page.goto(f'{base}/?t=tok', wait_until='load')
            page.wait_for_selector('#recipe option', state='attached', timeout=10000)
            plain = page.inner_text('#words-note')
            if 'Every time a word is said' in page.locator('#recipe option').all_inner_texts():
                page.select_option('#recipe', label='Every time a word is said')
                check('EVERY time it is said' in page.inner_text('#words-note') and 'EVERY time' not in plain, 'choosing the every-time recipe changes the hint under the words box to say it takes every time the words are said')
                page.select_option('#recipe', label='any words')
                check(page.inner_text('#words-note') == plain, 'and choosing the other recipe puts the original hint back')
            else:
                print('  SKIPPED: this engine does not know the op "every", so the recipe is listed as refused; run with a checkout that has recipe-every to test the hint')
            check(not errors, f'no page errors {errors[:2]}')
            b.close()

        print('\nthe log keeps counts only')
        logtxt = (out_dir / dm.ACTIVITY_NAME).read_text(encoding='utf-8')
        evs = [json.loads(x) for x in logtxt.splitlines()]
        sk = [e for e in evs if e['ev'] == 'words_skipped']
        check(len(sk) >= 3 and all(set(e) <= {'t', 's', 'ev', 'n', 'count'} for e in sk), f"each skipped plan or build is logged with a COUNT only ({[e.get('count') for e in sk]})")
        check(not any(w in logtxt.lower() for w in ('brooks', 'zork', 'the baby', 'sam videos')), 'MUST-FAIL: no skipped word, phrase or folder in the log')
        srv.shutdown()
        srv.server_close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('\nFAILED: ' + '; '.join(FAILED) if FAILED else '\nall passed')
    return 1 if FAILED else 0


if __name__ == '__main__':
    sys.exit(max(main(STUB_MAIN, 'older engine (plan stops on a gap): '), main(STUB_NEW, 'ENGINE 21 (never a dead end): ')))
