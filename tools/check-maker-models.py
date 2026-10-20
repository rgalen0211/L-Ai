"""The desktop maker's speech-model list in plain words (r9): no Whisper name is ever shown to a person, the sizes and the "already here" flags are true, and the default never
starts on a missing download. Real recipe and bind checks (the engine folder is REQUIRED, as in check-maker-activity-log.py); no browser, no network, nothing downloaded.

    python tools/check-maker-models.py <the kit's own folder, or a current Ryagram checkout> [<scratch base folder>]
"""
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

if len(sys.argv) < 2:
    sys.exit("Give the engine folder: the kit's own folder (the one that holds ryagram/local) or a current Ryagram checkout.")
ROOT = Path(__file__).resolve().parents[1]
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)

RECIPE = {"schema": "ryagram.recipe/0", "name": "well that is great news",
          "slots": [{"id": "source-1", "label": "First footage", "accepts": "video", "multiple": True}],
          "find": {"op": "words", "text": "well that is great news", "unit": "words", "slots": ["source-1"]},
          "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
          "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
          "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}},
          "render": {"preset": "720p30", "crf": 28}}
NAMES = re.compile(r"\b(tiny|base|small|medium|whisper)\b", re.I)
FAILED = []


def check(c, what):
    print(('  ok   ' if c else '  FAIL ') + what)
    if not c:
        FAILED.append(what)


def get(url, tok):
    req = urllib.request.Request(url, headers={'X-Maker-Token': tok})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def post(url, body, tok):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'X-Maker-Token': tok, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def names_in(text):
    return sorted(set(m.lower() for m in NAMES.findall(text)))


def main():
    tmp = Path(tempfile.mkdtemp(prefix='maker-models-', dir=BASE if BASE else None))
    keep = os.environ.get('RYAGRAM_MODEL_DIR')
    try:
        eng = tmp / 'engine'
        shutil.copytree(ENGINE / 'ryagram', eng / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
        (tmp / 'recipes').mkdir()
        (tmp / 'recipes' / 'great-news.json').write_text(json.dumps(RECIPE), encoding='utf8')
        clip = tmp / 'a.mp4'
        clip.write_bytes(b'not really a video')
        dm.faster_whisper_missing = lambda: False
        srv = dm.make_server(eng, tmp / 'recipes', tmp / 'work', tmp / 'films', port=0, token='tok', activity=False)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{dm.STATE['port']}"
        Emod = dm.STATE['E']
        real_models = Emod.MODELS

        def models_dir(*names):
            d = tmp / f"models-{'-'.join(names) or 'none'}"
            for n in names:
                f = d / f"models--Systran--faster-whisper-{n}" / "snapshots" / "x" / "model.bin"
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(b'x')
            d.mkdir(exist_ok=True)
            return d

        print('the list a person sees')
        os.environ.pop('RYAGRAM_MODEL_DIR', None)
        m = get(f'{base}/api/models', 'tok')
        check([c['label'] for c in m['choices']] == ['Fast (rough)', 'Balanced (recommended)', 'Quickest test (very rough)'], f"the choices read in plain words, Fast first, the quickest test last ({[c['label'] for c in m['choices']]})")
        check([c['mb'] for c in m['choices']] == [142, 464, 75], 'the download sizes are the real model folders: Fast 142, Balanced 464, Quickest 75 MB')
        check(m['default'] == 'base' and all(c['ready'] is None for c in m['choices']), 'r8.1: with no model folder known the default is FAST (the one get-model.bat fetches and the one timed) and nothing is claimed about what is downloaded')
        check(m['hint'] == 'Balanced works for most videos. Pick Fast for a quick try.', f"the hint is the agreed sentence, without promising a choice that is not offered ({m['hint']!r})")
        check(not names_in(json.dumps([c['label'] for c in m['choices']]) + m['hint']), 'MUST-FAIL: no Whisper name (tiny, base, small, medium, whisper) in any label or the hint')
        check(names_in('<select id="model"><option>tiny</option><option selected>base</option><option>small</option></select>') == ['base', 'small', 'tiny'], 'MUST-FAIL fixture: the r8 list WOULD be caught by this name check')

        os.environ['RYAGRAM_MODEL_DIR'] = str(models_dir('base'))
        m = get(f'{base}/api/models', 'tok')
        by = {c['name']: c['ready'] for c in m['choices']}
        check(by == {'base': True, 'small': False, 'tiny': False} and m['default'] == 'base', f"only Fast downloaded: Fast is ready, the others say so, and the DEFAULT is Fast (never a missing download) ({by}, {m['default']})")
        os.environ['RYAGRAM_MODEL_DIR'] = str(models_dir('base', 'small'))
        check(get(f'{base}/api/models', 'tok')['default'] == 'base', 'r8.1: with Balanced downloaded as well the default is still Fast until Ryan chooses; Balanced is one pick away')
        os.environ['RYAGRAM_MODEL_DIR'] = str(models_dir())
        check(get(f'{base}/api/models', 'tok')['default'] == 'base', 'r8.1: with nothing downloaded the default is Fast, whose door check says to double-click get-model.bat')

        Emod.MODELS = tuple(real_models) + ('medium',)
        m = get(f'{base}/api/models', 'tok')
        check([c['label'] for c in m['choices']] == ['Fast (rough)', 'Balanced (recommended)', 'Most accurate (slower)', 'Quickest test (very rough)'] and 'Most accurate if words come out wrong' in m['hint'],
              'the day the engine offers a bigger model, "Most accurate (slower)" appears before the quickest test and the hint mentions it')
        Emod.MODELS = real_models
        check('Most accurate' not in json.dumps(get(f'{base}/api/models', 'tok')), 'and it is NOT offered while the engine does not run it (no choice that would be refused)')

        print('\nthe sentences a person reads')
        os.environ['RYAGRAM_MODEL_DIR'] = str(models_dir('base'))
        sl = {'recipe': 'great-news.json', 'binds': {'source-1': [str(clip)]}}
        pc = post(f'{base}/api/check', {**sl, 'model': 'small'}, 'tok')
        miss = ' '.join(pc['problems'])
        check('Balanced (recommended)' in miss and 'about 464 MB' in miss and 'get-model.bat balanced' in miss and not names_in(miss), f'a missing Balanced model is named in plain words with its size and the one line to type ({miss[:150]!r})')
        pc = post(f'{base}/api/check', {**sl, 'model': 'tiny'}, 'tok')
        check('Quickest test' in ' '.join(pc['problems']) and 'get-model.bat quickest' in ' '.join(pc['problems']) and not names_in(' '.join(pc['problems'])), 'and so is the quickest test')
        ok = post(f'{base}/api/check', {**sl, 'model': 'base'}, 'tok')
        check(not [p for p in ok['problems'] if 'listening model' in p] and ok['model_label'] == 'Fast (rough)', 'a downloaded choice raises no model problem and the plan summary names it in plain words')
        pc = post(f'{base}/api/check', {**sl, 'model': 'huge'}, 'tok')
        check(any('Pick one of the choices' in p for p in pc['problems']) and not names_in(' '.join(pc['problems'])), 'MUST-FAIL: an unknown model is refused in plain words, without listing model names')
        pc = post(f'{base}/api/check', dict(sl), 'tok')
        check(pc['model_label'] == 'Fast (rough)', 'asked with no model, the server uses the same default the page does (Fast here, since only Fast is downloaded)')
        wait = [dm.wait_words(120, mm) for mm in ('base', 'small', 'tiny', 'medium')] + [dm.wait_words(None, 'small')]
        check(not names_in(' '.join(wait)), 'MUST-FAIL: no Whisper name in the estimated-wait sentences for any choice')
        check('Balanced (recommended)' in dm.wait_words(120, 'small') and 'Fast (rough)' in dm.wait_words(120, 'base'), 'the wait sentences name the choice in plain words')

        print('\nthe log and the receipt keep the real name; the black window and the download script')
        a = dm.ActivityLog(tmp / 'log', True)
        a.log('ui_model_changed', model='medium')
        a.log('ui_model_changed', model='bogus-model')
        got = [json.loads(x)['model'] for x in (tmp / 'log' / dm.ACTIVITY_NAME).read_text(encoding='utf-8').splitlines()]
        check(got == ['medium', '?'], f'the activity log still records the real model name and still refuses anything else ({got})')
        bat = (ROOT / 'tools' / 'get-model.bat').read_text(encoding='utf-8')
        check('set "SIZE=about 150 MB"' in bat and 'echo This downloads the listening model once, %SIZE%.' in bat and '--get %MODEL% %EXTRA%' in bat and '--get base' not in bat,
              'get-model.bat with no word still fetches the Fast one (about 150 MB, same sentence); a word picks another')
        check('if /i "%~1"=="balanced"' in bat and 'set "MODEL=small"' in bat and 'if /i "%~1"=="quickest"' in bat and 'set "MODEL=tiny"' in bat, 'the words balanced and quickest select the Balanced and the Quickest test models')
        page = dm.PAGE
        sel = re.search(r'<label for="model">.*?</p>', page, re.S).group(0)
        check('<select id="model"></select>' in sel and not names_in(re.sub(r'<[^>]+>', ' ', sel)), 'the page has no model name in the list or around it (the options are filled in from the server)')
        srv.shutdown()
        srv.server_close()
    finally:
        if 'Emod' in locals():
            Emod.MODELS = real_models
        if keep is None:
            os.environ.pop('RYAGRAM_MODEL_DIR', None)
        else:
            os.environ['RYAGRAM_MODEL_DIR'] = keep
        shutil.rmtree(tmp, ignore_errors=True)
    print('\nFAILED: ' + '; '.join(FAILED) if FAILED else '\nall passed')
    return 1 if FAILED else 0


if __name__ == '__main__':
    sys.exit(main())
