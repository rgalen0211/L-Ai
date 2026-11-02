"""Writes (or checks) tests/fixtures/game-night-sample.json (and assets/game-tv-sample.js, the same data for the page): a RECORDED sample game night made by FACES' real engine (Ryagram ryagram/games/guess_line.py, NEXT-FACES 104) over a MADE-UP transcript with made-up
players and scripted guesses. The TV screen page (/game-tv/) replays it; tests/game-tv.test.mjs proves the page shows only what the engine's public view allows before the reveal and that the numbers add up.
Nothing here is a real show, real person or real clip.

    python tools/make-game-sample.py <folder holding ryagram/games>            writes the file
    python tools/make-game-sample.py <folder holding ryagram/games> --check    exits 1 if the committed file differs
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args:
    sys.exit(__doc__)
sys.path.insert(0, str(Path(args[0]).resolve()))
from ryagram.games import guess_line as G  # noqa: E402
from ryagram.supercut.text import normalize_word  # noqa: E402

LINES = {   # made-up sentences, one per line; each ends a line with a full stop and a pause
    'made-up-show-1.mp4': ['The lighthouse keeper counted seventeen sleepy seagulls on the roof.', 'Nobody told the baker that the moon was made of sourdough.',
                           'My neighbour keeps a very polite goat in the garden shed.', 'We found a tiny orchestra living inside the old piano.'],
    'made-up-show-2.mp4': ['The librarian whispered that the dictionary had learned to sing.', 'Seventeen penguins marched slowly through the quiet museum.',
                           'Every evening the clock tower hums a different cheerful tune.', 'A cheerful tune drifted over the sleepy harbour at midnight.'],
}
WORD_MS, GAP_MS, SENTENCE_PAUSE_MS = 320, 40, 900


def library():
    lib, files = {}, {}
    for k, (fname, sents) in enumerate(LINES.items()):
        mid, t, words = f'm{k + 1}', 1000, []
        files[mid] = fname
        for s in sents:
            for w in s.split():
                words.append(dict(word=w, norm=normalize_word(w), start_ms=t, end_ms=t + WORD_MS)); t += WORD_MS + GAP_MS
            t += SENTENCE_PAUSE_MS
        lib[mid] = [w for w in words if w['norm']]
    return lib, files


PLAYERS = ['Ana', 'Ben', 'Cy']
def guesses_for(rnd, i):
    ans = [w['word'] for w in rnd.answer]
    plain = lambda w: w.strip('.,!?')
    exact = ' '.join(plain(w) for w in ans)
    near = ' '.join(plain(w) + ('s' if j == 0 and not plain(w).endswith('s') else '') for j, w in enumerate(ans))     # one word in another form
    half = ' '.join(plain(w) for w in ans[: max(1, len(ans) // 2)]) + ' and some other things'
    return {'Ana': [exact, near, half][i % 3], 'Ben': [near, half, exact][i % 3], 'Cy': ['', 'something else entirely', near][i % 3]}


lib, files = library()
rounds = G.new_game(lib, 'tv-sample-1', 3, files=files)
night = dict(schema='ryagram.game-night-sample/0', note='RECORDED sample made by the real engine (guess_line.py) over a MADE-UP transcript; nothing here is a real show, person or clip.',
             game='guess-the-next-line', seed='tv-sample-1', players=PLAYERS, timer_s=30, rounds=[], totals={p: 0 for p in PLAYERS})
for i, r in enumerate(rounds):
    gs = guesses_for(r, i)
    out = dict(public=r.to_public(), reveal=r.reveal(), guesses=[])
    for p in PLAYERS:
        res = G.score_guess(r, gs[p])
        night['totals'][p] += res['points']
        out['guesses'].append(dict(player=p, text=gs[p], result=res))
    night['rounds'].append(out)
text = json.dumps(night, sort_keys=True, ensure_ascii=False, indent=1) + '\n'
dest = ROOT / 'tests/fixtures/game-night-sample.json'
js_dest = ROOT / 'assets/game-tv-sample.js'
js = ('// RECORDED sample game night for the TV screen page (NEXT-WEB 203): the real engine output over a MADE-UP transcript, written by tools/make-game-sample.py. Do not edit by hand.\n'
      'window.ryagramGameTvSample = ' + json.dumps(night, sort_keys=True, ensure_ascii=False, separators=(',', ':')) + ';\n')
norm = lambda s: s.replace('\r\n', '\n')
if '--check' in sys.argv:
    same = (dest.exists() and norm(dest.read_text(encoding='utf-8')) == text and js_dest.exists() and norm(js_dest.read_text(encoding='utf-8')) == js)
    print('same' if same else 'DIFFERENT'); sys.exit(0 if same else 1)
dest.write_text(text, encoding='utf-8', newline='\n'); js_dest.write_text(js, encoding='utf-8', newline='\n'); print('wrote', dest.name, js_dest.name)
