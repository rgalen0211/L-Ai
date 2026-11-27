"""Zoom map data manifest (GEO 11-27): tests/zoom-map-data.json holds the data's VERSION (the one ?v= every data file is loaded
with) and the sha256 of the LF-normalised text of assets/zoom-map/states.js and every st-NN.js. tests/zoom-map.test.mjs recomputes
the hashes, so a data file that changes under the same VERSION fails until VERSION is bumped (in the exporter, the data and the page)
and this manifest is written again. The exporter writes it after every export; run it by hand only after a hand-made change:
  py -I -B tools/zoom-map/hash_zoom_map.py
Reads only the files in the repo; never the cache.
"""
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / 'assets' / 'zoom-map'
MANIFEST = ROOT / 'tests' / 'zoom-map-data.json'


def lf_sha256(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def data_version():
    """The version the states file says it is (the page's VERSION and the exporter's must equal it; the node test checks all three)."""
    m = re.search(r'"version":"([0-9a-z]+)"', (DATA / 'states.js').read_text(encoding='utf-8'))
    if not m:
        raise SystemExit('REFUSED: assets/zoom-map/states.js has no version')
    return m.group(1)


def write_manifest():
    files = ['states.js'] + sorted(p.name for p in DATA.glob('st-*.js') if re.fullmatch(r'st-\d{2}\.js', p.name))
    doc = {'version': data_version(), 'files': {f: lf_sha256(DATA / f) for f in files}}
    MANIFEST.write_text(json.dumps(doc, indent=1) + '\n', encoding='utf-8', newline='\n')
    return doc


if __name__ == '__main__':
    d = write_manifest()
    print(f'{MANIFEST.relative_to(ROOT)}: version {d["version"]}, {len(d["files"])} files')
