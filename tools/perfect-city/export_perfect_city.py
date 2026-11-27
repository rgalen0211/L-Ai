"""Perfect City (GEO 11-27): build the page data from the shared cache, offline.

Two outputs, kept apart on purpose:
  census   -> assets/perfect-city/<county>.census.json  (US Census, public domain: committed, served with the page)
  places   -> a SQL file OUTSIDE this repo (OpenStreetMap, ODbL; attorney row G11 is open, so the points are
              never committed or served as a site file; Ryan loads them into a private table with a live step)

Usage (system Python with pyshp and pyproj; no network):
  py -I -B tools/perfect-city/export_perfect_city.py census
  py -I -B tools/perfect-city/export_perfect_city.py official   (after census: adds County Business Patterns counts to the same files)
  py -I -B tools/perfect-city/export_perfect_city.py places --out D:/Ryagram-scratch/GEO/perfect-city/places.sql
Labels: population is OBSERVED (2020 Census P1); area and density are CALCULATED here from the boundary;
median household income is an ESTIMATE (ACS B19013, with its margin of error).
"""
import argparse
import io
import json
import math
import pathlib
import sys
import zipfile

import shapefile  # pyshp
from pyproj import Geod

CACHE = pathlib.Path(r'C:/Users/Ryan/Ryagram-cache/geo_intel')
REPO = pathlib.Path(__file__).resolve().parents[2]
COUNTIES = {
    'montgomery_oh': {'name': 'Montgomery County, Ohio (Dayton)', 'state': '39', 'county': '113'},
    'greene_oh': {'name': 'Greene County, Ohio (Beavercreek, Xenia)', 'state': '39', 'county': '057'},
}
GEOD = Geod(ellps='WGS84')
NOT_AVAILABLE = {-666666666, -999999999, -888888888, -555555555, -333333333, -222222222}


def table(path):
    rows = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    head = rows[0]
    return [dict(zip(head, r)) for r in rows[1:]]


def geoid(r):
    return r['state'] + r['county'] + r['tract'] + r['block group']


def simplify(ring, tol):
    """Douglas-Peucker on lon/lat pairs (tolerance in degrees), keeping the ring closed."""
    if len(ring) < 5:
        return ring
    def rdp(pts):
        if len(pts) < 3:
            return pts
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = -1.0, 0
        for i in range(1, len(pts) - 1):
            x0, y0 = pts[i]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, idx = d, i
        if best <= tol:
            return [pts[0], pts[-1]]
        return rdp(pts[:idx + 1])[:-1] + rdp(pts[idx:])
    out = rdp(ring)
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else ring


def census(args):
    with zipfile.ZipFile(CACHE / 'montgomery_oh' / 'bg_boundaries.zip') as z:
        stem = 'cb_2023_39_bg_500k'
        sf = shapefile.Reader(shp=io.BytesIO(z.read(stem + '.shp')), shx=io.BytesIO(z.read(stem + '.shx')),
                              dbf=io.BytesIO(z.read(stem + '.dbf')))
        fields = [f[0] for f in sf.fields[1:]]
        shapes = {}
        for rec, shp in zip(sf.iterRecords(), sf.iterShapes()):
            d = dict(zip(fields, rec))
            shapes[d['GEOID']] = shp
    out_dir = REPO / 'assets' / 'perfect-city'
    out_dir.mkdir(parents=True, exist_ok=True)
    for key, meta in COUNTIES.items():
        pop = {geoid(r): int(r['P1_001N']) for r in table(CACHE / key / 'pop_p1_2020.json')}
        inc = {}
        for r in table(CACHE / key / 'income_b19013.json'):
            e, m = int(r['B19013_001E']), int(r['B19013_001M'])
            inc[geoid(r)] = None if e in NOT_AVAILABLE else [e, None if m in NOT_AVAILABLE else m]
        prefix = meta['state'] + meta['county']
        feats, lon0, lat0, lon1, lat1 = [], 999, 999, -999, -999
        for g, shp in sorted(shapes.items()):
            if not g.startswith(prefix):
                continue
            parts = list(shp.parts) + [len(shp.points)]
            rings, area_m2 = [], 0.0
            for a, b in zip(parts[:-1], parts[1:]):
                ring = [(round(x, 5), round(y, 5)) for x, y in shp.points[a:b]]
                ar, _ = GEOD.polygon_area_perimeter([p[0] for p in ring], [p[1] for p in ring])
                area_m2 += -ar          # shapefile outer rings are clockwise: pyproj gives them negative
                rings.append([[round(x, 4), round(y, 4)] for x, y in simplify(ring, 0.0004)])
            for ring in rings:
                for x, y in ring:
                    lon0, lat0, lon1, lat1 = min(lon0, x), min(lat0, y), max(lon1, x), max(lat1, y)
            xs = [p[0] for p in shp.points]; ys = [p[1] for p in shp.points]
            km2 = round(area_m2 / 1e6, 4)
            p = pop.get(g)
            feats.append({'id': g, 'rings': rings, 'pop': p, 'km2': km2,
                          'density': (round(p / km2, 1) if p is not None and km2 > 0 else None),
                          'income': inc.get(g),
                          'centre': [round(sum(xs) / len(xs), 5), round(sum(ys) / len(ys), 5)]})
        doc = {
            'county': key, 'name': meta['name'], 'bbox': [lon0, lat0, lon1, lat1],
            'sources': {
                'boundaries': 'U.S. Census Bureau, cartographic boundary file cb_2023_39_bg_500k (block groups, 2020 geography)',
                'population': 'U.S. Census Bureau, 2020 Census, table P1 (total population): OBSERVED',
                'income': 'U.S. Census Bureau, American Community Survey 5-year, table B19013 (median household income, with margin of error): ESTIMATE',
                'calculated': 'Area and people per square kilometre are CALCULATED here from the boundary file; shapes are simplified for the page.',
                'licence': 'Public domain (U.S. government work).'},
            'units': feats}
        # A script, not a .json fetch: the app's CSP allows scripts from 'self' but its connect-src is Supabase only.
        path = out_dir / f'{key}.census.js'
        body = json.dumps(doc, separators=(',', ':'))
        path.write_text('// GENERATED by tools/perfect-city/export_perfect_city.py census: US Census data, public domain. Do not edit by hand.\n'
                        f'(window.ryagramPerfectCityData = window.ryagramPerfectCityData || {{}})[{json.dumps(key)}] = {body};\n',
                        encoding='utf-8', newline='\n')
        print(path.relative_to(REPO), len(feats), 'block groups', path.stat().st_size, 'bytes')


KINDS = {'fast_food': ('amenity', 'fast_food'), 'restaurant': ('amenity', 'restaurant'), 'grocery': ('shop', 'supermarket')}

# Food sub-kinds: a place in one of these is ALSO in fast_food or restaurant. The rules are COPIED from the Ryagram engine,
# ryagram/geo/categories.py DEFAULT (rows chicken, burger, pizza: requires, cuisine and brands, unchanged), and applied the same way as its
# classify(): the FIRST row that matches wins, so a place is in at most one of the three. Keep them in step with that file; do not add rules here.
SUBKINDS = (
    {"id": "chicken", "requires": [("amenity", ["fast_food", "restaurant"])], "tags": [], "cuisine": ["chicken"],
     "brands": ["kfc", "kentucky fried", "popeyes", "chick-fil-a", "raising cane", "wingstop", "bojangles", "zaxby", "church's chicken", "churchs chicken", "el pollo loco", "golden chick", "slim chickens", "bonchon", "lee's famous recipe"]},
    {"id": "burger", "requires": [("amenity", ["fast_food", "restaurant"])], "tags": [], "cuisine": ["burger"],
     "brands": ["mcdonald", "burger king", "wendy's", "wendys", "white castle", "five guys", "culver", "whataburger", "sonic drive", "jack in the box", "carl's jr", "hardee", "smashburger", "steak n shake", "in-n-out", "habit burger"]},
    {"id": "pizza", "requires": [("amenity", ["fast_food", "restaurant"])], "tags": [], "cuisine": ["pizza"],
     "brands": ["domino", "pizza hut", "papa john", "little caesars", "marco's pizza", "papa murphy", "jet's pizza", "cici's"]},
)


def subkind(tags):
    """The Ryagram engine's classify() (ryagram/geo/categories.py) over SUBKINDS: the id of the first row that matches, else None."""
    name = ' '.join(str(tags.get(k, '')) for k in ('name', 'brand', 'operator')).lower()
    cuisine = (tags.get('cuisine') or '').lower()
    for c in SUBKINDS:
        if any(tags.get(k) not in vals for k, vals in c.get('requires', [])):
            continue
        if any(tags.get(k) in vals for k, vals in c.get('tags', [])):
            return c['id']
        if any(w in cuisine for w in c.get('cuisine', [])) or any(b in name for b in c.get('brands', [])):
            return c['id']
    return None


def kinds_of(tags):
    """Every kind a place is in: its base kind (fast_food, restaurant or grocery) plus at most one food sub-kind."""
    out = [kind for kind, (k, v) in KINDS.items() if tags.get(k) == v]
    sub = subkind(tags)
    if sub:
        out.append(sub)
    return out


def places(args):
    out = pathlib.Path(args.out).resolve()
    if REPO in out.parents or out == REPO:
        sys.exit('REFUSED: the OpenStreetMap points must never be written inside the repo (attorney row G11).')
    rows, outside = [], 0
    for key in COUNTIES:
        # keep only the points INSIDE the county's own block groups (the queries used a box wider than the county; GAMES 08:44 LOW)
        js = (REPO / 'assets' / 'perfect-city' / f'{key}.census.js').read_text(encoding='utf-8')
        units = json.loads(js[js.index('] = ') + 4:].rstrip().rstrip(';'))['units']
        def inside(lon, lat, units=units):
            for u in units:
                n = 0
                for ring in u['rings']:
                    hit = False
                    for i in range(len(ring)):
                        (x1, y1), (x2, y2) = ring[i], ring[i - 1]
                        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                            hit = not hit
                    n += hit
                if n % 2 == 1:
                    return True
            return False
        for fname in ('osm_food_county', 'osm_grocery_county'):
            f = CACHE / key / f'{fname}.json'
            if not f.exists():
                continue
            doc = json.loads(f.read_text(encoding='utf-8'))
            for e in doc['elements']:
                tags = e.get('tags', {})
                lat = e.get('lat', e.get('center', {}).get('lat'))
                lon = e.get('lon', e.get('center', {}).get('lon'))
                if lat is None or lon is None:
                    continue
                if not inside(lon, lat):
                    outside += 1
                    continue
                for kind in kinds_of(tags):
                    name = (tags.get('name') or '')[:120]
                    rows.append((key, kind, f"{e['type'][0]}{e['id']}", name, round(lat, 6), round(lon, 6)))
    rows = sorted(set(rows))
    print('left out (outside the county):', outside, 'elements')
    q = lambda s: "'" + s.replace("'", "''") + "'"
    lines = ['-- Perfect City places (OpenStreetMap contributors, ODbL 1.0). PRIVATE until attorney row G11: never commit this file.',
             'begin;', 'delete from ryagram_private.perfect_city_places;']
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        lines.append('insert into ryagram_private.perfect_city_places (county, kind, osm_ref, name, lat, lon) values')
        lines.append(',\n'.join(f'({q(c)}, {q(k)}, {q(r)}, {q(n)}, {la}, {lo})' for c, k, r, n, la, lo in chunk) + ';')
    lines += ['commit;', f'select count(*) as places_loaded from ryagram_private.perfect_city_places;  -- expect {len(rows)}']
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
    from collections import Counter
    print(out, len(rows), 'places', dict(Counter((c, k) for c, k, *_ in rows)))


def units_seed(args):
    """The block-group centres and populations (US Census, public domain) as SQL for ryagram_private.perfect_city_units,
    read from the SAME page data files, so the server's people-within-a-ring numbers match the page's exactly."""
    rows = []
    for key in COUNTIES:
        js = (REPO / 'assets' / 'perfect-city' / f'{key}.census.js').read_text(encoding='utf-8')
        doc = json.loads(js[js.index('] = ') + 4:].rstrip().rstrip(';'))
        for u in doc['units']:
            if u['pop'] is not None:
                rows.append((key, u['id'], u['pop'], u['centre'][1], u['centre'][0]))
    lines = ['-- Perfect City block groups (GENERATED by tools/perfect-city/export_perfect_city.py units-seed from assets/perfect-city/*.census.js).',
             '-- US Census Bureau, 2020 Census P1 population and block-group centres (public domain). Safe in the repo; the OpenStreetMap places are NOT here.',
             'begin;', 'delete from ryagram_private.perfect_city_units;']
    for i in range(0, len(rows), 250):
        lines.append('insert into ryagram_private.perfect_city_units (county, geoid, pop, lat, lon) values')
        lines.append(',\n'.join(f"('{c}', '{g}', {p}, {la}, {lo})" for c, g, p, la, lo in rows[i:i + 250]) + ';')
    lines += ['commit;', f'select count(*) as units_loaded, sum(pop) as people from ryagram_private.perfect_city_units;  -- expect {len(rows)} and {sum(r[2] for r in rows)}']
    out = REPO / 'supabase' / 'live-steps' / 'perfect_city_units_seed.sql'
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
    print(out.relative_to(REPO), len(rows), 'block groups', sum(r[2] for r in rows), 'people')


# The OFFICIAL count of each kind in the county (GEO 11-27): U.S. Census Bureau, County Business Patterns (CBP), public domain,
# read from the bulk county files already in the cache (no network). There is no CBP code for chicken, burger or pizza places.
CBP_DIR = pathlib.Path(r'C:/Users/Ryan/Ryagram-cache/cbp_bulk')
CBP_NAICS = {'fast_food': '722513', 'restaurant': '722511', 'grocery': '445110'}
CBP_LABELS = {'722513': 'Limited-service restaurants', '722511': 'Full-service restaurants',
              '445110': 'Supermarkets and other grocery (except convenience) stores'}


def cbp_years():
    """The county-file years in the cache, newest first (cbpYYco.zip: 98 and 99 are 1998 and 1999)."""
    ys = []
    for f in CBP_DIR.glob('cbp??co.zip'):
        yy = int(f.name[3:5])
        ys.append(1900 + yy if yy >= 90 else 2000 + yy)
    return sorted(ys, reverse=True)


def cbp_counts(year, state, county):
    """{naics: est} for the CBP_NAICS codes in one county; a code with no row is absent (from 2017 on, CBP publishes
    a cell only with 3 or more establishments, so absent means fewer than 3 or none, never 0)."""
    import csv
    want = set(CBP_NAICS.values())
    out = {}
    with zipfile.ZipFile(CBP_DIR / f'cbp{year % 100:02d}co.zip') as z:
        name = [n for n in z.namelist() if n.lower().endswith('.txt')][0]
        with z.open(name) as fh:
            r = csv.reader(io.TextIOWrapper(fh, encoding='latin-1', newline=''))
            head = [h.strip().lower() for h in next(r)]
            i_s, i_c, i_n, i_e = (head.index(k) for k in ('fipstate', 'fipscty', 'naics', 'est'))
            for row in r:
                if row[i_s] == state and row[i_c] == county and row[i_n] in want:
                    out[row[i_n]] = int(row[i_e])
    return out


def official_block(year, meta):
    got = cbp_counts(year, meta['state'], meta['county'])
    kinds = {}
    for kind, code in CBP_NAICS.items():
        kinds[kind] = {'naics': code, 'label': CBP_LABELS[code], 'est': got.get(code)}
        if code not in got:
            kinds[kind]['note'] = 'fewer than 3 or none (not published)'
    return {'year': year,
            'source': f'U.S. Census Bureau, County Business Patterns {year}, county file cbp{year % 100:02d}co (establishments, by NAICS industry code): OBSERVED. Public domain (U.S. government work).',
            'not_counted': ['chicken', 'burger', 'pizza'],
            'kinds': kinds}


PAGE_HEAD = '// GENERATED by tools/perfect-city/export_perfect_city.py census: US Census data, public domain. Do not edit by hand.\n'


def read_page_doc(key):
    js = (REPO / 'assets' / 'perfect-city' / f'{key}.census.js').read_text(encoding='utf-8')
    return json.loads(js[js.index('] = ') + 4:].rstrip().rstrip(';'))


def write_page_doc(key, doc):
    path = REPO / 'assets' / 'perfect-city' / f'{key}.census.js'
    body = json.dumps(doc, separators=(',', ':'))
    path.write_text(PAGE_HEAD + f'(window.ryagramPerfectCityData = window.ryagramPerfectCityData || {{}})[{json.dumps(key)}] = {body};\n',
                    encoding='utf-8', newline='\n')
    return path


def official(args):
    """Adds (or replaces) the key 'official' in each page data file; every other field is read back and written unchanged."""
    years = cbp_years()
    if not years:
        sys.exit('REFUSED: no CBP county files in ' + str(CBP_DIR))
    year = years[0]
    for key, meta in COUNTIES.items():
        doc = read_page_doc(key)
        doc['official'] = official_block(year, meta)
        path = write_page_doc(key, doc)
        print(path.relative_to(REPO), year, {k: v['est'] for k, v in doc['official']['kinds'].items()})


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('census')
    sub.add_parser('units-seed')
    sub.add_parser('official')
    p = sub.add_parser('places'); p.add_argument('--out', required=True)
    a = ap.parse_args()
    {'census': census, 'places': places, 'units-seed': units_seed, 'official': official}[a.cmd](a)
