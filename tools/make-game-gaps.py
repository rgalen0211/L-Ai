"""Writes (or checks) assets/game-gap-rounds.js (a small pack of rounds for the live Fill the gap page) and tests/fixtures/game-gap-golden.json (the real engine's score for
invented guesses on each of those rounds). A Fill the gap round shows one made-up line with ONE word hidden; players type the missing word.
Nothing new is invented for scoring: the hidden word is a one-word answer, scored by FACES' real engine (Ryagram ryagram/games/guess_line.py score_guess) on a Round whose
answer is that word (its rarity from the engine's own Frequencies over the made-up library) and whose rarity is that word's rarity, so base points follow the engine's
base_points. assets/game-score.js (the browser port of score_guess) scores these rounds unchanged; tests/game-gaps.test.mjs proves it against the golden file.
The made-up library and timing are the same as tools/make-game-sample.py and tools/make-game-rounds.py. Nothing here is a real show, person, line or clip; every guess is invented.

The hidden word of a line: the rarest word that is at least 4 letters (its normalised form) and not the line's first word; a tie goes to the earliest.
The lines: the made-up lines Guess the next line (tools/make-game-rounds.py, seed game-rounds-38) does NOT use come first, in the order written, then the lines it does use,
until there are 5.

    py -I -B tools/make-game-gaps.py <folder holding ryagram/games>            writes the files
    py -I -B tools/make-game-gaps.py <folder holding ryagram/games> --check    exits 1 if the committed files differ
"""
import dataclasses, hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args:
    sys.exit(__doc__)
sys.path.insert(0, str(Path(args[0]).resolve()))
from ryagram.games import guess_line as G  # noqa: E402
from ryagram.supercut.text import normalize_word  # noqa: E402

LINES = {   # made-up sentences, one per line (the same as tools/make-game-sample.py and tools/make-game-rounds.py)
    'made-up-show-1.mp4': ['The lighthouse keeper counted seventeen sleepy seagulls on the roof.', 'Nobody told the baker that the moon was made of sourdough.',
                           'My neighbour keeps a very polite goat in the garden shed.', 'We found a tiny orchestra living inside the old piano.'],
    'made-up-show-2.mp4': ['The librarian whispered that the dictionary had learned to sing.', 'Seventeen penguins marched slowly through the quiet museum.',
                           'Every evening the clock tower hums a different cheerful tune.', 'A cheerful tune drifted over the sleepy harbour at midnight.'],
}
WORD_MS, GAP_MS, SENTENCE_PAUSE_MS = 320, 40, 900
LINE_ROUNDS_SEED, ROUNDS, GAP = 'game-rounds-38', 5, '____'
MIN_LETTERS = 4
EDGE = '.,!?;:"\''


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


def pick_lines(lib, files):
    """the made-up lines Guess the next line does not use, then the ones it does, in the order written"""
    used = {' '.join([w['word'] for w in r.heard] + [w['word'] for w in r.answer]) for r in G.new_game(lib, LINE_ROUNDS_SEED, ROUNDS, files=files)}
    every = [(fname, s) for fname, sents in LINES.items() for s in sents]
    order = [x for x in every if x[1] not in used] + [x for x in every if x[1] in used]
    return order[:ROUNDS], used


def gap_round(fname, line, freq):
    toks = line.split()
    best = None
    for i, tok in enumerate(toks):
        n = normalize_word(tok)
        if i == 0 or len(n) < MIN_LETTERS:
            continue
        r = freq.rarity(n)
        if best is None or r > best[1]:      # strictly rarer only: a tie keeps the earliest
            best = (i, r)
    i, r = best
    tok = toks[i]
    bare = tok.strip(EDGE)
    lead = tok[:len(tok) - len(tok.lstrip(EDGE))]
    shown = ' '.join(t if j != i else lead + GAP + tok[len(lead) + len(bare):] for j, t in enumerate(toks))
    word = dict(word=bare, norm=normalize_word(bare), rarity=round(r, 6))
    rid = hashlib.sha1(f'gap|{fname}|{line}|{i}'.encode()).hexdigest()[:12]
    full = G.Round(id=rid, media_id=fname, clip_start_ms=0, stop_ms=0, heard=[], answer=[dict(word=bare, norm=word['norm'], rarity=r)], rarity=r, phrase_count=1, file=fname)
    stored = dataclasses.replace(full, answer=[word], rarity=round(r, 6))
    assert shown.count(GAP) == 1 and shown.replace(GAP, bare) == line, line
    assert bare.lower() not in shown.lower(), f'the hidden word {bare!r} is still in {shown!r}'
    return full, stored, shown


def guesses_for(word):
    """about 15 invented guesses for one hidden word, built from the (made-up) word itself or from invented filler"""
    w = word.lower()
    mid = len(w) // 2
    typo = w[:mid] + ('q' if w[mid] != 'q' else 'z') + w[mid + 1:]
    return [
        ('exact', w),
        ('capitals', w.upper()),
        ('first letter capital', w.capitalize()),
        ('plural / -s', w + 's'),
        ('-es', w + 'es'),
        ('-ing', w + 'ing'),
        ('-ed', w + 'ed'),
        ('one letter changed in the middle', typo),
        ('one letter dropped', w[:mid] + w[mid + 1:]),
        ('a short wrong word', 'cat'),
        ('a long wrong word', 'umbrella'),
        ('two words: the answer and an invented one', w + ' kettle'),
        ('two invented words', 'purple waffle'),
        ('empty', ''),
        ('only spaces', '   '),
        ('punctuation only', '?!.,'),
        ('punctuation around the word', '"' + w + '!?"'),
    ]


def main():
    lib, files = library()
    freq = G.Frequencies(lib)
    chosen, used = pick_lines(lib, files)
    pack = dict(schema='ryagram.game-gap-rounds/0', note='Made by the real engine\'s rarity (Ryagram guess_line.py Frequencies) and scorer (score_guess) over a MADE-UP transcript, '
                'written by tools/make-game-gaps.py; nothing here is a real show, person, line or clip.', game='fill-the-gap',
                rule='hidden word: the rarest word of the line at least 4 letters long and not the first word; a tie goes to the earliest', rounds=[])
    golden = dict(schema='ryagram.game-gap-golden/0', note='The real engine\'s score_guess for invented guesses on the rounds of assets/game-gap-rounds.js (tools/make-game-gaps.py). Do not edit by hand.',
                  rounds=[])
    for r, (fname, line) in enumerate(chosen):
        full, stored, shown = gap_round(fname, line, freq)
        pack['rounds'].append(dict(public=dict(id=full.id, shown_text=shown, words_left=1, difficulty=full.difficulty), answer=stored.answer, rarity=stored.rarity,
                                   phrase_count=1, base_points=G.base_points(stored)))
        cases = []
        for label, text in guesses_for(stored.answer[0]['word']):
            res = G.score_guess(full, text)
            if G.score_guess(stored, text) != res:
                sys.exit(f'round {r}: cutting the rarity to 6 places changes the score of {label!r}; store more places')
            cases.append(dict(label=label, guess=text, result=res))
        golden['rounds'].append(dict(id=full.id, line=line, also_in_guess_the_next_line=line in used, cases=cases))
    answers = [x['answer'][0]['norm'] for x in pack['rounds']]
    if len(set(answers)) != len(answers):
        sys.exit(f'two rounds hide the same word: {answers}')

    js = ('// A small pack of rounds for the live Fill the gap page: one made-up line with one word hidden, made by the real engine\'s rarity and scorer (Ryagram guess_line.py)\n'
          '// over a MADE-UP transcript, written by tools/make-game-gaps.py. public is all the page may show before the reveal; answer is for scoring in the page\n'
          '// (assets/game-score.js scoreGuess, unchanged) and the reveal. Do not edit by hand.\n'
          'window.ryagramGameGapRounds = ' + json.dumps(pack, sort_keys=True, ensure_ascii=False, separators=(',', ':')) + ';\n')
    text = json.dumps(golden, sort_keys=True, ensure_ascii=True, indent=1) + '\n'
    dest, js_dest = ROOT / 'tests/fixtures/game-gap-golden.json', ROOT / 'assets/game-gap-rounds.js'
    norm = lambda s: s.replace('\r\n', '\n')
    if '--check' in sys.argv:
        same = (dest.exists() and norm(dest.read_text(encoding='utf-8')) == text and js_dest.exists() and norm(js_dest.read_text(encoding='utf-8')) == js)
        print('same' if same else 'DIFFERENT'); sys.exit(0 if same else 1)
    dest.write_text(text, encoding='utf-8', newline='\n'); js_dest.write_text(js, encoding='utf-8', newline='\n')
    print('wrote', dest.name, js_dest.name, 'cases:', sum(len(x['cases']) for x in golden['rounds']))
    for x, g in zip(pack['rounds'], golden['rounds']):
        print(f"  {x['public']['shown_text']}  ->  {x['answer'][0]['word']}  rarity {x['rarity']}  base {x['base_points']:.4f}  {'(also a next-line round)' if g['also_in_guess_the_next_line'] else ''}")


main()
