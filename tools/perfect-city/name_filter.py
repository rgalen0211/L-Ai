"""Perfect City private-name filter (FACES proposal 11-27, proposals/FACES-pc_name_filter-1127.py; stdlib only).

Used by export_perfect_city.py `places` for the OpenStreetMap kinds only (never the FDIC bank rows): a place whose tags say it is a
private home or a bare personal name is left out of the places file. The exporter prints only COUNTS of what it drops, never the names.

keep_place(tags) -> bool        True = keep the place, False = drop it from the exported places.
decide(tags) -> (keep, reason)  the same, with the reason in words (log the reason; never print the dropped names into a repo).

Principle: a business named after its owner (Joe's Burgers) is a real business. KEEP when a brand tag or a
business word says "business". DROP only when private tags or home words / a bare personal name say so.
Order of the rules matters (first match wins). The 25 invented test cases are in tests/test_perfect_city_name_filter.py.
"""
import re

APOS = str.maketrans({chr(0x2019): "'", chr(0x2018): "'", chr(0x2BC): "'"})      # curly and modifier apostrophes count as a plain one

PRIVATE_ACCESS = {'private', 'no'}
RESIDENTIAL_BUILDING = {'house', 'residential', 'detached', 'semidetached_house', 'terrace', 'bungalow',
                        'apartments', 'dormitory', 'static_caravan'}

# Whole words (lower case, plural and 's stripped) that say "this is a business".
BUSINESS_WORDS = set('''
cafe coffee espresso tea restaurant resto grill grille bbq barbecue bar pub tavern diner deli bakery bakehouse bakeshop
kitchen cooking cookery eatery bistro cantina steakhouse chophouse creamery ice cream icecream donut doughnut bagel
brewing brewery taproom lounge pizza pizzeria burger sandwich sub wing chicken taco burrito noodle sushi ramen pho
thai chinese mexican asian indian italian greek seafood fish oyster steak rib food truck express drive thru through
shop store mart market supermarket grocery grocer foods fresh corner convenience gas station bank credit union
co company inc llc corp ltd hut bell place plaza center catering dairy pantry smoothie juice buffet carryout takeout
daycare dental clinic pharmacy salon heaven house
'''.split())

# A deliberately short list: only used to call a bare "<First> <Last>" a person, never to drop a name that has a business word.
FIRST_NAMES = set('''
john jane james mary robert patricia michael jennifer william linda david elizabeth richard barbara joseph susan thomas
jessica charles sarah christopher karen daniel nancy matthew lisa anthony betty mark margaret donald sandra steven ashley
paul kimberly andrew emily joshua donna kenneth michelle kevin carol brian amanda george melissa timothy deborah ronald
stephanie edward rebecca jason sharon jeffrey laura ryan cynthia jacob kathleen gary amy nicholas angela eric shirley
jonathan anna stephen brenda larry pamela justin emma scott nicole brandon helen benjamin samantha samuel katherine
gregory christine frank debra alexander rachel raymond carolyn patrick janet jack catherine dennis maria jerry heather
tyler diane aaron ruth jose julie adam olivia nathan joyce henry virginia zachary victoria douglas kelly peter lauren
kyle christina walter joan ethan evelyn jeremy judith harold andrea keith hannah christian jacqueline roger megan
joe joey marie mike bob bill tom tim jim sue ann anne sam dan don ed ken pat ron steve tony grace lee
'''.split())

HOME_WORDS = {'home', 'residence', 'residential', 'private', 'family', 'household', 'apartment', 'condo', 'townhome',
              'townhouse', 'dwelling'}
UNIT_RE = re.compile(r"\b(?:apt|apartment|unit|suite|ste|room|rm|flat|lot)\b\.?\s*#?\s*[0-9]+[a-z]?\b|#\s*[0-9]+[a-z]?\b", re.I)
POSSESSIVE_DWELLING_RE = re.compile(r"\b[a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*)?'s?\s+(?:house|home|residence|apartment|apt|condo|garage)\b", re.I)


def _words(name):
    out = []
    for w in re.findall(r"[a-z0-9]+(?:'[a-z]+)?", name.translate(APOS).lower()):
        w = re.sub(r"'s$", '', w)
        out.append(w)
        if w.endswith('s') and len(w) > 3:
            out.append(w[:-1])
    return out


def has_business_word(name):
    return any(w in BUSINESS_WORDS for w in _words(name))


def decide(tags):
    """(keep, reason). `tags` is the OpenStreetMap tag dict of one element. The reason never contains the name."""
    tags = tags or {}
    name = (tags.get('name') or '').strip()
    brand = bool((tags.get('brand') or tags.get('brand:wikidata') or '').strip())
    access = (tags.get('access') or '').lower()
    building = (tags.get('building') or '').lower()
    if access in PRIVATE_ACCESS:
        return False, 'access=' + access          # even a brand: a place the public may not enter is not a place to list
    if brand:
        return True, 'brand tag'
    # possessive dwelling beats a business word only for house/home words: "Lee's house" has none, "Lee's House of Pizza" has pizza
    biz = has_business_word(re.sub(r"\b(house|home)\b", ' ', name, flags=re.I)) or \
        bool(re.search(r"\bhouse\b", name, re.I) and not POSSESSIVE_DWELLING_RE.search(name.translate(APOS)))
    if building in RESIDENTIAL_BUILDING and not biz:
        return False, 'building=' + building + ' and no business word'
    if not name:
        return True, 'no name (shown as "no name in the map data")'
    if biz:
        return True, 'business word in the name'
    words = _words(name)
    if UNIT_RE.search(name):
        return False, 'unit / apartment number'
    if POSSESSIVE_DWELLING_RE.search(name.translate(APOS)):
        return False, "possessive dwelling (X's house / home)"
    if any(w in HOME_WORDS for w in words):
        return False, 'home word and no business word'
    if tags.get('addr:housenumber'):
        return False, 'house number, no brand, no business word'
    letters = re.findall(r"[A-Za-z][A-Za-z.'-]*", name.translate(APOS))
    if 1 <= len(letters) <= 3 and len(letters) == len(name.split()) and letters[0].lower().rstrip('.') in FIRST_NAMES:
        return False, 'only a personal name'
    return True, 'nothing says private'


def keep_place(tags):
    return decide(tags)[0]
