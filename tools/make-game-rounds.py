"""Writes (or checks) assets/game-rounds.js (a small pack of rounds for the live Guess the next line page) and tests/fixtures/game-score-golden.json (the real engine's score for
many invented guesses on each of those rounds). Both are made by FACES' real engine (Ryagram ryagram/games/guess_line.py) over a MADE-UP transcript: the same made-up library and timing
as tools/make-game-sample.py. tests/game-score.test.mjs proves assets/game-score.js (the browser port of score_guess) gives exactly these results.
Nothing here is a real show, real person, real line or real clip; every guess is invented.

    py -I -B tools/make-game-rounds.py <folder holding ryagram/games>            writes the files
    py -I -B tools/make-game-rounds.py <folder holding ryagram/games> --check    exits 1 if the committed files differ
"""
import dataclasses, json, random, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args:
    sys.exit(__doc__)
sys.path.insert(0, str(Path(args[0]).resolve()))
from ryagram.games import guess_line as G  # noqa: E402
from ryagram.library.find import loose_keys  # noqa: E402
from ryagram.supercut.text import normalize_phrase, normalize_word  # noqa: E402

LINES = {   # made-up sentences, one per line; each ends a line with a full stop and a pause (the same as tools/make-game-sample.py)
    'made-up-show-1.mp4': ['The lighthouse keeper counted seventeen sleepy seagulls on the roof.', 'Nobody told the baker that the moon was made of sourdough.',
                           'My neighbour keeps a very polite goat in the garden shed.', 'We found a tiny orchestra living inside the old piano.'],
    'made-up-show-2.mp4': ['The librarian whispered that the dictionary had learned to sing.', 'Seventeen penguins marched slowly through the quiet museum.',
                           'Every evening the clock tower hums a different cheerful tune.', 'A cheerful tune drifted over the sleepy harbour at midnight.'],
}
WORD_MS, GAP_MS, SENTENCE_PAUSE_MS = 320, 40, 900
SEED, ROUNDS = 'game-rounds-38', 5      # this seed gives answers of 6, 7, 2, 4 and 4 words, one with a number word in it


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


SALAD = ['purple', 'umbrella', 'kettle', 'marble', 'quickly', 'banjo', 'waffle', 'lantern', 'pebble', 'zigzag', 'velvet', 'noodle', 'thimble', 'crayon', 'meadow', 'yonder']
ACCENT = {'a': '\u00e1', 'e': '\u00e9', 'i': '\u00ed', 'o': '\u00f3', 'u': '\u00fc'}
NUMWORDS = {'seventeen': '17', 'one': '1', 'two': '2', 'three': '3', 'seven': '7', 'ten': '10'}


def guesses_for(rnd, r):
    """about 25 invented guesses for one round, each built from the round's own (made-up) answer or from invented filler"""
    plain = [w['word'].strip('.,!?') for w in rnd.answer]
    low = [w.lower() for w in plain]
    ex = ' '.join(low)
    longest = max(low, key=len)
    li = low.index(longest)
    rng = random.Random(f'{SEED}|salad|{r}')
    swap = lambda i, w: ' '.join(w if j == i else x for j, x in enumerate(low))
    mid = len(longest) // 2
    typo_sub = longest[:mid] + ('q' if longest[mid] != 'q' else 'z') + longest[mid + 1:]
    typo_del = longest[:mid] + longest[mid + 1:]
    last = low[-1]
    doubled = last + last[-1] + 'ing' if last[-1] not in 'aeiouwxy' else last + 'ing'
    accented = next((low[0].replace(v, ACCENT[v], 1) for v in 'aeiou' if v in low[0]), low[0])
    out = [
        ('exact', ex),
        ('exact, as written with capitals and the full stop', ' '.join(w['word'] for w in rnd.answer)),
        ('all capitals', ex.upper()),
        ('plural of the first word', swap(0, low[0] + 's')),
        ('-ing on the last word', swap(len(low) - 1, last + 'ing')),
        ('-ed on the first word', swap(0, low[0] + 'ed')),
        ('doubled consonant and -ing on the last word', swap(len(low) - 1, doubled)),
        ('-es on the longest word', swap(li, longest + 'es')),
        ('one letter changed in the longest word', swap(li, typo_sub)),
        ('one letter dropped from the longest word', swap(li, typo_del)),
        ('short words that are not near: hear here cat cart', 'hear here cat cart ' + ex),
        ('number words as digits', ' '.join(NUMWORDS.get(w, w) for w in low)),
        ('wrong order', ' '.join(reversed(low))),
        ('padded with extra invented words', ex + ' and then a purple kettle waltzed away'),
        ('empty', ''),
        ('only spaces', '   \t \n '),
        ('punctuation only', '!!! ,,, ... ?'),
        ('punctuation around words', ', '.join(low) + '!?'),
        ('hyphen, dash, slash and ellipsis between words', ''.join(w + ['-', '\u2014', '/', '\u2026', '...', '\u2013', '\\'][j % 7] for j, w in enumerate(low[:-1])) + last),
        ('two answer words typed joined', ' '.join(low[:-2] + [low[-2] + low[-1]])),
        ('smart apostrophe word in front', 'it\u2019s ' + ex),
        ('accented letters: cafe with an acute, and an accent on the first word', 'caf\u00e9 ' + ' '.join([accented] + low[1:])),
        ('odd spaces between words: no-break, ideographic, next-line, zero-width no-break', ['\u00a0', '\u3000', '\x85', '\ufeff'][r % 4].join(low)),
        ('folded letters: fullwidth, ligature, sharp s', ''.join(chr(ord(c) + 0xFEE0) for c in low[0]) + ' stra\u00dfe \ufb01ddle ' + ' '.join(low[1:])),
        ('only the first half', ' '.join(low[: max(1, len(low) // 2)])),
        ('one word missing', ' '.join(low[1:])),
        ('far too long (truncated)', ex + ' ' + ' '.join(SALAD[k % len(SALAD)] for k in range(3 * len(low) + 6))),
        ('word salad', ' '.join(rng.choice(SALAD) for _ in range(len(low) + 2))),
        ('word salad with one right word', ' '.join(rng.sample(SALAD, 3) + [low[-1]] + rng.sample(SALAD, 2))),
    ]
    return out


# word-rule cases: pairs and words whose engine answer the port must also give (numbers, endings, near misses that are not near, Unicode)
CREDIT_PAIRS = [('boxes', 'box'), ('buses', 'bus'), ('churches', 'church'), ('wishes', 'wish'), ('buzzes', 'buzz'), ('makes', 'make'), ('making', 'make'), ('liked', 'like'),
                ('running', 'run'), ('stopped', 'stop'), ('locked', 'locke'), ('locked', 'lock'), ('falling', 'fall'), ('passes', 'pass'), ('class', 'clas'), ('clubs', 'club'),
                ('hear', 'here'), ('cat', 'cart'), ('rat', 'rate'), ('hat', 'hate'), ('red', 'reed'), ('hating', 'hat'), ('17', 'seventeen'), ('seven', '7'), ('20', 'twenty'),
                ('21', 'twentyone'), ('0', 'zero'), ('seagull', 'seagulls'), ('garden', 'gardn'), ('harbour', 'harbor'), ('midnight', 'midnite'), ('piano', 'pianos'),
                ('sleepy', 'sleeps'), ('dont', "don't"), ("it's", 'its'), ('ses', 'se'), ('goes', 'go'), ('tower', 'towers'), ('tune', 'tuned'), ('hummed', 'hum'), ('hums', 'hum'),
                ('humming', 'hum'), ('playing', 'play'), ('saying', 'say'), ('fixed', 'fix'), ('fizzing', 'fizz'), ('voting', 'vote'), ('abcde', 'abcdf'), ('abcd', 'abce')]
WORDS = ['caf\u00e9', 'CAF\u00c9', 'cafe\u0301', 'na\u00efve', 'don\u2019t', 'don\u2018t', 'don\u02bct', 'don\u00b4t', 'don`t', "'quoted'", "''", 'stra\u00dfe', '\u1e9e', '\u00e6ther', '\u00c6THER',
         'sm\u00f8rrebr\u00f8d', '\u0153uvre', '\u0141\u00f3d\u017a', '\u0111\u0110', '\u00fein\u00de', '\ufb01ne', '\uff27\uff4f\uff4f\uff44', '\u2460', '\u00bd', 'x\u00b2', '\u212bngstr\u00f6m',
         '\u0130stanbul', '\u0131', '[Music]', '--', '\u266a', '\u65e5\u672c', '\u0645\u0631\u062d\u0628\u0627', 'e\u0301\u0302\u0323', '\u1e9b\u0323', 'ab\u200bcd', 'ab\ufeffcd', 'ab\u00adcd',
         '\u2160\u2161', '\u3392', 'k\u212a', '\u01c4', '\u0e01\u0e34', 'r\u00e9sum\u00e9s', 'co\u00f6perate', '\ua7f1', 'x\U0001ccd6y', 'a\U0001ccf0b', '\U0001d400\U0001d401c', 'a\u0308\u0304']
PHRASES = ['a b', 'a\u00a0b', 'a\u3000b', 'a\x85b', 'a\x1cb\x1dc\x1ed\x1fe', 'a\ufeffb', 'a\u200bb', 'a\u2028b\u2029c', 'a\u202fb\u205fc\u1680d', ' lead and trail ', 'a\t\n\v\fb\rc', 'a--b', 'a,b c.']


def main():
    lib, files = library()
    rounds = G.new_game(lib, SEED, ROUNDS, files=files)
    pack = dict(schema='ryagram.game-rounds/0', note='Made by the real engine (Ryagram guess_line.py new_game) over a MADE-UP transcript, written by tools/make-game-rounds.py; nothing here is a real show, person, line or clip.',
                game='guess-the-next-line', seed=SEED, rounds=[])
    golden = dict(schema='ryagram.game-score-golden/0', note='The real engine\'s score_guess for invented guesses on the rounds of assets/game-rounds.js (tools/make-game-rounds.py). Do not edit by hand.',
                  seed=SEED, rounds=[], credit=[], loose_keys=[], words=[], phrases=[])
    for r, rnd in enumerate(rounds):
        answer = [dict(word=a['word'], norm=a['norm'], rarity=round(a['rarity'], 6)) for a in rnd.answer]
        pack['rounds'].append(dict(public=rnd.to_public(), answer=answer, rarity=round(rnd.rarity, 6), phrase_count=rnd.phrase_count, base_points=G.base_points(rnd)))
        stored = dataclasses.replace(rnd, answer=answer, rarity=round(rnd.rarity, 6))      # the round as the page will hold it (rarity cut to 6 places)
        cases = []
        for label, text in guesses_for(rnd, r):
            res = G.score_guess(rnd, text)
            if G.score_guess(stored, text) != res:
                sys.exit(f'round {r}: cutting the rarity to 6 places changes the score of {label!r}; store more places')
            cases.append(dict(label=label, guess=text, result=res))
        golden['rounds'].append(dict(id=rnd.id, cases=cases))
    words = {w for a, b in CREDIT_PAIRS for w in (a, b)}
    golden['credit'] = [dict(g=a, a=b, credit=G._credit(a, b), one_edit=G._one_edit(a, b)) for a, b in CREDIT_PAIRS]
    golden['loose_keys'] = [dict(word=w, keys=sorted(loose_keys(w))) for w in sorted(words)]
    golden['words'] = [dict(word=w, norm=normalize_word(w)) for w in WORDS]
    golden['phrases'] = [dict(phrase=p, words=normalize_phrase(p)) for p in PHRASES]

    js = ('// A small pack of rounds for the live Guess the next line page: made by the real engine (Ryagram guess_line.py new_game) over a MADE-UP transcript, written by tools/make-game-rounds.py.\n'
          '// public is all the page may show before the reveal; answer is for scoring in the page (assets/game-score.js) and the reveal. Do not edit by hand.\n'
          'window.ryagramGameRounds = ' + json.dumps(pack, sort_keys=True, ensure_ascii=False, separators=(',', ':')) + ';\n')
    text = json.dumps(golden, sort_keys=True, ensure_ascii=True, indent=1) + '\n'      # ASCII escapes, so the odd spaces and marks in the guesses survive any editor
    dest, js_dest = ROOT / 'tests/fixtures/game-score-golden.json', ROOT / 'assets/game-rounds.js'
    norm = lambda s: s.replace('\r\n', '\n')
    if '--check' in sys.argv:
        same = (dest.exists() and norm(dest.read_text(encoding='utf-8')) == text and js_dest.exists() and norm(js_dest.read_text(encoding='utf-8')) == js)
        print('same' if same else 'DIFFERENT'); sys.exit(0 if same else 1)
    dest.write_text(text, encoding='utf-8', newline='\n'); js_dest.write_text(js, encoding='utf-8', newline='\n')
    print('wrote', dest.name, js_dest.name, 'cases:', sum(len(x['cases']) for x in golden['rounds']))


main()
