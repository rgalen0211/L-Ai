"""Writes (or checks) tests/fixtures/geo-site-comparison-demo.json: ENGINE's own comparison (ryagram.geo.compare.compare_sites, NEXT-ENGINE 70/71) run over the SYNTHETIC inputs in
tests/fixtures/geo-demo-inputs.json. That file is the JSON contract the website page and the engine both test: the page's JavaScript must give the same values, labels and structure for the same inputs
(tests/geo-contract.test.mjs), and ENGINE can run the same inputs through its own code and compare with this file.

    python tools/make-geo-fixture.py <path to a Ryagram checkout or a folder holding ryagram/geo>         writes the file
    python tools/make-geo-fixture.py <path> --check                                                       exits 1 if the committed file differs
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args:
    sys.exit(__doc__)
sys.path.insert(0, str(Path(args[0]).resolve()))
from ryagram.geo import catchment as C, compare as K, anatomy as AN  # noqa: E402

inp = json.loads((ROOT / 'tests/fixtures/geo-demo-inputs.json').read_text(encoding='utf-8'))
out = K.compare_sites([C.Site(s['id'], s['lon'], s['lat']) for s in inp['sites']], inp['radii_m'], inp['areas'], inp['points'], inp['categories'],
                      area_source=inp['area_source'], point_source=inp['point_source'], snapshot=inp['snapshot'])
# City Anatomy (ENGINE 75): the access share for every category at 0.5, 1 and 2 miles, over the same synthetic areas and points
anat = {'schema': 'ryagram.city-anatomy-set/0', 'note': 'ENGINE anatomy.access_share over the SYNTHETIC inputs; miles are keys', 'miles': [0.5, 1, 2], 'results': {}}
for cat in inp['categories']:
    anat['results'][cat] = {format(m, 'g'): AN.access_share(inp['areas'], inp['points'], cat, m, area_source=inp['area_source'], point_source=inp['point_source'], snapshot=inp['snapshot']) for m in anat['miles']}
anat['results']['nothing_listed'] = {'1': AN.access_share(inp['areas'], inp['points'], 'nothing_listed', 1, area_source=inp['area_source'], point_source=inp['point_source'], snapshot=inp['snapshot'])}
atext = json.dumps(anat, sort_keys=True, ensure_ascii=False, indent=1) + '\n'
adest = ROOT / 'tests/fixtures/geo-city-anatomy-demo.json'
text = json.dumps(out, sort_keys=True, ensure_ascii=False, indent=1) + '\n'
dest = ROOT / 'tests/fixtures/geo-site-comparison-demo.json'
if '--check' in sys.argv:
    same = dest.exists() and dest.read_text(encoding='utf-8').replace('\r\n', '\n') == text and adest.exists() and adest.read_text(encoding='utf-8').replace('\r\n', '\n') == atext
    print('same' if same else 'DIFFERENT'); sys.exit(0 if same else 1)
dest.write_text(text, encoding='utf-8', newline='\n'); adest.write_text(atext, encoding='utf-8', newline='\n'); print('wrote', dest, adest, len(text), len(atext), 'bytes')
