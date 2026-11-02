"""PRIVATE. Reads the four real files ENGINE fetched for the Chicken in Dayton demo (Ryan's Q362 yes) and writes ONE local file the demo page can load from this computer (NEXT-WEB 204).

    python tools/make-geo-real-inputs.py <folder holding ryagram/geo (a Ryagram checkout or an extract of it)> [--cache <the montgomery_oh folder>] [--out <file>]

It reads only local files (no network, nothing fetched). The output holds OpenStreetMap points (ODbL, share-alike) and Census data, so it is PRIVATE: the default place is
D:\\Ryagram-scratch\\WEB\\private\\geo-dayton-real.json, and the tool REFUSES to write inside any git repository or inside any folder the website is served from. Do not copy it into a repo, do not publish it, do not
share screenshots made from it until the attorney rows are answered (proposals/LEGAL-QUESTIONS-FOR-ATTORNEY.md, D1). The page reads it with a file chooser and uploads, stores and fetches nothing.
Every source, licence, retrieval date, size and fingerprint is copied from ENGINE's receipts into the file, and the page prints them.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
args = sys.argv[1:]
if not args or args[0].startswith('--'):
    sys.exit(__doc__)
engine = Path(args[0]).resolve()
opt = lambda name, default: Path(args[args.index(name) + 1]) if name in args else Path(default)
cache = opt('--cache', 'D:/Ryagram-cache/geo_intel/montgomery_oh').resolve()
out = opt('--out', 'D:/Ryagram-scratch/WEB/private/geo-dayton-real.json').resolve()

p = out.parent
while True:
    if (p / '.git').exists():
        sys.exit(f'REFUSED: {out} is inside a git repository ({p}). The real data is private; write it somewhere outside every repo.')
    if p.parent == p:
        break
    p = p.parent
if ROOT in out.parents:
    sys.exit('REFUSED: the output may not be inside the website folder.')

sys.path.insert(0, str(engine))
from ryagram.geo import loaders as L  # noqa: E402

need = ['bg_boundaries.zip', 'pop_p1_2020.json', 'income_b19013.json', 'osm_fast_food.json']
missing = [n for n in need if not (cache / n).exists()]
if missing:
    sys.exit(f'REFUSED: {cache} is missing {missing}. Nothing is fetched by this tool.')
bounds, dropped = L.read_boundaries_zip((cache / 'bg_boundaries.zip').read_bytes(), county_prefix='39113')
pop = L.parse_census_rows((cache / 'pop_p1_2020.json').read_text(encoding='utf-8'))
inc = L.parse_census_rows((cache / 'income_b19013.json').read_text(encoding='utf-8'))
pts = L.parse_overpass((cache / 'osm_fast_food.json').read_text(encoding='utf-8'))
areas, points, no_shape = L.build_inputs(bounds, pop, inc, pts)
points = [q for q in points if q['lon'] is not None and q['lat'] is not None and q['category'] in ('chicken', 'burger')]
keep = [a for a in areas if a['ring']]
lons = [x for a in keep for x, _ in a['ring']]; lats = [y for a in keep for _, y in a['ring']]
bbox = dict(lon0=min(lons), lat0=min(lats), lon1=max(lons), lat1=max(lats))
points = [q for q in points if bbox['lon0'] <= q['lon'] <= bbox['lon1'] and bbox['lat0'] <= q['lat'] <= bbox['lat1']]


def centroid(a):
    xs = [x for x, _ in a['ring']]; ys = [y for _, y in a['ring']]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def density(a):
    xs = [x for x, _ in a['ring']]; ys = [y for _, y in a['ring']]
    box = (max(xs) - min(xs)) * (max(ys) - min(ys))
    return (a['population'] or 0) / box if box else 0


with_pop = [a for a in keep if a['population'] is not None]
with_inc = [a for a in keep if a['income'] is not None]
picks = [('Most crowded area (an example site)', max(with_pop, key=density)), ('Highest median income area (an example site)', max(with_inc, key=lambda a: a['income'])),
         ('Least crowded area with people (an example site)', min([a for a in with_pop if a['population'] > 200], key=density))]
sites = [dict(id=f'S{i + 1}', name=n, lon=round(centroid(a)[0], 6), lat=round(centroid(a)[1], 6)) for i, (n, a) in enumerate(picks)]
sources = []
for n in need:
    rp = cache / (n + '.receipt.json')
    sources.append(json.loads(rp.read_text(encoding='utf-8')) if rp.exists() else {'file': n, 'note': 'no receipt found'})

doc = dict(schema='ryagram.geo-real-inputs/0', real=True,
           note='PRIVATE REAL DATA for the Chicken in Dayton demo (Ryan Q362). Contains OpenStreetMap data (ODbL, share-alike). Not for sharing, publishing or committing until the attorney rows are answered.',
           SOURCE='Census 2020 and ACS 2019-2023 block groups; fast-food points from OpenStreetMap', LABEL='Observed',
           credit='Map data \u00a9 OpenStreetMap contributors (ODbL 1.0). Population and income: U.S. Census Bureau (public domain).',
           categories={'chicken': 'Chicken places', 'burger': 'Burger places'},
           sorting_rule='A place is sorted as chicken or burger by its cuisine tag, then by a named brand list (ENGINE ryagram/geo/loaders.py). Many chicken places carry no cuisine tag. Other fast-food places are not drawn or counted.',
           sources=sources, bbox=bbox, areas=[dict(id=a['id'], ring=[[round(x, 6), round(y, 6)] for x, y in a['ring']], population=a['population'], income=a['income']) for a in keep],
           points=[dict(id=q['id'], lon=round(q['lon'], 6), lat=round(q['lat'], 6), category=q['category'], name=q.get('name', '')) for q in points], sites=sites,
           stats=dict(areas=len(keep), areas_without_population=len([a for a in keep if a['population'] is None]), areas_without_income=len([a for a in keep if a['income'] is None]),
                      points=len(points), chicken=len([q for q in points if q['category'] == 'chicken']), burger=len([q for q in points if q['category'] == 'burger']),
                      boundary_parts_dropped=dropped, figures_without_a_shape=len(no_shape)))
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8', newline='\n')
print('wrote', out, out.stat().st_size, 'bytes'); print(json.dumps(doc['stats']))
